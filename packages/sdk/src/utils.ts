import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";

export const DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const DUSDC_DECIMALS = 6;

/** sha256 of the agent's stated reason; this is what goes onchain as reason_hash. Browser-safe. */
export function reasonHash(text: string): Uint8Array {
  return sha256(new TextEncoder().encode(text));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error("Invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function explorerTx(sig: string, cluster: "devnet" | "mainnet-beta" = "devnet"): string {
  return `https://explorer.solana.com/tx/${sig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
}

export function explorerAddress(address: string | PublicKey, cluster: "devnet" | "mainnet-beta" = "devnet"): string {
  return `https://explorer.solana.com/address/${address.toString()}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
}

/** "0.25" -> 250000n (6 decimals). Accepts numbers and strings; rejects more decimals than the mint has. */
export function toBaseUnits(ui: string | number, decimals = DUSDC_DECIMALS): bigint {
  const s = typeof ui === "number" ? ui.toFixed(decimals) : ui.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: ${ui}`);
  const [whole, frac = ""] = s.split(".");
  const fracTrimmed = frac.replace(/0+$/, "");
  if (fracTrimmed.length > decimals) throw new Error(`Too many decimals in ${ui} (max ${decimals})`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracTrimmed.padEnd(decimals, "0") || "0");
}

/** 250000n -> "0.25" */
export function fromBaseUnits(base: bigint, decimals = DUSDC_DECIMALS): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const d = 10n ** BigInt(decimals);
  const whole = v / d;
  const frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

/** 32-byte memo from an x402 nonce given as hex (64 chars) or any string (sha256'd). */
export function memoFromNonce(nonce: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(nonce)) return fromHex(nonce);
  return reasonHash(nonce);
}

export const REASON_MEMO_PREFIX = "leash:reason:";

/** Pull the agent's reason text out of an SPL Memo program log line, if present. */
export function reasonFromLogs(logs: readonly string[] | null | undefined): string | undefined {
  if (!logs) return undefined;
  for (const line of logs) {
    const m = line.match(/^Program log: Memo \(len \d+\): "(.*)"$/);
    if (m && m[1].startsWith(REASON_MEMO_PREFIX)) {
      return m[1].slice(REASON_MEMO_PREFIX.length).replace(/\\"/g, '"');
    }
  }
  return undefined;
}
