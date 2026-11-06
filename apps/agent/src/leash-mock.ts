/**
 * In-memory stand-in for the onchain Leash program, implementing the exact ILeashClient contract with the same
 * check order (docs/04 "agent_spend — check order") and error names. Used until the real SDK lands; swapped in
 * src/leash.ts. Nothing here is security: the real rules live in programs/leash.
 */
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  type ActivityEvent,
  type ILeashClient,
  type LeashErrorName,
  type MandateState,
  type OwnerAction,
  type PayeeState,
  type Policy,
  type RequestSpendResult,
  type RequestState,
  type RequestStatus,
  type SpendArgs,
  type SpendResult,
  type VaultState,
  errorCode,
  friendlyError,
  reasonHash,
  toHex,
} from "@leash/sdk";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function mockSig(): string {
  const bytes = randomBytes(60);
  let s = "mock";
  for (const b of bytes) s += B58[b % 58];
  return s.slice(0, 88);
}

/** VaultState fields added with the rolling-window program; the mock doesn't model them. */
const NEW_VAULT_FIELDS = () => ({
  createdAt: Math.floor(Date.now() / 1000),
  spent24h: 0n,
  autonomous24h: 0n,
  cosignWindowThreshold: 0n,
  strikeWindowStart: 0,
  enforceTripwire: false,
  openRequests: 0,
  openPayees: 0,
  openMandates: 0,
  lastBucket: 0,
  spentBuckets: [] as bigint[],
  autoBuckets: [] as bigint[],
});

const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export interface MockSeed {
  connection: Connection;
  programId: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  merchant: PublicKey;
  /** signer the client acts as (agent for agent methods, owner for owner methods) */
  signer: PublicKey;
  siteUrl: string;
  vaultBalance?: bigint;
}

type Fail = { name: LeashErrorName };

export class MockLeashClient implements ILeashClient {
  readonly programId: PublicKey;
  readonly connection: Connection;
  private readonly signer: PublicKey;
  private readonly siteUrl: string;
  private vaults = new Map<string, VaultState>();
  private payees = new Map<string, PayeeState>();
  private mandates = new Map<string, MandateState>();
  private requests = new Map<string, RequestState>();
  private activity: ActivityEvent[] = [];
  private bus = new EventEmitter();
  readonly demoVault: PublicKey;

  constructor(seed: MockSeed) {
    this.programId = seed.programId;
    this.connection = seed.connection;
    this.signer = seed.signer;
    this.siteUrl = seed.siteUrl;
    // Seed state = scripts/setup-devnet.ts targets (prompts A2): per-tx 1.00, daily 5.00, threshold 0.20.
    this.demoVault = this.vaultPda(seed.owner, 1n);
    this.vaults.set(this.demoVault.toBase58(), {
      address: this.demoVault,
      owner: seed.owner,
      agent: seed.agent,
      mint: seed.mint,
      vaultId: 1n,
      paused: false,
      perTxCap: 1_000_000n,
      dailyCap: 5_000_000n,
      windowStart: Math.floor(Date.now() / 1000),
      spentInWindow: 0n,
      cosignThreshold: 200_000n,
      requestTtlSecs: 3600,
      requestSeq: 0n,
      mandateSeq: 0n,
      totalSpent: 0n,
      blockedCount: 0n,
      strikes: 0,
      freezeAfterStrikes: 0,
      lastBlockedAt: 0,
      vaultAta: PublicKey.findProgramAddressSync([Buffer.from("mock-ata"), this.demoVault.toBuffer()], this.programId)[0],
      balance: seed.vaultBalance ?? 1_000_000_000n,
      decimals: 6,
      ...NEW_VAULT_FIELDS(),
    });
    const payeeAddr = this.payeePda(this.demoVault, seed.merchant);
    this.payees.set(payeeAddr.toBase58(), {
      address: payeeAddr,
      vault: this.demoVault,
      payee: seed.merchant,
      label: "Demo APIs (merchant)",
      perTxMax: 500_000n,
      budgetTotal: 5_000_000n,
      spent: 0n,
      active: true,
    });
  }

  // ── PDAs (same seeds as the program) ───────────────────────────────────────────────────────────────────────
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

  // ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────
  private vault(v: PublicKey): VaultState {
    const s = this.vaults.get(v.toBase58());
    if (!s) throw new Error(`Mock: unknown vault ${v.toBase58()}`);
    return s;
  }
  async getVault(vault: PublicKey): Promise<VaultState> {
    return { ...this.vault(vault) };
  }
  async listPayees(vault: PublicKey): Promise<PayeeState[]> {
    return [...this.payees.values()].filter((p) => p.vault.equals(vault)).map((p) => ({ ...p }));
  }
  async listMandates(vault: PublicKey): Promise<MandateState[]> {
    return [...this.mandates.values()].filter((m) => m.vault.equals(vault)).map((m) => ({ ...m }));
  }
  async listRequests(vault: PublicKey, status?: RequestStatus): Promise<RequestState[]> {
    return [...this.requests.values()]
      .filter((r) => r.vault.equals(vault) && (!status || this.statusOf(r) === status))
      .map((r) => ({ ...r, status: this.statusOf(r) }));
  }
  async getRequest(request: PublicKey): Promise<RequestState | null> {
    const r = this.requests.get(request.toBase58());
    return r ? { ...r, status: this.statusOf(r) } : null;
  }
  private statusOf(r: RequestState): RequestStatus {
    if (r.status === "pending" && Date.now() / 1000 > r.expiresAt) return "expired";
    return r.status;
  }

  // ── owner ──────────────────────────────────────────────────────────────────────────────────────────────────
  async initializeVault(args: { vaultId: bigint; agent: PublicKey; mint: PublicKey; policy: Policy }) {
    const vault = this.vaultPda(this.signer, args.vaultId);
    this.vaults.set(vault.toBase58(), {
      address: vault,
      owner: this.signer,
      agent: args.agent,
      mint: args.mint,
      vaultId: args.vaultId,
      paused: false,
      perTxCap: args.policy.perTxCap,
      dailyCap: args.policy.dailyCap,
      windowStart: Math.floor(Date.now() / 1000),
      spentInWindow: 0n,
      cosignThreshold: args.policy.cosignThreshold,
      requestTtlSecs: args.policy.requestTtlSecs,
      requestSeq: 0n,
      mandateSeq: 0n,
      totalSpent: 0n,
      blockedCount: 0n,
      strikes: 0,
      freezeAfterStrikes: args.policy.freezeAfterStrikes,
      lastBlockedAt: 0,
      vaultAta: vault,
      balance: 0n,
      decimals: 6,
      ...NEW_VAULT_FIELDS(),
      cosignWindowThreshold: args.policy.cosignWindowThreshold,
      enforceTripwire: args.policy.enforceTripwire,
    });
    return { vault, sig: mockSig() };
  }

  async ownerAction(action: OwnerAction): Promise<string> {
    const sig = mockSig();
    const v = this.vault(action.vault);
    const now = Math.floor(Date.now() / 1000);
    switch (action.type) {
      case "approveRequest":
      case "rejectRequest": {
        const r = this.requests.get(action.request.toBase58());
        if (!r || this.statusOf(r) !== "pending") throw new Error(r && this.statusOf(r) === "expired" ? "RequestExpired" : "RequestNotPending");
        if (action.type === "approveRequest") {
          if (v.balance < r.amount) throw new Error("InsufficientFunds");
          v.balance -= r.amount;
          v.totalSpent += r.amount;
          r.status = "approved";
          this.emit(action.vault, { kind: "spent", sig, ts: now, amount: r.amount, payee: r.payee.toBase58(), via: "request", request: r.address.toBase58() });
        } else {
          r.status = "rejected";
        }
        this.emit(action.vault, { kind: "resolved", sig, ts: now, request: r.address.toBase58(), approved: action.type === "approveRequest" });
        return sig;
      }
      case "setPaused":
        v.paused = action.paused;
        if (!action.paused) v.strikes = 0;
        this.emit(action.vault, { kind: "paused", sig, ts: now, paused: action.paused });
        return sig;
      case "resetStrikes":
        v.strikes = 0;
        return sig;
      case "updatePolicy":
        Object.assign(v, {
          perTxCap: action.policy.perTxCap,
          dailyCap: action.policy.dailyCap,
          cosignThreshold: action.policy.cosignThreshold,
          requestTtlSecs: action.policy.requestTtlSecs,
          freezeAfterStrikes: action.policy.freezeAfterStrikes,
        });
        this.emit(action.vault, { kind: "policy", sig, ts: now });
        return sig;
      case "addPayee": {
        const address = this.payeePda(action.vault, action.payee);
        this.payees.set(address.toBase58(), {
          address,
          vault: action.vault,
          payee: action.payee,
          label: action.label,
          perTxMax: action.perTxMax,
          budgetTotal: action.budgetTotal,
          spent: 0n,
          active: true,
        });
        return sig;
      }
      case "updatePayee": {
        const p = this.payees.get(this.payeePda(action.vault, action.payee).toBase58());
        if (!p) throw new Error("PayeeNotAuthorized");
        Object.assign(p, { perTxMax: action.perTxMax, budgetTotal: action.budgetTotal, active: action.active });
        return sig;
      }
      case "removePayee":
        this.payees.delete(this.payeePda(action.vault, action.payee).toBase58());
        return sig;
      case "createMandate": {
        const id = v.mandateSeq++;
        const address = this.mandatePda(action.vault, id);
        this.mandates.set(address.toBase58(), {
          address,
          vault: action.vault,
          id,
          payee: action.payee,
          maxTotal: action.maxTotal,
          maxPerTx: action.maxPerTx,
          spent: 0n,
          expiresAt: action.expiresAt,
          intentHash: reasonHash(action.intent),
          revoked: false,
        });
        this.emit(action.vault, { kind: "mandate", sig, ts: now, payee: action.payee.toBase58() });
        return sig;
      }
      case "revokeMandate": {
        const m = this.mandates.get(action.mandate.toBase58());
        if (m) m.revoked = true;
        return sig;
      }
      case "withdraw":
        if (v.balance < action.amount) throw new Error("InsufficientFunds");
        v.balance -= action.amount;
        return sig;
      default:
        // bumpMandateSeq / closeMandate / closeRequest / closeVault: not modelled by the mock
        return sig;
    }
  }

  async buildOwnerTx(_owner: PublicKey, _action: OwnerAction): Promise<Transaction> {
    throw new Error("MockLeashClient cannot build real transactions; use @leash/sdk LeashClient");
  }

  // ── agent ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** docs/04 check order. Returns the first failure, or which authorization covers the payment. */
  private check(v: VaultState, args: SpendArgs): Fail | { via: "payee" | "mandate"; payee?: PayeeState; mandate?: MandateState } {
    const now = Math.floor(Date.now() / 1000);
    // 5. authorization: payee PDA first, then mandates for that payee
    const payee = this.payees.get(this.payeePda(args.vault, args.payee).toBase58());
    let auth: { via: "payee" | "mandate"; payee?: PayeeState; mandate?: MandateState } | null = null;
    if (payee && payee.active && !args.mandate) {
      if (args.amount > payee.perTxMax) return { name: "ExceedsPayeePerTx" };
      if (payee.budgetTotal > 0n && payee.spent + args.amount > payee.budgetTotal) return { name: "PayeeBudgetExceeded" };
      auth = { via: "payee", payee };
    } else {
      const mandates = [...this.mandates.values()].filter(
        (m) => m.vault.equals(args.vault) && m.payee.equals(args.payee) && (!args.mandate || m.address.equals(args.mandate)),
      );
      const m = mandates.find((x) => !x.revoked && now < x.expiresAt) ?? mandates[0];
      if (!m) return { name: "PayeeNotAuthorized" };
      if (m.revoked) return { name: "MandateRevoked" };
      if (now >= m.expiresAt) return { name: "MandateExpired" };
      if (args.amount > m.maxPerTx) return { name: "ExceedsPayeePerTx" };
      if (m.spent + args.amount > m.maxTotal) return { name: "MandateExhausted" };
      auth = { via: "mandate", mandate: m };
    }
    // 6. vault per-tx cap
    if (args.amount > v.perTxCap) return { name: "ExceedsPerTxCap" };
    // 7. rolling 24h window
    if (now - v.windowStart >= 86_400) {
      v.windowStart = now;
      v.spentInWindow = 0n;
    }
    if (v.spentInWindow + args.amount > v.dailyCap) return { name: "ExceedsDailyCap" };
    // 8. co-sign threshold
    if (v.cosignThreshold > 0n && args.amount >= v.cosignThreshold) return { name: "RequiresCosign" };
    return auth;
  }

  private fail(name: LeashErrorName, sig?: string): Extract<SpendResult, { ok: false }> {
    const f = friendlyError(name);
    return { ok: false, blocked: true, name, code: errorCode(name), message: f.title, friendly: f, sig, explorerUrl: sig ? "" : undefined };
  }

  async spend(args: SpendArgs): Promise<SpendResult> {
    const v = this.vault(args.vault);
    const now = Math.floor(Date.now() / 1000);
    const sig = args.expectFailure || args.mode === "guarded" ? mockSig() : undefined;
    const reasonHex = toHex(reasonHash(args.reason));
    // 1-3 always hard errors
    if (!this.signer.equals(v.agent)) return this.fail("NotAgent", sig);
    if (v.paused) return this.fail("VaultPaused", sig);
    if (args.amount <= 0n) return this.fail("ZeroAmount", sig);
    const res = this.check(v, args);
    if ("name" in res) {
      if (args.mode === "guarded") {
        v.blockedCount += 1n;
        v.strikes += 1;
        v.lastBlockedAt = now;
        if (v.freezeAfterStrikes > 0 && v.strikes >= v.freezeAfterStrikes) {
          v.paused = true;
          this.emit(args.vault, { kind: "frozen", sig: sig!, ts: now });
        }
      }
      this.emit(args.vault, { kind: "blocked", sig: sig ?? mockSig(), ts: now, amount: args.amount, payee: args.payee.toBase58(), errorName: res.name, reasonHash: reasonHex, reason: args.reason });
      return this.fail(res.name, sig);
    }
    if (v.balance < args.amount) return this.fail("InsufficientFunds", sig);
    v.balance -= args.amount;
    v.spentInWindow += args.amount;
    v.totalSpent += args.amount;
    if (res.payee) res.payee.spent += args.amount;
    if (res.mandate) res.mandate.spent += args.amount;
    const okSig = mockSig();
    this.emit(args.vault, { kind: "spent", sig: okSig, ts: now, amount: args.amount, payee: args.payee.toBase58(), via: res.via, reasonHash: reasonHex, reason: args.reason });
    return { ok: true, sig: okSig, explorerUrl: "", via: res.via };
  }

  async requestSpend(args: { vault: PublicKey; payee: PublicKey; amount: bigint; reason: string }): Promise<RequestSpendResult> {
    const v = this.vault(args.vault);
    if (!this.signer.equals(v.agent)) return this.fail("NotAgent");
    if (v.paused) return this.fail("VaultPaused");
    if (args.amount <= 0n) return this.fail("ZeroAmount");
    const now = Math.floor(Date.now() / 1000);
    const seq = v.requestSeq++;
    const address = this.requestPda(args.vault, seq);
    this.requests.set(address.toBase58(), {
      address,
      vault: args.vault,
      seq,
      payee: args.payee,
      amount: args.amount,
      reasonHash: reasonHash(args.reason),
      createdAt: now,
      expiresAt: now + v.requestTtlSecs,
      status: "pending",
    });
    const sig = mockSig();
    this.emit(args.vault, { kind: "requested", sig, ts: now, amount: args.amount, payee: args.payee.toBase58(), request: address.toBase58(), reason: args.reason });
    return {
      ok: true,
      request: address,
      seq,
      sig,
      explorerUrl: "",
      blinkUrl: `${this.siteUrl}/api/actions/approve?request=${address.toBase58()}`,
    };
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────────────────────
  private emit(vault: PublicKey, e: ActivityEvent): void {
    this.activity.unshift(e);
    this.activity.length = Math.min(this.activity.length, 200);
    this.bus.emit(vault.toBase58(), e);
  }
  onActivity(vault: PublicKey, cb: (e: ActivityEvent) => void): () => void {
    const key = vault.toBase58();
    this.bus.on(key, cb);
    return () => this.bus.off(key, cb);
  }
  async recentActivity(_vault: PublicKey, limit = 50): Promise<ActivityEvent[]> {
    return this.activity.slice(0, limit);
  }

  /** Mock-only: restore the seeded balance and counters (used by POST /reset). */
  resetDemo(balance = 1_000_000_000n): void {
    const v = this.vault(this.demoVault);
    Object.assign(v, { balance, spentInWindow: 0n, totalSpent: 0n, paused: false, strikes: 0, blockedCount: 0n });
    for (const p of this.payees.values()) p.spent = 0n;
    for (const r of this.requests.values()) if (r.status === "pending") r.status = "rejected";
    this.activity = [];
  }
}
