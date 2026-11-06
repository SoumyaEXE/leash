import {
  type Commitment,
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  type TransactionInstruction,
  TransactionInstruction as TxIx,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import { activityFromTransaction, topLevelInstructions } from "./activity";
import {
  errorNameFromCode,
  friendlyError,
  parseLeashErrorFromLogs,
} from "./errors";
import {
  approveRequestIx,
  addPayeeIx,
  bumpMandateSeqIx,
  closeMandateIx,
  closeRequestIx,
  closeVaultIx,
  createMandateIx,
  initializeVaultIx,
  redeemSignedMandateIx,
  rejectRequestIx,
  removePayeeIx,
  requestSpendIx,
  resetStrikesIx,
  revokeMandateIx,
  setPausedIx,
  spendIx,
  updatePayeeIx,
  updatePolicyIx,
  withdrawIx,
} from "./instructions";
import {
  VAULT_FIELD_OFFSET,
  ACCOUNT,
  MAX_OPEN_REQUESTS,
  type MandateTermsArgs,
  decodeMandate,
  decodePayee,
  decodeRequest,
  decodeVault,
  parseLeashEvents,
  rollingSum,
  type LeashEvent,
} from "./layout";
import {
  buildMandateMessage,
  decodeSignedMandate,
  mandateMessageText,
  type LeashCluster,
  type MandateMessageContext,
  type SignedMandate,
  type SignedMandateJson,
} from "./mandate";
import type {
  ActivityEvent,
  AuthKind,
  ILeashClient,
  MandateState,
  OwnerAction,
  PayeeState,
  Policy,
  RequestSpendResult,
  RequestState,
  RequestStatus,
  SpendArgs,
  SpendResult,
  VaultState,
} from "./types";
import {
  MEMO_PROGRAM_ID,
  REASON_MEMO_PREFIX,
  explorerTx,
  reasonHash,
} from "./utils";
import bs58 from "bs58";

/** Anything that can sign: a Keypair (server agents) or a wallet adapter (browser owner). */
export interface WalletLike {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
}

export interface LeashClientOptions {
  connection: Connection;
  programId: PublicKey | string;
  /** Signer for owner or agent actions. Read-only use needs none. */
  wallet?: Keypair | WalletLike;
  /** Site that serves the Solana Actions routes, e.g. https://leash.example → blinkUrl for spend requests. */
  blinkBaseUrl?: string;
  commitment?: Commitment;
  /** Cluster of the program build: explorer links, and the "Cluster:" line of signed mandates. */
  cluster?: LeashCluster;
}

type Failure = Extract<SpendResult, { ok: false }>;

export type RedeemMandateResult = (Extract<SpendResult, { ok: true }> & { mandate: PublicKey }) | Failure;

function isKeypair(w: unknown): w is Keypair {
  return w instanceof Keypair || (!!w && typeof w === "object" && "secretKey" in w && "publicKey" in w);
}

/** The policy a vault runs now, ready to edit one field and pass to `updatePolicy` without resetting the others. */
export function policyOf(v: Pick<VaultState, keyof Policy>): Policy {
  return {
    perTxCap: v.perTxCap,
    dailyCap: v.dailyCap,
    cosignThreshold: v.cosignThreshold,
    requestTtlSecs: v.requestTtlSecs,
    freezeAfterStrikes: v.freezeAfterStrikes,
    cosignWindowThreshold: v.cosignWindowThreshold,
    enforceTripwire: v.enforceTripwire,
  };
}

/** What a signed-mandate message for this vault needs besides the terms (see `buildMandateMessage`). */
export function mandateContextFor(
  v: Pick<VaultState, "address" | "createdAt" | "mint" | "decimals">,
  programId: PublicKey,
  cluster: LeashCluster = "devnet",
): MandateMessageContext {
  return { programId, cluster, vault: v.address, vaultCreatedAt: v.createdAt, mint: v.mint, decimals: v.decimals };
}

const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export class LeashClient implements ILeashClient {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly wallet?: Keypair | WalletLike;
  readonly blinkBaseUrl?: string;
  readonly commitment: Commitment;
  readonly cluster: LeashCluster;
  private mintCache = new Map<string, { tokenProgram: PublicKey; decimals: number }>();

  constructor(opts: LeashClientOptions) {
    this.connection = opts.connection;
    this.programId = new PublicKey(opts.programId);
    this.wallet = opts.wallet;
    this.blinkBaseUrl = opts.blinkBaseUrl?.replace(/\/$/, "");
    this.commitment = opts.commitment ?? "confirmed";
    this.cluster = opts.cluster ?? "devnet";
  }

  get walletPublicKey(): PublicKey {
    if (!this.wallet) throw new Error("LeashClient: no wallet configured");
    return this.wallet.publicKey;
  }

  // ───────────────────────────── PDAs ─────────────────────────────

  vaultPda(owner: PublicKey, vaultId: bigint): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.toBuffer(), u64le(vaultId)], this.programId)[0];
  }
  payeePda(vault: PublicKey, payee: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("payee"), vault.toBuffer(), payee.toBuffer()], this.programId)[0];
  }
  mandatePda(vault: PublicKey, id: bigint): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("mandate"), vault.toBuffer(), u64le(id)], this.programId)[0];
  }
  requestPda(vault: PublicKey, seq: bigint): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("request"), vault.toBuffer(), u64le(seq)], this.programId)[0];
  }

  // ───────────────────────────── token helpers ─────────────────────────────

  /** Token program and decimals of a mint (cached). */
  async mintInfo(mint: PublicKey): Promise<{ tokenProgram: PublicKey; decimals: number }> {
    const key = mint.toBase58();
    const cached = this.mintCache.get(key);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(mint, this.commitment);
    if (!info) throw new Error(`Mint ${key} not found`);
    if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      throw new Error(`${key} is not an SPL Token / Token-2022 mint`);
    }
    // Base mint layout (both programs): mint_authority COption<Pubkey> (36) + supply u64 (8) → decimals at 44.
    if (info.data.length < 45) throw new Error(`Mint ${key} has no mint data`);
    const out = { tokenProgram: info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID, decimals: info.data[44] };
    this.mintCache.set(key, out);
    return out;
  }

  async tokenProgramFor(mint: PublicKey): Promise<PublicKey> {
    return (await this.mintInfo(mint)).tokenProgram;
  }

  ata(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
    return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  }

  // ───────────────────────────── reads ─────────────────────────────

  async getVault(vault: PublicKey): Promise<VaultState> {
    const info = await this.connection.getAccountInfo(vault, this.commitment);
    if (!info) throw new Error(`Vault ${vault.toBase58()} not found`);
    if (!info.owner.equals(this.programId)) throw new Error(`${vault.toBase58()} is not an account of the Leash program ${this.programId.toBase58()}`);
    const v = decodeVault(info.data);
    const { tokenProgram, decimals } = await this.mintInfo(v.mint);
    const vaultAta = this.ata(v.mint, vault, tokenProgram);
    let balance = 0n;
    try {
      const bal = await this.connection.getTokenAccountBalance(vaultAta, this.commitment);
      balance = BigInt(bal.value.amount);
    } catch (e) {
      // Only a missing token account means 0. An RPC error (e.g. 429) must not look like an empty vault.
      if (!/could not find account|not a Token account|Invalid param/i.test((e as Error)?.message ?? "")) throw e;
    }
    const now = Math.floor(Date.now() / 1000);
    const spent24h = rollingSum(v.spentBuckets, v.lastBucket, now);
    return {
      address: vault,
      owner: v.owner,
      agent: v.agent,
      mint: v.mint,
      vaultId: v.vaultId,
      createdAt: v.createdAt,
      paused: v.paused,
      perTxCap: v.perTxCap,
      dailyCap: v.dailyCap,
      spent24h,
      autonomous24h: rollingSum(v.autoBuckets, v.lastBucket, now),
      windowStart: now,
      spentInWindow: spent24h,
      cosignThreshold: v.cosignThreshold,
      cosignWindowThreshold: v.cosignWindowThreshold,
      requestTtlSecs: v.requestTtlSecs,
      requestSeq: v.requestSeq,
      mandateSeq: v.mandateSeq,
      totalSpent: v.totalSpent,
      blockedCount: v.blockedCount,
      strikes: v.strikes,
      freezeAfterStrikes: v.freezeAfterStrikes,
      lastBlockedAt: v.lastBlockedAt,
      strikeWindowStart: v.strikeWindowStart,
      enforceTripwire: v.enforceTripwire,
      openRequests: v.openRequests,
      openPayees: v.openPayees,
      openMandates: v.openMandates,
      lastBucket: v.lastBucket,
      spentBuckets: v.spentBuckets,
      autoBuckets: v.autoBuckets,
      vaultAta,
      balance,
      decimals,
    };
  }

  /** Context for `buildMandateMessage` / `signMandate` on this vault (fetches the vault). */
  async mandateContext(vault: PublicKey): Promise<MandateMessageContext> {
    return mandateContextFor(await this.getVault(vault), this.programId, this.cluster);
  }

  private async programAccountsFor(vault: PublicKey, disc: Uint8Array) {
    return this.connection.getProgramAccounts(this.programId, {
      commitment: this.commitment,
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(disc) } },
        { memcmp: { offset: VAULT_FIELD_OFFSET, bytes: vault.toBase58() } },
      ],
    });
  }

  async listPayees(vault: PublicKey): Promise<PayeeState[]> {
    const accts = await this.programAccountsFor(vault, ACCOUNT.Payee);
    return accts.map((a) => decodePayee(a.pubkey, a.account.data)).sort((x, y) => x.label.localeCompare(y.label));
  }

  async getPayee(vault: PublicKey, payee: PublicKey): Promise<PayeeState | null> {
    const pda = this.payeePda(vault, payee);
    const info = await this.connection.getAccountInfo(pda, this.commitment);
    return info && info.owner.equals(this.programId) ? decodePayee(pda, info.data) : null;
  }

  /** Mandates that exist onchain. Ids can have gaps (bump_mandate_seq, close_mandate). */
  async listMandates(vault: PublicKey): Promise<MandateState[]> {
    const accts = await this.programAccountsFor(vault, ACCOUNT.Mandate);
    return accts.map((a) => decodeMandate(a.pubkey, a.account.data)).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }

  /**
   * Open spend requests (status "pending", or "expired" once past expiresAt). Approved / rejected requests are
   * closed by the program, so they are not listed: read outcomes from `recentActivity` or `getRequest`.
   */
  async listRequests(vault: PublicKey, status?: RequestStatus): Promise<RequestState[]> {
    const accts = await this.programAccountsFor(vault, ACCOUNT.SpendRequest);
    const now = Math.floor(Date.now() / 1000);
    return accts
      .map((a) => decodeRequest(a.pubkey, a.account.data))
      .map((r) => (r.status === "pending" && now > r.expiresAt ? { ...r, status: "expired" as const } : r))
      .filter((r) => !status || r.status === status)
      .sort((x, y) => (y.seq > x.seq ? 1 : y.seq < x.seq ? -1 : 0));
  }

  /** The open request account, or null (never existed, or already approved / rejected / closed). */
  async getOpenRequest(request: PublicKey): Promise<RequestState | null> {
    const info = await this.connection.getAccountInfo(request, this.commitment);
    if (!info || !info.owner.equals(this.programId)) return null;
    const r = decodeRequest(request, info.data);
    return r.status === "pending" && Math.floor(Date.now() / 1000) > r.expiresAt ? { ...r, status: "expired" } : r;
  }

  /**
   * A spend request and its status. Open requests are read from their account. The program closes a request when
   * it is approved, rejected or closed after expiry, so for those the status ("approved" / "rejected" /
   * "expired") is read back from the request's transaction history (`closed: true`). null if it never existed.
   */
  async getRequest(request: PublicKey): Promise<RequestState | null> {
    const open = await this.getOpenRequest(request);
    if (open) return open;
    return this.closedRequest(request).catch(() => null);
  }

  private async closedRequest(request: PublicKey): Promise<RequestState | null> {
    const sigs = await this.connection.getSignaturesForAddress(request, { limit: 20 }, "confirmed");
    let outcome: { status: RequestStatus; memo: Uint8Array | null } | null = null;
    for (const s of sigs) {
      if (s.err) continue;
      const tx = await this.connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const events = parseLeashEvents(tx?.meta?.logMessages, this.programId);
      for (const e of events) {
        if ((e.name === "RequestResolved" || e.name === "RequestClosed") && e.data.request.equals(request) && !outcome) {
          const executed = events.find((x) => x.name === "SpendExecuted" && x.data.request?.equals(request));
          outcome = {
            status: e.name === "RequestClosed" ? "expired" : e.data.approved ? "approved" : "rejected",
            memo: executed && executed.name === "SpendExecuted" ? executed.data.memo : null,
          };
        }
        if (e.name === "SpendRequested" && e.data.request.equals(request)) {
          // Newest first: the creation of the latest lifecycle of this address. No outcome after it = inconsistent.
          if (!outcome) return null;
          const vaultInfo = await this.connection.getAccountInfo(e.data.vault, this.commitment).catch(() => null);
          let seq = -1n;
          let ttl = 0;
          if (vaultInfo?.owner.equals(this.programId)) {
            try {
              const v = decodeVault(vaultInfo.data);
              ttl = v.requestTtlSecs;
              for (let i = v.requestSeq - 1n, n = 0; i >= 0n && n < 1024; i--, n++) {
                if (this.requestPda(e.data.vault, i).equals(request)) {
                  seq = i;
                  break;
                }
              }
            } catch {
              // closed or legacy vault: leave seq unknown
            }
          }
          return {
            address: request,
            vault: e.data.vault,
            seq,
            payee: e.data.payee,
            amount: e.data.amount,
            reasonHash: e.data.reasonHash,
            createdAt: e.data.ts,
            expiresAt: e.data.ts + ttl,
            status: outcome.status,
            memo: outcome.memo,
            closed: true,
          };
        }
      }
    }
    return null;
  }

  /**
   * Which owner-signed authorization should cover a payment to `payee`. Allowlist entry first if it can take
   * `amount`; otherwise a mandate that can (soonest expiry first). Exhausted, revoked and expired mandates are
   * skipped. If nothing fits, the closest authorization is still returned, so the program refuses with its named,
   * benign reason (ExceedsPayeePerTx, PayeeBudgetExceeded, MandateExhausted, MandateExpired...) instead of
   * PayeeNotAuthorized, which is a tripwire strike.
   */
  async resolveAuthorization(
    vault: PublicKey,
    payee: PublicKey,
    forceMandate?: PublicKey,
    amount?: bigint,
  ): Promise<{ payeeAccount: PublicKey | null; mandateAccount: PublicKey | null; via: AuthKind | null }> {
    if (forceMandate) return { payeeAccount: null, mandateAccount: forceMandate, via: "mandate" };
    const asPayee = (p: PayeeState) => ({ payeeAccount: p.address, mandateAccount: null, via: "payee" as const });
    const asMandate = (m: MandateState) => ({ payeeAccount: null, mandateAccount: m.address, via: "mandate" as const });
    const p = await this.getPayee(vault, payee);
    const payeeFits =
      !!p && p.active && (amount === undefined || (amount <= p.perTxMax && (p.budgetTotal === 0n || p.spent + amount <= p.budgetTotal)));
    if (p && payeeFits) return asPayee(p);

    const now = Math.floor(Date.now() / 1000);
    const forPayee = (await this.listMandates(vault)).filter((m) => m.payee.equals(payee));
    const live = forPayee
      .filter((m) => !m.revoked && m.expiresAt > now && m.spent < m.maxTotal)
      .sort((a, b) => a.expiresAt - b.expiresAt || (a.id < b.id ? -1 : 1));
    const fits = amount === undefined ? live : live.filter((m) => amount <= m.maxPerTx && m.spent + amount <= m.maxTotal);
    if (fits[0]) return asMandate(fits[0]);
    if (p) return asPayee(p);
    if (live[0]) return asMandate(live[0]);
    // Only used-up / revoked / expired mandates: the newest one gets a named, non-strike refusal.
    const newest = [...forPayee].sort((a, b) => (a.id > b.id ? -1 : 1))[0];
    if (newest) return asMandate(newest);
    return { payeeAccount: null, mandateAccount: null, via: null };
  }

  // ───────────────────────────── sending ─────────────────────────────

  private async signAndSend(
    ixs: TransactionInstruction[],
    opts: { skipPreflight?: boolean; extraSigners?: Keypair[] } = {},
  ): Promise<string> {
    const wallet = this.wallet;
    if (!wallet) throw new Error("LeashClient: no wallet configured");
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.commitment);
    let tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    if (isKeypair(wallet)) {
      tx.sign(wallet, ...(opts.extraSigners ?? []));
    } else {
      if (opts.extraSigners?.length) tx.partialSign(...opts.extraSigners);
      tx = await wallet.signTransaction(tx);
    }
    const sig = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: opts.skipPreflight ?? false,
      preflightCommitment: this.commitment,
      maxRetries: 5,
    });
    await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, this.commitment).catch(() => {
      // a failed tx still "confirms" with an err; we read it back below when needed
    });
    return sig;
  }

  /** Read a landed tx back: did it fail, with which Leash error, and which events did it emit? */
  async inspectTx(sig: string): Promise<{ err: unknown; logs: string[]; events: LeashEvent[] } | null> {
    for (let i = 0; i < 10; i++) {
      const tx = await this.connection.getTransaction(sig, {
        commitment: this.commitment === "processed" ? "confirmed" : (this.commitment as "confirmed" | "finalized"),
        maxSupportedTransactionVersion: 0,
      });
      if (tx?.meta) {
        const logs = tx.meta.logMessages ?? [];
        return { err: tx.meta.err, logs, events: parseLeashEvents(logs, this.programId) };
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    return null;
  }

  private failure(logs: string[] | undefined, fallback: string, sig?: string): Failure {
    const parsed = parseLeashErrorFromLogs(logs, this.programId);
    const name = parsed?.name ?? fallback;
    return {
      ok: false,
      blocked: !!parsed,
      name,
      code: parsed?.code,
      message: parsed?.message ?? name,
      friendly: friendlyError(name),
      sig,
      explorerUrl: sig ? explorerTx(sig, this.cluster) : undefined,
    };
  }

  /** Send, and turn a Leash refusal into a result instead of an exception. */
  private async sendExpectingLeash(
    ixs: TransactionInstruction[],
    skipPreflight: boolean,
  ): Promise<{ ok: true; sig: string; events: LeashEvent[]; logs: string[] } | Failure> {
    let sig: string;
    try {
      sig = await this.signAndSend(ixs, { skipPreflight });
    } catch (e) {
      if (e instanceof SendTransactionError) {
        const logs = (await e.getLogs(this.connection).catch(() => undefined)) ?? e.logs ?? undefined;
        return this.failure(logs ?? undefined, e.message.slice(0, 200));
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, blocked: false, name: "SendFailed", message: msg, friendly: friendlyError(msg) };
    }
    const landed = await this.inspectTx(sig);
    if (!landed) {
      return { ok: false, blocked: false, name: "NotConfirmed", message: "Transaction not confirmed", friendly: friendlyError("Transaction not confirmed"), sig, explorerUrl: explorerTx(sig, this.cluster) };
    }
    if (landed.err) return this.failure(landed.logs, JSON.stringify(landed.err), sig);
    return { ok: true, sig, events: landed.events, logs: landed.logs };
  }

  private reasonMemoIx(reason: string): TransactionInstruction {
    const text = REASON_MEMO_PREFIX + reason.replace(/\s+/g, " ").slice(0, 180);
    return new TxIx({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(text, "utf8") });
  }

  // ───────────────────────────── agent ─────────────────────────────

  /** Build the instructions for a spend (memo with the reason + agent_spend/guarded_spend). */
  async buildSpendIxs(args: SpendArgs & { agent?: PublicKey }): Promise<{ ixs: TransactionInstruction[]; via: AuthKind | null }> {
    const agent = args.agent ?? this.walletPublicKey;
    const vault = await this.getVault(args.vault);
    const tokenProgram = await this.tokenProgramFor(vault.mint);
    const auth = await this.resolveAuthorization(args.vault, args.payee, args.mandate, args.amount);
    // The program only pays the payee's associated token account (T4).
    const recipientAta = this.ata(vault.mint, args.payee, tokenProgram);
    const spend = spendIx(
      this.programId,
      {
        agent,
        vault: args.vault,
        mint: vault.mint,
        vaultAta: vault.vaultAta,
        recipientAta,
        payeeAccount: auth.payeeAccount,
        mandateAccount: auth.mandateAccount,
        tokenProgram,
      },
      { amount: args.amount, reasonHash: reasonHash(args.reason), memo: args.memo ?? null },
      args.mode === "guarded",
    );
    return { ixs: [this.reasonMemoIx(args.reason), spend], via: auth.via };
  }

  async spend(args: SpendArgs): Promise<SpendResult> {
    let built: { ixs: TransactionInstruction[]; via: AuthKind | null };
    try {
      built = await this.buildSpendIxs(args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, blocked: false, name: "BuildFailed", message: msg, friendly: friendlyError(msg) };
    }
    // Preflight stays on unless the caller expects a revert (project rule). A guarded refusal doesn't revert, so
    // it passes simulation and lands with its PaymentBlocked event.
    const res = await this.sendExpectingLeash(built.ixs, !!args.expectFailure);
    if (!res.ok) return res;
    const blocked = res.events.find((e) => e.name === "PaymentBlocked");
    if (blocked && blocked.name === "PaymentBlocked") {
      const name = errorNameFromCode(blocked.data.reasonCode) ?? `Custom(${blocked.data.reasonCode})`;
      return {
        ok: false,
        blocked: true,
        name,
        code: blocked.data.reasonCode,
        message: friendlyError(name).detail,
        friendly: friendlyError(name),
        sig: res.sig,
        explorerUrl: explorerTx(res.sig, this.cluster),
        strike: blocked.data.strike,
      };
    }
    const executed = res.events.find((e) => e.name === "SpendExecuted");
    const via = executed && executed.name === "SpendExecuted" ? executed.data.via : (built.via ?? "payee");
    return { ok: true, sig: res.sig, explorerUrl: explorerTx(res.sig, this.cluster), via };
  }

  /**
   * Partially-signed spend for an x402 facilitator that pays the fee (docs/05 Option 1): the agent signs,
   * the facilitator adds the fee-payer signature. Returns a base64 versioned transaction.
   */
  async buildSpendTxForFeePayer(args: SpendArgs & { feePayer: PublicKey }): Promise<string> {
    const wallet = this.wallet;
    if (!wallet || !isKeypair(wallet)) throw new Error("buildSpendTxForFeePayer needs a Keypair agent wallet");
    const { ixs } = await this.buildSpendIxs({ ...args, agent: wallet.publicKey });
    const { blockhash } = await this.connection.getLatestBlockhash(this.commitment);
    const { TransactionMessage } = await import("@solana/web3.js");
    const msg = new TransactionMessage({ payerKey: args.feePayer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const vtx = new VersionedTransaction(msg);
    vtx.sign([wallet]);
    return Buffer.from(vtx.serialize()).toString("base64");
  }

  async requestSpend(args: {
    vault: PublicKey;
    payee: PublicKey;
    amount: bigint;
    reason: string;
    memo?: Uint8Array;
  }): Promise<RequestSpendResult> {
    let vault = await this.getVault(args.vault);
    if (vault.openRequests >= MAX_OPEN_REQUESTS) {
      // Free slots held by expired requests first (permissionless; the rent comes back to the agent).
      await this.closeExpiredRequests(args.vault).catch(() => []);
      vault = await this.getVault(args.vault);
    }
    const request = this.requestPda(args.vault, vault.requestSeq);
    const auth = await this.resolveAuthorization(args.vault, args.payee, undefined, args.amount);
    const ixs = [
      this.reasonMemoIx(args.reason),
      requestSpendIx(
        this.programId,
        { agent: this.walletPublicKey, vault: args.vault, request, payeeAccount: auth.payeeAccount, mandateAccount: auth.mandateAccount },
        { payee: args.payee, amount: args.amount, reasonHash: reasonHash(args.reason), memo: args.memo ?? null },
      ),
    ];
    const res = await this.sendExpectingLeash(ixs, false);
    if (!res.ok) return res;
    return {
      ok: true,
      request,
      seq: vault.requestSeq,
      sig: res.sig,
      explorerUrl: explorerTx(res.sig, this.cluster),
      blinkUrl: this.blinkBaseUrl ? `${this.blinkBaseUrl}/api/actions/approve?request=${request.toBase58()}` : undefined,
    };
  }

  /** Close this vault's expired requests (anyone may; rent goes to the vault's agent). Returns the tx signatures. */
  async closeExpiredRequests(vault: PublicKey): Promise<string[]> {
    const v = await this.getVault(vault);
    const expired = (await this.listRequests(vault, "expired")).filter((r) => r.vault.equals(vault));
    const sigs: string[] = [];
    for (let i = 0; i < expired.length; i += 6) {
      const ixs = expired.slice(i, i + 6).map((r) => closeRequestIx(this.programId, { vault, request: r.address, agent: v.agent }));
      sigs.push(await this.signAndSend(ixs));
    }
    return sigs;
  }

  /**
   * The redeem transaction for an owner-signed mandate: `[Ed25519 verify, redeem_signed_mandate]` (the verify ix
   * must come right before). The message is rebuilt from the vault's current state, exactly as the program does.
   */
  async buildRedeemMandateIxs(
    agent: PublicKey,
    input: { vault: PublicKey; terms: MandateTermsArgs; signature: Uint8Array; message?: string },
  ): Promise<{ ixs: TransactionInstruction[]; mandate: PublicKey; vault: VaultState }> {
    const vault = await this.getVault(input.vault);
    const text = mandateMessageText(mandateContextFor(vault, this.programId, this.cluster), input.terms);
    if (input.message && input.message !== text) {
      throw new Error(
        "The signed text doesn't match this vault's current state (different program, cluster, vault opening time or mint decimals).",
      );
    }
    const verify = Ed25519Program.createInstructionWithPublicKey({
      publicKey: vault.owner.toBytes(),
      message: new TextEncoder().encode(text),
      signature: input.signature,
    });
    const mandate = this.mandatePda(input.vault, vault.mandateSeq);
    const redeem = redeemSignedMandateIx(this.programId, { agent, vault: input.vault, mandate, mint: vault.mint }, input.terms);
    return { ixs: [verify, redeem], mandate, vault };
  }

  /**
   * Agent side: redeem a mandate the owner signed off-chain (`signMandate` / the dashboard export). Accepts the
   * exported JSON (string or object), a `SignedMandate`, or (vault, terms, signature). The agent pays the rent.
   */
  async redeemSignedMandate(signed: SignedMandate | SignedMandateJson | string): Promise<RedeemMandateResult>;
  async redeemSignedMandate(vault: PublicKey, terms: MandateTermsArgs, ownerSignature: Uint8Array): Promise<RedeemMandateResult>;
  async redeemSignedMandate(
    a: SignedMandate | SignedMandateJson | string | PublicKey,
    terms?: MandateTermsArgs,
    ownerSignature?: Uint8Array,
  ): Promise<RedeemMandateResult> {
    let input: { vault: PublicKey; terms: MandateTermsArgs; signature: Uint8Array; message?: string };
    try {
      if (a instanceof PublicKey) {
        if (!terms || !ownerSignature) throw new Error("redeemSignedMandate(vault, terms, signature): terms and signature are required");
        input = { vault: a, terms, signature: ownerSignature };
      } else {
        const s = typeof a === "string" || !("signature" in a && a.signature instanceof Uint8Array) ? decodeSignedMandate(a as string | SignedMandateJson) : (a as SignedMandate);
        if (!s.programId.equals(this.programId)) throw new Error(`Mandate was signed for program ${s.programId.toBase58()}, not ${this.programId.toBase58()}`);
        if (s.cluster !== this.cluster) throw new Error(`Mandate was signed for ${s.cluster}, this client is on ${this.cluster}`);
        input = { vault: s.vault, terms: s.terms, signature: s.signature, message: s.message || undefined };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, blocked: false, name: "InvalidSignedMandate", message: msg, friendly: friendlyError(msg) };
    }
    let built: Awaited<ReturnType<LeashClient["buildRedeemMandateIxs"]>>;
    try {
      built = await this.buildRedeemMandateIxs(this.walletPublicKey, input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, blocked: false, name: "BuildFailed", message: msg, friendly: friendlyError(msg) };
    }
    if (input.terms.nonce !== built.vault.mandateSeq) {
      // Would fail onchain with StaleMandateNonce: already redeemed, or cancelled by bump_mandate_seq.
      const f = friendlyError("StaleMandateNonce");
      return { ok: false, blocked: true, name: "StaleMandateNonce", message: f.detail, friendly: f };
    }
    const res = await this.sendExpectingLeash(built.ixs, false);
    if (!res.ok) return res;
    return { ok: true, sig: res.sig, explorerUrl: explorerTx(res.sig, this.cluster), via: "mandate", mandate: built.mandate };
  }

  // ───────────────────────────── owner ─────────────────────────────

  async initializeVault(args: {
    vaultId: bigint;
    agent: PublicKey;
    mint: PublicKey;
    policy: Policy;
  }): Promise<{ vault: PublicKey; sig: string }> {
    const owner = this.walletPublicKey;
    const vault = this.vaultPda(owner, args.vaultId);
    const tokenProgram = await this.tokenProgramFor(args.mint);
    const vaultAta = this.ata(args.mint, vault, tokenProgram);
    const sig = await this.signAndSend([
      initializeVaultIx(this.programId, { owner, vault, mint: args.mint, vaultAta, tokenProgram }, args),
    ]);
    const landed = await this.inspectTx(sig);
    if (landed?.err) throw new Error(`initialize_vault failed: ${parseLeashErrorFromLogs(landed.logs, this.programId)?.name ?? JSON.stringify(landed.err)}`);
    return { vault, sig };
  }

  /** Instructions for an owner action (owner = signer and fee payer). */
  async ownerIxs(owner: PublicKey, action: OwnerAction): Promise<TransactionInstruction[]> {
    const pid = this.programId;
    switch (action.type) {
      case "setPaused":
        return [setPausedIx(pid, owner, action.vault, action.paused)];
      case "resetStrikes":
        return [resetStrikesIx(pid, owner, action.vault)];
      case "updatePolicy":
        return [updatePolicyIx(pid, owner, action.vault, action.policy)];
      case "addPayee":
        return [
          addPayeeIx(
            pid,
            { owner, vault: action.vault, payeeAccount: this.payeePda(action.vault, action.payee) },
            { payee: action.payee, label: action.label, perTxMax: action.perTxMax, budgetTotal: action.budgetTotal },
          ),
        ];
      case "updatePayee":
        return [
          updatePayeeIx(
            pid,
            { owner, vault: action.vault, payeeAccount: this.payeePda(action.vault, action.payee) },
            { perTxMax: action.perTxMax, budgetTotal: action.budgetTotal, active: action.active },
          ),
        ];
      case "removePayee":
        return [removePayeeIx(pid, { owner, vault: action.vault, payeeAccount: this.payeePda(action.vault, action.payee) })];
      case "createMandate": {
        const v = await this.getVault(action.vault);
        return [
          createMandateIx(
            pid,
            { owner, vault: action.vault, mandate: this.mandatePda(action.vault, v.mandateSeq) },
            {
              payee: action.payee,
              maxTotal: action.maxTotal,
              maxPerTx: action.maxPerTx,
              expiresAt: action.expiresAt,
              intentHash: reasonHash(action.intent),
            },
          ),
        ];
      }
      case "revokeMandate":
        return [revokeMandateIx(pid, { owner, vault: action.vault, mandate: action.mandate })];
      case "closeMandate":
        return [closeMandateIx(pid, { owner, vault: action.vault, mandate: action.mandate })];
      case "bumpMandateSeq": {
        const v = await this.getVault(action.vault);
        return [bumpMandateSeqIx(pid, owner, action.vault, action.newSeq ?? v.mandateSeq + 1n)];
      }
      case "approveRequest": {
        const req = await this.getOpenRequest(action.request);
        if (!req) throw new Error("Spend request not found: it was already approved, rejected or closed");
        if (!req.vault.equals(action.vault)) throw new Error("Spend request belongs to another vault");
        const v = await this.getVault(action.vault);
        const tokenProgram = await this.tokenProgramFor(v.mint);
        const auth = await this.resolveAuthorization(action.vault, req.payee, undefined, req.amount);
        return [
          approveRequestIx(pid, {
            owner,
            vault: action.vault,
            request: action.request,
            mint: v.mint,
            vaultAta: v.vaultAta,
            recipientAta: this.ata(v.mint, req.payee, tokenProgram),
            payeeAccount: auth.payeeAccount,
            mandateAccount: auth.mandateAccount,
            tokenProgram,
            agent: v.agent,
          }),
        ];
      }
      case "rejectRequest": {
        const v = await this.getVault(action.vault);
        return [rejectRequestIx(pid, { owner, vault: action.vault, request: action.request, agent: v.agent })];
      }
      case "closeRequest": {
        const v = await this.getVault(action.vault);
        return [closeRequestIx(pid, { vault: action.vault, request: action.request, agent: v.agent })];
      }
      case "withdraw": {
        const v = await this.getVault(action.vault);
        const tokenProgram = await this.tokenProgramFor(v.mint);
        return [
          withdrawIx(
            pid,
            {
              owner,
              vault: action.vault,
              mint: v.mint,
              vaultAta: v.vaultAta,
              ownerTokenAccount: this.ata(v.mint, owner, tokenProgram),
              tokenProgram,
            },
            action.amount,
          ),
        ];
      }
      case "closeVault": {
        const v = await this.getVault(action.vault);
        const tokenProgram = await this.tokenProgramFor(v.mint);
        return [closeVaultIx(pid, { owner, vault: action.vault, mint: v.mint, vaultAta: v.vaultAta, tokenProgram })];
      }
    }
  }

  async ownerAction(action: OwnerAction): Promise<string> {
    const ixs = await this.ownerIxs(this.walletPublicKey, action);
    const sig = await this.signAndSend(ixs);
    const landed = await this.inspectTx(sig);
    if (landed?.err) {
      const parsed = parseLeashErrorFromLogs(landed.logs, this.programId);
      throw new Error(parsed ? `${parsed.name}: ${friendlyError(parsed.name).detail}` : JSON.stringify(landed.err));
    }
    return sig;
  }

  async buildOwnerTx(owner: PublicKey, action: OwnerAction): Promise<Transaction> {
    const ixs = await this.ownerIxs(owner, action);
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.commitment);
    return new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(...ixs);
  }

  // ───────────────────────────── activity ─────────────────────────────

  private async fetchActivity(vault: PublicKey, sig: string, blockTime?: number | null): Promise<ActivityEvent[] | null> {
    const tx = await this.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return null;
    return activityFromTransaction(this.programId, vault, {
      sig,
      ts: blockTime ?? tx.blockTime ?? Math.floor(Date.now() / 1000),
      slot: tx.slot,
      logs: tx.meta.logMessages ?? [],
      err: tx.meta.err,
      instructions: topLevelInstructions(tx),
    });
  }

  /**
   * Live feed: every tx that mentions the vault, including failed (blocked) ones, filtered to what the Leash
   * program really did to *this* vault (see activity.ts). Returns unsubscribe.
   */
  onActivity(vault: PublicKey, cb: (e: ActivityEvent) => void): () => void {
    const seen = new Set<string>();
    const pending = new Set<string>();
    const emitAll = (sig: string, events: ActivityEvent[]) => {
      if (seen.has(sig)) return;
      seen.add(sig);
      for (const e of events) cb(e);
    };
    const fetchAndEmit = (sig: string, blockTime?: number | null) => {
      if (seen.has(sig) || pending.has(sig)) return;
      pending.add(sig);
      this.fetchActivity(vault, sig, blockTime)
        .then((events) => {
          if (events) emitAll(sig, events);
        })
        .catch(() => undefined)
        .finally(() => pending.delete(sig));
    };
    let subId: number | null = null;
    try {
      subId = this.connection.onLogs(
        vault,
        (l, ctx) => {
          if (l.err) {
            // A failure is only attributable with the tx's instructions: fetch it.
            fetchAndEmit(l.signature);
            return;
          }
          emitAll(
            l.signature,
            activityFromTransaction(this.programId, vault, { sig: l.signature, ts: Math.floor(Date.now() / 1000), slot: ctx.slot, logs: l.logs, err: null }),
          );
        },
        this.commitment,
      );
    } catch {
      subId = null;
    }
    // Polling fallback: public devnet websockets drop. Every 3s, fetch new signatures for the vault.
    let lastSig: string | undefined;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const sigs = await this.connection.getSignaturesForAddress(vault, { limit: 10, until: lastSig }, "confirmed");
        if (sigs.length) {
          lastSig = sigs[0].signature;
          for (const s of sigs.filter((x) => !seen.has(x.signature)).reverse()) {
            const events = await this.fetchActivity(vault, s.signature, s.blockTime).catch(() => null);
            if (events) emitAll(s.signature, events);
          }
        }
      } catch {
        // keep polling
      }
      if (!stopped) setTimeout(poll, 3000);
    };
    // seed lastSig so the poller only reports new activity
    this.connection
      .getSignaturesForAddress(vault, { limit: 1 }, "confirmed")
      .then((s) => {
        lastSig = s[0]?.signature;
        s.forEach((x) => seen.add(x.signature));
      })
      .catch(() => undefined)
      .finally(() => setTimeout(poll, 3000));
    return () => {
      stopped = true;
      if (subId !== null) this.connection.removeOnLogsListener(subId).catch(() => undefined);
    };
  }

  /** Recent history for the dashboard feed (newest first). */
  async recentActivity(vault: PublicKey, limit = 25): Promise<ActivityEvent[]> {
    const sigs = await this.connection.getSignaturesForAddress(vault, { limit }, "confirmed");
    if (!sigs.length) return [];
    // Small parallel chunks instead of one JSON-RPC batch: public devnet answers big getTransactions batches with
    // "Too many requests for a specific RPC call". Txs that still fail are skipped, not fatal.
    const out: ActivityEvent[] = [];
    for (let i = 0; i < sigs.length; i += 4) {
      const chunk = sigs.slice(i, i + 4);
      const results = await Promise.all(chunk.map((s) => this.fetchActivity(vault, s.signature, s.blockTime).catch(() => null)));
      for (const events of results) if (events) out.push(...events);
    }
    return out;
  }
}

export { buildMandateMessage };
