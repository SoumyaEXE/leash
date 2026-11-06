/** borsh primitives, amount helpers and event-frame trust (the small things everything else stands on). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Reader, Writer } from "../src/borsh";
import { BUCKETS, discriminator, parseLeashEvents, rollingSum } from "../src/layout";
import { fromBaseUnits, toBaseUnits } from "../src/utils";

test("borsh round trip", () => {
  const pk = Keypair.generate().publicKey;
  const w = new Writer().u8(7).bool(true).u16(513).u64(2n ** 63n + 5n).i64(-42n).string("héllo").optionFixed(null, 32).optionPubkey(pk);
  const r = new Reader(w.bytes());
  assert.equal(r.u8(), 7);
  assert.equal(r.bool(), true);
  assert.equal(r.u16(), 513);
  assert.equal(r.u64(), 2n ** 63n + 5n);
  assert.equal(r.i64(), -42n);
  assert.equal(r.string(), "héllo");
  assert.equal(r.optionFixed(32), null);
  assert.ok(r.optionPubkey()?.equals(pk));
  assert.equal(r.remaining, 0);
  assert.throws(() => r.u8(), /read past end/);
});

test("amount helpers", () => {
  assert.equal(toBaseUnits("0.25"), 250_000n);
  assert.equal(fromBaseUnits(250_000n), "0.25");
  assert.equal(toBaseUnits("1000"), 1_000_000_000n);
  assert.throws(() => toBaseUnits("0.0000001"));
});

test("rollingSum covers the current hour and the 24 before it", () => {
  const now = 1_794_052_800; // 2026-11-07T12:00:00Z
  const hour = Math.floor(now / 3600);
  const ring = Array.from({ length: BUCKETS }, () => 0n);
  ring[hour % BUCKETS] = 1n;
  ring[(hour - 24) % BUCKETS] = 10n;
  assert.equal(rollingSum(ring, hour, now), 11n);
  // an hour later the 24h-old bucket falls out (and nothing was written since)
  assert.equal(rollingSum(ring, hour, now + 3600), 1n);
  // a day later everything is stale
  assert.equal(rollingSum(ring, hour, now + 25 * 3600), 0n);
});

test("parseLeashEvents decodes the Leash frame only", () => {
  const programId = Keypair.generate().publicKey;
  const other = Keypair.generate().publicKey;
  const vault = Keypair.generate().publicKey;
  const evBytes = new Writer().raw(discriminator("event", "VaultFrozen")).pubkey(vault).u8(3).i64(123).bytes();
  const line = `Program data: ${Buffer.from(evBytes).toString("base64")}`;
  const logs = [
    `Program ${programId.toBase58()} invoke [1]`,
    line,
    `Program ${other.toBase58()} invoke [2]`,
    line, // forged by another program: ignored
    `Program ${other.toBase58()} success`,
    `Program ${programId.toBase58()} success`,
  ];
  const evs = parseLeashEvents(logs, programId);
  assert.equal(evs.length, 1);
  assert.ok(evs[0].name === "VaultFrozen" && evs[0].data.strikes === 3);
});
