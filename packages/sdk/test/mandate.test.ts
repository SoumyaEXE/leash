/**
 * T5 readable mandates: the SDK must produce byte-for-byte the message programs/leash/src/mandate_msg.rs rebuilds.
 * Vectors are the Rust unit tests (ui_amounts, iso_dates, intents) and the wallet text the LiteSVM tests sign
 * (tests/leash.rs `wallet_text` / `owner_text`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { Ed25519Program, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { redeemSignedMandateIx } from "../src/instructions";
import {
  MAX_EXPIRES_AT,
  MAX_INTENT_LEN,
  buildMandateMessage,
  decodeSignedMandate,
  encodeSignedMandate,
  mandateIntentError,
  mandateIsoTime,
  mandateMessageText,
  mandateTermsError,
  mandateUiAmount,
  signMandate,
  type MandateMessageContext,
} from "../src/mandate";
import type { MandateTermsArgs } from "../src/layout";

const PROGRAM_ID = new PublicKey("Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");

/** Sign like a wallet's signMessage: plain Ed25519 over the bytes (web3.js precompile helper signs with noble). */
function keypairSigner(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    async signMessage(message: Uint8Array) {
      const ix = Ed25519Program.createInstructionWithPrivateKey({ privateKey: kp.secretKey, message });
      return Uint8Array.from(ix.data.subarray(48, 112));
    },
  };
}

function ed25519Verify(pubkey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubkey.toBytes())]);
  return verify(null, message, createPublicKey({ key: der, format: "der", type: "spki" }), signature);
}

test("ui amounts match mandate_msg::ui_amount", () => {
  assert.equal(mandateUiAmount(1_000_000n, 6), "1.00");
  assert.equal(mandateUiAmount(500_000n, 6), "0.50");
  assert.equal(mandateUiAmount(1_234_500n, 6), "1.2345");
  assert.equal(mandateUiAmount(1n, 6), "0.000001");
  assert.equal(mandateUiAmount(10_000_000_000n, 6), "10000.00");
  assert.equal(mandateUiAmount(5n, 0), "5");
  assert.equal(mandateUiAmount(50n, 1), "5.0");
  assert.equal(mandateUiAmount(2n ** 64n - 1n, 18), "18.446744073709551615");
  assert.equal(mandateUiAmount(0n, 6), "0.00");
});

test("ISO times match mandate_msg::iso8601 (no milliseconds)", () => {
  assert.equal(mandateIsoTime(0), "1970-01-01T00:00:00Z");
  assert.equal(mandateIsoTime(951_782_400), "2000-02-29T00:00:00Z");
  assert.equal(mandateIsoTime(1_794_052_800), "2026-11-07T12:00:00Z");
  assert.equal(mandateIsoTime(MAX_EXPIRES_AT), "9999-12-31T23:59:59Z");
  assert.throws(() => mandateIsoTime(MAX_EXPIRES_AT + 1));
});

test("intent rules match mandate_msg::validate_intent", () => {
  assert.equal(mandateIntentError("Buy one research report"), null);
  assert.notEqual(mandateIntentError(""), null);
  assert.notEqual(mandateIntentError("line\nMax total: 1000"), null);
  assert.notEqual(mandateIntentError("café"), null);
  assert.notEqual(mandateIntentError("‮evil"), null, "bidi override");
  assert.notEqual(mandateIntentError("x".repeat(MAX_INTENT_LEN + 1)), null);
  assert.equal(mandateIntentError("x".repeat(MAX_INTENT_LEN)), null);
});

const vault = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const payee = Keypair.generate().publicKey;
/** The LiteSVM tests open their vault at T0 = 2026-11-06T21:20:00Z. */
const OPENED = Date.UTC(2026, 10, 6, 21, 20, 0) / 1000;
const ctx: MandateMessageContext = { programId: PROGRAM_ID, cluster: "devnet", vault, vaultCreatedAt: OPENED, mint, decimals: 6 };
const terms: MandateTermsArgs = {
  payee,
  maxTotal: 1_000_000n,
  maxPerTx: 500_000n,
  expiresAt: 1_794_052_800,
  nonce: 0n,
  intent: "Buy one research report from Acme Research",
};

test("message text = the wallet text the program tests sign", () => {
  const expected =
    `Leash spending mandate v2\nProgram: ${PROGRAM_ID.toBase58()}\nCluster: devnet\nVault: ${vault.toBase58()}\n` +
    `Vault opened: 2026-11-06T21:20:00Z\nPayee: ${payee.toBase58()}\nMint: ${mint.toBase58()}\nMax total: 1.00\n` +
    `Max per payment: 0.50\nExpires: 2026-11-07T12:00:00Z\nNonce: 0\nIntent: Buy one research report from Acme Research`;
  assert.equal(mandateMessageText(ctx, terms), expected);
  assert.ok(Buffer.from(buildMandateMessage(ctx, terms)).equals(Buffer.from(expected, "utf8")));
  assert.ok(!expected.endsWith("\n"));
});

test("message binds cluster, program, vault opening time, mint and decimals", () => {
  const base = mandateMessageText(ctx, terms);
  assert.match(mandateMessageText({ ...ctx, cluster: "mainnet-beta" }, terms), /\nCluster: mainnet-beta\n/);
  assert.notEqual(mandateMessageText({ ...ctx, programId: Keypair.generate().publicKey }, terms), base);
  assert.notEqual(mandateMessageText({ ...ctx, vaultCreatedAt: OPENED + 1 }, terms), base);
  assert.notEqual(mandateMessageText({ ...ctx, mint: Keypair.generate().publicKey }, terms), base);
  assert.match(mandateMessageText({ ...ctx, decimals: 9 }, terms), /Max total: 0\.001\n/);
  assert.throws(() => mandateMessageText(ctx, { ...terms, intent: "two\nlines" }));
});

test("terms checks mirror the program's InvalidMandateTerms / InvalidIntent", () => {
  const now = 1_794_000_000;
  assert.equal(mandateTermsError(terms, now), null);
  assert.notEqual(mandateTermsError({ ...terms, maxTotal: 0n }, now), null);
  assert.notEqual(mandateTermsError({ ...terms, maxPerTx: 2_000_000n }, now), null);
  assert.notEqual(mandateTermsError({ ...terms, expiresAt: now }, now), null);
  assert.notEqual(mandateTermsError({ ...terms, expiresAt: MAX_EXPIRES_AT + 1 }, now), null);
  assert.notEqual(mandateTermsError({ ...terms, intent: "" }, now), null);
});

test("signMandate → export JSON → decode round trip, and the signature verifies", async () => {
  const owner = Keypair.generate();
  const future = { ...terms, expiresAt: Math.floor(Date.now() / 1000) + 86_400 };
  const signed = await signMandate(keypairSigner(owner), ctx, future);
  assert.equal(signed.message, mandateMessageText(ctx, future));
  assert.ok(ed25519Verify(owner.publicKey, new TextEncoder().encode(signed.message), signed.signature));

  const json = encodeSignedMandate(signed);
  const parsed = JSON.parse(json);
  assert.equal(parsed.type, "leash-signed-mandate");
  assert.equal(parsed.terms.maxTotal, "1000000", "base units as strings (bigint-safe)");
  const back = decodeSignedMandate(json);
  assert.ok(back.vault.equals(vault) && back.owner.equals(owner.publicKey) && back.programId.equals(PROGRAM_ID));
  assert.deepEqual({ ...back.terms, payee: back.terms.payee.toBase58() }, { ...future, payee: future.payee.toBase58() });
  assert.ok(Buffer.from(back.signature).equals(Buffer.from(signed.signature)));
  // hex signatures are accepted too
  const hex = decodeSignedMandate({ ...parsed, signature: Buffer.from(signed.signature).toString("hex") });
  assert.ok(Buffer.from(hex.signature).equals(Buffer.from(signed.signature)));
  assert.throws(() => decodeSignedMandate({ ...parsed, version: 1 }));
  assert.throws(() => decodeSignedMandate({ ...parsed, signature: "abc" }));
});

test("signMandate refuses terms the program would refuse", async () => {
  const owner = Keypair.generate();
  await assert.rejects(signMandate(keypairSigner(owner), ctx, { ...terms, expiresAt: 1 }));
  await assert.rejects(signMandate(keypairSigner(owner), ctx, { ...terms, expiresAt: Math.floor(Date.now() / 1000) + 60, intent: "café" }));
});

test("Ed25519 verify ix uses u16::MAX instruction indices and carries the exact message", () => {
  const owner = Keypair.generate();
  const message = buildMandateMessage(ctx, terms);
  const ix = Ed25519Program.createInstructionWithPrivateKey({ privateKey: owner.secretKey, message });
  const d = Buffer.from(ix.data);
  assert.equal(d[0], 1, "one signature");
  const u16 = (o: number) => d.readUInt16LE(o);
  // [sig_off, sig_ix, pk_off, pk_ix, msg_off, msg_len, msg_ix] after the 2-byte header
  assert.deepEqual([u16(4), u16(8), u16(14)], [0xffff, 0xffff, 0xffff]);
  assert.ok(d.subarray(u16(6), u16(6) + 32).equals(Buffer.from(owner.publicKey.toBytes())));
  assert.ok(d.subarray(u16(10), u16(10) + u16(12)).equals(Buffer.from(message)));
});

test("[Ed25519, redeem_signed_mandate] with the largest terms fits in one transaction (1232 bytes)", () => {
  const owner = Keypair.generate();
  const agent = Keypair.generate();
  const max = 2n ** 64n - 1n;
  const big: MandateTermsArgs = { payee, maxTotal: max, maxPerTx: max, expiresAt: MAX_EXPIRES_AT, nonce: max, intent: "~".repeat(MAX_INTENT_LEN) };
  const message = buildMandateMessage({ ...ctx, decimals: 6 }, big);
  const verifyIx = Ed25519Program.createInstructionWithPrivateKey({ privateKey: owner.secretKey, message });
  const redeem = redeemSignedMandateIx(PROGRAM_ID, { agent: agent.publicKey, vault, mandate: Keypair.generate().publicKey, mint }, big);
  const tx = new Transaction({ feePayer: agent.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(verifyIx, redeem);
  tx.sign(agent);
  const size = tx.serialize().length;
  assert.ok(size <= 1232, `tx is ${size} bytes`);
});
