/**
 * Readable, domain-bound signed mandates (T5). The owner signs a plain UTF-8 message with a wallet `signMessage`
 * (no transaction, no SOL); the agent redeems it with `[Ed25519 verify, redeem_signed_mandate]`. The program
 * rebuilds the exact same bytes from the instruction args and its accounts (programs/leash/src/mandate_msg.rs)
 * and checks the owner's signature over them, so what the wallet shows is exactly what is enforced.
 *
 *   Leash spending mandate v2
 *   Program: <program id>
 *   Cluster: devnet
 *   Vault: <vault PDA>
 *   Vault opened: <vault.created_at, ISO>
 *   Payee: <payee wallet>
 *   Mint: <vault mint>
 *   Max total: <ui amount>
 *   Max per payment: <ui amount>
 *   Expires: <ISO>
 *   Nonce: <vault.mandate_seq>
 *   Intent: <intent text>
 */
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { MandateTermsArgs } from "./layout";
import { fromHex } from "./utils";

export const MANDATE_HEADER = "Leash spending mandate v2";
/** Intent text: 1..=100 bytes of printable ASCII (state.rs MAX_INTENT_LEN). */
export const MAX_INTENT_LEN = 100;
/** Latest accepted expiry, 9999-12-31T23:59:59Z (state.rs MAX_EXPIRES_AT). */
export const MAX_EXPIRES_AT = 253_402_300_799;

export type LeashCluster = "devnet" | "mainnet-beta";

/** The parts of the message that come from the chain, not from the terms. */
export interface MandateMessageContext {
  programId: PublicKey;
  /** compile-time cluster tag of the program build ("devnet" unless built with `--features mainnet`) */
  cluster: LeashCluster;
  vault: PublicKey;
  /** vault.created_at, unix seconds */
  vaultCreatedAt: number;
  mint: PublicKey;
  /** mint decimals (UI amounts in the message must match the program's formatting exactly) */
  decimals: number;
}

/** null when the intent is acceptable, else why not (mirrors mandate_msg::validate_intent). */
export function mandateIntentError(intent: string): string | null {
  const bytes = new TextEncoder().encode(intent);
  if (bytes.length === 0) return "Intent can't be empty.";
  if (bytes.length > MAX_INTENT_LEN) return `Intent is ${bytes.length} characters; the limit is ${MAX_INTENT_LEN}.`;
  for (const b of bytes) {
    if (b < 0x20 || b > 0x7e) return "Intent may only use printable ASCII (letters, digits, punctuation, spaces): no newlines, emoji or accents.";
  }
  return null;
}

/**
 * Base units → UI string exactly as the program formats it: plain decimal, no separators, trailing fractional
 * zeros trimmed but at least min(2, decimals) fractional digits. 1_000_000n@6 → "1.00", 1_234_500n@6 → "1.2345",
 * 5n@0 → "5".
 */
export function mandateUiAmount(amount: bigint, decimals: number): string {
  if (amount < 0n) throw new Error("amount must be >= 0");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error(`unsupported decimals ${decimals}`);
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const int = amount / scale;
  let frac = (amount % scale).toString().padStart(decimals, "0");
  const min = Math.min(2, decimals);
  while (frac.length > min && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${int}.${frac}`;
}

/** `YYYY-MM-DDTHH:MM:SSZ` in UTC, no milliseconds (toISOString() adds ".000"). */
export function mandateIsoTime(unixSecs: number): string {
  if (!Number.isInteger(unixSecs) || unixSecs < 0 || unixSecs > MAX_EXPIRES_AT) throw new Error(`timestamp out of range: ${unixSecs}`);
  return new Date(unixSecs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Problems that make the program refuse these terms before it even checks the signature (or right after). */
export function mandateTermsError(terms: MandateTermsArgs, now: number = Math.floor(Date.now() / 1000)): string | null {
  const intent = mandateIntentError(terms.intent);
  if (intent) return intent;
  if (terms.maxTotal <= 0n || terms.maxPerTx <= 0n) return "Limits must be greater than zero.";
  if (terms.maxPerTx > terms.maxTotal) return "The per-payment limit can't be above the total.";
  if (!Number.isInteger(terms.expiresAt) || terms.expiresAt <= now) return "Expiry must be in the future.";
  if (terms.expiresAt > MAX_EXPIRES_AT) return "Expiry must be before the year 10000.";
  if (terms.nonce < 0n) return "Nonce must be >= 0.";
  return null;
}

/** The exact text the owner signs and the wallet shows. Throws on terms the program would refuse to format. */
export function mandateMessageText(ctx: MandateMessageContext, terms: MandateTermsArgs): string {
  const intent = mandateIntentError(terms.intent);
  if (intent) throw new Error(intent);
  if (terms.expiresAt <= 0 || terms.expiresAt > MAX_EXPIRES_AT) throw new Error("Expiry out of range");
  return [
    MANDATE_HEADER,
    `Program: ${ctx.programId.toBase58()}`,
    `Cluster: ${ctx.cluster}`,
    `Vault: ${ctx.vault.toBase58()}`,
    `Vault opened: ${mandateIsoTime(Math.min(Math.max(ctx.vaultCreatedAt, 0), MAX_EXPIRES_AT))}`,
    `Payee: ${terms.payee.toBase58()}`,
    `Mint: ${ctx.mint.toBase58()}`,
    `Max total: ${mandateUiAmount(terms.maxTotal, ctx.decimals)}`,
    `Max per payment: ${mandateUiAmount(terms.maxPerTx, ctx.decimals)}`,
    `Expires: ${mandateIsoTime(terms.expiresAt)}`,
    `Nonce: ${terms.nonce.toString()}`,
    `Intent: ${terms.intent}`,
  ].join("\n");
}

/** UTF-8 bytes of `mandateMessageText`: pass these to the wallet's `signMessage`. */
export function buildMandateMessage(ctx: MandateMessageContext, terms: MandateTermsArgs): Uint8Array {
  return new TextEncoder().encode(mandateMessageText(ctx, terms));
}

// ───────────────────────────── export format (owner → agent) ─────────────────────────────

/** JSON the owner hands to the agent. Amounts are base-unit decimal strings, the signature is base58. */
export interface SignedMandateJson {
  type: "leash-signed-mandate";
  version: 2;
  programId: string;
  cluster: LeashCluster;
  vault: string;
  /** vault owner = the signer */
  owner: string;
  terms: {
    payee: string;
    maxTotal: string;
    maxPerTx: string;
    expiresAt: number;
    nonce: string;
    intent: string;
  };
  /** the exact text that was signed (informational: the program rebuilds it) */
  message: string;
  signature: string;
}

export interface SignedMandate {
  programId: PublicKey;
  cluster: LeashCluster;
  vault: PublicKey;
  owner: PublicKey;
  terms: MandateTermsArgs;
  message: string;
  /** 64-byte Ed25519 signature of the owner over `message` */
  signature: Uint8Array;
}

/** Anything with a wallet-style `signMessage` (wallet adapter, Phantom provider, a Keypair wrapper). */
export interface MessageSigner {
  publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/** Owner side: format the readable message, have the wallet sign it, and return the bundle for the agent. */
export async function signMandate(signer: MessageSigner, ctx: MandateMessageContext, terms: MandateTermsArgs): Promise<SignedMandate> {
  const problem = mandateTermsError(terms);
  if (problem) throw new Error(problem);
  const message = mandateMessageText(ctx, terms);
  const signature = await signer.signMessage(new TextEncoder().encode(message));
  if (signature.length !== 64) throw new Error(`Wallet returned a ${signature.length}-byte signature, expected 64`);
  return { programId: ctx.programId, cluster: ctx.cluster, vault: ctx.vault, owner: signer.publicKey, terms, message, signature };
}

export function signedMandateToJson(s: SignedMandate): SignedMandateJson {
  return {
    type: "leash-signed-mandate",
    version: 2,
    programId: s.programId.toBase58(),
    cluster: s.cluster,
    vault: s.vault.toBase58(),
    owner: s.owner.toBase58(),
    terms: {
      payee: s.terms.payee.toBase58(),
      maxTotal: s.terms.maxTotal.toString(),
      maxPerTx: s.terms.maxPerTx.toString(),
      expiresAt: s.terms.expiresAt,
      nonce: s.terms.nonce.toString(),
      intent: s.terms.intent,
    },
    message: s.message,
    signature: bs58.encode(s.signature),
  };
}

export function encodeSignedMandate(s: SignedMandate): string {
  return JSON.stringify(signedMandateToJson(s), null, 2);
}

const bigintField = (v: unknown, name: string): bigint => {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new Error(`Signed mandate: ${name} must be a non-negative integer string`);
};

/** Parse what `encodeSignedMandate` produced (a JSON string or the parsed object). Signature: base58 or hex. */
export function decodeSignedMandate(input: string | SignedMandateJson): SignedMandate {
  const j = (typeof input === "string" ? JSON.parse(input) : input) as Partial<SignedMandateJson>;
  if (j?.type !== "leash-signed-mandate" || j.version !== 2) throw new Error("Not a Leash v2 signed mandate");
  if (j.cluster !== "devnet" && j.cluster !== "mainnet-beta") throw new Error("Signed mandate: unknown cluster");
  const t = j.terms;
  if (!t || typeof t.intent !== "string" || typeof t.expiresAt !== "number" || typeof t.payee !== "string") {
    throw new Error("Signed mandate: missing terms");
  }
  const sigText = String(j.signature ?? "");
  const signature = /^(0x)?[0-9a-fA-F]{128}$/.test(sigText) ? fromHex(sigText) : bs58.decode(sigText);
  if (signature.length !== 64) throw new Error("Signed mandate: signature must be 64 bytes");
  return {
    programId: new PublicKey(String(j.programId)),
    cluster: j.cluster,
    vault: new PublicKey(String(j.vault)),
    owner: new PublicKey(String(j.owner)),
    terms: {
      payee: new PublicKey(t.payee),
      maxTotal: bigintField(t.maxTotal, "maxTotal"),
      maxPerTx: bigintField(t.maxPerTx, "maxPerTx"),
      expiresAt: t.expiresAt,
      nonce: bigintField(t.nonce, "nonce"),
      intent: t.intent,
    },
    message: String(j.message ?? ""),
    signature,
  };
}
