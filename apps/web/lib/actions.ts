import "server-only";
import type { Transaction } from "@solana/web3.js";

export const DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** Headers every Solana Actions endpoint (and actions.json) must send, per docs/07 + the Actions spec. */
export const ACTION_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Content-Encoding, Accept-Encoding",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": DEVNET_CAIP2,
  "Content-Type": "application/json",
};

export function actionJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: ACTION_HEADERS });
}

export function actionError(message: string, status = 400): Response {
  return actionJson({ message }, status);
}

export function actionOptions(): Response {
  return new Response(null, { status: 204, headers: ACTION_HEADERS });
}

export function serializeUnsigned(tx: Transaction): string {
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
}

/** Absolute URL for icons/links, from the incoming request (works behind Vercel / tunnels). */
export function origin(req: Request): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${proto}://${fwdHost}`;
  return new URL(req.url).origin;
}
