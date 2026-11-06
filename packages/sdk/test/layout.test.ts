/**
 * Guards the hand-written layouts against the program: compares every discriminator, instruction arg list and
 * account list with the IDL produced by `anchor build` (packages/sdk/src/idl/leash.json, via pnpm sdk:sync-idl),
 * and round-trips borsh + event parsing. Run: pnpm --filter @leash/sdk test
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Reader, Writer } from "../src/borsh";
import { ACCOUNT, EVENT_NAMES, IX, discriminator, encodeMandateTerms, parseLeashEvents } from "../src/layout";
import { buildMandateMessage } from "../src/client";
import { toBaseUnits, fromBaseUnits } from "../src/utils";
import { LEASH_ERROR_NAMES } from "../src/errors";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}
const eq = (a: Uint8Array | number[], b: Uint8Array | number[]) => Buffer.from(a).equals(Buffer.from(b));

// ── borsh round trip ──
const w = new Writer().u8(7).bool(true).u16(513).u64(2n ** 63n + 5n).i64(-42n).string("héllo").optionFixed(null, 32);
const r = new Reader(w.bytes());
check("borsh round trip", r.u8() === 7 && r.bool() && r.u16() === 513 && r.u64() === 2n ** 63n + 5n && r.i64() === -42n && r.string() === "héllo" && r.optionFixed(32) === null);
check("amounts", toBaseUnits("0.25") === 250_000n && fromBaseUnits(250_000n) === "0.25" && toBaseUnits("1000") === 1_000_000_000n);

// ── mandate message format ──
const terms = {
  vault: Keypair.generate().publicKey,
  payee: Keypair.generate().publicKey,
  maxTotal: 1_000_000n,
  maxPerTx: 500_000n,
  expiresAt: 1_800_000_000,
  intentHash: new Uint8Array(32).fill(5),
  nonce: 0n,
};
const raw = encodeMandateTerms(terms);
check("mandate terms = 128 bytes", raw.length === 32 + 32 + 8 + 8 + 8 + 32 + 8);
const msg = new TextDecoder().decode(buildMandateMessage(terms));
check("mandate message prefix + hex", msg.startsWith("LEASH_MANDATE_V1:") && msg.length === 17 + 256);

// ── event parsing only trusts the Leash program frame ──
const programId = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const evBytes = new Writer()
  .raw(discriminator("event", "VaultFrozen"))
  .pubkey(terms.vault)
  .u8(3)
  .i64(123)
  .bytes();
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
check("parseLeashEvents decodes own frame only", evs.length === 1 && evs[0].name === "VaultFrozen" && evs[0].data.strikes === 3);

// ── compare with the IDL from anchor build ──
const idlPath = resolve(import.meta.dirname, "../src/idl/leash.json");
if (!existsSync(idlPath)) {
  console.log("skip IDL comparison (run anchor build + pnpm sdk:sync-idl)");
} else {
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));
  const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  for (const ins of idl.instructions as { name: string; discriminator: number[]; args: { name: string }[]; accounts: { name: string }[] }[]) {
    const ours = (IX as Record<string, Uint8Array>)[camel(ins.name)];
    check(`ix ${ins.name} discriminator`, !!ours && eq(ours, ins.discriminator));
  }
  for (const acc of idl.accounts as { name: string; discriminator: number[] }[]) {
    const ours = (ACCOUNT as Record<string, Uint8Array>)[acc.name];
    check(`account ${acc.name} discriminator`, !!ours && eq(ours, acc.discriminator));
  }
  for (const ev of idl.events as { name: string; discriminator: number[] }[]) {
    check(`event ${ev.name} known + discriminator`, (EVENT_NAMES as readonly string[]).includes(ev.name) && eq(discriminator("event", ev.name), ev.discriminator));
  }
  const idlErrors = (idl.errors as { code: number; name: string }[]).map((e) => `${e.code}:${e.name}`);
  const ourErrors = LEASH_ERROR_NAMES.map((n, i) => `${6000 + i}:${n}`);
  check("error codes + names match", JSON.stringify(idlErrors) === JSON.stringify(ourErrors), `idl=${idlErrors.join(",")}`);

  // arg order per instruction (names only; types are covered by the program tests sending real bytes)
  const expectedArgs: Record<string, string[]> = {
    initialize_vault: ["vault_id", "agent", "policy"],
    update_policy: ["policy"],
    set_agent: ["new_agent"],
    set_paused: ["paused"],
    add_payee: ["payee", "label", "per_tx_max", "budget_total"],
    update_payee: ["per_tx_max", "budget_total", "active"],
    create_mandate: ["payee", "max_total", "max_per_tx", "expires_at", "intent_hash"],
    redeem_signed_mandate: ["terms"],
    agent_spend: ["amount", "reason_hash", "memo"],
    guarded_spend: ["amount", "reason_hash", "memo"],
    request_spend: ["payee", "amount", "reason_hash", "memo"],
    withdraw: ["amount"],
  };
  const expectedAccounts: Record<string, string[]> = {
    agent_spend: ["agent", "vault", "mint", "vault_ata", "recipient_ata", "payee_account", "mandate_account", "token_program"],
    request_spend: ["agent", "vault", "request", "payee_account", "mandate_account", "system_program"],
    approve_request: ["owner", "vault", "request", "mint", "vault_ata", "recipient_ata", "payee_account", "mandate_account", "token_program"],
    initialize_vault: ["owner", "vault", "mint", "vault_ata", "token_program", "associated_token_program", "system_program"],
    redeem_signed_mandate: ["agent", "vault", "mandate", "instructions", "system_program"],
    withdraw: ["owner", "vault", "mint", "vault_ata", "owner_token_account", "token_program"],
  };
  for (const ins of idl.instructions as { name: string; args: { name: string }[]; accounts: { name: string }[] }[]) {
    if (expectedArgs[ins.name]) {
      check(`ix ${ins.name} args`, JSON.stringify(ins.args.map((a) => a.name)) === JSON.stringify(expectedArgs[ins.name]), ins.args.map((a) => a.name).join(","));
    }
    if (expectedAccounts[ins.name]) {
      check(`ix ${ins.name} accounts`, JSON.stringify(ins.accounts.map((a) => a.name)) === JSON.stringify(expectedAccounts[ins.name]), ins.accounts.map((a) => a.name).join(","));
    }
  }
  const types = Object.fromEntries((idl.types as { name: string; type: { fields?: { name: string }[] } }[]).map((t) => [t.name, t.type.fields?.map((f) => f.name)]));
  check("Vault field order", JSON.stringify(types.Vault) === JSON.stringify(["owner", "agent", "mint", "vault_id", "paused", "per_tx_cap", "daily_cap", "window_start", "spent_in_window", "cosign_threshold", "request_ttl_secs", "request_seq", "mandate_seq", "total_spent", "blocked_count", "strikes", "freeze_after_strikes", "last_blocked_at", "bump"]), String(types.Vault));
  check("SpendRequest field order", JSON.stringify(types.SpendRequest) === JSON.stringify(["vault", "seq", "payee", "amount", "reason_hash", "created_at", "expires_at", "status", "bump", "memo"]), String(types.SpendRequest));
  check("program address", new PublicKey(idl.address).toBase58() === "Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");
}

console.log(failures ? `\n${failures} failed` : "\nall layout checks passed");
process.exit(failures ? 1 : 0);
