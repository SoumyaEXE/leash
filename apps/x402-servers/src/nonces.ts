/**
 * Server-side source of truth for issued payment terms. A payment proof is checked against what WE issued for
 * that nonce (amount, payTo, asset, resource), never against the client's echo of the requirements.
 */
import { randomBytes } from "node:crypto";

export interface IssuedTerms {
  nonce: string;
  resource: string;
  amount: bigint;
  payTo: string;
  asset: string;
  schemes: string[];
  issuedAt: number;
  expiresAt: number;
  usedBy?: string;
}

const issued = new Map<string, IssuedTerms>();
const usedSigs = new Set<string>();

export function issue(t: Omit<IssuedTerms, "nonce" | "issuedAt" | "expiresAt">, ttlSecs: number): IssuedTerms {
  const now = Math.floor(Date.now() / 1000);
  const rec: IssuedTerms = { ...t, nonce: randomBytes(32).toString("hex"), issuedAt: now, expiresAt: now + ttlSecs };
  issued.set(rec.nonce, rec);
  // keep memory bounded
  if (issued.size > 5000) {
    for (const [k, v] of issued) if (v.expiresAt < now) issued.delete(k);
  }
  return rec;
}

export function lookup(nonce: string): IssuedTerms | undefined {
  return issued.get(nonce);
}

export function sigUsed(sig: string): boolean {
  return usedSigs.has(sig);
}

export function consume(rec: IssuedTerms, sig: string): void {
  rec.usedBy = sig;
  usedSigs.add(sig);
}
