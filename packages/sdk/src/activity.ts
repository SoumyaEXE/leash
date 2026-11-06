/**
 * Turning transactions into dashboard activity without trusting anything a third party can write.
 *
 * A vault's signature list (getSignaturesForAddress / logsSubscribe) includes every tx that merely *mentions* the
 * vault, and any program can print a fake "Error Code: PayeeNotAuthorized" log line (judge #12: fake BLOCKED
 * entries). So:
 *  - a failed tx counts as "blocked" only if the runtime says top-level instruction i failed with a Leash error
 *    code, instruction i is a Leash payment instruction, and its `vault` account is this vault;
 *  - a successful tx contributes only events emitted inside a Leash invoke frame whose `vault` field is this vault.
 */
import { PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { Buffer } from "buffer";
import { errorNameFromCode, parseLeashErrorFromLogs, type LeashErrorName } from "./errors";
import { EXIT_RE, INVOKE_RE, VAULT_ACCOUNT_INDEX, instructionName, parseLeashEvents, type LeashIxName } from "./layout";
import type { ActivityEvent } from "./types";
import { reasonFromLogs, toHex } from "./utils";

export interface TopLevelInstruction {
  programId: PublicKey;
  accounts: PublicKey[];
  data: Uint8Array;
}

/** Top-level instructions of a fetched transaction (legacy or v0 with lookup tables). null if keys can't be resolved. */
export function topLevelInstructions(
  tx: Pick<VersionedTransactionResponse, "transaction" | "meta">,
): TopLevelInstruction[] | null {
  try {
    const msg = tx.transaction.message;
    const keys =
      msg.version === 0 ? msg.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses ?? null }) : msg.getAccountKeys();
    return msg.compiledInstructions.map((ci) => {
      const programId = keys.get(ci.programIdIndex);
      if (!programId) throw new Error("account index out of range");
      return {
        programId,
        accounts: ci.accountKeyIndexes.map((i) => {
          const k = keys.get(i);
          if (!k) throw new Error("account index out of range");
          return k;
        }),
        data: ci.data,
      };
    });
  } catch {
    return null;
  }
}

/** Leash instructions that move (or try to move) money; their failures are refused payments. */
const PAYMENT_IXS: ReadonlySet<LeashIxName> = new Set(["agent_spend", "guarded_spend", "request_spend", "approve_request", "redeem_signed_mandate"]);

export interface LeashFailure {
  /** top-level instruction index that failed */
  index: number;
  code: number;
  name: LeashErrorName;
  message?: string;
}

/**
 * The Leash error a failed tx was refused with, if the failing frame really is the Leash program at the top level.
 * `err` is `meta.err` (runtime-written). With `instructions`, the failing instruction must target `programId`;
 * without them the runtime's own `Program <leash> failed: custom program error` line must close the last top-level
 * frame. Program-written log lines alone are never enough.
 */
export function leashFailure(
  programId: PublicKey,
  err: unknown,
  logs: readonly string[] | null | undefined,
  instructions?: readonly TopLevelInstruction[] | null,
): LeashFailure | null {
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
  if (!Array.isArray(ie) || typeof ie[0] !== "number") return null;
  const custom = (ie[1] as { Custom?: unknown } | null)?.Custom;
  if (typeof custom !== "number") return null;
  const name = errorNameFromCode(custom);
  if (!name) return null;
  const index = ie[0];
  const pid = programId.toBase58();
  if (instructions) {
    if (!instructions[index]?.programId.equals(programId)) return null;
  } else if (lastTopLevelFrame(logs) !== `${pid} failed: custom program error: 0x${custom.toString(16)}`) {
    return null;
  }
  const parsed = parseLeashErrorFromLogs(logs, programId);
  return { index, code: custom, name, message: parsed?.code === custom ? parsed.message : undefined };
}

/** "<program> failed: ..." / "<program> success" of the last depth-1 frame in the logs, or null. */
function lastTopLevelFrame(logs: readonly string[] | null | undefined): string | null {
  if (!logs) return null;
  let depth = 0;
  let last: string | null = null;
  for (const line of logs) {
    const inv = line.match(INVOKE_RE);
    if (inv) {
      depth = Number(inv[2]);
      continue;
    }
    if (EXIT_RE.test(line)) {
      if (depth === 1) last = line.slice("Program ".length);
      depth = Math.max(0, depth - 1);
    }
  }
  return last;
}

const u64At = (data: Uint8Array, at: number): bigint | undefined =>
  data.length >= at + 8 ? Buffer.from(data.subarray(at, at + 8)).readBigUInt64LE(0) : undefined;
const pubkeyAt = (data: Uint8Array, at: number): string | undefined =>
  data.length >= at + 32 ? new PublicKey(data.subarray(at, at + 32)).toBase58() : undefined;

export interface ActivityTx {
  sig: string;
  /** unix seconds (block time) */
  ts: number;
  slot?: number;
  logs: readonly string[];
  err: unknown;
  /** top-level instructions; required to attribute a failed tx to this vault (failures are dropped without) */
  instructions?: readonly TopLevelInstruction[] | null;
}

/** Dashboard activity for `vault` from one transaction. */
export function activityFromTransaction(programId: PublicKey, vault: PublicKey, tx: ActivityTx): ActivityEvent[] {
  const reason = reasonFromLogs(tx.logs);
  const { sig, slot } = tx;
  if (tx.err) {
    if (!tx.instructions) return [];
    const f = leashFailure(programId, tx.err, tx.logs, tx.instructions);
    if (!f) return [];
    const ixn = tx.instructions[f.index];
    const name = instructionName(ixn.data);
    if (!name || !PAYMENT_IXS.has(name)) return [];
    if (!ixn.accounts[VAULT_ACCOUNT_INDEX[name]]?.equals(vault)) return [];
    const ev: ActivityEvent = { kind: "blocked", sig, ts: tx.ts, slot, errorName: f.name, instruction: name, reason };
    if (name === "agent_spend" || name === "guarded_spend") {
      ev.amount = u64At(ixn.data, 8);
      ev.reasonHash = ixn.data.length >= 48 ? toHex(ixn.data.subarray(16, 48)) : undefined;
    } else if (name === "request_spend") {
      ev.payee = pubkeyAt(ixn.data, 8);
      ev.amount = u64At(ixn.data, 40);
      ev.reasonHash = ixn.data.length >= 80 ? toHex(ixn.data.subarray(48, 80)) : undefined;
    } else if (name === "approve_request") {
      ev.request = ixn.accounts[2]?.toBase58();
    } else if (name === "redeem_signed_mandate") {
      ev.payee = pubkeyAt(ixn.data, 8);
    }
    return [ev];
  }
  const out: ActivityEvent[] = [];
  for (const e of parseLeashEvents(tx.logs, programId)) {
    if (!e.data.vault.equals(vault)) continue;
    const base = { sig, ts: "ts" in e.data ? e.data.ts : tx.ts, slot, reason };
    switch (e.name) {
      case "SpendExecuted":
        out.push({
          ...base,
          kind: "spent",
          amount: e.data.amount,
          payee: e.data.payee.toBase58(),
          via: e.data.via,
          reasonHash: toHex(e.data.reasonHash),
          request: e.data.request?.toBase58(),
        });
        break;
      case "PaymentBlocked":
        out.push({
          ...base,
          kind: "blocked",
          amount: e.data.amount,
          payee: e.data.attemptedPayee.toBase58(),
          errorName: errorNameFromCode(e.data.reasonCode) ?? String(e.data.reasonCode),
          strike: e.data.strike,
          reasonHash: toHex(e.data.reasonHash),
        });
        break;
      case "SpendRequested":
        out.push({
          ...base,
          kind: "requested",
          amount: e.data.amount,
          payee: e.data.payee.toBase58(),
          request: e.data.request.toBase58(),
          reasonHash: toHex(e.data.reasonHash),
        });
        break;
      case "RequestResolved":
        out.push({ ...base, kind: "resolved", request: e.data.request.toBase58(), approved: e.data.approved });
        break;
      case "RequestClosed":
        out.push({ ...base, kind: "closed", request: e.data.request.toBase58() });
        break;
      case "MandateClosed":
        out.push({ ...base, kind: "closed", mandate: e.data.mandate.toBase58() });
        break;
      case "VaultClosed":
        out.push({ ...base, kind: "closed" });
        break;
      case "VaultFrozen":
        out.push({ ...base, kind: "frozen" });
        break;
      case "VaultPausedChanged":
        out.push({ ...base, kind: "paused", paused: e.data.paused });
        break;
      case "Withdrawn":
        out.push({ ...base, kind: "withdrawn", amount: e.data.amount });
        break;
      case "MandateCreated":
        out.push({ ...base, kind: "mandate", mandate: e.data.mandate.toBase58(), payee: e.data.payee.toBase58(), amount: e.data.maxTotal });
        break;
      case "MandateRevoked":
        out.push({ ...base, kind: "mandate", mandate: e.data.mandate.toBase58() });
        break;
      case "MandateSeqBumped":
        out.push({ ...base, kind: "mandate" });
        break;
      case "PolicyUpdated":
        out.push({ ...base, kind: "policy" });
        break;
      case "PayeeChanged":
        out.push({ ...base, kind: "policy", payee: e.data.payee.toBase58() });
        break;
    }
  }
  return out;
}
