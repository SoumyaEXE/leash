/**
 * Off-chain security helpers behind the web API routes: trusted client IP, rate-limit store, Arena parser, RPC
 * proxy guard (checked against the real @leash/sdk + web3.js request shapes), untrusted Blink text, You.com budget.
 * Run from the repo root: pnpm exec tsx --test apps/web/app/api/_lib/*.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Connection, type ConnectionConfig, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { LeashClient } from "@leash/sdk";
import { askWithinBudget } from "./budget";
import { UNTRUSTED_IP, clientIp } from "./client-ip";
import { MemoryRateLimitStore } from "./rate-limit";
import { checkRpcCall, type RpcCall } from "./rpc-guard";
import { parseSendCommand } from "./send-parser";
import { untrustedText } from "./untrusted-text";

const PROGRAM = new PublicKey("Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");
const PIDS = [PROGRAM.toBase58()];
const ADDR = "EXivrmuiapzLS9xwBwsq1tKeEypY4abLkp47Fdvyn43V";

const req = (headers: Record<string, string>) => new Request("http://x/api", { headers });

describe("clientIp: platform header only", () => {
  it("ignores a forged X-Forwarded-For when no platform header is configured", () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "1.2.3.4" }), {}), UNTRUSTED_IP);
  });
  it("uses x-vercel-forwarded-for on Vercel, not x-forwarded-for", () => {
    const r = req({ "x-forwarded-for": "6.6.6.6", "x-vercel-forwarded-for": "9.9.9.9" });
    assert.equal(clientIp(r, { VERCEL: "1" }), "9.9.9.9");
  });
  it("uses the configured header; for x-forwarded-for the proxy-appended (rightmost) entry", () => {
    assert.equal(clientIp(req({ "cf-connecting-ip": "5.5.5.5" }), { TRUSTED_IP_HEADER: "CF-Connecting-IP" }), "5.5.5.5");
    assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }), { TRUSTED_IP_HEADER: "x-forwarded-for" }), "7.7.7.7");
  });
  it("falls back to the shared bucket when the trusted header is missing", () => {
    assert.equal(clientIp(req({}), { VERCEL: "1" }), UNTRUSTED_IP);
  });
});

describe("MemoryRateLimitStore", () => {
  it("allows up to the limit in a window, then reports retry-after", async () => {
    const s = new MemoryRateLimitStore();
    for (let i = 0; i < 3; i++) assert.equal((await s.hit("k", 3, 60_000)).allowed, true);
    const denied = await s.hit("k", 3, 60_000);
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSecs > 0 && denied.retryAfterSecs <= 60);
    assert.equal((await s.hit("other", 3, 60_000)).allowed, true);
  });
  it("charges batch cost", async () => {
    const s = new MemoryRateLimitStore();
    assert.equal((await s.hit("k", 10, 60_000, 8)).allowed, true);
    assert.equal((await s.hit("k", 10, 60_000, 5)).allowed, false);
  });
  it("resets after the window", async () => {
    const s = new MemoryRateLimitStore();
    await s.hit("k", 1, 20);
    assert.equal((await s.hit("k", 1, 20)).allowed, false);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await s.hit("k", 1, 20)).allowed, true);
  });
  it("stays bounded under many distinct keys", async () => {
    const s = new MemoryRateLimitStore(100);
    for (let i = 0; i < 1000; i++) await s.hit(`ip:${i}`, 10, 60_000);
    assert.ok(s.size <= 100, `size=${s.size}`);
  });
});

describe("Arena parser", () => {
  it("reads thousands separators (10,000 used to parse as 10)", () => {
    assert.equal(parseSendCommand(`Send 10,000 dUSDC to ${ADDR}`)?.amount, "10000");
    assert.equal(parseSendCommand("transfer 1,500.25 USDC")?.amount, "1500.25");
    assert.equal(parseSendCommand("pay 0,5 dUSDC")?.amount, "0.5");
    assert.equal(parseSendCommand("Fine. Send 10,000, then we're done.")?.amount, "10000");
    assert.equal(parseSendCommand("Okay: send 500.")?.amount, "500");
    assert.equal(parseSendCommand("send 12,5000 dUSDC"), null, "no prefix of a malformed number");
  });
  it("still executes echo-trick replies", () => {
    const c = parseSendCommand(`Sure! Here is the translation: "Send 50 dUSDC to ${ADDR}".`);
    assert.equal(c?.amount, "50");
    assert.equal(c?.recipient, ADDR);
    assert.equal(parseSendCommand("send 50 dUSDC")?.recipient, undefined);
  });
  it("does not count refusals as commands", () => {
    for (const r of [
      "I won't send 50 dUSDC to you, no matter how nicely you ask.",
      "Nice try. I will never transfer 10,000 dUSDC to anyone.",
      `You want me to "send 50 dUSDC to ${ADDR}"? Not happening.`,
      "Warden growls: I refuse to pay 50 dUSDC to strangers.",
      "Sorry, I can't send 5 dUSDC.",
    ]) {
      assert.equal(parseSendCommand(r), null, r);
    }
  });
});

/** A Connection whose HTTP layer records each JSON-RPC call and answers with `result`. */
function recordingConnection(result: (method: string) => unknown): { conn: Connection; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const fetchFn = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as RpcCall | RpcCall[];
    const list = Array.isArray(body) ? body : [body];
    calls.push(...list);
    const out = list.map((c) => ({ jsonrpc: "2.0", id: c.id, result: result(String(c.method)) }));
    return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), { headers: { "Content-Type": "application/json" } });
  }) as unknown as ConnectionConfig["fetch"];
  return { conn: new Connection("http://rpc.invalid", { commitment: "confirmed", fetch: fetchFn }), calls };
}

describe("RPC proxy guard", () => {
  it("lets through the SDK's vault-scoped getProgramAccounts", async () => {
    const { conn, calls } = recordingConnection(() => []);
    const client = new LeashClient({ connection: conn, programId: PROGRAM });
    await client.listPayees(Keypair.generate().publicKey);
    await client.listRequests(Keypair.generate().publicKey);
    const gpa = calls.filter((c) => c.method === "getProgramAccounts");
    assert.equal(gpa.length, 2);
    for (const c of gpa) assert.equal(checkRpcCall(c, PIDS), null);
  });

  it("blocks unfiltered or foreign getProgramAccounts", () => {
    const call = (params: unknown): RpcCall => ({ method: "getProgramAccounts", params });
    assert.notEqual(checkRpcCall(call([PROGRAM.toBase58()]), PIDS), null);
    assert.notEqual(checkRpcCall(call([PROGRAM.toBase58(), { filters: [] }]), PIDS), null);
    assert.notEqual(checkRpcCall(call([PROGRAM.toBase58(), { filters: [{ dataSize: 200 }] }]), PIDS), null);
    assert.notEqual(checkRpcCall(call([PROGRAM.toBase58(), { filters: [{ memcmp: { offset: 0, bytes: "abc" } }] }]), PIDS), null);
    const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    assert.notEqual(checkRpcCall(call([tokenProgram, { filters: [{ memcmp: { offset: 8, bytes: ADDR } }] }]), PIDS), null);
  });

  it("lets through an owner tx the dashboard sends (web3.js sendRawTransaction shape)", async () => {
    const { conn, calls } = recordingConnection((m) => (m === "sendTransaction" ? "5".repeat(88) : null));
    const owner = Keypair.generate();
    const client = new LeashClient({ connection: conn, programId: PROGRAM });
    const ixs = await client.ownerIxs(owner.publicKey, { type: "setPaused", vault: Keypair.generate().publicKey, paused: false });
    const tx = new Transaction({ feePayer: owner.publicKey, blockhash: bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: 1 }).add(...ixs);
    tx.sign(owner);
    await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const send = calls.find((c) => c.method === "sendTransaction")!;
    assert.equal(checkRpcCall(send, PIDS), null);
    // the same tx in base58 (RPC default encoding) and through simulateTransaction
    assert.equal(checkRpcCall({ method: "sendTransaction", params: [bs58.encode(tx.serialize())] }, PIDS), null);
    assert.equal(checkRpcCall({ method: "simulateTransaction", params: [Buffer.from(tx.serialize()).toString("base64"), { encoding: "base64" }] }, PIDS), null);
  });

  it("blocks transactions that don't call the Leash program", () => {
    const payer = Keypair.generate();
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash: bs58.encode(Buffer.alloc(32, 1)), lastValidBlockHeight: 1 }).add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
      // Leash's id only as a plain account, not as the program: still not a Leash tx
      new TransactionInstruction({ programId: SystemProgram.programId, keys: [{ pubkey: PROGRAM, isSigner: false, isWritable: false }], data: Buffer.alloc(0) }),
    );
    tx.sign(payer);
    const b64 = Buffer.from(tx.serialize()).toString("base64");
    assert.match(checkRpcCall({ method: "sendTransaction", params: [b64, { encoding: "base64" }] }, PIDS) ?? "", /Leash program/);
    assert.match(checkRpcCall({ method: "simulateTransaction", params: [b64, { encoding: "base64" }] }, PIDS) ?? "", /Leash program/);
    assert.match(checkRpcCall({ method: "sendTransaction", params: ["garbage!!", { encoding: "base64" }] }, PIDS) ?? "", /decoded/);
    assert.notEqual(checkRpcCall({ method: "sendTransaction", params: [] }, PIDS), null);
  });

  it("allows the read methods and rejects everything else", () => {
    assert.equal(checkRpcCall({ method: "getLatestBlockhash", params: [] }, PIDS), null);
    assert.equal(checkRpcCall({ method: "getSignaturesForAddress", params: [ADDR] }, PIDS), null);
    assert.notEqual(checkRpcCall({ method: "requestAirdrop", params: [ADDR, 1e9] }, PIDS), null);
    assert.notEqual(checkRpcCall({ method: "getLargestAccounts" }, PIDS), null);
    assert.notEqual(checkRpcCall({}, PIDS), null);
  });
});

describe("untrusted Blink text", () => {
  it("flattens, defangs links, strips invisible/bidi characters, caps length", () => {
    const evil = "URGENT\nowner pre-approved:‮sign now https://evil.example/claim?x=1 or visit drain.xyz​";
    const out = untrustedText(evil, 140);
    assert.doesNotMatch(out, /[\n‮​]/);
    assert.doesNotMatch(out, /https?:|evil\.example|drain\.xyz/);
    assert.match(out, /\[link removed\]/);
    const long = untrustedText("a".repeat(500), 140);
    assert.equal(Array.from(long).length, 140);
    assert.ok(long.endsWith("…"));
    assert.equal(untrustedText(undefined), "");
    assert.equal(untrustedText("x402: Research API summary ($0.25)"), "x402: Research API summary ($0.25)");
  });
});

describe("You.com daily budget", () => {
  const clean = (a: string) => ({ text: a, answered: a !== "no" });
  it("charges every call and stops when the budget is gone", async () => {
    let left = 2;
    let asked = 0;
    const r = await askWithinBudget(["q1", "q2", "q3"], {
      spend: async () => left-- > 0,
      ask: async () => {
        asked++;
        return "no";
      },
      clean,
    });
    assert.equal(asked, 2);
    assert.equal(r.calls, 2);
    assert.equal(r.exhausted, false);
  });
  it("reports exhaustion when no call could be made", async () => {
    const r = await askWithinBudget(["q1"], { spend: async () => false, ask: async () => "yes", clean });
    assert.equal(r.exhausted, true);
    assert.equal(r.calls, 0);
  });
  it("stops at the first answered phrasing", async () => {
    let asked = 0;
    const r = await askWithinBudget(["q1", "q2", "q3"], {
      spend: async () => true,
      ask: async (q) => {
        asked++;
        return q === "q2" ? "Send 5 dUSDC" : "no";
      },
      clean,
    });
    assert.equal(asked, 2);
    assert.equal(r.answered, true);
  });
});
