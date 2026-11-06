/** Print SOL balances of the demo wallets and say which ones still need devnet SOL. */
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { connection, loadKeypair } from "./lib";

const NEEDS: Record<string, number> = { owner: 4, agent: 0.2, victim: 0.1 };

const conn = connection();
let missing = 0;
for (const name of ["owner", "agent", "victim", "attacker", "merchant"] as const) {
  const pk = loadKeypair(name).publicKey;
  const sol = (await conn.getBalance(pk)) / LAMPORTS_PER_SOL;
  const need = NEEDS[name] ?? 0;
  const flag = sol + 1e-9 < need ? `  <- needs ${need} SOL` : "";
  if (flag) missing++;
  console.log(`${name.padEnd(9)} ${pk.toBase58()}  ${sol.toFixed(4)} SOL${flag}`);
}
if (missing) {
  console.log("\nFund the flagged wallets at https://faucet.solana.com (devnet, sign in with GitHub for more SOL).");
  console.log("The owner deploys the program (~3-4 SOL); the others only pay fees.");
}
