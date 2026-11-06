/**
 * Byte layouts of the Leash program (programs/leash/src): Anchor discriminators (sha256("global:"|"account:"|
 * "event:" + name)[..8]), account structs, instruction args and events. Field order mirrors the Rust structs;
 * keep the two in sync (packages/sdk/test/idl.test.ts checks every one of them against src/idl/leash.json).
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

/** Instruction name (snake_case, as in the IDL) → camelCase key of `IX`. */
export const IX_NAMES = [
  "initialize_vault",
  "update_policy",
  "set_agent",
  "set_paused",
  "reset_strikes",
  "add_payee",
  "update_payee",
  "remove_payee",
  "create_mandate",
  "redeem_signed_mandate",
  "bump_mandate_seq",
  "revoke_mandate",
  "close_mandate",
  "agent_spend",
  "guarded_spend",
  "request_spend",
  "approve_request",
  "reject_request",
  "close_request",
  "withdraw",
  "close_vault",
] as const;
export type LeashIxName = (typeof IX_NAMES)[number];

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
  bumpMandateSeq: discriminator("global", "bump_mandate_seq"),
  revokeMandate: discriminator("global", "revoke_mandate"),
  closeMandate: discriminator("global", "close_mandate"),
  agentSpend: discriminator("global", "agent_spend"),
  guardedSpend: discriminator("global", "guarded_spend"),
  requestSpend: discriminator("global", "request_spend"),
  approveRequest: discriminator("global", "approve_request"),
  rejectRequest: discriminator("global", "reject_request"),
  closeRequest: discriminator("global", "close_request"),
  withdraw: discriminator("global", "withdraw"),
  closeVault: discriminator("global", "close_vault"),
} as const;

const IX_BY_DISC = new Map<string, LeashIxName>(
  IX_NAMES.map((n) => [Buffer.from(discriminator("global", n)).toString("hex"), n]),
);

/** Which Leash instruction this data is for (by its 8-byte discriminator), or null. */
export function instructionName(data: Uint8Array): LeashIxName | null {
  if (data.length < 8) return null;
  return IX_BY_DISC.get(Buffer.from(data.subarray(0, 8)).toString("hex")) ?? null;
}

/** Position of the `vault` account in each instruction's account list (Rust Accounts struct field order). */
export const VAULT_ACCOUNT_INDEX: Record<LeashIxName, number> = {
  initialize_vault: 1,
  update_policy: 1,
  set_agent: 1,
  set_paused: 1,
  reset_strikes: 1,
  add_payee: 1,
  update_payee: 1,
  remove_payee: 1,
  create_mandate: 1,
  redeem_signed_mandate: 1,
  bump_mandate_seq: 1,
  revoke_mandate: 1,
  close_mandate: 1,
  agent_spend: 1,
  guarded_spend: 1,
  request_spend: 1,
  approve_request: 1,
  reject_request: 1,
  close_request: 0,
  withdraw: 1,
  close_vault: 1,
};

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
  "Withdrawn",
  "MandateSeqBumped",
  "MandateClosed",
  "RequestClosed",
  "VaultClosed",
] as const;
export type LeashEventName = (typeof EVENT_NAMES)[number];

const EVENT_DISC = new Map<string, LeashEventName>(
  EVENT_NAMES.map((n) => [Buffer.from(discriminator("event", n)).toString("hex"), n]),
);

/** Offset of the `vault` field in Payee / Mandate / SpendRequest (right after the discriminator). */
export const VAULT_FIELD_OFFSET = 8;

/** Rolling-window ring: one bucket per hour, 25 of them (programs/leash/src/state.rs BUCKETS / BUCKET_SECS). */
export const BUCKETS = 25;
export const BUCKET_SECS = 3600;

/** Size of a Vault account (8-byte discriminator + Vault::INIT_SPACE). */
export const VAULT_ACCOUNT_SIZE = 627;
/** Size of a Vault created by the first deployed program (fixed 24h window, no rolling buckets). */
export const LEGACY_VAULT_ACCOUNT_SIZE = 204;

/** Open spend requests per vault (state.rs MAX_OPEN_REQUESTS). */
export const MAX_OPEN_REQUESTS = 8;

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
  /** unix seconds the vault was initialized (part of every signed-mandate message) */
  createdAt: number;
  paused: boolean;
  perTxCap: bigint;
  dailyCap: bigint;
  cosignThreshold: bigint;
  cosignWindowThreshold: bigint;
  requestTtlSecs: number;
  requestSeq: bigint;
  mandateSeq: bigint;
  totalSpent: bigint;
  blockedCount: bigint;
  strikes: number;
  freezeAfterStrikes: number;
  lastBlockedAt: number;
  strikeWindowStart: number;
  enforceTripwire: boolean;
  openRequests: number;
  openPayees: number;
  openMandates: number;
  /** hour index (unix_ts / 3600) of the newest bucket in both rings */
  lastBucket: number;
  /** everything paid out per hour, slot = hour % 25 */
  spentBuckets: bigint[];
  /** payments made without a co-sign per hour, slot = hour % 25 */
  autoBuckets: bigint[];
  bump: number;
}

/** True when `data` is a Vault account with the pre-rolling-window layout, which this program can't load. */
export function isLegacyVaultAccount(data: Uint8Array): boolean {
  return hasDisc(data, ACCOUNT.Vault) && data.length === LEGACY_VAULT_ACCOUNT_SIZE;
}

export function decodeVault(data: Uint8Array): RawVault {
  if (!hasDisc(data, ACCOUNT.Vault)) throw new Error("Not a Leash Vault account");
  if (data.length === LEGACY_VAULT_ACCOUNT_SIZE) {
    throw new Error(
      "This vault was created by an older Leash program (pre rolling-window layout) and can't be loaded by the current one. Create a new vault (new vault_id).",
    );
  }
  const r = new Reader(data).skip(8);
  const owner = r.pubkey();
  const agent = r.pubkey();
  const mint = r.pubkey();
  const vaultId = r.u64();
  const createdAt = Number(r.i64());
  const paused = r.bool();
  const perTxCap = r.u64();
  const dailyCap = r.u64();
  const cosignThreshold = r.u64();
  const cosignWindowThreshold = r.u64();
  const requestTtlSecs = Number(r.i64());
  const requestSeq = r.u64();
  const mandateSeq = r.u64();
  const totalSpent = r.u64();
  const blockedCount = r.u64();
  const strikes = r.u8();
  const freezeAfterStrikes = r.u8();
  const lastBlockedAt = Number(r.i64());
  const strikeWindowStart = Number(r.i64());
  const enforceTripwire = r.bool();
  const openRequests = r.u16();
  const openPayees = r.u16();
  const openMandates = r.u16();
  const lastBucket = Number(r.i64());
  const spentBuckets = Array.from({ length: BUCKETS }, () => r.u64());
  const autoBuckets = Array.from({ length: BUCKETS }, () => r.u64());
  const bump = r.u8();
  return {
    owner,
    agent,
    mint,
    vaultId,
    createdAt,
    paused,
    perTxCap,
    dailyCap,
    cosignThreshold,
    cosignWindowThreshold,
    requestTtlSecs,
    requestSeq,
    mandateSeq,
    totalSpent,
    blockedCount,
    strikes,
    freezeAfterStrikes,
    lastBlockedAt,
    strikeWindowStart,
    enforceTripwire,
    openRequests,
    openPayees,
    openMandates,
    lastBucket,
    spentBuckets,
    autoBuckets,
    bump,
  };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Sum of a bucket ring over the rolling 24h ending at `now` (the current hour and the 24 before it), exactly as
 * the program computes it (`Vault::rolling_sum`). A payment counts for 24-25h.
 */
export function rollingSum(ring: readonly bigint[], lastBucket: number, now: number = Math.floor(Date.now() / 1000)): bigint {
  const oldest = Math.floor(now / BUCKET_SECS) - (BUCKETS - 1);
  let sum = 0n;
  for (let slot = 0; slot < ring.length; slot++) {
    const hour = lastBucket - mod(lastBucket - slot, BUCKETS);
    if (hour >= oldest) sum += ring[slot];
  }
  return sum;
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

/** Policy arg (42 bytes): the five original fields, then cosign_window_threshold and enforce_tripwire. */
export function writePolicy(w: Writer, p: Policy): Writer {
  return w
    .u64(p.perTxCap)
    .u64(p.dailyCap)
    .u64(p.cosignThreshold)
    .i64(p.requestTtlSecs)
    .u8(p.freezeAfterStrikes)
    .u64(p.cosignWindowThreshold)
    .bool(p.enforceTripwire);
}

/**
 * The `MandateTerms` instruction arg of `redeem_signed_mandate`: what the owner signed (as the readable message
 * from `buildMandateMessage`). The vault, program id, cluster and mint come from the accounts; the program
 * computes intent_hash = sha256(intent) itself.
 */
export interface MandateTermsArgs {
  payee: PublicKey;
  maxTotal: bigint;
  maxPerTx: bigint;
  /** unix seconds */
  expiresAt: number;
  /** must equal vault.mandateSeq at redeem time */
  nonce: bigint;
  /** 1-100 printable ASCII characters, shown to the owner in the wallet prompt */
  intent: string;
}

export function encodeMandateTerms(t: MandateTermsArgs): Uint8Array {
  return new Writer()
    .pubkey(t.payee)
    .u64(t.maxTotal)
    .u64(t.maxPerTx)
    .i64(t.expiresAt)
    .u64(t.nonce)
    .string(t.intent)
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
        /** the co-signed SpendRequest this payment settles (approve_request); null otherwise or in older logs */
        request: PublicKey | null;
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
        /**
         * true = unauthorized attempt that counted as a tripwire strike; false = benign block (cap, budget,
         * expiry...) recorded without one. Logs from the first program version (where every block was a strike)
         * decode as true.
         */
        strike: boolean;
      };
    }
  | { name: "VaultFrozen"; data: { vault: PublicKey; strikes: number; ts: number } }
  | { name: "Withdrawn"; data: { vault: PublicKey; to: PublicKey; amount: bigint; ts: number } }
  | { name: "MandateSeqBumped"; data: { vault: PublicKey; mandateSeq: bigint; ts: number } }
  | { name: "MandateClosed"; data: { vault: PublicKey; mandate: PublicKey; ts: number } }
  | { name: "RequestClosed"; data: { vault: PublicKey; request: PublicKey; ts: number } }
  | { name: "VaultClosed"; data: { vault: PublicKey; ts: number } };

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
          request: r.remaining > 0 ? r.optionPubkey() : null,
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
          strike: r.remaining > 0 ? r.bool() : true,
        },
      };
    case "VaultFrozen":
      return { name, data: { vault: r.pubkey(), strikes: r.u8(), ts: Number(r.i64()) } };
    case "Withdrawn":
      return { name, data: { vault: r.pubkey(), to: r.pubkey(), amount: r.u64(), ts: Number(r.i64()) } };
    case "MandateSeqBumped":
      return { name, data: { vault: r.pubkey(), mandateSeq: r.u64(), ts: Number(r.i64()) } };
    case "MandateClosed":
      return { name, data: { vault: r.pubkey(), mandate: r.pubkey(), ts: Number(r.i64()) } };
    case "RequestClosed":
      return { name, data: { vault: r.pubkey(), request: r.pubkey(), ts: Number(r.i64()) } };
    case "VaultClosed":
      return { name, data: { vault: r.pubkey(), ts: Number(r.i64()) } };
  }
}

/** Runtime-written log lines (programs can only add "Program log:" / "Program data:" lines, never these). */
export const INVOKE_RE = /^Program (\w+) invoke \[(\d+)\]$/;
export const EXIT_RE = /^Program (\w+) (success|failed)/;

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
    const invoke = line.match(INVOKE_RE);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (EXIT_RE.test(line)) {
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
