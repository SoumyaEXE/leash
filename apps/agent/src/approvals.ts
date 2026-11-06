/**
 * After the owner approves a spend request (Blink → approve_request), the agent "continues": it finds the approval
 * transaction and retries the original x402 call with it as the payment proof (docs/03 F3, docs/09 S4 beat).
 */
import { PublicKey } from "@solana/web3.js";
import type { RequestStatus } from "@leash/sdk";
import { connection } from "./env";
import { getLeash } from "./leash";
import { type PayForResourceResult, pendingX402, retryWithProof } from "./x402-client";

export interface RequestProgress {
  request: string;
  status: RequestStatus | "unknown";
  result?: PayForResourceResult;
  updatedAt: number;
}

const progress = new Map<string, RequestProgress>();
const MAX_AGE_MS = 60 * 60 * 1000;

async function approvalSig(request: PublicKey): Promise<string | null> {
  const { client, vault } = getLeash();
  const feed = await client.recentActivity(vault, 100).catch(() => []);
  const hit = feed.find((e) => e.kind === "spent" && e.request === request.toBase58());
  if (hit?.sig) return hit.sig;
  // Real chain: the newest successful tx touching the request PDA after its creation is the approval.
  const sigs = await connection().getSignaturesForAddress(request, { limit: 10 }).catch(() => []);
  const ok = sigs.filter((s) => s.err === null);
  return ok.length >= 2 ? ok[0].signature : null;
}

export async function checkRequest(requestStr: string): Promise<RequestProgress> {
  const known = progress.get(requestStr);
  if (known?.result) return known;
  let request: PublicKey;
  try {
    request = new PublicKey(requestStr);
  } catch {
    return { request: requestStr, status: "unknown", updatedAt: Date.now() };
  }
  const state = await getLeash().client.getRequest(request).catch(() => null);
  const entry: RequestProgress = { request: requestStr, status: state?.status ?? "unknown", updatedAt: Date.now() };
  const pending = pendingX402.get(requestStr);
  if (state?.status === "approved" && pending) {
    const sig = await approvalSig(request);
    if (sig) {
      entry.result = await retryWithProof(pending.args, pending.paymentRequired, pending.accepted, pending.nonce, sig, undefined, { request: requestStr });
      pendingX402.delete(requestStr);
    }
  } else if (state && state.status !== "pending") {
    pendingX402.delete(requestStr);
  }
  progress.set(requestStr, entry);
  return entry;
}

/** Poll pending co-signed payments in the background so the agent continues without a UI round-trip. */
export function startApprovalWatcher(intervalMs = 3000): () => void {
  const timer = setInterval(async () => {
    for (const [req, p] of pendingX402) {
      if (Date.now() - p.createdAt > MAX_AGE_MS) {
        pendingX402.delete(req);
        continue;
      }
      await checkRequest(req).catch(() => undefined);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
