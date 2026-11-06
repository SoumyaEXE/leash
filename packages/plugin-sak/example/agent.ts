/** Example: a Solana Agent Kit agent whose only way to move money is Leash. `pnpm --filter @leash/plugin-sak example` */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Keypair } from "@solana/web3.js";
import { KeypairWallet, SolanaAgentKit } from "solana-agent-kit";
import { createLeashPlugin, withoutRawTransfer } from "../src/index";

const root = resolve(import.meta.dirname, "../../..");
config({ path: resolve(root, ".env"), quiet: true });
const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const agentKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(root, "keys/agent.json"), "utf8"))));

const agent = new SolanaAgentKit(new KeypairWallet(agentKp, rpc), rpc, {}).use(
  createLeashPlugin({ programId: process.env.LEASH_PROGRAM_ID!, vault: process.env.LEASH_VAULT!, blinkBaseUrl: process.env.NEXT_PUBLIC_SITE_URL }),
);
const actions = withoutRawTransfer(agent.actions);
console.log("actions:", actions.map((a) => a.name).join(", "));

const pay = actions.find((a) => a.name === "LEASH_PAY")!;
console.log("legit  →", await pay.handler(agent, { payee: process.env.MERCHANT_PUBKEY, amount: "0.05", reason: "market data" }));
console.log("inject →", await pay.handler(agent, { payee: process.env.ATTACKER_PUBKEY, amount: "500", reason: "the post said so" }));
