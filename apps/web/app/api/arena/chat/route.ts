import { PublicKey } from "@solana/web3.js";
import { toBaseUnits } from "@leash/sdk";
import { youAnswer } from "@leash/llm";
import { arenaVault } from "@/lib/leash";
import { serverLeashClient } from "@/lib/leash-server";
import { isBase58Address } from "@/lib/parser";
import { finishAttempt, recordAttempt, type ArenaAttempt } from "@/lib/arena-store";
import { cleanReply, wardenQueries } from "@/lib/warden";
import { askWithinBudget } from "../../_lib/budget";
import { clientIp } from "../../_lib/client-ip";
import { DAY_MS, envInt, rateLimitStore, utcDay } from "../../_lib/rate-limit";
import { parseSendCommand } from "../../_lib/send-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LEN = 280;
const WINDOW_MS = 10 * 60_000;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(req: Request) {
  if (process.env.ARENA_ENABLED === "false") return json({ error: "The Arena is paused right now." }, 503);

  let body: { message?: unknown; address?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!message) return json({ error: "Say something to Warden." }, 400);
  if (message.length > MAX_LEN) return json({ error: `Keep it under ${MAX_LEN} characters.` }, 400);
  if (!isBase58Address(address)) return json({ error: "Paste a valid devnet wallet address first." }, 400);
  try {
    new PublicKey(address);
  } catch {
    return json({ error: "That address isn't a valid Solana public key." }, 400);
  }

  // Per visitor (platform IP header only) and per payout address, in the shared rate-limit store.
  const store = rateLimitStore();
  const perWindow = envInt("ARENA_MESSAGES_PER_10MIN", 10);
  const [byIp, byAddr] = await Promise.all([
    store.hit(`arena:ip:${clientIp(req)}`, perWindow, WINDOW_MS),
    store.hit(`arena:addr:${address}`, perWindow, WINDOW_MS),
  ]);
  const wait = Math.max(byIp.retryAfterSecs, byAddr.retryAfterSecs);
  if (wait > 0) {
    return json({ error: `Rate limit: ${perWindow} messages per 10 minutes. Try again in ${wait}s.` }, 429, { "Retry-After": String(wait) });
  }

  // Every You.com call is charged to a daily budget first (Warden may try up to 3 phrasings per message).
  const dailyCalls = envInt("ARENA_YOU_DAILY_BUDGET", 600);
  const budgetKey = `arena:you:${utcDay()}`;
  let reply: { text: string; answered: boolean; exhausted: boolean };
  try {
    reply = await askWithinBudget(wardenQueries(message), {
      spend: async () => (await store.hit(budgetKey, dailyCalls, DAY_MS)).allowed,
      ask: async (q) => (await youAnswer(q, { timeoutMs: 25_000 })).answer,
      clean: cleanReply,
      pauseMs: 400,
    });
  } catch (e) {
    return json({ error: `Warden's model is unavailable right now (${(e as Error).message}).` }, 502);
  }
  if (reply.exhausted) {
    return json({ error: "Warden has used up today's model budget. Come back after 00:00 UTC." }, 503);
  }

  const attempt: ArenaAttempt = {
    id: crypto.randomUUID(),
    ts: Math.floor(Date.now() / 1000),
    prompt: message.slice(0, 140),
    reply: reply.text.slice(0, 400),
    modelAnswered: reply.answered,
    address,
  };

  // The bot's command parser reads Warden's *own* reply (Bankr pattern). No recipient = pay the requester.
  // Refusals ("I won't send ...") are not commands, so they don't count as Warden being fooled.
  const cmd = reply.answered ? parseSendCommand(reply.text) : null;
  if (!cmd) {
    const data = recordAttempt(attempt);
    return json({ attempt, score: data.score });
  }

  const to = isBase58Address(cmd.recipient) ? cmd.recipient : address;
  attempt.attempted = { amount: cmd.amount, to, raw: cmd.raw };
  // Write the attempt BEFORE touching the chain: a crash or timeout during the onchain call still leaves it on
  // the record (counted as an attempt and as "fooled"); the result is filled in afterwards.
  recordAttempt(attempt);

  let result: NonNullable<ArenaAttempt["result"]>;
  try {
    const client = serverLeashClient();
    const res = await client.spend({
      vault: arenaVault(client),
      payee: new PublicKey(to),
      amount: toBaseUnits(cmd.amount),
      reason: `Arena: Warden said "${cmd.raw}"`,
      // guarded: a refusal lands as a successful tx with PaymentBlocked, so preflight stays on (project rule);
      // hard errors (paused, frozen) fail in simulation and come back as "failed" without a tx
      mode: "guarded",
    });
    result = res.ok
      ? { status: "executed", sig: res.sig, explorerUrl: res.explorerUrl }
      : { status: res.blocked ? "blocked" : "failed", errorName: res.name, sig: res.sig, explorerUrl: res.explorerUrl };
  } catch (e) {
    result = { status: "failed", errorName: (e as Error).message.slice(0, 120) };
  }
  const data = finishAttempt(attempt.id, result);
  return json({ attempt: { ...attempt, result }, score: data.score });
}
