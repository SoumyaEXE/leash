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
import {
  errorNameFromCode,
  friendlyError,
  parseLeashErrorFromLogs,
} from "./errors";
import {
  approveRequestIx,
  addPayeeIx,
  createMandateIx,
  initializeVaultIx,
  redeemSignedMandateIx,
  rejectRequestIx,
  removePayeeIx,
  requestSpendIx,
  resetStrikesIx,
  revokeMandateIx,
  setAgentIx,
  setPausedIx,
  spendIx,
  updatePayeeIx,
  updatePolicyIx,
  withdrawIx,
} from "./instructions";
import {
  VAULT_FIELD_OFFSET,
  ACCOUNT,
  type MandateTermsArgs,
  decodeMandate,
  decodePayee,
  decodeRequest,
  decodeVault,
  encodeMandateTerms,
  parseLeashEvents,
  type LeashEvent,
} from "./layout";
import type {
  ActivityEvent,
  AuthKind,
  ILeashClient,
  MandateState,
  OwnerAction,
  PayeeState,
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
  reasonFromLogs,
  reasonHash,
  toHex,
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
  cluster?: "devnet" | "mainnet-beta";
}

const MANDATE_MESSAGE_PREFIX = "LEASH_MANDATE_V1:";

function isKeypair(w: unknown): w is Keypair {
  return w instanceof Keypair || (!!w && typeof w === "object" && "secretKey" in w && "publicKey" in w);
}

/** UTF-8 message the owner signs (wallet signMessage) to authorize a mandate off-chain. */
export function buildMandateMessage(terms: MandateTermsArgs): Uint8Array {
  return new TextEncoder().encode(MANDATE_MESSAGE_PREFIX + toHex(encodeMandateTerms(terms)));
}

export class LeashClient implements ILeashClient {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly wallet?: Keypair | WalletLike;
  readonly blinkBaseUrl?: string;
  readonly commitment: Commitment;
  readonly cluster: "devnet" | "mainnet-beta";
  private mintProgramCache = new Map<string, PublicKey>();

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
    const id = Buffer.alloc(8);
    id.writeBigUInt64LE(vaultId);
    return PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.toBuffer(), id], this.programId)[0];
  }
  payeePda(vault: PublicKey, payee: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("payee"), vault.toBuffer(), payee.toBuffer()], this.programId)[0];
  }
  mandatePda(vault: PublicKey, id: bigint): PublicKey {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(id);
    return PublicKey.findProgramAddressSync([Buffer.from("mandate"), vault.toBuffer(), b], this.programId)[0];
  }
  requestPda(vault: PublicKey, seq: bigint): PublicKey {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(seq);
    return PublicKey.findProgramAddressSync([Buffer.from("request"), vault.toBuffer(), b], this.programId)[0];
  }

  // ───────────────────────────── token helpers ─────────────────────────────

  async tokenProgramFor(mint: PublicKey): Promise<PublicKey> {
    const key = mint.toBase58();
    const cached = this.mintProgramCache.get(key);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(mint, this.commitment);
    if (!info) throw new Error(`Mint ${key} not found`);
    const prog = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    this.mintProgramCache.set(key, prog);
    return prog;
  }

  ata(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
    return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  }

  // ───────────────────────────── reads ─────────────────────────────

  async getVault(vault: PublicKey): Promise<VaultState> {
    const info = await this.connection.getAccountInfo(vault, this.commitment);
    if (!info) throw new Error(`Vault ${vault.toBase58()} not found`);
    const v = decodeVault(info.data);
    const tokenProgram = await this.tokenProgramFor(v.mint);
    const vaultAta = this.ata(v.mint, vault, tokenProgram);
    let balance = 0n;
    let decimals = 6;
    try {
      const bal = await this.connection.getTokenAccountBalance(vaultAta, this.commitment);
      balance = BigInt(bal.value.amount);
      decimals = bal.value.decimals;
    } catch {
      // ATA missing (shouldn't happen: created in initialize_vault)
    }
    return {
      address: vault,
      owner: v.owner,
      agent: v.agent,
      mint: v.mint,
      vaultId: v.vaultId,
      paused: v.paused,
      perTxCap: v.perTxCap,
      dailyCap: v.dailyCap,
      windowStart: v.windowStart,
      spentInWindow: v.spentInWindow,
      cosignThreshold: v.cosignThreshold,
      requestTtlSecs: v.requestTtlSecs,
      requestSeq: v.requestSeq,
      mandateSeq: v.mandateSeq,
      totalSpent: v.totalSpent,
      blockedCount: v.blockedCount,
      strikes: v.strikes,
      freezeAfterStrikes: v.freezeAfterStrikes,
      lastBlockedAt: v.lastBlockedAt,
      vaultAta,
      balance,
      decimals,
    };
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
    return info ? decodePayee(pda, info.data) : null;
  }

  async listMandates(vault: PublicKey): Promise<MandateState[]> {
    const accts = await this.programAccountsFor(vault, ACCOUNT.Mandate);
    return accts.map((a) => decodeMandate(a.pubkey, a.account.data)).sort((x, y) => Number(x.id - y.id));
  }

  async listRequests(vault: PublicKey, status?: RequestStatus): Promise<RequestState[]> {
    const accts = await this.programAccountsFor(vault, ACCOUNT.SpendRequest);
    const now = Math.floor(Date.now() / 1000);
    return accts
      .map((a) => decodeRequest(a.pubkey, a.account.data))
      .map((r) => (r.status === "pending" && now > r.expiresAt ? { ...r, status: "expired" as const } : r))
      .filter((r) => !status || r.status === status)
      .sort((x, y) => Number(y.seq - x.seq));
  }

  async getRequest(request: PublicKey): Promise<RequestState | null> {
    const info = await this.connection.getAccountInfo(request, this.commitment);
    if (!info) return null;
    const r = decodeRequest(request, info.data);
    return r.status === "pending" && Math.floor(Date.now() / 1000) > r.expiresAt ? { ...r, status: "expired" } : r;
  }

  /** Which owner-signed authorization covers `payee`: allowlist entry first, then an active mandate. */
  async resolveAuthorization(
    vault: PublicKey,
    payee: PublicKey,
    forceMandate?: PublicKey,
  ): Promise<{ payeeAccount: PublicKey | null; mandateAccount: PublicKey | null; via: AuthKind | null }> {
    if (forceMandate) return { payeeAccount: null, mandateAccount: forceMandate, via: "mandate" };
    const p = await this.getPayee(vault, payee);
    if (p) return { payeeAccount: p.address, mandateAccount: null, via: "payee" };
    const now = Math.floor(Date.now() / 1000);
    const m = (await this.listMandates(vault)).find((m) => m.payee.equals(payee) && !m.revoked && m.expiresAt > now);
    if (m) return { payeeAccount: null, mandateAccount: m.address, via: "mandate" };
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

  private failure(logs: string[] | undefined, fallback: string, sig?: string): Extract<SpendResult, { ok: false }> {
    const parsed = parseLeashErrorFromLogs(logs);
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
    expectFailure: boolean,
  ): Promise<{ ok: true; sig: string; events: LeashEvent[]; logs: string[] } | Extract<SpendResult, { ok: false }>> {
    let sig: string;
    try {
      sig = await this.signAndSend(ixs, { skipPreflight: expectFailure });
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
    const auth = await this.resolveAuthorization(args.vault, args.payee, args.mandate);
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
    const res = await this.sendExpectingLeash(built.ixs, !!args.expectFailure || args.mode === "guarded");
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
    const vault = await this.getVault(args.vault);
    const request = this.requestPda(args.vault, vault.requestSeq);
    const auth = await this.resolveAuthorization(args.vault, args.payee);
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

  /** Redeem an owner-signed mandate: `[Ed25519 verify, redeem_signed_mandate]` in one tx (agent pays). */
  async redeemSignedMandate(terms: MandateTermsArgs, ownerSignature: Uint8Array): Promise<SpendResult> {
    const vault = await this.getVault(terms.vault);
    const message = buildMandateMessage(terms);
    const verify = Ed25519Program.createInstructionWithPublicKey({
      publicKey: vault.owner.toBytes(),
      message,
      signature: ownerSignature,
    });
    const redeem = redeemSignedMandateIx(
      this.programId,
      { agent: this.walletPublicKey, vault: terms.vault, mandate: this.mandatePda(terms.vault, terms.nonce) },
      terms,
    );
    const res = await this.sendExpectingLeash([verify, redeem], false);
    if (!res.ok) return res;
    return { ok: true, sig: res.sig, explorerUrl: explorerTx(res.sig, this.cluster), via: "mandate" };
  }

  // ───────────────────────────── owner ─────────────────────────────

  async initializeVault(args: {
    vaultId: bigint;
    agent: PublicKey;
    mint: PublicKey;
    policy: import("./types").Policy;
  }): Promise<{ vault: PublicKey; sig: string }> {
    const owner = this.walletPublicKey;
    const vault = this.vaultPda(owner, args.vaultId);
    const tokenProgram = await this.tokenProgramFor(args.mint);
    const vaultAta = this.ata(args.mint, vault, tokenProgram);
    const sig = await this.signAndSend([
      initializeVaultIx(this.programId, { owner, vault, mint: args.mint, vaultAta, tokenProgram }, args),
    ]);
    const landed = await this.inspectTx(sig);
    if (landed?.err) throw new Error(`initialize_vault failed: ${parseLeashErrorFromLogs(landed.logs)?.name ?? JSON.stringify(landed.err)}`);
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
      case "approveRequest": {
        const req = await this.getRequest(action.request);
        if (!req) throw new Error("Spend request not found");
        const v = await this.getVault(action.vault);
        const tokenProgram = await this.tokenProgramFor(v.mint);
        const auth = await this.resolveAuthorization(action.vault, req.payee);
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
          }),
        ];
      }
      case "rejectRequest":
        return [rejectRequestIx(pid, { owner, vault: action.vault, request: action.request })];
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
    }
  }

  async ownerAction(action: OwnerAction): Promise<string> {
    const ixs = await this.ownerIxs(this.walletPublicKey, action);
    const sig = await this.signAndSend(ixs);
    const landed = await this.inspectTx(sig);
    if (landed?.err) {
      const parsed = parseLeashErrorFromLogs(landed.logs);
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

  /** Turn one tx (logs + err) into dashboard activity events. Failed txs become "blocked". */
  toActivity(sig: string, logs: readonly string[], err: unknown, ts: number, slot?: number): ActivityEvent[] {
    const reason = reasonFromLogs(logs);
    if (err) {
      const parsed = parseLeashErrorFromLogs(logs);
      if (!parsed) return [];
      return [{ kind: "blocked", sig, ts, slot, errorName: parsed.name, reason }];
    }
    const out: ActivityEvent[] = [];
    for (const ev of parseLeashEvents(logs, this.programId)) {
      const base = { sig, ts: ev.data && "ts" in ev.data ? ev.data.ts : ts, slot, reason };
      switch (ev.name) {
        case "SpendExecuted":
          out.push({ ...base, kind: "spent", amount: ev.data.amount, payee: ev.data.payee.toBase58(), via: ev.data.via, reasonHash: toHex(ev.data.reasonHash) });
          break;
        case "PaymentBlocked":
          out.push({
            ...base,
            kind: "blocked",
            amount: ev.data.amount,
            payee: ev.data.attemptedPayee.toBase58(),
            errorName: errorNameFromCode(ev.data.reasonCode) ?? String(ev.data.reasonCode),
            reasonHash: toHex(ev.data.reasonHash),
          });
          break;
        case "SpendRequested":
          out.push({ ...base, kind: "requested", amount: ev.data.amount, payee: ev.data.payee.toBase58(), request: ev.data.request.toBase58(), reasonHash: toHex(ev.data.reasonHash) });
          break;
        case "RequestResolved":
          out.push({ ...base, kind: "resolved", request: ev.data.request.toBase58(), approved: ev.data.approved });
          break;
        case "VaultFrozen":
          out.push({ ...base, kind: "frozen" });
          break;
        case "VaultPausedChanged":
          out.push({ ...base, kind: "paused", paused: ev.data.paused });
          break;
        case "MandateCreated":
        case "MandateRevoked":
          out.push({ ...base, kind: "mandate" });
          break;
        case "PolicyUpdated":
        case "PayeeChanged":
          out.push({ ...base, kind: "policy" });
          break;
      }
    }
    return out;
  }

  /** Live feed: every tx that mentions the vault, including failed (blocked) ones. Returns unsubscribe. */
  onActivity(vault: PublicKey, cb: (e: ActivityEvent) => void): () => void {
    const seen = new Set<string>();
    const emit = (sig: string, logs: readonly string[], err: unknown, slot?: number) => {
      if (seen.has(sig)) return;
      seen.add(sig);
      for (const e of this.toActivity(sig, logs, err, Math.floor(Date.now() / 1000), slot)) cb(e);
    };
    let subId: number | null = null;
    try {
      subId = this.connection.onLogs(vault, (l, ctx) => emit(l.signature, l.logs, l.err, ctx.slot), this.commitment);
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
          const fresh = sigs.filter((s) => !seen.has(s.signature)).reverse();
          for (const s of fresh) {
            const tx = await this.connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            if (tx?.meta) emit(s.signature, tx.meta.logMessages ?? [], tx.meta.err, tx.slot);
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
    const txs = await this.connection.getTransactions(
      sigs.map((s) => s.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    const out: ActivityEvent[] = [];
    txs.forEach((tx, i) => {
      if (!tx?.meta) return;
      const s = sigs[i];
      out.push(...this.toActivity(s.signature, tx.meta.logMessages ?? [], tx.meta.err, s.blockTime ?? tx.blockTime ?? 0, tx.slot));
    });
    return out;
  }
}
