/**
 * Byte layouts of the Leash program (programs/leash/src): Anchor discriminators (sha256("global:"|"account:"|
 * "event:" + name)[..8]), account structs, instruction args and events. Field order mirrors the Rust structs;
 * keep the two in sync (the program tests + packages/sdk/test/layout.test.ts guard this).
 */
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Reader, Writer } from "./borsh";
import type {
  AuthKind,
  MandateState,
  PayeeState,
  Policy,
  RequestState,
  RequestStatus,
} from "./types";

export function discriminator(namespace: "global" | "account" | "event", name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`${namespace}:${name}`)).slice(0, 8);
}

export const IX = {
  initializeVault: discriminator("global", "initialize_vault"),
  updatePolicy: discriminator("global", "update_policy"),
  setAgent: discriminator("global", "set_agent"),
  setPaused: discriminator("global", "set_paused"),
  resetStrikes: discriminator("global", "reset_strikes"),
  addPayee: discriminator("global", "add_payee"),
  updatePayee: discriminator("global", "update_payee"),
  removePayee: discriminator("global", "remove_payee"),
  createMandate: discriminator("global", "create_mandate"),
  redeemSignedMandate: discriminator("global", "redeem_signed_mandate"),
  revokeMandate: discriminator("global", "revoke_mandate"),
  agentSpend: discriminator("global", "agent_spend"),
  guardedSpend: discriminator("global", "guarded_spend"),
  requestSpend: discriminator("global", "request_spend"),
  approveRequest: discriminator("global", "approve_request"),
  rejectRequest: discriminator("global", "reject_request"),
  withdraw: discriminator("global", "withdraw"),
} as const;

export const ACCOUNT = {
  Vault: discriminator("account", "Vault"),
  Payee: discriminator("account", "Payee"),
  Mandate: discriminator("account", "Mandate"),
  SpendRequest: discriminator("account", "SpendRequest"),
} as const;

export const EVENT_NAMES = [
  "SpendExecuted",
  "SpendRequested",
  "RequestResolved",
  "PolicyUpdated",
  "PayeeChanged",
  "MandateCreated",
  "MandateRevoked",
  "VaultPausedChanged",
  "PaymentBlocked",
  "VaultFrozen",
] as const;
export type LeashEventName = (typeof EVENT_NAMES)[number];

const EVENT_DISC = new Map<string, LeashEventName>(
  EVENT_NAMES.map((n) => [Buffer.from(discriminator("event", n)).toString("hex"), n]),
);

/** Offset of the `vault` field in Payee / Mandate / SpendRequest (right after the discriminator). */
export const VAULT_FIELD_OFFSET = 8;

function hasDisc(data: Uint8Array, disc: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) return false;
  return true;
}

// ───────────────────────────── accounts ─────────────────────────────

export interface RawVault {
  owner: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  vaultId: bigint;
  paused: boolean;
  perTxCap: bigint;
  dailyCap: bigint;
  windowStart: number;
  spentInWindow: bigint;
  cosignThreshold: bigint;
  requestTtlSecs: number;
  requestSeq: bigint;
  mandateSeq: bigint;
  totalSpent: bigint;
  blockedCount: bigint;
  strikes: number;
  freezeAfterStrikes: number;
  lastBlockedAt: number;
  bump: number;
}

export function decodeVault(data: Uint8Array): RawVault {
  if (!hasDisc(data, ACCOUNT.Vault)) throw new Error("Not a Leash Vault account");
  const r = new Reader(data).skip(8);
  return {
    owner: r.pubkey(),
    agent: r.pubkey(),
    mint: r.pubkey(),
    vaultId: r.u64(),
    paused: r.bool(),
    perTxCap: r.u64(),
    dailyCap: r.u64(),
    windowStart: Number(r.i64()),
    spentInWindow: r.u64(),
    cosignThreshold: r.u64(),
    requestTtlSecs: Number(r.i64()),
    requestSeq: r.u64(),
    mandateSeq: r.u64(),
    totalSpent: r.u64(),
    blockedCount: r.u64(),
    strikes: r.u8(),
    freezeAfterStrikes: r.u8(),
    lastBlockedAt: Number(r.i64()),
    bump: r.u8(),
  };
}

export function decodePayee(address: PublicKey, data: Uint8Array): PayeeState {
  if (!hasDisc(data, ACCOUNT.Payee)) throw new Error("Not a Leash Payee account");
  const r = new Reader(data).skip(8);
  return {
    address,
    vault: r.pubkey(),
    payee: r.pubkey(),
    label: r.string(),
    perTxMax: r.u64(),
    budgetTotal: r.u64(),
    spent: r.u64(),
    active: r.bool(),
  };
}

export function decodeMandate(address: PublicKey, data: Uint8Array): MandateState {
  if (!hasDisc(data, ACCOUNT.Mandate)) throw new Error("Not a Leash Mandate account");
  const r = new Reader(data).skip(8);
  return {
    address,
    vault: r.pubkey(),
    id: r.u64(),
    payee: r.pubkey(),
    maxTotal: r.u64(),
    maxPerTx: r.u64(),
    spent: r.u64(),
    expiresAt: Number(r.i64()),
    intentHash: r.fixed(32),
    revoked: r.bool(),
  };
}

const STATUS: RequestStatus[] = ["pending", "approved", "rejected", "expired"];

export function decodeRequest(address: PublicKey, data: Uint8Array): RequestState {
  if (!hasDisc(data, ACCOUNT.SpendRequest)) throw new Error("Not a Leash SpendRequest account");
  const r = new Reader(data).skip(8);
  const head = {
    address,
    vault: r.pubkey(),
    seq: r.u64(),
    payee: r.pubkey(),
    amount: r.u64(),
    reasonHash: r.fixed(32),
    createdAt: Number(r.i64()),
    expiresAt: Number(r.i64()),
    status: STATUS[r.u8()] ?? ("pending" as RequestStatus),
  };
  r.u8(); // bump
  return { ...head, memo: r.optionFixed(32) };
}

// ───────────────────────────── instruction data ─────────────────────────────

export function writePolicy(w: Writer, p: Policy): Writer {
  return w
    .u64(p.perTxCap)
    .u64(p.dailyCap)
    .u64(p.cosignThreshold)
    .i64(p.requestTtlSecs)
    .u8(p.freezeAfterStrikes);
}

export interface MandateTermsArgs {
  vault: PublicKey;
  payee: PublicKey;
  maxTotal: bigint;
  maxPerTx: bigint;
  /** unix seconds */
  expiresAt: number;
  intentHash: Uint8Array;
  /** must equal vault.mandateSeq at redeem time */
  nonce: bigint;
}

export function encodeMandateTerms(t: MandateTermsArgs): Uint8Array {
  return new Writer()
    .pubkey(t.vault)
    .pubkey(t.payee)
    .u64(t.maxTotal)
    .u64(t.maxPerTx)
    .i64(t.expiresAt)
    .fixed(t.intentHash, 32)
    .u64(t.nonce)
    .bytes();
}

export function ixData(disc: Uint8Array, build?: (w: Writer) => Writer): Buffer {
  const w = new Writer().raw(disc);
  return Buffer.from((build ? build(w) : w).bytes());
}

// ───────────────────────────── events ─────────────────────────────

const AUTH: AuthKind[] = ["payee", "mandate", "request"];

export type LeashEvent =
  | {
      name: "SpendExecuted";
      data: {
        vault: PublicKey;
        payee: PublicKey;
        amount: bigint;
        reasonHash: Uint8Array;
        memo: Uint8Array | null;
        via: AuthKind;
        ts: number;
      };
    }
  | {
      name: "SpendRequested";
      data: { vault: PublicKey; request: PublicKey; payee: PublicKey; amount: bigint; reasonHash: Uint8Array; ts: number };
    }
  | { name: "RequestResolved"; data: { vault: PublicKey; request: PublicKey; approved: boolean; ts: number } }
  | { name: "PolicyUpdated"; data: { vault: PublicKey; ts: number } }
  | { name: "PayeeChanged"; data: { vault: PublicKey; payee: PublicKey; active: boolean; removed: boolean; ts: number } }
  | {
      name: "MandateCreated";
      data: {
        vault: PublicKey;
        mandate: PublicKey;
        payee: PublicKey;
        maxTotal: bigint;
        expiresAt: number;
        intentHash: Uint8Array;
        signedOffchain: boolean;
      };
    }
  | { name: "MandateRevoked"; data: { vault: PublicKey; mandate: PublicKey; ts: number } }
  | { name: "VaultPausedChanged"; data: { vault: PublicKey; paused: boolean; ts: number } }
  | {
      name: "PaymentBlocked";
      data: {
        vault: PublicKey;
        attemptedPayee: PublicKey;
        amount: bigint;
        reasonCode: number;
        reasonHash: Uint8Array;
        blockedCount: bigint;
        strikes: number;
        ts: number;
      };
    }
  | { name: "VaultFrozen"; data: { vault: PublicKey; strikes: number; ts: number } };

export function decodeEvent(bytes: Uint8Array): LeashEvent | null {
  if (bytes.length < 8) return null;
  const name = EVENT_DISC.get(Buffer.from(bytes.slice(0, 8)).toString("hex"));
  if (!name) return null;
  const r = new Reader(bytes).skip(8);
  switch (name) {
    case "SpendExecuted":
      return {
        name,
        data: {
          vault: r.pubkey(),
          payee: r.pubkey(),
          amount: r.u64(),
          reasonHash: r.fixed(32),
          memo: r.optionFixed(32),
          via: AUTH[r.u8()] ?? "payee",
          ts: Number(r.i64()),
        },
      };
    case "SpendRequested":
      return {
        name,
        data: {
          vault: r.pubkey(),
          request: r.pubkey(),
          payee: r.pubkey(),
          amount: r.u64(),
          reasonHash: r.fixed(32),
          ts: Number(r.i64()),
        },
      };
    case "RequestResolved":
      return { name, data: { vault: r.pubkey(), request: r.pubkey(), approved: r.bool(), ts: Number(r.i64()) } };
    case "PolicyUpdated":
      return { name, data: { vault: r.pubkey(), ts: Number(r.i64()) } };
    case "PayeeChanged":
      return {
        name,
        data: { vault: r.pubkey(), payee: r.pubkey(), active: r.bool(), removed: r.bool(), ts: Number(r.i64()) },
      };
    case "MandateCreated":
      return {
        name,
        data: {
          vault: r.pubkey(),
          mandate: r.pubkey(),
          payee: r.pubkey(),
          maxTotal: r.u64(),
          expiresAt: Number(r.i64()),
          intentHash: r.fixed(32),
          signedOffchain: r.bool(),
        },
      };
    case "MandateRevoked":
      return { name, data: { vault: r.pubkey(), mandate: r.pubkey(), ts: Number(r.i64()) } };
    case "VaultPausedChanged":
      return { name, data: { vault: r.pubkey(), paused: r.bool(), ts: Number(r.i64()) } };
    case "PaymentBlocked":
      return {
        name,
        data: {
          vault: r.pubkey(),
          attemptedPayee: r.pubkey(),
          amount: r.u64(),
          reasonCode: r.u16(),
          reasonHash: r.fixed(32),
          blockedCount: r.u64(),
          strikes: r.u8(),
          ts: Number(r.i64()),
        },
      };
    case "VaultFrozen":
      return { name, data: { vault: r.pubkey(), strikes: r.u8(), ts: Number(r.i64()) } };
  }
}

/**
 * Leash events from a transaction's log messages. Only `Program data:` lines emitted while the Leash program is
 * the innermost running program are decoded (so another program can't forge Leash events in the same tx).
 */
export function parseLeashEvents(logs: readonly string[] | null | undefined, programId: PublicKey | string): LeashEvent[] {
  if (!logs) return [];
  const pid = programId.toString();
  const stack: string[] = [];
  const out: LeashEvent[] = [];
  for (const line of logs) {
    const invoke = line.match(/^Program (\w+) invoke \[\d+\]$/);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === pid) {
      try {
        const ev = decodeEvent(new Uint8Array(Buffer.from(line.slice("Program data: ".length), "base64")));
        if (ev) out.push(ev);
      } catch {
        // not one of ours / truncated logs
      }
    }
  }
  return out;
}
