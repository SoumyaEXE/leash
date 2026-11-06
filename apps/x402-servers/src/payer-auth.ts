/**
 * Payer binding for x402 proofs. A payment tx is public the moment it lands, and so is the nonce in its memo, so
 * "here is the tx signature" alone proves nothing about who is asking: anyone watching the chain could redeem the
 * agent's payment before the agent's own retry does. The paying key therefore also signs
 *
 *     leash-x402-payer:v1
 *     nonce:<nonce from PAYMENT-REQUIRED>
 *     resource:<resource.url from PAYMENT-REQUIRED>
 *
 * (UTF-8, "\n" separated, no trailing newline) with ed25519, and sends `payer` (base58 pubkey) and
 * `payerSignature` (base64, 64 bytes) in the PAYMENT-SIGNATURE payload. The server checks the signature here and
 * then requires `payer` to be the key that actually paid, read from chain (the vault's `agent` for the "leash"
 * scheme, the debited wallet for "transfer").
 *
 * Node's built-in ed25519 only, so the agent, the MCP server and this verifier need no extra dependency.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const PAYER_AUTH_PREFIX = "leash-x402-payer:v1";

export function payerAuthMessage(nonce: string, resourceUrl: string): Buffer {
  return Buffer.from(`${PAYER_AUTH_PREFIX}\nnonce:${nonce}\nresource:${resourceUrl}`, "utf8");
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

/** Sign with a Solana secret key (64 bytes: seed || pubkey). Returns base64. Used by tests and clients. */
export function signPayerAuth(secretKey: Uint8Array, nonce: string, resourceUrl: string): string {
  const key = createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", d: b64url(secretKey.slice(0, 32)), x: b64url(secretKey.slice(32, 64)) },
    format: "jwk",
  });
  return sign(null, payerAuthMessage(nonce, resourceUrl), key).toString("base64");
}

export function verifyPayerAuth(payer: string, signatureB64: string, nonce: string, resourceUrl: string): boolean {
  let pub: PublicKey;
  let sig: Buffer;
  try {
    pub = new PublicKey(payer);
    sig = Buffer.from(signatureB64, "base64");
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64url(pub.toBytes()) }, format: "jwk" });
    return verify(null, payerAuthMessage(nonce, resourceUrl), key, sig);
  } catch {
    return false;
  }
}
