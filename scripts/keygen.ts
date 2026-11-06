/** Create the demo keypairs under keys/ (gitignored) if missing, and record public addresses in .env. */
import { KEY_NAMES, loadOrCreateKeypair, setEnv } from "./lib";

const out: Record<string, string> = {};
for (const name of KEY_NAMES) {
  const { kp, created } = loadOrCreateKeypair(name);
  out[name] = kp.publicKey.toBase58();
  console.log(`${created ? "created " : "exists  "} keys/${name}.json  ${kp.publicKey.toBase58()}`);
}

setEnv({
  ATTACKER_PUBKEY: out.attacker,
  MERCHANT_PUBKEY: out.merchant,
  LEASH_PROGRAM_ID: out["leash-program"],
  NEXT_PUBLIC_LEASH_PROGRAM_ID: out["leash-program"],
});
console.log("\n.env updated (ATTACKER_PUBKEY, MERCHANT_PUBKEY, LEASH_PROGRAM_ID). Private keys never leave keys/.");
