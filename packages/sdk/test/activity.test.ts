/**
 * Judge #12: the activity feed must not show fake BLOCKED entries. A failure counts only when the runtime says a
 * top-level Leash payment instruction for *this* vault failed with a Leash error; events count only when emitted
 * inside a Leash frame for this vault.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, type VersionedTransactionResponse } from "@solana/web3.js";
import { Buffer } from "buffer";
import { activityFromTransaction, leashFailure, topLevelInstructions, type TopLevelInstruction } from "../src/activity";
import { parseLeashErrorFromLogs } from "../src/errors";
import { spendIx, requestSpendIx, updatePolicyIx } from "../src/instructions";
import { MEMO_PROGRAM_ID, REASON_MEMO_PREFIX } from "../src/utils";
import { eventData } from "./helpers/idl";

const PID = new PublicKey("Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");
const pk = () => Keypair.generate().publicKey;
const VAULT = pk();
const OTHER_VAULT = pk();
const EVIL = pk();
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const anchorErr = (name: string, code: number) =>
  `Program log: AnchorError occurred. Error Code: ${name}. Error Number: ${code}. Error Message: ${name} happened.`;
const failedLine = (p: PublicKey, code: number) => `Program ${p.toBase58()} failed: custom program error: 0x${code.toString(16)}`;

function spendFor(vault: PublicKey, amount = 500_000_000n): TopLevelInstruction {
  const ix = spendIx(
    PID,
    { agent: pk(), vault, mint: pk(), vaultAta: pk(), recipientAta: pk(), tokenProgram: TOKEN },
    { amount, reasonHash: new Uint8Array(32).fill(7) },
  );
  return { programId: ix.programId, accounts: ix.keys.map((k) => k.pubkey), data: Uint8Array.from(ix.data) };
}

const memoIx: TopLevelInstruction = { programId: MEMO_PROGRAM_ID, accounts: [], data: Buffer.from(`${REASON_MEMO_PREFIX}send it`) };
const memoLogs = [
  `Program ${MEMO_PROGRAM_ID.toBase58()} invoke [1]`,
  `Program log: Memo (len 20): "${REASON_MEMO_PREFIX}send it"`,
  `Program ${MEMO_PROGRAM_ID.toBase58()} success`,
];
const leashFailLogs = (name: string, code: number) => [
  ...memoLogs,
  `Program ${PID.toBase58()} invoke [1]`,
  "Program log: Instruction: AgentSpend",
  anchorErr(name, code),
  `Program ${PID.toBase58()} consumed 9000 of 200000 compute units`,
  failedLine(PID, code),
];

test("a refused agent_spend on this vault is one blocked event with name, amount and reason", () => {
  const events = activityFromTransaction(PID, VAULT, {
    sig: "s1",
    ts: 100,
    logs: leashFailLogs("PayeeNotAuthorized", 6004),
    err: { InstructionError: [1, { Custom: 6004 }] },
    instructions: [memoIx, spendFor(VAULT)],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "blocked");
  assert.equal(events[0].errorName, "PayeeNotAuthorized");
  assert.equal(events[0].instruction, "agent_spend");
  assert.equal(events[0].amount, 500_000_000n);
  assert.equal(events[0].reason, "send it");
});

test("a Leash refusal for another vault that merely mentions this one is ignored", () => {
  const ix = spendFor(OTHER_VAULT);
  ix.accounts.push(VAULT); // extra account so the tx shows up in this vault's signature list
  const events = activityFromTransaction(PID, VAULT, {
    sig: "s2",
    ts: 100,
    logs: leashFailLogs("PayeeNotAuthorized", 6004),
    err: { InstructionError: [1, { Custom: 6004 }] },
    instructions: [memoIx, ix],
  });
  assert.deepEqual(events, []);
});

test("another program printing a Leash AnchorError and returning 6004 is not a Leash refusal", () => {
  const logs = [
    `Program ${EVIL.toBase58()} invoke [1]`,
    anchorErr("PayeeNotAuthorized", 6004),
    failedLine(EVIL, 6004),
  ];
  const tx = { sig: "s3", ts: 100, logs, err: { InstructionError: [0, { Custom: 6004 }] } };
  const evilIx: TopLevelInstruction = { programId: EVIL, accounts: [VAULT], data: new Uint8Array(16) };
  assert.deepEqual(activityFromTransaction(PID, VAULT, { ...tx, instructions: [evilIx] }), []);
  assert.equal(leashFailure(PID, tx.err, logs, [evilIx]), null);
  assert.equal(leashFailure(PID, tx.err, logs), null, "logs only: last top-level frame is not Leash");
  assert.equal(parseLeashErrorFromLogs(logs, PID), undefined);
});

test("a forged error line in another frame doesn't rename the real Leash error", () => {
  const logs = [
    `Program ${EVIL.toBase58()} invoke [1]`,
    anchorErr("PayeeNotAuthorized", 6004),
    `Program ${EVIL.toBase58()} success`,
    `Program ${PID.toBase58()} invoke [1]`,
    anchorErr("ExceedsDailyCap", 6011),
    failedLine(PID, 6011),
  ];
  const evilIx: TopLevelInstruction = { programId: EVIL, accounts: [], data: new Uint8Array(8) };
  const [ev] = activityFromTransaction(PID, VAULT, { sig: "s4", ts: 1, logs, err: { InstructionError: [1, { Custom: 6011 }] }, instructions: [evilIx, spendFor(VAULT)] });
  assert.equal(ev.errorName, "ExceedsDailyCap");
  assert.equal(parseLeashErrorFromLogs(logs, PID)?.name, "ExceedsDailyCap");
  assert.equal(parseLeashErrorFromLogs(logs)?.name, "PayeeNotAuthorized", "legacy mode trusts the first line (why the frame check exists)");
});

test("failures without instructions, non-payment instructions and non-Leash codes are not blocked payments", () => {
  const err = { InstructionError: [1, { Custom: 6004 }] };
  assert.deepEqual(activityFromTransaction(PID, VAULT, { sig: "a", ts: 1, logs: leashFailLogs("PayeeNotAuthorized", 6004), err }), []);

  const upd = updatePolicyIx(PID, pk(), VAULT, {
    perTxCap: 0n,
    dailyCap: 0n,
    cosignThreshold: 0n,
    requestTtlSecs: 0,
    freezeAfterStrikes: 0,
    cosignWindowThreshold: 0n,
    enforceTripwire: false,
  });
  const updIx = { programId: upd.programId, accounts: upd.keys.map((k) => k.pubkey), data: Uint8Array.from(upd.data) };
  assert.deepEqual(
    activityFromTransaction(PID, VAULT, { sig: "b", ts: 1, logs: leashFailLogs("InvalidPolicy", 6018), err: { InstructionError: [1, { Custom: 6018 }] }, instructions: [memoIx, updIx] }),
    [],
  );
  // token-program error propagated through Leash (code 1) is not a Leash error code
  assert.deepEqual(
    activityFromTransaction(PID, VAULT, { sig: "c", ts: 1, logs: leashFailLogs("X", 1), err: { InstructionError: [1, { Custom: 1 }] }, instructions: [memoIx, spendFor(VAULT)] }),
    [],
  );
});

test("request_spend refusals carry payee and amount from the instruction", () => {
  const payee = pk();
  const r = requestSpendIx(PID, { agent: pk(), vault: VAULT, request: pk() }, { payee, amount: 250_000n, reasonHash: new Uint8Array(32) });
  const ix = { programId: r.programId, accounts: r.keys.map((k) => k.pubkey), data: Uint8Array.from(r.data) };
  const [ev] = activityFromTransaction(PID, VAULT, { sig: "r", ts: 1, logs: leashFailLogs("TooManyOpenRequests", 6024), err: { InstructionError: [1, { Custom: 6024 }] }, instructions: [memoIx, ix] });
  assert.equal(ev.errorName, "TooManyOpenRequests");
  assert.equal(ev.payee, payee.toBase58());
  assert.equal(ev.amount, 250_000n);
});

test("successful txs: only events inside a Leash frame and for this vault", () => {
  const blocked = eventData("PaymentBlocked", {
    vault: VAULT,
    attempted_payee: EVIL,
    amount: 7n,
    reason_code: 6004,
    reason_hash: new Uint8Array(32),
    blocked_count: 3n,
    strikes: 1,
    ts: 50n,
    strike: true,
  });
  const benign = eventData("PaymentBlocked", {
    vault: VAULT,
    attempted_payee: EVIL,
    amount: 9n,
    reason_code: 6011,
    reason_hash: new Uint8Array(32),
    blocked_count: 4n,
    strikes: 1,
    ts: 51n,
    strike: false,
  });
  const otherVaultSpend = eventData("SpendExecuted", {
    vault: OTHER_VAULT,
    payee: EVIL,
    amount: 1n,
    reason_hash: new Uint8Array(32),
    memo: null,
    via: { variant: 0 },
    ts: 52n,
    request: null,
  });
  const logs = [
    `Program ${PID.toBase58()} invoke [1]`,
    `Program data: ${blocked}`,
    `Program data: ${benign}`,
    `Program data: ${otherVaultSpend}`,
    `Program ${PID.toBase58()} success`,
    `Program ${EVIL.toBase58()} invoke [1]`,
    `Program data: ${blocked}`, // forged copy from another program
    `Program ${EVIL.toBase58()} success`,
  ];
  const events = activityFromTransaction(PID, VAULT, { sig: "ok", ts: 1, logs, err: null });
  assert.deepEqual(
    events.map((e) => [e.kind, e.errorName, e.strike, e.amount]),
    [
      ["blocked", "PayeeNotAuthorized", true, 7n],
      ["blocked", "ExceedsDailyCap", false, 9n],
    ],
  );
});

test("a co-signed payment links back to its request", () => {
  const request = pk();
  const spent = eventData("SpendExecuted", {
    vault: VAULT,
    payee: EVIL,
    amount: 300_000n,
    reason_hash: new Uint8Array(32),
    memo: null,
    via: { variant: 2 },
    ts: 60n,
    request,
  });
  const logs = [`Program ${PID.toBase58()} invoke [1]`, `Program data: ${spent}`, `Program ${PID.toBase58()} success`];
  const [ev] = activityFromTransaction(PID, VAULT, { sig: "a", ts: 1, logs, err: null });
  assert.equal(ev.kind, "spent");
  assert.equal(ev.via, "request");
  assert.equal(ev.request, request.toBase58());
});

test("topLevelInstructions resolves legacy and v0 messages", () => {
  const payer = pk();
  const ix = new TransactionInstruction({ programId: PID, keys: [{ pubkey: VAULT, isSigner: false, isWritable: true }], data: Buffer.from([1, 2, 3]) });
  const blockhash = pk().toBase58();
  for (const message of [
    new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ix] }).compileToLegacyMessage(),
    new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message(),
  ]) {
    const tx = { transaction: { message, signatures: [] }, meta: null } as unknown as VersionedTransactionResponse;
    const out = topLevelInstructions(tx);
    assert.ok(out);
    assert.ok(out[0].programId.equals(PID));
    assert.ok(out[0].accounts[0].equals(VAULT));
    assert.deepEqual([...out[0].data], [1, 2, 3]);
  }
});
