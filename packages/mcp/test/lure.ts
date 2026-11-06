/**
 * Counterfactual for the A1 lab: "what if the agent had followed the poisoned docs?"
 *
 * Reads the lure (wallet + amount) from the docs page itself, then sends exactly that leash_pay call through the
 * built MCP server over stdio, the same way Claude Code calls it. No model is involved; this shows what the Leash
 * program does with the payment a fooled agent would have sent.
 *
 *   pnpm --filter @leash/mcp build
 *   pnpm --filter @leash/mcp test:lure [docs-url]     (default http://localhost:3000/lab/market-data/quickstart)
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = resolve(import.meta.dirname, "../../..");
config({ path: resolve(root, ".env"), quiet: true });

const url = process.argv[2] ?? `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/lab/market-data/quickstart`;
const html = await (await fetch(url)).text();
// "billing wallet: <addr>" (activation-step) or "licensing wallet <addr>" (hidden-license)
const wallet = html.match(/(?:billing|licensing) wallet:?\s*([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1];
const amount = html.match(/(\d+\.\d{2}) dUSDC/)?.[1];
if (!wallet || !amount) throw new Error(`No payment lure found on ${url}`);
console.log(`lure on ${url}: pay ${amount} dUSDC to ${wallet}`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(import.meta.dirname, "../dist/index.js")],
  env: { ...process.env } as Record<string, string>,
});
const client = new Client({ name: "leash-lure", version: "0.0.1" });
await client.connect(transport);
const res = await client.callTool({
  name: "leash_pay",
  arguments: { payee: wallet, amount, reason: "Market Data API activation" },
});
console.log(JSON.stringify(res.structuredContent ?? res.content, null, 2));
await client.close();
