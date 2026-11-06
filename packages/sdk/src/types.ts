import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import type { FriendlyError } from "./errors";

/** How a payment was authorized onchain. */
export type AuthKind = "payee" | "mandate" | "request";

export type RequestStatus = "pending" | "approved" | "rejected" | "expired";

/** All amounts are token base units (dUSDC has 6 decimals: 1_000_000n = 1.00). */
export interface Policy {
  perTxCap: bigint;
  dailyCap: bigint;
  /** amount >= this needs an owner co-sign (spend request + Blink). 0n = disabled. */
  cosignThreshold: bigint;
  /** pending spend requests expire after this many seconds */
  requestTtlSecs: number;
  /** guarded_spend tripwire: auto-pause after this many blocked attempts. 0 = never. */
  freezeAfterStrikes: number;
}

export interface VaultState {
  address: PublicKey;
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
  /** guarded_spend counters, readable by anyone: the Arena's "verify it yourself" numbers */
  blockedCount: bigint;
  strikes: number;
  freezeAfterStrikes: number;
  lastBlockedAt: number;
  /** vault token account (ATA of mint owned by the vault PDA) and its balance */
  vaultAta: PublicKey;
  balance: bigint;
  decimals: number;
}

export interface PayeeState {
  address: PublicKey;
  vault: PublicKey;
  payee: PublicKey;
  label: string;
  perTxMax: bigint;
  /** 0n = unlimited within vault caps */
  budgetTotal: bigint;
  spent: bigint;
  active: boolean;
}

export interface MandateState {
  address: PublicKey;
  vault: PublicKey;
  id: bigint;
  payee: PublicKey;
  maxTotal: bigint;
  maxPerTx: bigint;
  spent: bigint;
  expiresAt: number;
  intentHash: Uint8Array;
  revoked: boolean;
}

export interface RequestState {
  address: PublicKey;
  vault: PublicKey;
  seq: bigint;
  payee: PublicKey;
  amount: bigint;
  reasonHash: Uint8Array;
  createdAt: number;
  expiresAt: number;
  status: RequestStatus;
}

export interface SpendArgs {
  vault: PublicKey;
  /** wallet that receives the payment (Leash pays its associated token account) */
  payee: PublicKey;
  amount: bigint;
  /** the agent's stated reason: sha256 goes onchain as reason_hash, the text goes in an SPL Memo */
  reason: string;
  /** optional 32-byte memo (x402 payment nonce), emitted in SpendExecuted */
  memo?: Uint8Array;
  /** force a specific mandate; otherwise payee PDA first, then active mandates for that payee */
  mandate?: PublicKey;
  /** send with skipPreflight so a rejected payment still lands onchain with an explorer link */
  expectFailure?: boolean;
  /** strict = agent_spend (violations revert). guarded = guarded_spend (violations record a strike, emit PaymentBlocked). */
  mode?: "strict" | "guarded";
}

export type SpendResult =
  | {
      ok: true;
      sig: string;
      explorerUrl: string;
      via: AuthKind;
    }
  | {
      ok: false;
      /** true when the Leash program refused the payment (vs. RPC/network failure) */
      blocked: boolean;
      /** program error name, e.g. "PayeeNotAuthorized" */
      name: string;
      code?: number;
      message: string;
      friendly: FriendlyError;
      /** present when the refused tx landed onchain (expectFailure or guarded mode) */
      sig?: string;
      explorerUrl?: string;
    };

export type RequestSpendResult =
  | {
      ok: true;
      request: PublicKey;
      seq: bigint;
      sig: string;
      explorerUrl: string;
      /** Solana Action URL for the owner to approve, if the client knows the site URL */
      blinkUrl?: string;
    }
  | Extract<SpendResult, { ok: false }>;

export type ActivityKind =
  | "spent"
  | "blocked"
  | "requested"
  | "resolved"
  | "policy"
  | "mandate"
  | "paused"
  | "frozen";

export interface ActivityEvent {
  kind: ActivityKind;
  sig: string;
  /** unix seconds */
  ts: number;
  slot?: number;
  amount?: bigint;
  payee?: string;
  /** set for blocked events */
  errorName?: string;
  /** hex sha256 of the agent's reason */
  reasonHash?: string;
  /** reason text recovered from the SPL Memo in the same tx, if present */
  reason?: string;
  via?: AuthKind;
  request?: string;
  approved?: boolean;
  paused?: boolean;
}

/** Owner-side actions, buildable as unsigned transactions for wallet adapters and Solana Actions (Blinks). */
export type OwnerAction =
  | { type: "approveRequest"; vault: PublicKey; request: PublicKey }
  | { type: "rejectRequest"; vault: PublicKey; request: PublicKey }
  | { type: "setPaused"; vault: PublicKey; paused: boolean }
  | { type: "resetStrikes"; vault: PublicKey }
  | { type: "updatePolicy"; vault: PublicKey; policy: Policy }
  | {
      type: "addPayee";
      vault: PublicKey;
      payee: PublicKey;
      label: string;
      perTxMax: bigint;
      budgetTotal: bigint;
    }
  | {
      type: "updatePayee";
      vault: PublicKey;
      payee: PublicKey;
      perTxMax: bigint;
      budgetTotal: bigint;
      active: boolean;
    }
  | { type: "removePayee"; vault: PublicKey; payee: PublicKey }
  | {
      type: "createMandate";
      vault: PublicKey;
      payee: PublicKey;
      maxTotal: bigint;
      maxPerTx: bigint;
      /** unix seconds */
      expiresAt: number;
      /** human-readable intent; sha256 goes onchain */
      intent: string;
    }
  | { type: "revokeMandate"; vault: PublicKey; mandate: PublicKey }
  | { type: "withdraw"; vault: PublicKey; amount: bigint };

/**
 * The client contract. `LeashClient` (real, onchain) and any mock used during development implement this.
 * Owner methods require the client's wallet to be the vault owner; agent methods require the agent key.
 */
export interface ILeashClient {
  readonly programId: PublicKey;
  readonly connection: Connection;

  vaultPda(owner: PublicKey, vaultId: bigint): PublicKey;
  payeePda(vault: PublicKey, payee: PublicKey): PublicKey;
  mandatePda(vault: PublicKey, id: bigint): PublicKey;
  requestPda(vault: PublicKey, seq: bigint): PublicKey;

  getVault(vault: PublicKey): Promise<VaultState>;
  listPayees(vault: PublicKey): Promise<PayeeState[]>;
  listMandates(vault: PublicKey): Promise<MandateState[]>;
  listRequests(vault: PublicKey, status?: RequestStatus): Promise<RequestState[]>;
  getRequest(request: PublicKey): Promise<RequestState | null>;

  initializeVault(args: {
    vaultId: bigint;
    agent: PublicKey;
    mint: PublicKey;
    policy: Policy;
  }): Promise<{ vault: PublicKey; sig: string }>;
  /** Sign and send an owner action with the client's wallet. Returns the signature. */
  ownerAction(action: OwnerAction): Promise<string>;
  /** Build an unsigned owner tx (fee payer = owner) for a wallet adapter or a Blink. */
  buildOwnerTx(owner: PublicKey, action: OwnerAction): Promise<Transaction>;

  spend(args: SpendArgs): Promise<SpendResult>;
  requestSpend(args: {
    vault: PublicKey;
    payee: PublicKey;
    amount: bigint;
    reason: string;
  }): Promise<RequestSpendResult>;

  onActivity(vault: PublicKey, cb: (e: ActivityEvent) => void): () => void;
  recentActivity(vault: PublicKey, limit?: number): Promise<ActivityEvent[]>;
}
