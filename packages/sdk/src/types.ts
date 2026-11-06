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
  /** tripwire: auto-pause after this many strikes (unauthorized attempts) within 24h. 0 = never. */
  freezeAfterStrikes: number;
  /**
   * Once the agent's un-co-signed spending over the rolling 24h would reach this, every further payment needs an
   * owner co-sign (stops 5 x 0.19 under a 0.20 per-payment threshold). 0n = disabled.
   */
  cosignWindowThreshold: bigint;
  /**
   * When true, agent_spend behaves like guarded_spend (refusals are recorded, unauthorized ones strike), so a
   * stolen agent key can't dodge the tripwire by picking the strict path. Required on purpose: an update_policy
   * built without it would silently switch the tripwire off.
   */
  enforceTripwire: boolean;
}

export interface VaultState {
  address: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  vaultId: bigint;
  /** unix seconds the vault was initialized (part of every signed-mandate message) */
  createdAt: number;
  paused: boolean;
  perTxCap: bigint;
  dailyCap: bigint;
  /** what left the vault in the rolling 24h at fetch time (counts against dailyCap) */
  spent24h: bigint;
  /** payments the agent made without a co-sign in the rolling 24h at fetch time (counts against cosignWindowThreshold) */
  autonomous24h: bigint;
  /**
   * @deprecated The program has no fixed window any more (rolling 24h of hourly buckets). This is the fetch time,
   * so old `now - windowStart >= 86400 ? 0n : spentInWindow` code keeps reading `spentInWindow`. Use `spent24h`.
   */
  windowStart: number;
  /** @deprecated Same as `spent24h`. */
  spentInWindow: bigint;
  cosignThreshold: bigint;
  cosignWindowThreshold: bigint;
  requestTtlSecs: number;
  requestSeq: bigint;
  /** nonce the next signed mandate must carry; also the id of the next mandate */
  mandateSeq: bigint;
  totalSpent: bigint;
  /** tripwire counters, readable by anyone: the Arena's "verify it yourself" numbers */
  blockedCount: bigint;
  /** strikes (unauthorized attempts) in the current 24h strike window */
  strikes: number;
  freezeAfterStrikes: number;
  lastBlockedAt: number;
  /** start of the current strike window, unix seconds (0 = none) */
  strikeWindowStart: number;
  enforceTripwire: boolean;
  /** open (unresolved) spend requests; the program allows at most 8 */
  openRequests: number;
  openPayees: number;
  openMandates: number;
  /** hourly rings behind spent24h / autonomous24h: slot = hour % 25, newest hour = lastBucket (unix_ts / 3600) */
  lastBucket: number;
  spentBuckets: bigint[];
  autoBuckets: bigint[];
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
  /** x402 payment nonce, emitted in SpendExecuted when the owner approves */
  memo?: Uint8Array | null;
  /**
   * true when the account no longer exists: the program closes a request on approve / reject / close_request, and
   * the status was read back from its transaction history. `seq` is then -1n if it couldn't be recovered, and
   * `expiresAt` is estimated from the vault's current request TTL.
   */
  closed?: boolean;
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
  /**
   * Send with skipPreflight so a rejected payment still lands onchain with an explorer link (demo txs that are
   * expected to fail). Everything else keeps preflight on, guarded mode included: a guarded refusal succeeds in
   * simulation (it records PaymentBlocked instead of reverting), so it lands anyway.
   */
  expectFailure?: boolean;
  /**
   * strict = agent_spend (violations revert, unless the vault has enforceTripwire). guarded = guarded_spend
   * (violations are recorded as PaymentBlocked; unauthorized ones are strikes).
   */
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
      /** present when the refused tx landed onchain (expectFailure, or a guarded refusal) */
      sig?: string;
      explorerUrl?: string;
      /** guarded refusals: true if it counted as a tripwire strike (unauthorized payee / redirected recipient) */
      strike?: boolean;
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
  | "frozen"
  /** owner withdrew funds */
  | "withdrawn"
  /** an expired request, a mandate or the vault was closed (rent refunded) */
  | "closed";

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
  /** blocked events recorded by the tripwire: true if it counted as a strike */
  strike?: boolean;
  /** blocked events from a failed tx: the Leash instruction that was refused, e.g. "agent_spend" */
  instruction?: string;
  /** hex sha256 of the agent's reason */
  reasonHash?: string;
  /** reason text recovered from the SPL Memo in the same tx, if present */
  reason?: string;
  via?: AuthKind;
  /** spend request address (requested / resolved / closed, and spent when the payment settled a request) */
  request?: string;
  /** mandate address (mandate / closed events) */
  mandate?: string;
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
  | { type: "withdraw"; vault: PublicKey; amount: bigint }
  /** Cancel every unredeemed signed mandate (moves vault.mandateSeq to `newSeq`, default mandateSeq + 1). */
  | { type: "bumpMandateSeq"; vault: PublicKey; newSeq?: bigint }
  /** Close a mandate (any state); rent goes back to the owner. */
  | { type: "closeMandate"; vault: PublicKey; mandate: PublicKey }
  /** Close an expired spend request (anyone may; rent goes back to the agent). */
  | { type: "closeRequest"; vault: PublicKey; request: PublicKey }
  /** Close an empty vault with no payees, mandates or open requests; all rent goes to the owner. */
  | { type: "closeVault"; vault: PublicKey };

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
    /** optional 32-byte x402 nonce, carried to SpendExecuted on approval */
    memo?: Uint8Array;
  }): Promise<RequestSpendResult>;

  onActivity(vault: PublicKey, cb: (e: ActivityEvent) => void): () => void;
  recentActivity(vault: PublicKey, limit?: number): Promise<ActivityEvent[]>;
}
