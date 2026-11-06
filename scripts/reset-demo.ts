/**
 * Restore the seeded demo state in a few seconds (the /demo "Reset" button calls this):
 *  - attacker's loot goes back to the victim; victim topped up to exactly 1,000 dUSDC,
 *  - demo + tripwire vaults: open requests rejected (pending or expired: this closes them and frees the 8 open
 *    slots), payee budgets fresh, policy = demo config, balances exact, unpaused, strikes 0.
 * Idempotent. The Arena vault is left alone (its counters are the public scoreboard).
 */
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, mintTo, transfer } from "@solana/spl-token";
import { LeashClient, fromBaseUnits, policyOf } from "@leash/sdk";
import { connection, envPubkey, loadKeypair } from "./lib";
import { DEMO_VAULT, PAYEES, TRIPWIRE_VAULT, VICTIM_BALANCE, samePolicy } from "./demo-config";

const conn = connection();
const owner = loadKeypair("owner");
const attacker = loadKeypair("attacker");
const victim = loadKeypair("victim");
const wallets = { merchant: loadKeypair("merchant").publicKey, research: loadKeypair("research").publicKey };
const log = (s: string) => console.log(s);

async function bal(ata: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(conn, ata, "confirmed")).amount;
  } catch {
    return 0n;
  }
}

async function main() {
  const mint = envPubkey("DUSDC_MINT");
  const programId = envPubkey("LEASH_PROGRAM_ID");
  const ownerAta = getAssociatedTokenAddressSync(mint, owner.publicKey);
  const victimAta = getAssociatedTokenAddressSync(mint, victim.publicKey);
  const attackerAta = getAssociatedTokenAddressSync(mint, attacker.publicKey);

  // 1. Victim: refund from the attacker, then top up / trim to exactly 1,000.
  const loot = await bal(attackerAta);
  if (loot > 0n) {
    await transfer(conn, owner, attackerAta, victimAta, attacker, loot, [], { commitment: "confirmed" });
    log(`refunded ${fromBaseUnits(loot)} dUSDC attacker → victim`);
  }
  const vb = await bal(victimAta);
  if (vb < VICTIM_BALANCE) await mintTo(conn, owner, mint, victimAta, owner, VICTIM_BALANCE - vb, [], { commitment: "confirmed" });
  if (vb > VICTIM_BALANCE) await transfer(conn, owner, victimAta, ownerAta, victim, vb - VICTIM_BALANCE, [], { commitment: "confirmed" });
  log(`victim   ${fromBaseUnits(await bal(victimAta))} dUSDC`);

  // 2. Vaults
  const leash = new LeashClient({ connection: conn, programId, wallet: owner });
  // The vaults the apps actually use (.env, written by setup), else the configured ids.
  const targets = [
    { cfg: DEMO_VAULT, env: process.env.LEASH_VAULT },
    { cfg: TRIPWIRE_VAULT, env: process.env.TRIPWIRE_VAULT },
  ];
  for (const { cfg, env } of targets) {
    const vault = env?.trim() ? new PublicKey(env.trim()) : leash.vaultPda(owner.publicKey, cfg.id);
    if (!(await conn.getAccountInfo(vault))) {
      log(`vault ${vault.toBase58()} missing: run pnpm setup:devnet`);
      continue;
    }
    // Every open request (pending or expired). reject_request closes it and refunds the agent's rent.
    for (const r of await leash.listRequests(vault)) {
      await leash.ownerAction({ type: "rejectRequest", vault, request: r.address });
      log(`  rejected ${r.status} request #${r.seq}`);
    }
    for (const p of PAYEES) {
      const wallet = wallets[p.key];
      const cur = await leash.getPayee(vault, wallet);
      if (cur && (cur.spent > 0n || !cur.active || cur.perTxMax !== p.perTxMax || cur.budgetTotal !== p.budgetTotal)) {
        await leash.ownerAction({ type: "removePayee", vault, payee: wallet });
      }
      if (!cur || cur.spent > 0n || !cur.active || cur.perTxMax !== p.perTxMax || cur.budgetTotal !== p.budgetTotal) {
        await leash.ownerAction({ type: "addPayee", vault, payee: wallet, label: p.label, perTxMax: p.perTxMax, budgetTotal: p.budgetTotal });
        log(`  payee "${p.label}" budget reset`);
      }
    }
    const v = await leash.getVault(vault);
    if (!samePolicy(policyOf(v), cfg.policy)) {
      await leash.ownerAction({ type: "updatePolicy", vault, policy: cfg.policy });
      log("  policy reset to the demo config");
    }
    if (v.paused) await leash.ownerAction({ type: "setPaused", vault, paused: false });
    else if (v.strikes > 0) await leash.ownerAction({ type: "resetStrikes", vault });
    if (v.balance > cfg.balance) await leash.ownerAction({ type: "withdraw", vault, amount: v.balance - cfg.balance });
    if (v.balance < cfg.balance) {
      const need = cfg.balance - v.balance;
      if ((await bal(ownerAta)) < need) await mintTo(conn, owner, mint, ownerAta, owner, need, [], { commitment: "confirmed" });
      await transfer(conn, owner, ownerAta, v.vaultAta, owner, need, [], { commitment: "confirmed" });
    }
    const after = await leash.getVault(vault);
    const used = after.spent24h;
    log(
      `vault ${after.vaultId}  ${fromBaseUnits(after.balance)} dUSDC  paused=${after.paused}  strikes=${after.strikes}  ` +
        `24h used ${fromBaseUnits(used)}/${fromBaseUnits(after.dailyCap)}  open requests=${after.openRequests}`,
    );
    // The cap is a rolling 24h (hourly buckets): a payment stops counting 24-25h after it was made.
    if (used * 10n > after.dailyCap * 6n) log("  ⚠ more than 60% of the rolling 24h cap is used; legit S4 runs may hit ExceedsDailyCap until those payments are 24-25h old");
    if (after.cosignWindowThreshold > 0n && after.autonomous24h * 10n > after.cosignWindowThreshold * 6n) {
      log("  ⚠ autonomous 24h spending is above 60% of the co-sign window threshold; small payments may need a co-sign");
    }
  }
  log("reset done");
}

main()
  .then(() => process.exit(0)) // RPC websocket subscriptions would otherwise keep the process alive
  .catch((e) => {
  console.error(`reset failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
