/**
 * Server-side source of truth for issued payment terms. A payment proof is checked against what WE issued for
 * that nonce (amount, payTo, asset, resource), never against the client's echo of the requirements.
 *
 * Concurrency: verifying a proof is async (RPC reads), so two requests carrying the same nonce or the same tx
 * signature could both pass a "not used yet" check before either marks it used. `reserve()` closes that window:
 * it checks and claims the nonce and the signature in one synchronous step (nothing else runs on the event loop
 * in between), the verifier runs while they are held, and the caller then either `commit()`s or `release()`s.
 *
 * Memory is bounded: at most `maxIssued` terms and `maxSigs` remembered signatures. Expired entries go first;
 * past the cap the oldest unreserved terms are evicted (per-IP issuance limits in paywall.ts make that hard to
 * force).
 */
import { randomBytes } from "node:crypto";

export interface IssuedTerms {
  nonce: string;
  /** `${METHOD} ${path}`: the route the terms were issued for */
  resource: string;
  /** absolute URL sent in PAYMENT-REQUIRED; the payer authorization signs this exact string */
  resourceUrl: string;
  amount: bigint;
  payTo: string;
  asset: string;
  schemes: string[];
  issuedAt: number;
  expiresAt: number;
  /** tx signature that redeemed these terms */
  usedBy?: string;
  /** ms timestamp while a proof for this nonce is being verified */
  reservedAt?: number;
}

export interface Reservation {
  terms: IssuedTerms;
  sig: string;
  done: boolean;
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; reason: string; retryable?: boolean };

export interface NonceStoreOptions {
  /** hard cap on issued terms kept in memory */
  maxIssued?: number;
  /** hard cap on remembered (reserved or used) tx signatures */
  maxSigs?: number;
  /** how long a used signature is remembered, seconds (must exceed the longest terms TTL) */
  sigRetentionSecs?: number;
  /** a reservation older than this is treated as abandoned, ms */
  staleReservationMs?: number;
}

type SigState = { state: "reserved" | "used"; until: number };

const nowSecs = () => Math.floor(Date.now() / 1000);

export class NonceStore {
  private readonly issued = new Map<string, IssuedTerms>();
  private readonly sigs = new Map<string, SigState>();
  readonly maxIssued: number;
  readonly maxSigs: number;
  readonly sigRetentionSecs: number;
  readonly staleReservationMs: number;

  constructor(opts: NonceStoreOptions = {}) {
    this.maxIssued = opts.maxIssued ?? 10_000;
    this.maxSigs = opts.maxSigs ?? 50_000;
    this.sigRetentionSecs = opts.sigRetentionSecs ?? 3 * 3600;
    this.staleReservationMs = opts.staleReservationMs ?? 120_000;
  }

  get size(): { issued: number; sigs: number } {
    return { issued: this.issued.size, sigs: this.sigs.size };
  }

  issue(t: Omit<IssuedTerms, "nonce" | "issuedAt" | "expiresAt" | "usedBy" | "reservedAt">, ttlSecs: number, now = nowSecs()): IssuedTerms {
    if (this.issued.size >= this.maxIssued) this.evictTerms(now);
    const rec: IssuedTerms = { ...t, nonce: randomBytes(32).toString("hex"), issuedAt: now, expiresAt: now + ttlSecs };
    this.issued.set(rec.nonce, rec);
    return rec;
  }

  lookup(nonce: string): IssuedTerms | undefined {
    return this.issued.get(nonce);
  }

  /**
   * Atomically claim `nonce` (and `sig`, when the scheme has one) for verification. Synchronous on purpose:
   * no await between the checks and the claim.
   */
  reserve(nonce: string, sig: string, now = nowSecs()): ReserveResult {
    const terms = this.issued.get(nonce);
    if (!terms) return { ok: false, reason: "Unknown payment nonce" };
    if (terms.usedBy) return { ok: false, reason: "Nonce already used" };
    if (now > terms.expiresAt) return { ok: false, reason: "Payment terms expired" };
    const reservedFor = terms.reservedAt === undefined ? Infinity : Date.now() - terms.reservedAt;
    if (reservedFor < this.staleReservationMs) {
      return { ok: false, reason: "A payment proof for this nonce is already being verified", retryable: true };
    }
    if (sig) {
      const s = this.sigs.get(sig);
      if (s?.state === "used" && s.until >= now) return { ok: false, reason: "Transaction signature already used" };
      if (s?.state === "reserved") return { ok: false, reason: "This transaction signature is already being verified", retryable: true };
    }
    terms.reservedAt = Date.now();
    if (sig) {
      if (this.sigs.size >= this.maxSigs) this.evictSigs(now);
      this.sigs.set(sig, { state: "reserved", until: Number.MAX_SAFE_INTEGER });
    }
    return { ok: true, reservation: { terms, sig, done: false } };
  }

  /** Verification failed: free the nonce and the signature so a corrected proof can be retried. */
  release(r: Reservation): void {
    if (r.done) return;
    r.done = true;
    r.terms.reservedAt = undefined;
    if (r.sig && this.sigs.get(r.sig)?.state === "reserved") this.sigs.delete(r.sig);
  }

  /** Verification passed: the nonce and the signature(s) are spent for good. */
  commit(r: Reservation, txSignature = r.sig, now = nowSecs()): void {
    if (r.done) return;
    r.done = true;
    r.terms.reservedAt = undefined;
    r.terms.usedBy = txSignature || "settled";
    const until = now + this.sigRetentionSecs;
    for (const s of new Set([r.sig, txSignature])) if (s) this.sigs.set(s, { state: "used", until });
    if (this.sigs.size > this.maxSigs) this.evictSigs(now);
  }

  private evictTerms(now: number): void {
    // 1) everything expired and not mid-verification (used terms past expiry can't be redeemed anyway)
    for (const [k, v] of this.issued) if (v.expiresAt < now && v.reservedAt === undefined) this.issued.delete(k);
    // 2) still full: drop the oldest unreserved terms (Map iterates in insertion order)
    if (this.issued.size < this.maxIssued) return;
    const target = Math.floor(this.maxIssued * 0.9);
    for (const [k, v] of this.issued) {
      if (this.issued.size <= target) break;
      if (v.reservedAt === undefined) this.issued.delete(k);
    }
  }

  private evictSigs(now: number): void {
    for (const [k, v] of this.sigs) if (v.state === "used" && v.until < now) this.sigs.delete(k);
    if (this.sigs.size < this.maxSigs) return;
    const target = Math.floor(this.maxSigs * 0.9);
    for (const [k, v] of this.sigs) {
      if (this.sigs.size <= target) break;
      if (v.state === "used") this.sigs.delete(k);
    }
  }
}

/** Process-wide store used by the paid routes. */
export const nonceStore = new NonceStore({
  maxIssued: Number(process.env.X402_MAX_NONCES) || undefined,
});
