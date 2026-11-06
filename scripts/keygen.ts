/** Create the demo keypairs under keys/ (gitignored) if missing, and record public addresses in .env. */
import { KEY_NAMES, loadOrCreateKeypair, setEnv } from "./lib";

const out: Record<string, string> = {};
for (const name of KEY_NAMES) {
  const { kp, created } = loadOrCreateKeypair(name);
  out[name] = kp.publicKey.toBase58();
  console.log(`${created ? "created " : "exists  "} keys/${name}.json  ${kp.publicKey.toBase58()}`);
}

// Keep an existing LEASH_PROGRAM_ID (e.g. the already-deployed devnet program); otherwise use our own program key.
const programId = process.env.LEASH_PROGRAM_ID?.trim() || out["leash-program"];
setEnv({
  ATTACKER_PUBKEY: out.attacker,
  MERCHANT_PUBKEY: out.merchant,
  RESEARCH_PUBKEY: out.research,
  LEASH_PROGRAM_ID: programId,
  NEXT_PUBLIC_LEASH_PROGRAM_ID: programId,
});
console.log("\n.env updated (ATTACKER_PUBKEY, MERCHANT_PUBKEY, LEASH_PROGRAM_ID). Private keys never leave keys/.");
