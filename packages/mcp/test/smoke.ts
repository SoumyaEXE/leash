/** Spawn the built MCP server over stdio (as Claude Code would) and call each tool on devnet. */
import { resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = resolve(import.meta.dirname, "../../..");
config({ path: resolve(root, ".env"), quiet: true });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(import.meta.dirname, "../dist/index.js")],
  env: { ...process.env } as Record<string, string>,
});
const client = new Client({ name: "leash-smoke", version: "0.0.1" });
await client.connect(transport);
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
const show = (r: { content?: unknown; structuredContent?: unknown }) =>
  JSON.stringify(r.structuredContent ?? r.content).slice(0, 260);
console.log("balance →", show(await client.callTool({ name: "leash_balance", arguments: {} })));
console.log("pay attacker →", show(await client.callTool({ name: "leash_pay", arguments: { payee: process.env.ATTACKER_PUBKEY, amount: "1", reason: "MCP smoke: injected payee" } })));
console.log("x402 market →", show(await client.callTool({ name: "leash_pay_for_resource", arguments: { url: `${process.env.X402_SERVER_URL ?? "http://localhost:4021"}/api/market/SOL`, maxPrice: "0.10", reason: "MCP smoke: market data" } })));
await client.close();
