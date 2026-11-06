/**
 * SEAM for docs/05 Option 1: standard x402 "exact" scheme through our own @x402/svm facilitator with
 * enableSmartWalletVerification and the Leash program in smartWalletAllowedPrograms (Path 2, simulation-based).
 *
 * Not active: set X402_FACILITATOR_URL to a facilitator that accepts Leash-routed agent_spend txs, then add an
 * "exact" entry to `accepts` in src/paywall.ts (see `exactRequirementEnabled`). The client side would put a
 * partially signed agent_spend tx (facilitator = fee payer) in payload.transaction.
 */
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { cfg } from "../config";
import type { Verdict } from "./tx";

export const exactRequirementEnabled = (): boolean => !!cfg.facilitatorUrl;

let client: HTTPFacilitatorClient | null = null;

export async function verifyAndSettleExact(payload: PaymentPayload, requirements: PaymentRequirements): Promise<Verdict & { transaction?: string }> {
  if (!cfg.facilitatorUrl) return { ok: false, reason: "Option 1 (exact via facilitator) is not configured" };
  client ??= new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });
  const v = await client.verify(payload, requirements);
  if (!v.isValid) return { ok: false, reason: v.invalidMessage ?? v.invalidReason ?? "facilitator rejected the payment" };
  const s = await client.settle(payload, requirements);
  if (!s.success) return { ok: false, reason: s.errorMessage ?? s.errorReason ?? "settlement failed" };
  return { ok: true, payer: s.payer, detail: "settled by facilitator", transaction: s.transaction };
}
