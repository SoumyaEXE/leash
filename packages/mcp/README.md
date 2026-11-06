# @leash/mcp

Give any MCP agent a leashed Solana wallet. The agent can ask to pay; the Leash program decides.

```bash
pnpm --filter @leash/mcp build
claude mcp add leash -- node packages/mcp/dist/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "leash": {
      "command": "node",
      "args": ["/absolute/path/to/leash/packages/mcp/dist/index.js"],
      "env": {
        "SOLANA_RPC_URL": "https://api.devnet.solana.com",
        "LEASH_PROGRAM_ID": "<program id>",
        "LEASH_VAULT": "<vault PDA>",
        "AGENT_KEYPAIR_PATH": "/absolute/path/to/keys/agent.json",
        "NEXT_PUBLIC_SITE_URL": "https://<your Leash web app>"
      }
    }
  }
}
```

| Tool | What it does |
|---|---|
| `leash_balance` | Vault balance, caps left today, approved payees and their budgets |
| `leash_pay` | Pay an approved payee; over the co-sign threshold it becomes an owner approval request |
| `leash_request` | Explicit owner approval request (returns the Blink / Action URL) |
| `leash_pay_for_resource` | x402 v2: fetch → 402 → pay via Leash (`leash` scheme) → retry with `PAYMENT-SIGNATURE` |

Refused payments are **returned**, not thrown: `{ status: "blocked_onchain", error: "PayeeNotAuthorized", why, explorer }`.
The agent key holds only fee SOL; losing it lets an attacker *request* payments, which the vault policy still governs.
