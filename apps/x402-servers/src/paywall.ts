/**
 * x402 v2 paywall middleware (docs/05). Headers: PAYMENT-REQUIRED (402, base64 JSON), PAYMENT-SIGNATURE (client
 * proof), PAYMENT-RESPONSE (settlement). Encoded/decoded with @x402/core/http so the wire format is the real v2 one.
 *
 * Order of checks for a proof: known nonce for this resource → payer authorization signature (cheap, before any
 * RPC) → atomic reservation of nonce + tx signature → onchain verification → payer == the key that paid → commit.
 * Any failure after the reservation releases it, so a corrected proof can be retried.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PublicKey } from "@solana/web3.js";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { PAYMENT_REQUIRED_CACHE_CONTROL } from "@x402/core/server";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { fromBaseUnits } from "@leash/sdk";
import { cfg, setupGaps } from "./config";
import { type IssuedTerms, type NonceStore, nonceStore } from "./nonces";
import { PAYER_AUTH_PREFIX, verifyPayerAuth } from "./payer-auth";
import { exactRequirementEnabled, verifyAndSettleExact } from "./verify/exact-facilitator";
import { verifyLeashPayment } from "./verify/leash";
import { verifyTransferPayment } from "./verify/transfer";
import type { Verdict } from "./verify/tx";

export interface PaidRoute {
  serviceName: string;
  description: string;
  /** seconds the payment terms stay valid (co-signed payments need minutes, not seconds) */
  ttlSecs: number;
  price(req: Request): Promise<{ amount: bigint; payTo: PublicKey }>;
}

export interface PaymentInfo {
  scheme: string;
  txSignature: string;
  amount: string;
  payTo: string;
  payer?: string;
  detail: string;
}

type ExactVerdict = Verdict & { transaction?: string };

/** Injectable for tests; production uses the onchain verifiers and the process-wide nonce store. */
export interface PaywallDeps {
  store: NonceStore;
  verifyLeash: (sig: string, terms: IssuedTerms, opts: { request?: string }) => Promise<Verdict>;
  verifyTransfer: (sig: string, terms: IssuedTerms) => Promise<Verdict>;
  verifyExact: (payload: PaymentPayload, req: PaymentRequirements) => Promise<ExactVerdict>;
  /** require the payer authorization (payer-auth.ts) on "leash" and "transfer" proofs */
  requirePayerAuth: boolean;
  /** 402 terms issued per client IP per minute (bounds the nonce store against floods) */
  issuePerMinute: number;
  /** skip the "server configured?" check (tests) */
  skipSetupCheck: boolean;
}

const defaultDeps = (): PaywallDeps => ({
  store: nonceStore,
  verifyLeash: verifyLeashPayment,
  verifyTransfer: verifyTransferPayment,
  verifyExact: verifyAndSettleExact,
  requirePayerAuth: process.env.X402_REQUIRE_PAYER_AUTH !== "0",
  issuePerMinute: Number(process.env.X402_ISSUE_PER_MINUTE) || 120,
  skipSetupCheck: false,
});

function resourceKey(req: Request): string {
  return `${req.method} ${req.baseUrl}${req.path}`;
}

function requirements(terms: IssuedTerms): PaymentRequirements[] {
  const common = {
    network: cfg.network,
    asset: terms.asset,
    amount: terms.amount.toString(),
    payTo: terms.payTo,
    maxTimeoutSeconds: terms.expiresAt - terms.issuedAt,
  };
  const payerAuth = { payerAuth: PAYER_AUTH_PREFIX };
  const out: PaymentRequirements[] = [
    { scheme: "leash", ...common, extra: { nonce: terms.nonce, program: cfg.programId?.toBase58(), decimals: 6, symbol: "dUSDC", ...payerAuth } },
    { scheme: "transfer", ...common, extra: { nonce: terms.nonce, decimals: 6, symbol: "dUSDC", memo: `x402:${terms.nonce}`, ...payerAuth } },
  ];
  if (exactRequirementEnabled()) out.push({ scheme: "exact", ...common, extra: { nonce: terms.nonce } });
  return out;
}

/** Fixed one-minute window per IP for issuing new terms. Bounded: swept when it grows. */
class IssueLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  allow(ip: string, limit: number): boolean {
    const now = Date.now();
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    const h = this.hits.get(ip);
    if (!h || h.reset <= now) {
      this.hits.set(ip, { n: 1, reset: now + 60_000 });
      return true;
    }
    h.n += 1;
    return h.n <= limit;
  }
}

export function paywall(route: PaidRoute, overrides: Partial<PaywallDeps> = {}): RequestHandler {
  const deps: PaywallDeps = { ...defaultDeps(), ...overrides };
  const limiter = new IssueLimiter();

  async function send402(req: Request, res: Response, error?: string): Promise<void> {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!limiter.allow(ip, deps.issuePerMinute)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Too many payment requests from this address; try again in a minute." });
      return;
    }
    const { amount, payTo } = await route.price(req);
    const resourceUrl = `${cfg.publicUrl}${req.originalUrl}`;
    const terms = deps.store.issue(
      { resource: resourceKey(req), resourceUrl, amount, payTo: payTo.toBase58(), asset: cfg.mint!.toBase58(), schemes: ["leash", "transfer"] },
      route.ttlSecs,
    );
    const body: PaymentRequired = {
      x402Version: 2,
      ...(error ? { error } : {}),
      resource: { url: resourceUrl, description: route.description, mimeType: "application/json", serviceName: route.serviceName },
      accepts: requirements(terms),
    };
    res.status(402);
    res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(body));
    res.setHeader("Cache-Control", PAYMENT_REQUIRED_CACHE_CONTROL);
    res.json({ ...body, _human: `Pay ${fromBaseUnits(amount)} dUSDC to ${payTo.toBase58()} and retry with PAYMENT-SIGNATURE.` });
  }

  /** 402 that keeps the current terms (the client should fix or repeat the same proof). */
  function reject(res: Response, reason: string, retryable = false): void {
    res.status(402).json({ x402Version: 2, error: reason, ...(retryable ? { retryable: true } : {}) });
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!deps.skipSetupCheck) {
        const gaps = setupGaps();
        if (gaps.length) {
          res.status(503).json({ error: `x402 server not configured. Missing in .env: ${gaps.join(", ")} (run pnpm setup:devnet)` });
          return;
        }
      }
      const header = req.get("PAYMENT-SIGNATURE");
      if (!header) return void (await send402(req, res));

      let payload: PaymentPayload;
      try {
        payload = decodePaymentSignatureHeader(header);
      } catch {
        return void (await send402(req, res, "Malformed PAYMENT-SIGNATURE header"));
      }
      const scheme = payload.accepted?.scheme;
      const p = (payload.payload ?? {}) as Record<string, unknown>;
      const nonce = String(p.nonce ?? payload.accepted?.extra?.nonce ?? "");
      const sig = typeof p.txSignature === "string" ? p.txSignature : "";
      const terms = deps.store.lookup(nonce);
      const now = Math.floor(Date.now() / 1000);
      if (!terms) return void (await send402(req, res, "Unknown payment nonce"));
      if (terms.resource !== resourceKey(req)) return void (await send402(req, res, "Nonce was issued for a different resource"));
      if (terms.usedBy) return void (await send402(req, res, "Nonce already used"));
      if (now > terms.expiresAt) return void (await send402(req, res, "Payment terms expired"));
      const offered = requirements(terms).find((r) => r.scheme === scheme);
      if (!offered) return void (await send402(req, res, `Unsupported scheme "${scheme}"`));
      if (scheme !== "exact" && !sig) return reject(res, "Missing transaction signature");

      // Payer binding, checked before any RPC work: who is presenting this proof?
      const payer = typeof p.payer === "string" ? p.payer : "";
      if (scheme !== "exact" && deps.requirePayerAuth) {
        const payerSig = typeof p.payerSignature === "string" ? p.payerSignature : "";
        if (!payer || !payerSig) {
          return reject(res, `Missing payer authorization: sign "${PAYER_AUTH_PREFIX}\\nnonce:<nonce>\\nresource:<resource.url>" with the paying key (payload.payer, payload.payerSignature)`);
        }
        if (!verifyPayerAuth(payer, payerSig, terms.nonce, terms.resourceUrl)) return reject(res, "Invalid payer authorization signature");
      }

      // Claim nonce + tx signature atomically before the async verification.
      const claim = deps.store.reserve(nonce, scheme === "exact" ? "" : sig);
      if (!claim.ok) return reject(res, claim.reason, claim.retryable);
      const reservation = claim.reservation;

      try {
        let verdict: ExactVerdict;
        if (scheme === "leash") verdict = await deps.verifyLeash(sig, terms, { request: typeof p.request === "string" ? p.request : undefined });
        else if (scheme === "transfer") verdict = await deps.verifyTransfer(sig, terms);
        else verdict = await deps.verifyExact(payload, offered);

        if (!verdict.ok) {
          deps.store.release(reservation);
          // let the client retry the same proof while the tx confirms; otherwise re-issue terms
          if (verdict.retryable) return reject(res, verdict.reason, true);
          return void (await send402(req, res, verdict.reason));
        }
        if (scheme !== "exact" && deps.requirePayerAuth && verdict.authority !== payer) {
          deps.store.release(reservation);
          return reject(res, `Payer authorization was signed by ${payer}, but this payment was made by ${verdict.authority ?? "an unknown key"}`);
        }

        const txSignature = verdict.transaction ?? sig;
        deps.store.commit(reservation, txSignature);
        res.setHeader(
          "PAYMENT-RESPONSE",
          encodePaymentResponseHeader({ success: true, transaction: txSignature, network: cfg.network, payer: verdict.payer, amount: terms.amount.toString() }),
        );
        res.locals.payment = {
          scheme,
          txSignature,
          amount: fromBaseUnits(terms.amount),
          payTo: terms.payTo,
          payer: verdict.payer,
          detail: verdict.detail,
        } satisfies PaymentInfo;
      } catch (e) {
        deps.store.release(reservation);
        throw e;
      }
      next();
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: (e as Error).message });
    }
  };
}
