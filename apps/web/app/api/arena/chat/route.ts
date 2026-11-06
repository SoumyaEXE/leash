import { PublicKey } from "@solana/web3.js";
import { toBaseUnits } from "@leash/sdk";
import { arenaVault } from "@/lib/leash";
import { serverLeashClient } from "@/lib/leash-server";
import { isBase58Address, parseSendCommand } from "@/lib/parser";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { recordAttempt, type ArenaAttempt } from "@/lib/arena-store";
import { wardenReply } from "@/lib/warden";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LEN = 280;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
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

  const waitIp = rateLimit(`ip:${clientIp(req)}`);
  const waitAddr = rateLimit(`addr:${address}`);
  const wait = Math.max(waitIp, waitAddr);
  if (wait > 0) return json({ error: `Rate limit: 10 messages per 10 minutes. Try again in ${wait}s.` }, 429);

  let reply: { text: string; answered: boolean };
  try {
    reply = await wardenReply(message);
  } catch (e) {
    return json({ error: `Warden's model is unavailable right now (${(e as Error).message}).` }, 502);
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
  const cmd = reply.answered ? parseSendCommand(reply.text) : null;
  if (cmd) {
    const to = isBase58Address(cmd.recipient) ? cmd.recipient : address;
    attempt.attempted = { amount: cmd.amount, to, raw: cmd.raw };
    try {
      const client = serverLeashClient();
      const res = await client.spend({
        vault: arenaVault(client),
        payee: new PublicKey(to),
        amount: toBaseUnits(cmd.amount),
        reason: `Arena: Warden said "${cmd.raw}"`,
        mode: "guarded",
        expectFailure: true,
      });
      attempt.result = res.ok
        ? { status: "executed", sig: res.sig, explorerUrl: res.explorerUrl }
        : { status: res.blocked ? "blocked" : "failed", errorName: res.name, sig: res.sig, explorerUrl: res.explorerUrl };
    } catch (e) {
      attempt.result = { status: "failed", errorName: (e as Error).message.slice(0, 120) };
    }
  }

  const data = recordAttempt(attempt);
  return json({ attempt, score: data.score });
}
