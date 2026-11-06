/**
 * The hand-written SDK against the IDL that `anchor build` produced (src/idl/leash.json, copied by
 * `pnpm sdk:sync-idl`): every discriminator, every instruction's account metas (order, signer, writable, fixed
 * addresses) and arg bytes, every account and event layout, and the error list. Values are random, generated
 * from the IDL types and encoded by an independent IDL-driven codec (helpers/idl.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Writer } from "../src/borsh";
import { LEASH_ERROR_NAMES, friendlyError } from "../src/errors";
import * as I from "../src/instructions";
import {
  ACCOUNT,
  EVENT_NAMES,
  IX,
  IX_NAMES,
  VAULT_ACCOUNT_INDEX,
  VAULT_ACCOUNT_SIZE,
  decodeEvent,
  decodeMandate,
  decodePayee,
  decodeRequest,
  decodeVault,
  instructionName,
  type LeashIxName,
  type MandateTermsArgs,
} from "../src/layout";
import type { Policy } from "../src/types";
import { accountData, camel, canon, discBytes, encode, fixedSize, idl, random, rng, toSdk, type IdlInstruction } from "./helpers/idl";

const PROGRAM_ID = new PublicKey(idl.address);
const eq = (a: Uint8Array | number[], b: Uint8Array | number[]) => Buffer.from(a).equals(Buffer.from(b));

test("program address is the deployed id", () => {
  assert.equal(idl.address, "Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");
});

test("instruction set and discriminators match the IDL", () => {
  assert.deepEqual([...IX_NAMES].sort(), idl.instructions.map((i) => i.name).sort());
  for (const ins of idl.instructions) {
    const ours = (IX as Record<string, Uint8Array>)[camel(ins.name)];
    assert.ok(ours, `IX.${camel(ins.name)} missing`);
    assert.ok(eq(ours, ins.discriminator), `${ins.name} discriminator`);
    assert.equal(instructionName(Uint8Array.from([...ins.discriminator, 1, 2, 3])), ins.name);
  }
});

test("account discriminators match the IDL", () => {
  assert.deepEqual(Object.keys(ACCOUNT).sort(), idl.accounts.map((a) => a.name).sort());
  for (const acc of idl.accounts) assert.ok(eq((ACCOUNT as Record<string, Uint8Array>)[acc.name], acc.discriminator), acc.name);
});

test("event names and discriminators match the IDL", () => {
  assert.deepEqual([...EVENT_NAMES].sort(), idl.events.map((e) => e.name).sort());
  for (const ev of idl.events) {
    const bytes = Uint8Array.from([...ev.discriminator, ...new Uint8Array(400)]);
    assert.equal(decodeEvent(bytes)?.name, ev.name, `${ev.name} discriminator`);
  }
});

test("error codes, names and friendly texts match the IDL", () => {
  assert.deepEqual(
    idl.errors.map((e) => `${e.code}:${e.name}`),
    LEASH_ERROR_NAMES.map((n, i) => `${6000 + i}:${n}`),
  );
  for (const n of LEASH_ERROR_NAMES) assert.notEqual(friendlyError(n).title, "Transaction failed", `friendly text for ${n}`);
});

test("vault account index per instruction matches the IDL", () => {
  for (const ins of idl.instructions) {
    assert.equal(VAULT_ACCOUNT_INDEX[ins.name as LeashIxName], ins.accounts.findIndex((a) => a.name === "vault"), ins.name);
  }
});

test("Vault account size = 8 + IDL Vault size", () => {
  assert.equal(VAULT_ACCOUNT_SIZE, 8 + fixedSize({ defined: { name: "Vault" } }));
});

// ── instruction builders: account metas + arg bytes vs the IDL ──

type Builder = (a: Record<string, PublicKey>, args: Record<string, unknown>) => TransactionInstruction;

const BUILDERS: Record<LeashIxName, Builder> = {
  initialize_vault: (a, x) =>
    I.initializeVaultIx(PROGRAM_ID, a as never, { vaultId: x.vaultId as bigint, agent: x.agent as PublicKey, policy: x.policy as Policy }),
  update_policy: (a, x) => I.updatePolicyIx(PROGRAM_ID, a.owner, a.vault, x.policy as Policy),
  set_agent: (a, x) => I.setAgentIx(PROGRAM_ID, a.owner, a.vault, x.newAgent as PublicKey),
  set_paused: (a, x) => I.setPausedIx(PROGRAM_ID, a.owner, a.vault, x.paused as boolean),
  reset_strikes: (a) => I.resetStrikesIx(PROGRAM_ID, a.owner, a.vault),
  add_payee: (a, x) => I.addPayeeIx(PROGRAM_ID, a as never, x as never),
  update_payee: (a, x) => I.updatePayeeIx(PROGRAM_ID, a as never, x as never),
  remove_payee: (a) => I.removePayeeIx(PROGRAM_ID, a as never),
  create_mandate: (a, x) => I.createMandateIx(PROGRAM_ID, a as never, x as never),
  redeem_signed_mandate: (a, x) => I.redeemSignedMandateIx(PROGRAM_ID, a as never, x.terms as MandateTermsArgs),
  bump_mandate_seq: (a, x) => I.bumpMandateSeqIx(PROGRAM_ID, a.owner, a.vault, x.newSeq as bigint),
  revoke_mandate: (a) => I.revokeMandateIx(PROGRAM_ID, a as never),
  close_mandate: (a) => I.closeMandateIx(PROGRAM_ID, a as never),
  agent_spend: (a, x) => I.spendIx(PROGRAM_ID, a as never, x as never, false),
  guarded_spend: (a, x) => I.spendIx(PROGRAM_ID, a as never, x as never, true),
  request_spend: (a, x) => I.requestSpendIx(PROGRAM_ID, a as never, x as never),
  approve_request: (a) => I.approveRequestIx(PROGRAM_ID, a as never),
  reject_request: (a) => I.rejectRequestIx(PROGRAM_ID, a as never),
  close_request: (a) => I.closeRequestIx(PROGRAM_ID, a as never),
  withdraw: (a, x) => I.withdrawIx(PROGRAM_ID, a as never, x.amount as bigint),
  close_vault: (a) => I.closeVaultIx(PROGRAM_ID, a as never),
};

function idlIxBytes(ins: IdlInstruction, args: Record<string, unknown>): Uint8Array {
  const w = new Writer().raw(discBytes(ins.discriminator));
  for (const f of ins.args) encode(w, f.type, args[f.name]);
  return w.bytes();
}

for (const ins of idl.instructions) {
  test(`ix ${ins.name}: accounts and data match the IDL`, () => {
    const r = rng(ins.name.length * 7919 + ins.discriminator[0]);
    for (let round = 0; round < 12; round++) {
      const named: Record<string, PublicKey> = {};
      for (const acc of ins.accounts) if (!acc.address) named[camel(acc.name)] = new PublicKey(r.bytes(32));
      const args = Object.fromEntries(ins.args.map((f) => [f.name, random(f.type, r, f.name)]));
      const sdkArgs = Object.fromEntries(ins.args.map((f) => [camel(f.name), toSdk(f.type, args[f.name])]));
      const built = BUILDERS[ins.name as LeashIxName](named, sdkArgs);

      assert.ok(built.programId.equals(PROGRAM_ID));
      assert.equal(built.keys.length, ins.accounts.length, `${ins.name}: account count`);
      ins.accounts.forEach((acc, i) => {
        const k = built.keys[i];
        const want = acc.address ? new PublicKey(acc.address) : named[camel(acc.name)];
        assert.ok(k.pubkey.equals(want), `${ins.name}: account #${i} should be ${acc.name}`);
        assert.equal(k.isSigner, !!acc.signer, `${ins.name}.${acc.name} signer`);
        assert.equal(k.isWritable, !!acc.writable, `${ins.name}.${acc.name} writable`);
      });
      assert.equal(Buffer.from(built.data).toString("hex"), Buffer.from(idlIxBytes(ins, args)).toString("hex"), `${ins.name}: data`);
    }
  });
}

test("optional accounts absent = program id, read-only", () => {
  const k = () => new PublicKey(rng(1).bytes(32));
  const spend = I.spendIx(
    PROGRAM_ID,
    { agent: k(), vault: k(), mint: k(), vaultAta: k(), recipientAta: k(), payeeAccount: null, mandateAccount: undefined, tokenProgram: k() },
    { amount: 1n, reasonHash: new Uint8Array(32) },
  );
  for (const i of [5, 6]) {
    assert.ok(spend.keys[i].pubkey.equals(PROGRAM_ID));
    assert.equal(spend.keys[i].isWritable, false);
  }
});

// ── account + event decoders vs IDL-encoded random values ──

const ACCOUNT_DECODERS: Record<string, { decode: (d: Uint8Array) => unknown; omit: string[] }> = {
  Vault: { decode: (d) => decodeVault(d), omit: [] },
  Payee: { decode: (d) => decodePayee(PublicKey.default, d), omit: ["bump"] },
  Mandate: { decode: (d) => decodeMandate(PublicKey.default, d), omit: ["bump"] },
  SpendRequest: { decode: (d) => decodeRequest(PublicKey.default, d), omit: ["bump"] },
};

for (const acc of idl.accounts) {
  test(`account ${acc.name}: decoder reads every IDL field`, () => {
    const dec = ACCOUNT_DECODERS[acc.name];
    assert.ok(dec, `no decoder for ${acc.name}`);
    const r = rng(acc.discriminator[0] * 31 + 5);
    for (let round = 0; round < 20; round++) {
      const value = random({ defined: { name: acc.name } }, r) as Record<string, unknown>;
      const decoded = dec.decode(accountData(acc.name, value));
      const type = { defined: { name: acc.name } };
      assert.deepEqual(canon(type, decoded, true, dec.omit), canon(type, value, false, dec.omit));
    }
  });
}

for (const ev of idl.events) {
  test(`event ${ev.name}: decoder reads every IDL field`, () => {
    const r = rng(ev.discriminator[0] * 17 + 3);
    for (let round = 0; round < 20; round++) {
      const type = { defined: { name: ev.name } };
      const value = random(type, r) as Record<string, unknown>;
      const bytes = encode(new Writer().raw(discBytes(ev.discriminator)), type, value).bytes();
      const decoded = decodeEvent(bytes);
      assert.equal(decoded?.name, ev.name);
      assert.deepEqual(canon(type, decoded!.data, true), canon(type, value, false));
    }
  });
}

test("events from the first program version still decode (appended fields absent)", () => {
  const r = rng(99);
  const spend = random({ defined: { name: "SpendExecuted" } }, r) as Record<string, unknown>;
  spend.request = null;
  const full = encode(new Writer().raw(discBytes(idl.events.find((e) => e.name === "SpendExecuted")!.discriminator)), { defined: { name: "SpendExecuted" } }, spend).bytes();
  const legacy = decodeEvent(full.slice(0, full.length - 1)); // old layout: no trailing Option<Pubkey>
  assert.equal(legacy?.name, "SpendExecuted");
  assert.equal(legacy?.name === "SpendExecuted" && legacy.data.request, null);

  const blocked = random({ defined: { name: "PaymentBlocked" } }, r) as Record<string, unknown>;
  blocked.strike = false;
  const fullB = encode(new Writer().raw(discBytes(idl.events.find((e) => e.name === "PaymentBlocked")!.discriminator)), { defined: { name: "PaymentBlocked" } }, blocked).bytes();
  const legacyB = decodeEvent(fullB.slice(0, fullB.length - 1));
  assert.equal(legacyB?.name === "PaymentBlocked" && legacyB.data.strike, true, "every old block was a strike");
});
