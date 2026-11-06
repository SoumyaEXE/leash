/**
 * Off-chain security tests for the x402 paywall: nonce store (atomic reserve, release, commit, bounds), payer
 * authorization, and the race the reservation closes. The onchain verifiers are replaced by fakes; the chain path
 * is covered by test/live-devnet.ts. Run: pnpm --filter x402-servers test
 */
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";

// Config is read at import time: give it a mint/program before loading the modules under test.
process.env.DUSDC_MINT ||= Keypair.generate().publicKey.toBase58();
process.env.LEASH_PROGRAM_ID ||= Keypair.generate().publicKey.toBase58();
process.env.X402_SERVER_URL = "http://127.0.0.1:4231";

const { NonceStore } = await import("../src/nonces");
const { signPayerAuth, verifyPayerAuth, payerAuthMessage } = await import("../src/payer-auth");
const { paywall } = await import("../src/paywall");
const { default: express } = await import("express");

const PORT = 4231;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const termsInput = (resource = "GET /paid") => ({
  resource,
  resourceUrl: `${BASE}/paid`,
  amount: 50_000n,
  payTo: Keypair.generate().publicKey.toBase58(),
  asset: process.env.DUSDC_MINT!,
  schemes: ["leash", "transfer"],
});

describe("NonceStore", () => {
  it("reserves a nonce atomically: a second claim fails while the first is in flight", () => {
    const s = new NonceStore();
    const t = s.issue(termsInput(), 60);
    const a = s.reserve(t.nonce, "sigA");
    const b = s.reserve(t.nonce, "sigB");
    assert.equal(a.ok, true);
    assert.equal(b.ok, false);
    assert.equal(!b.ok && b.retryable, true);
  });

  it("blocks the same tx signature on a different nonce while reserved and after commit", () => {
    const s = new NonceStore();
    const t1 = s.issue(termsInput(), 60);
    const t2 = s.issue(termsInput(), 60);
    const a = s.reserve(t1.nonce, "sig");
    assert.equal(a.ok, true);
    const b = s.reserve(t2.nonce, "sig");
    assert.equal(b.ok, false);
    if (a.ok) s.commit(a.reservation);
    const c = s.reserve(t2.nonce, "sig");
    assert.equal(c.ok, false);
    assert.match(!c.ok ? c.reason : "", /already used/);
  });

  it("release frees nonce and signature; commit spends them", () => {
    const s = new NonceStore();
    const t = s.issue(termsInput(), 60);
    const a = s.reserve(t.nonce, "sig");
    assert.ok(a.ok);
    s.release(a.reservation);
    const b = s.reserve(t.nonce, "sig");
    assert.ok(b.ok);
    s.commit(b.reservation);
    assert.equal(s.lookup(t.nonce)?.usedBy, "sig");
    const c = s.reserve(t.nonce, "other");
    assert.equal(c.ok, false);
    assert.match(!c.ok ? c.reason : "", /Nonce already used/);
    // release after commit is a no-op
    s.release(b.reservation);
    assert.equal(s.lookup(t.nonce)?.usedBy, "sig");
  });

  it("rejects expired terms", () => {
    const s = new NonceStore();
    const now = Math.floor(Date.now() / 1000);
    const t = s.issue(termsInput(), 10, now - 100);
    const r = s.reserve(t.nonce, "sig", now);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : "", /expired/);
  });

  it("stays bounded under a flood of issued terms and keeps reserved ones", () => {
    const s = new NonceStore({ maxIssued: 100 });
    const keep = s.issue(termsInput(), 3600);
    const claim = s.reserve(keep.nonce, "inflight");
    assert.ok(claim.ok);
    for (let i = 0; i < 1000; i++) s.issue(termsInput(), 3600);
    assert.ok(s.size.issued <= 100, `issued=${s.size.issued}`);
    assert.ok(s.lookup(keep.nonce), "a nonce being verified must not be evicted");
  });

  it("drops expired terms first when full", () => {
    const s = new NonceStore({ maxIssued: 10 });
    const now = Math.floor(Date.now() / 1000);
    const live = s.issue(termsInput(), 3600, now);
    for (let i = 0; i < 9; i++) s.issue(termsInput(), 1, now - 100);
    s.issue(termsInput(), 3600, now);
    assert.ok(s.lookup(live.nonce), "unexpired terms survive while expired ones can be dropped");
    assert.ok(s.size.issued <= 10);
  });

  it("bounds remembered signatures", () => {
    const s = new NonceStore({ maxSigs: 50 });
    for (let i = 0; i < 500; i++) {
      const t = s.issue(termsInput(), 60);
      const r = s.reserve(t.nonce, `sig${i}`);
      if (r.ok) s.commit(r.reservation);
    }
    assert.ok(s.size.sigs <= 50, `sigs=${s.size.sigs}`);
  });
});

describe("payer authorization", () => {
  const kp = Keypair.generate();
  const nonce = "ab".repeat(32);
  const url = `${BASE}/paid?x=1`;

  it("round-trips with a Solana keypair", () => {
    const sig = signPayerAuth(kp.secretKey, nonce, url);
    assert.equal(verifyPayerAuth(kp.publicKey.toBase58(), sig, nonce, url), true);
  });

  it("fails for another key, another nonce, another resource, or garbage", () => {
    const sig = signPayerAuth(kp.secretKey, nonce, url);
    assert.equal(verifyPayerAuth(Keypair.generate().publicKey.toBase58(), sig, nonce, url), false);
    assert.equal(verifyPayerAuth(kp.publicKey.toBase58(), sig, "cd".repeat(32), url), false);
    assert.equal(verifyPayerAuth(kp.publicKey.toBase58(), sig, nonce, `${BASE}/other`), false);
    assert.equal(verifyPayerAuth("not-a-key", sig, nonce, url), false);
    assert.equal(verifyPayerAuth(kp.publicKey.toBase58(), "AAAA", nonce, url), false);
  });

  it("uses the documented message format", () => {
    assert.equal(payerAuthMessage("n", "u").toString("utf8"), "leash-x402-payer:v1\nnonce:n\nresource:u");
  });
});

describe("paywall (HTTP)", () => {
  const agent = Keypair.generate();
  const store = new NonceStore();
  let verifyCalls = 0;
  let verifyDelayMs = 300;
  let failNext = false;
  let server: Server;

  before(async () => {
    const app = express();
    app.get(
      "/paid",
      paywall(
        { serviceName: "Test", description: "test", ttlSecs: 60, price: async () => ({ amount: 50_000n, payTo: new PublicKey(termsInput().payTo) }) },
        {
          store,
          skipSetupCheck: true,
          requirePayerAuth: true,
          verifyLeash: async () => {
            verifyCalls++;
            await sleep(verifyDelayMs);
            if (failNext) {
              failNext = false;
              return { ok: false, reason: "not confirmed yet", retryable: true };
            }
            return { ok: true, payer: "VAULT", authority: agent.publicKey.toBase58(), detail: "fake" };
          },
        },
      ),
      (_req, res) => {
        res.json({ served: true });
      },
    );
    await new Promise<void>((resolve) => {
      server = app.listen(PORT, "127.0.0.1", () => resolve());
    });
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function terms(): Promise<{ pr: PaymentRequired; nonce: string }> {
    const r = await fetch(`${BASE}/paid`);
    assert.equal(r.status, 402);
    const pr = decodePaymentRequiredHeader(r.headers.get("PAYMENT-REQUIRED")!);
    await r.arrayBuffer();
    return { pr, nonce: String(pr.accepts[0].extra.nonce) };
  }

  function proof(pr: PaymentRequired, nonce: string, txSignature: string, signer: Keypair | null = agent): string {
    const accepted = pr.accepts.find((a) => a.scheme === "leash")!;
    const auth = signer ? { payer: signer.publicKey.toBase58(), payerSignature: signPayerAuth(signer.secretKey, nonce, pr.resource!.url) } : {};
    return encodePaymentSignatureHeader({ x402Version: 2, resource: pr.resource, accepted, payload: { txSignature, nonce, ...auth } });
  }

  const pay = (header: string) => fetch(`${BASE}/paid`, { headers: { "PAYMENT-SIGNATURE": header } });

  it("issues terms that ask for payer authorization", async () => {
    const { pr } = await terms();
    assert.equal(pr.accepts.find((a) => a.scheme === "leash")?.extra.payerAuth, "leash-x402-payer:v1");
  });

  it("serves exactly one of two concurrent requests carrying the same proof", async () => {
    const { pr, nonce } = await terms();
    const header = proof(pr, nonce, "tx-race-1");
    verifyCalls = 0;
    const [a, b] = await Promise.all([pay(header), pay(header)]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 402]);
    assert.equal(verifyCalls, 1, "the losing request must not even reach the verifier");
    const loser = (await (a.status === 402 ? a : b).json()) as { error: string; retryable?: boolean };
    assert.match(loser.error, /already being verified/);
    // after the winner commits, the proof is spent
    const again = await pay(header);
    assert.equal(again.status, 402);
    assert.match(((await again.json()) as { error: string }).error, /Nonce already used/);
  });

  it("does not let one tx signature pay for two nonces", async () => {
    const t1 = await terms();
    const t2 = await terms();
    const [a, b] = await Promise.all([pay(proof(t1.pr, t1.nonce, "tx-shared")), pay(proof(t2.pr, t2.nonce, "tx-shared"))]);
    assert.deepEqual([a.status, b.status].sort(), [200, 402]);
  });

  it("releases the reservation when verification fails, so the same proof can be retried", async () => {
    const { pr, nonce } = await terms();
    const header = proof(pr, nonce, "tx-retry");
    failNext = true;
    const first = await pay(header);
    assert.equal(first.status, 402);
    assert.equal(((await first.json()) as { retryable?: boolean }).retryable, true);
    const second = await pay(header);
    assert.equal(second.status, 200);
  });

  it("rejects proofs without payer authorization before calling the verifier", async () => {
    const { pr, nonce } = await terms();
    verifyCalls = 0;
    const r = await pay(proof(pr, nonce, "tx-noauth", null));
    assert.equal(r.status, 402);
    assert.match(((await r.json()) as { error: string }).error, /Missing payer authorization/);
    assert.equal(verifyCalls, 0);
  });

  it("rejects a front-runner who copies the agent's tx signature", async () => {
    const { pr, nonce } = await terms();
    const thief = Keypair.generate();
    const r = await pay(proof(pr, nonce, "tx-front-run", thief));
    assert.equal(r.status, 402);
    assert.match(((await r.json()) as { error: string }).error, /was signed by .* but this payment was made by/);
    // the agent's own proof still works afterwards (the thief's attempt released the nonce)
    const ok = await pay(proof(pr, nonce, "tx-front-run"));
    assert.equal(ok.status, 200);
  });

  it("rejects an authorization signed for another resource", async () => {
    const { pr, nonce } = await terms();
    const accepted = pr.accepts.find((a) => a.scheme === "leash")!;
    const header = encodePaymentSignatureHeader({
      x402Version: 2,
      resource: pr.resource,
      accepted,
      payload: {
        txSignature: "tx-wrong-resource",
        nonce,
        payer: agent.publicKey.toBase58(),
        payerSignature: signPayerAuth(agent.secretKey, nonce, `${BASE}/elsewhere`),
      },
    });
    const r = await pay(header);
    assert.equal(r.status, 402);
    assert.match(((await r.json()) as { error: string }).error, /Invalid payer authorization/);
  });

  it("rejects the removed mock shortcut", async () => {
    process.env.X402_ACCEPT_MOCK = "1";
    const { pr, nonce } = await terms();
    verifyDelayMs = 0;
    const r = await pay(proof(pr, nonce, "mock-sig", Keypair.generate()));
    assert.equal(r.status, 402, "a mock signature is verified like any other and fails payer binding");
    delete process.env.X402_ACCEPT_MOCK;
  });
});
