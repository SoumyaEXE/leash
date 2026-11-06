/**
 * Idempotent devnet setup. Fund only the OWNER wallet (faucet.solana.com); this script:
 *  1. tops up agent / victim / attacker with fee SOL from the owner,
 *  2. creates our own 6-decimal test mint "dUSDC" (owner = mint authority),
 *  3. creates token accounts and gives the victim 1,000 dUSDC,
 *  4. if the program is deployed: creates the demo vault (1), Arena vault (2) and tripwire vault (3),
 *     deposits funds and adds the two x402 payees,
 *  5. writes every address to .env (keeping your other values).
 * Run again any time; it only does what's missing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  transfer,
} from "@solana/spl-token";
import { LeashClient, fromBaseUnits } from "@leash/sdk";
import { ROOT, connection, loadKeypair, setEnv } from "./lib";
import { ARENA_VAULT, DEMO_VAULT, FEE_SOL, PAYEES, TRIPWIRE_VAULT, VICTIM_BALANCE } from "./demo-config";

const conn = connection();
const owner = loadKeypair("owner");
const agent = loadKeypair("agent");
const victim = loadKeypair("victim");
const attacker = loadKeypair("attacker");
const merchant = loadKeypair("merchant");
const research = loadKeypair("research");
const programId = process.env.LEASH_PROGRAM_ID?.trim()
  ? new PublicKey(process.env.LEASH_PROGRAM_ID.trim())
  : loadKeypair("leash-program").publicKey;

const log = (s: string) => console.log(s);

async function ensureFeeSol(): Promise<void> {
  const ownerSol = (await conn.getBalance(owner.publicKey)) / LAMPORTS_PER_SOL;
  log(`owner    ${owner.publicKey.toBase58()}  ${ownerSol.toFixed(3)} SOL`);
  const tx = new Transaction();
  for (const [name, kp] of [["agent", agent], ["victim", victim], ["attacker", attacker]] as const) {
    const want = FEE_SOL[name];
    const have = (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
    if (have < want / 2) {
      const lamports = Math.round((want - have) * LAMPORTS_PER_SOL);
      tx.add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: kp.publicKey, lamports }));
      log(`  + ${(lamports / LAMPORTS_PER_SOL).toFixed(3)} SOL → ${name}`);
    }
  }
  const needed = tx.instructions.reduce((s, ix) => s + Number(ix.data.readBigUInt64LE(4)), 0) / LAMPORTS_PER_SOL;
  if (ownerSol < needed + 0.05) {
    throw new Error(
      `Owner has ${ownerSol.toFixed(3)} SOL; needs ~${(needed + 0.1).toFixed(2)} for setup (plus ~4 SOL to deploy the program).\n` +
        `Fund ${owner.publicKey.toBase58()} at https://faucet.solana.com (devnet), then re-run.`,
    );
  }
  if (tx.instructions.length) await sendAndConfirmTransaction(conn, tx, [owner], { commitment: "confirmed" });
}

async function ensureMint(): Promise<PublicKey> {
  const path = resolve(ROOT, "keys", "dusdc-mint.json");
  let mintKp: Keypair;
  if (existsSync(path)) {
    mintKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  } else {
    mintKp = Keypair.generate();
    writeFileSync(path, JSON.stringify(Array.from(mintKp.secretKey)));
  }
  const info = await conn.getAccountInfo(mintKp.publicKey);
  if (!info) {
    await createMint(conn, owner, owner.publicKey, null, 6, mintKp, { commitment: "confirmed" });
    log(`created dUSDC mint ${mintKp.publicKey.toBase58()} (6 decimals, authority = owner)`);
  } else {
    log(`dUSDC mint ${mintKp.publicKey.toBase58()} exists`);
  }
  return mintKp.publicKey;
}

async function tokenBalance(ata: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(conn, ata, "confirmed")).amount;
  } catch {
    return 0n;
  }
}

async function main() {
  log("── Leash devnet setup ──");
  await ensureFeeSol();
  const mint = await ensureMint();

  // Token accounts (owner pays rent)
  const atas: Record<string, PublicKey> = {};
  for (const [name, kp] of Object.entries({ owner, victim, attacker, merchant, research })) {
    atas[name] = await createAssociatedTokenAccountIdempotent(conn, owner, mint, kp.publicKey, { commitment: "confirmed" });
  }
  log("token accounts ready (owner, victim, attacker, merchant, research)");

  // Victim holds its 1,000 dUSDC directly (the unprotected, Bankr-style wallet)
  const victimBal = await tokenBalance(atas.victim);
  if (victimBal < VICTIM_BALANCE) {
    await mintTo(conn, owner, mint, atas.victim, owner, VICTIM_BALANCE - victimBal, [], { commitment: "confirmed" });
  }
  log(`victim   ${fromBaseUnits(await tokenBalance(atas.victim))} dUSDC`);

  setEnv({
    DUSDC_MINT: mint.toBase58(),
    NEXT_PUBLIC_DUSDC_MINT: mint.toBase58(),
    LEASH_PROGRAM_ID: programId.toBase58(),
    NEXT_PUBLIC_LEASH_PROGRAM_ID: programId.toBase58(),
    ATTACKER_PUBKEY: attacker.publicKey.toBase58(),
    MERCHANT_PUBKEY: merchant.publicKey.toBase58(),
    RESEARCH_PUBKEY: research.publicKey.toBase58(),
  });

  const program = await conn.getAccountInfo(programId);
  if (!program?.executable) {
    log(`\nProgram ${programId.toBase58()} is not deployed yet. Token setup is done.`);
    log("Deploy it (anchor deploy --provider.cluster devnet), then run this script again for the vaults.");
    return;
  }

  const leash = new LeashClient({ connection: conn, programId, wallet: owner });
  const vaults = [
    { cfg: DEMO_VAULT, env: "LEASH_VAULT", payees: true },
    { cfg: ARENA_VAULT, env: "ARENA_VAULT", payees: false },
    { cfg: TRIPWIRE_VAULT, env: "TRIPWIRE_VAULT", payees: true },
  ];
  const total = vaults.reduce((s, v) => s + v.cfg.balance, 0n);
  const ownerBal = await tokenBalance(atas.owner);
  if (ownerBal < total) {
    await mintTo(conn, owner, mint, atas.owner, owner, total - ownerBal, [], { commitment: "confirmed" });
  }

  const envOut: Record<string, string> = {};
  for (const v of vaults) {
    const pda = leash.vaultPda(owner.publicKey, v.cfg.id);
    if (!(await conn.getAccountInfo(pda))) {
      const { sig } = await leash.initializeVault({ vaultId: v.cfg.id, agent: agent.publicKey, mint, policy: v.cfg.policy });
      log(`created vault ${v.cfg.id} ${pda.toBase58()}  (${sig.slice(0, 12)}…)`);
    }
    const vaultAta = getAssociatedTokenAddressSync(mint, pda, true);
    const bal = await tokenBalance(vaultAta);
    if (bal < v.cfg.balance) {
      await transfer(conn, owner, atas.owner, vaultAta, owner, v.cfg.balance - bal, [], { commitment: "confirmed" });
    }
    if (v.payees) {
      for (const p of PAYEES) {
        const wallet = p.key === "merchant" ? merchant.publicKey : research.publicKey;
        if (!(await leash.getPayee(pda, wallet))) {
          await leash.ownerAction({ type: "addPayee", vault: pda, payee: wallet, label: p.label, perTxMax: p.perTxMax, budgetTotal: p.budgetTotal });
          log(`  + payee "${p.label}" ${wallet.toBase58()}`);
        }
      }
    }
    const state = await leash.getVault(pda);
    log(`vault ${v.cfg.id}  ${pda.toBase58()}  ${fromBaseUnits(state.balance)} dUSDC  freeze_after=${state.freezeAfterStrikes}`);
    envOut[v.env] = pda.toBase58();
  }
  setEnv({
    ...envOut,
    NEXT_PUBLIC_LEASH_VAULT: envOut.LEASH_VAULT,
    NEXT_PUBLIC_ARENA_VAULT: envOut.ARENA_VAULT,
    NEXT_PUBLIC_TRIPWIRE_VAULT: envOut.TRIPWIRE_VAULT,
  });
  log("\n.env updated. Demo state is seeded.");
}

main()
  .then(() => process.exit(0)) // RPC websocket subscriptions would otherwise keep the process alive
  .catch((e) => {
  console.error(`\nsetup failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
