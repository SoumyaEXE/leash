/** The agent's x402 payer authorization matches the documented format the x402 server verifies. */
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { describe, it } from "node:test";
import { Keypair } from "@solana/web3.js";
import { payerAuthorization } from "../src/x402-client";

describe("payer authorization", () => {
  it("is an ed25519 signature by the paying key over leash-x402-payer:v1 / nonce / resource", () => {
    const kp = Keypair.generate();
    const nonce = "ab".repeat(32);
    const url = "http://localhost:4021/api/market/SOL";
    const auth = payerAuthorization(kp, nonce, url);
    assert.equal(auth.payer, kp.publicKey.toBase58());
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(kp.publicKey.toBytes()).toString("base64url") }, format: "jwk" });
    const msg = Buffer.from(`leash-x402-payer:v1\nnonce:${nonce}\nresource:${url}`, "utf8");
    assert.equal(verify(null, msg, key, Buffer.from(auth.payerSignature, "base64")), true);
    assert.equal(verify(null, Buffer.from(`leash-x402-payer:v1\nnonce:${nonce}\nresource:${url}x`), key, Buffer.from(auth.payerSignature, "base64")), false);
  });
});
