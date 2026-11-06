/**
 * What the browser → RPC proxy (app/api/rpc) forwards. The upstream is a metered provider (Helius) whose key is
 * ours, so the proxy only relays what the Leash web app itself needs:
 *   - a fixed set of read methods;
 *   - getProgramAccounts only on the Leash program and only scoped by a memcmp at offset 8 (the `vault` field of
 *     Payee/Mandate/SpendRequest, the `owner` field of Vault), the way @leash/sdk queries;
 *   - sendTransaction / simulateTransaction only for transactions with a top-level Leash instruction.
 */
import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";

export const READ_METHODS = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getLatestBlockhash",
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",
  "getVersion",
  "getGenesisHash",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "isBlockhashValid",
]);

/** Leash accounts keep the vault (or, for Vault, the owner) right after the 8-byte discriminator. */
export const SCOPE_OFFSET = 8;
const MAX_TX_BYTES = 1232;

export type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

/** Relative cost for the rate limiter (getProgramAccounts is the expensive call on metered RPCs). */
export function callCost(c: RpcCall): number {
  return c.method === "getProgramAccounts" ? 5 : 1;
}

function checkProgramAccounts(params: unknown, programIds: readonly string[]): string | null {
  if (!Array.isArray(params) || !programIds.includes(params[0] as string)) return "getProgramAccounts is only allowed on the Leash program";
  const cfg = params[1] as { filters?: unknown } | undefined;
  const filters = Array.isArray(cfg?.filters) ? (cfg!.filters as unknown[]) : [];
  if (filters.length === 0 || filters.length > 4) return "getProgramAccounts needs 1-4 filters";
  const scoped = filters.some((f) => {
    const m = (f as { memcmp?: { offset?: unknown; bytes?: unknown } } | null)?.memcmp;
    return !!m && m.offset === SCOPE_OFFSET && typeof m.bytes === "string" && m.bytes.length >= 32;
  });
  return scoped ? null : `getProgramAccounts must filter on one vault (memcmp at offset ${SCOPE_OFFSET})`;
}

/** Decode the wire tx of sendTransaction/simulateTransaction (base58 is the RPC default, web3.js sends base64). */
export function decodeWireTx(params: unknown): VersionedTransaction | null {
  if (!Array.isArray(params) || typeof params[0] !== "string") return null;
  const encoding = (params[1] as { encoding?: unknown } | undefined)?.encoding ?? "base58";
  let bytes: Uint8Array;
  try {
    if (encoding === "base64") bytes = Buffer.from(params[0], "base64");
    else if (encoding === "base58") bytes = bs58.decode(params[0]);
    else return null;
    if (bytes.length === 0 || bytes.length > MAX_TX_BYTES) return null;
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return null;
  }
}

/** Top-level program ids of a transaction (program ids are always static keys, never from lookup tables). */
export function topLevelPrograms(tx: VersionedTransaction): string[] {
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]?.toBase58() ?? "");
}

function checkTransaction(params: unknown, programIds: readonly string[]): string | null {
  const tx = decodeWireTx(params);
  if (!tx) return "Transaction could not be decoded";
  return topLevelPrograms(tx).some((p) => programIds.includes(p)) ? null : "Only transactions that call the Leash program can be sent through this proxy";
}

/** null when the call may be forwarded, otherwise the reason it can't. `programIds`: the Leash program id(s). */
export function checkRpcCall(c: RpcCall, programIds: readonly string[]): string | null {
  const method = typeof c.method === "string" ? c.method : "";
  if (READ_METHODS.has(method)) return null;
  if (method === "getProgramAccounts") return checkProgramAccounts(c.params, programIds);
  if (method === "sendTransaction" || method === "simulateTransaction") return checkTransaction(c.params, programIds);
  return `Method not allowed: ${method || "(none)"}`;
}
