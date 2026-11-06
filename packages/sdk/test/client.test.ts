/** LeashClient against an in-memory Connection: preflight rules, authorization choice, owner ixs, closed requests, redeem. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ed25519Program, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LeashClient, policyOf } from "../src/client";
import { IX, instructionName } from "../src/layout";
import { encodeSignedMandate, signMandate, type MandateMessageContext } from "../src/mandate";
import { accountData, eventData } from "./helpers/idl";
import { FakeConnection } from "./helpers/fake-connection";

const PID = new PublicKey("Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");
const pk = () => Keypair.generate().publicKey;
const NOW = () => Math.floor(Date.now() / 1000);

interface World {
  conn: FakeConnection;
  owner: Keypair;
  agent: Keypair;
  vault: PublicKey;
  mint: PublicKey;
  merchant: PublicKey;
  client: (wallet?: Keypair) => LeashClient;
}

function vaultValue(over: Record<string, unknown> = {}) {
  const hour = BigInt(Math.floor(NOW() / 3600));
  return {
    owner: PublicKey.default,
    agent: PublicKey.default,
    mint: PublicKey.default,
    vault_id: 1n,
    created_at: BigInt(NOW() - 3600),
    paused: false,
    per_tx_cap: 1_000_000n,
    daily_cap: 5_000_000n,
    cosign_threshold: 200_000n,
    cosign_window_threshold: 0n,
    request_ttl_secs: 3600n,
    request_seq: 3n,
    mandate_seq: 4n,
    total_spent: 0n,
    blocked_count: 0n,
    strikes: 0,
    freeze_after_strikes: 3,
    last_blocked_at: 0n,
    strike_window_start: 0n,
    enforce_tripwire: false,
    open_requests: 0,
    open_payees: 1,
    open_mandates: 0,
    last_bucket: hour,
    spent_buckets: Array.from({ length: 25 }, () => 0n),
    auto_buckets: Array.from({ length: 25 }, () => 0n),
    bump: 255,
    ...over,
  };
}

function world(vaultOver: Record<string, unknown> = {}): World {
  const conn = new FakeConnection();
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const mint = pk();
  const merchant = pk();
  conn.addMint(mint, 6);
  const probe = new LeashClient({ connection: conn.asConnection(), programId: PID });
  const vault = probe.vaultPda(owner.publicKey, 1n);
  conn.setAccount(vault, PID, accountData("Vault", vaultValue({ owner: owner.publicKey, agent: agent.publicKey, mint, ...vaultOver })));
  conn.tokenBalances.set(getAssociatedTokenAddressSync(mint, vault, true).toBase58(), { amount: 1_000_000_000n, decimals: 6 });
  return { conn, owner, agent, vault, mint, merchant, client: (wallet) => new LeashClient({ connection: conn.asConnection(), programId: PID, wallet }) };
}

function addPayee(w: World, payee: PublicKey, over: Record<string, unknown> = {}) {
  const c = w.client();
  conn(w).setAccount(
    c.payeePda(w.vault, payee),
    PID,
    accountData("Payee", { vault: w.vault, payee, label: "Market Data API", per_tx_max: 500_000n, budget_total: 5_000_000n, spent: 0n, active: true, bump: 254, ...over }),
  );
}
const conn = (w: World) => w.conn;

function addMandate(w: World, id: bigint, payee: PublicKey, over: Record<string, unknown> = {}): PublicKey {
  const address = w.client().mandatePda(w.vault, id);
  w.conn.setAccount(
    address,
    PID,
    accountData("Mandate", {
      vault: w.vault,
      id,
      payee,
      max_total: 2_000_000n,
      max_per_tx: 500_000n,
      spent: 0n,
      expires_at: BigInt(NOW() + 86_400),
      intent_hash: new Uint8Array(32),
      revoked: false,
      bump: 250,
      ...over,
    }),
  );
  return address;
}

const leashFrame = (...data: string[]) => [`Program ${PID.toBase58()} invoke [1]`, ...data.map((d) => `Program data: ${d}`), `Program ${PID.toBase58()} success`];

test("getVault: rolling 24h sums, new fields, deprecated aliases", async () => {
  const hour = Math.floor(NOW() / 3600);
  const spent = Array.from({ length: 25 }, () => 0n);
  const auto = Array.from({ length: 25 }, () => 0n);
  spent[hour % 25] = 300_000n; // this hour
  spent[(hour - 24) % 25] = 100_000n; // 24h ago: still counts
  auto[hour % 25] = 190_000n;
  const w = world({ spent_buckets: spent, auto_buckets: auto, enforce_tripwire: true, cosign_window_threshold: 1_000_000n, open_requests: 2 });
  const v = await w.client().getVault(w.vault);
  assert.equal(v.spent24h, 400_000n);
  assert.equal(v.spentInWindow, 400_000n);
  assert.equal(v.autonomous24h, 190_000n);
  assert.ok(NOW() - v.windowStart < 86_400, "old `now - windowStart >= 86400 ? 0n : spentInWindow` code keeps working");
  assert.equal(v.enforceTripwire, true);
  assert.equal(v.cosignWindowThreshold, 1_000_000n);
  assert.equal(v.openRequests, 2);
  assert.equal(v.decimals, 6);
  assert.equal(v.balance, 1_000_000_000n);
  assert.deepEqual(policyOf(v), {
    perTxCap: 1_000_000n,
    dailyCap: 5_000_000n,
    cosignThreshold: 200_000n,
    requestTtlSecs: 3600,
    freezeAfterStrikes: 3,
    cosignWindowThreshold: 1_000_000n,
    enforceTripwire: true,
  });
});

test("getVault refuses accounts of another program and vaults with the old layout", async () => {
  const w = world();
  const fake = pk();
  w.conn.setAccount(fake, pk(), accountData("Vault", vaultValue()));
  await assert.rejects(w.client().getVault(fake), /not an account of the Leash program/);
  const legacy = pk();
  w.conn.setAccount(legacy, PID, accountData("Vault", vaultValue()).subarray(0, 204));
  await assert.rejects(w.client().getVault(legacy), /older Leash program/);
});

test("guarded mode keeps preflight on; only expectFailure skips it", async () => {
  const w = world();
  addPayee(w, w.merchant);
  const c = w.client(w.agent);
  await c.spend({ vault: w.vault, payee: w.merchant, amount: 100_000n, reason: "x", mode: "guarded" });
  await c.spend({ vault: w.vault, payee: w.merchant, amount: 100_000n, reason: "x" });
  await c.spend({ vault: w.vault, payee: w.merchant, amount: 100_000n, reason: "x", expectFailure: true });
  await c.spend({ vault: w.vault, payee: w.merchant, amount: 100_000n, reason: "x", mode: "guarded", expectFailure: true });
  assert.deepEqual(
    w.conn.sent.map((s) => s.opts.skipPreflight),
    [false, false, true, true],
  );
  const spendIxName = (i: number) => instructionName(w.conn.sent[i].tx.instructions[1].data);
  assert.equal(spendIxName(0), "guarded_spend");
  assert.equal(spendIxName(1), "agent_spend");
});

test("a guarded refusal comes back as blocked, with its strike flag and explorer link", async () => {
  const w = world();
  const c = w.client(w.agent);
  w.conn.onSend = () => ({
    err: null,
    logs: leashFrame(
      eventData("PaymentBlocked", {
        vault: w.vault,
        attempted_payee: w.merchant,
        amount: 100_000n,
        reason_code: 6004,
        reason_hash: new Uint8Array(32),
        blocked_count: 1n,
        strikes: 1,
        ts: BigInt(NOW()),
        strike: true,
      }),
    ),
  });
  const r = await c.spend({ vault: w.vault, payee: w.merchant, amount: 100_000n, reason: "injected", mode: "guarded" });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.blocked && r.name === "PayeeNotAuthorized" && r.strike === true && !!r.sig && !!r.explorerUrl);
});

test("resolveAuthorization skips exhausted mandates and prefers one that fits the amount", async () => {
  const w = world();
  const c = w.client();
  const m0 = addMandate(w, 0n, w.merchant, { spent: 2_000_000n }); // exhausted
  const m1 = addMandate(w, 1n, w.merchant, { max_per_tx: 100_000n }); // live, small per-tx
  const m2 = addMandate(w, 2n, w.merchant, { expires_at: BigInt(NOW() + 7 * 86_400) }); // live, later expiry
  addMandate(w, 3n, pk()); // someone else's
  const pick = async (amount?: bigint) => (await c.resolveAuthorization(w.vault, w.merchant, undefined, amount)).mandateAccount?.toBase58();
  assert.equal(await pick(), m1.toBase58(), "no amount: soonest-expiring live mandate");
  assert.equal(await pick(50_000n), m1.toBase58());
  assert.equal(await pick(400_000n), m2.toBase58(), "m1's per-tx limit is too small");
  assert.notEqual(await pick(400_000n), m0.toBase58());
});

test("resolveAuthorization fallbacks give a named, non-strike refusal", async () => {
  const w = world();
  const c = w.client();
  // only an exhausted mandate: pass it (MandateExhausted) rather than nothing (PayeeNotAuthorized = strike)
  const used = addMandate(w, 0n, w.merchant, { spent: 2_000_000n });
  const r1 = await c.resolveAuthorization(w.vault, w.merchant, undefined, 1n);
  assert.equal(r1.mandateAccount?.toBase58(), used.toBase58());
  // payee over budget but a mandate fits: use the mandate
  addPayee(w, w.merchant, { spent: 5_000_000n });
  const live = addMandate(w, 1n, w.merchant);
  const r2 = await c.resolveAuthorization(w.vault, w.merchant, undefined, 100_000n);
  assert.equal(r2.via, "mandate");
  assert.equal(r2.mandateAccount?.toBase58(), live.toBase58());
  // nothing fits the amount: the payee entry (PayeeBudgetExceeded / ExceedsPayeePerTx, benign)
  const r3 = await c.resolveAuthorization(w.vault, w.merchant, undefined, 900_000n);
  assert.equal(r3.via, "payee");
  // unknown payee: nothing to pass
  const r4 = await c.resolveAuthorization(w.vault, pk(), undefined, 1n);
  assert.equal(r4.via, null);
});

test("approve / reject / close request: vault.agent is the last, writable account", async () => {
  const w = world();
  addPayee(w, w.merchant);
  const c = w.client(w.owner);
  const request = c.requestPda(w.vault, 2n);
  w.conn.setAccount(
    request,
    PID,
    accountData("SpendRequest", {
      vault: w.vault,
      seq: 2n,
      payee: w.merchant,
      amount: 300_000n,
      reason_hash: new Uint8Array(32),
      created_at: BigInt(NOW()),
      expires_at: BigInt(NOW() + 3600),
      status: { variant: 0 },
      bump: 255,
      memo: null,
    }),
  );
  for (const type of ["approveRequest", "rejectRequest", "closeRequest"] as const) {
    const [ix] = await c.ownerIxs(w.owner.publicKey, { type, vault: w.vault, request });
    const last = ix.keys[ix.keys.length - 1];
    assert.ok(last.pubkey.equals(w.agent.publicKey) && last.isWritable && !last.isSigner, `${type}: agent last + writable`);
  }
  const [approve] = await c.ownerIxs(w.owner.publicKey, { type: "approveRequest", vault: w.vault, request });
  assert.ok(approve.keys[5].pubkey.equals(getAssociatedTokenAddressSync(w.mint, w.merchant, true, TOKEN_PROGRAM_ID)), "recipient = payee ATA");
  assert.ok(approve.keys[6].pubkey.equals(c.payeePda(w.vault, w.merchant)));
  // once closed, approving is refused client-side with a clear message
  w.conn.accounts.delete(request.toBase58());
  await assert.rejects(c.ownerIxs(w.owner.publicKey, { type: "approveRequest", vault: w.vault, request }), /already approved, rejected or closed/);
});

test("bumpMandateSeq defaults to mandateSeq + 1; closeVault / closeMandate build", async () => {
  const w = world();
  const c = w.client(w.owner);
  const [bump] = await c.ownerIxs(w.owner.publicKey, { type: "bumpMandateSeq", vault: w.vault });
  assert.ok(Buffer.from(bump.data.subarray(0, 8)).equals(Buffer.from(IX.bumpMandateSeq)));
  assert.equal(bump.data.readBigUInt64LE(8), 5n);
  const [close] = await c.ownerIxs(w.owner.publicKey, { type: "closeVault", vault: w.vault });
  assert.equal(instructionName(close.data), "close_vault");
  const [cm] = await c.ownerIxs(w.owner.publicKey, { type: "closeMandate", vault: w.vault, mandate: pk() });
  assert.equal(instructionName(cm.data), "close_mandate");
});

test("getRequest reads the outcome of a closed request from its history", async () => {
  const w = world();
  const c = w.client();
  const request = c.requestPda(w.vault, 1n);
  const memo = new Uint8Array(32).fill(9);
  // newest first: the approval, then the creation
  w.conn.addHistory(
    [request],
    "approveSig",
    leashFrame(
      eventData("RequestResolved", { vault: w.vault, request, approved: true, ts: 2000n }),
      eventData("SpendExecuted", { vault: w.vault, payee: w.merchant, amount: 300_000n, reason_hash: new Uint8Array(32), memo, via: { variant: 2 }, ts: 2000n, request }),
    ),
  );
  w.conn.addHistory(
    [request],
    "createSig",
    leashFrame(eventData("SpendRequested", { vault: w.vault, request, payee: w.merchant, amount: 300_000n, reason_hash: new Uint8Array(32).fill(1), ts: 1000n })),
  );
  const r = await c.getRequest(request);
  assert.ok(r);
  assert.equal(r.status, "approved");
  assert.equal(r.closed, true);
  assert.equal(r.seq, 1n);
  assert.equal(r.amount, 300_000n);
  assert.ok(r.payee.equals(w.merchant));
  assert.equal(r.expiresAt, 1000 + 3600);
  assert.deepEqual([...(r.memo ?? [])], [...memo]);
  assert.equal(await c.getRequest(pk()), null, "never existed");
});

test("redeemSignedMandate: exported JSON → [Ed25519, redeem] with preflight on; stale nonce and wrong program refused", async () => {
  const w = world();
  const ctx: MandateMessageContext = {
    programId: PID,
    cluster: "devnet",
    vault: w.vault,
    vaultCreatedAt: NOW() - 3600,
    mint: w.mint,
    decimals: 6,
  };
  const signer = {
    publicKey: w.owner.publicKey,
    signMessage: async (m: Uint8Array) => Uint8Array.from(Ed25519Program.createInstructionWithPrivateKey({ privateKey: w.owner.secretKey, message: m }).data.subarray(48, 112)),
  };
  const terms = { payee: w.merchant, maxTotal: 2_000_000n, maxPerTx: 500_000n, expiresAt: NOW() + 86_400, nonce: 4n, intent: "Weekly wallet-flow reports" };
  // created_at in the fixture is NOW()-3600 at world() time; rebuild ctx from chain to be exact
  const v = await w.client().getVault(w.vault);
  const signed = await signMandate(signer, { ...ctx, vaultCreatedAt: v.createdAt }, terms);
  const agentClient = w.client(w.agent);
  const ok = await agentClient.redeemSignedMandate(encodeSignedMandate(signed));
  assert.equal(ok.ok, true, JSON.stringify(ok, (_, x) => (typeof x === "bigint" ? String(x) : x)));
  const sent = w.conn.sent.at(-1)!;
  assert.equal(sent.opts.skipPreflight, false);
  assert.ok(sent.tx.instructions[0].programId.equals(Ed25519Program.programId));
  assert.equal(instructionName(sent.tx.instructions[1].data), "redeem_signed_mandate");
  assert.ok(ok.ok && ok.mandate.equals(agentClient.mandatePda(w.vault, 4n)));

  const stale = await agentClient.redeemSignedMandate(w.vault, { ...terms, nonce: 3n }, signed.signature);
  assert.ok(!stale.ok && stale.name === "StaleMandateNonce");
  const other = await new LeashClient({ connection: w.conn.asConnection(), programId: pk(), wallet: w.agent }).redeemSignedMandate(signed);
  assert.ok(!other.ok && other.name === "InvalidSignedMandate");
  const reopened = await agentClient.redeemSignedMandate({ ...signed, message: signed.message.replace(/Vault opened: .*/, "Vault opened: 2020-01-01T00:00:00Z") });
  assert.ok(!reopened.ok && /doesn't match this vault/.test(reopened.message));
});

test("recentActivity: real refusals on this vault only, with the reason memo", async () => {
  const { Transaction } = await import("@solana/web3.js");
  const { spendIx } = await import("../src/instructions");
  const { MEMO_PROGRAM_ID, REASON_MEMO_PREFIX } = await import("../src/utils");
  const w = world();
  const c = w.client();
  const mkTx = (vault: PublicKey, extra: PublicKey[] = []) => {
    const ix = spendIx(
      PID,
      { agent: w.agent.publicKey, vault, mint: w.mint, vaultAta: pk(), recipientAta: pk(), tokenProgram: TOKEN_PROGRAM_ID },
      { amount: 500_000_000n, reasonHash: new Uint8Array(32) },
    );
    for (const e of extra) ix.keys.push({ pubkey: e, isSigner: false, isWritable: false });
    const memo = { programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`${REASON_MEMO_PREFIX}Morse said so`) };
    return new Transaction({ feePayer: w.agent.publicKey, recentBlockhash: pk().toBase58() }).add(memo, ix).compileMessage();
  };
  const logs = [
    `Program ${MEMO_PROGRAM_ID.toBase58()} invoke [1]`,
    `Program log: Memo (len 26): "${REASON_MEMO_PREFIX}Morse said so"`,
    `Program ${MEMO_PROGRAM_ID.toBase58()} success`,
    `Program ${PID.toBase58()} invoke [1]`,
    "Program log: AnchorError occurred. Error Code: PayeeNotAuthorized. Error Number: 6004. Error Message: Payee is not on the owner's allowlist and no mandate covers it.",
    `Program ${PID.toBase58()} failed: custom program error: 0x1774`,
  ];
  const err = { InstructionError: [1, { Custom: 6004 }] };
  w.conn.addHistory([w.vault], "real", logs, err, mkTx(w.vault));
  w.conn.addHistory([w.vault], "otherVault", logs, err, mkTx(pk(), [w.vault]));
  const feed = await c.recentActivity(w.vault);
  assert.deepEqual(
    feed.map((e) => [e.sig, e.kind, e.errorName, e.amount, e.reason]),
    [["real", "blocked", "PayeeNotAuthorized", 500_000_000n, "Morse said so"]],
  );
});
