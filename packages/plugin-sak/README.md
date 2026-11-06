# @leash/plugin-sak

Solana Agent Kit plugin: the agent keeps its other abilities, but its only way to move money is a Leash vault.
Built against `solana-agent-kit` **2.0.10** (pinned peer dependency).

```ts
import { KeypairWallet, SolanaAgentKit } from "solana-agent-kit";
import { createLeashPlugin, withoutRawTransfer } from "@leash/plugin-sak";

const agent = new SolanaAgentKit(new KeypairWallet(agentKeypair, rpcUrl), rpcUrl, {}).use(
  createLeashPlugin({
    programId: process.env.LEASH_PROGRAM_ID!,
    vault: process.env.LEASH_VAULT!,
    blinkBaseUrl: "https://your-leash-site.example", // approve links for co-sign requests
  }),
);

// If you also load the SAK token plugin, drop its raw TRANSFER action so the model can't bypass the vault.
const actions = withoutRawTransfer(agent.actions);
```

| Action | What it does |
|---|---|
| `LEASH_PAY` | Pay an owner-approved payee. Refusals come back as `{ status: "blocked_onchain", error: "PayeeNotAuthorized", explorer }`; amounts at or above the co-sign threshold become a pending request with an `approveUrl` |
| `LEASH_REQUEST` | Create a pending payment for the owner to approve via a Blink. Nothing moves until they sign |
| `LEASH_BALANCE` | Vault balance, paused flag, what's left in the current 24h window, payees and their remaining budgets |

The plugin also exposes `methods.leashPay(agent, payee, amount, reason)`. Refused payments are sent with
`skipPreflight`, so the failed transaction (and its named error) is onchain. The `reason` is published as an SPL Memo:
don't put secrets in it.

Example against devnet (needs `keys/agent.json` and the `.env` written by `pnpm setup:devnet`):

```bash
pnpm --filter @leash/plugin-sak example   # pays the market-data API, then tries an injected payment (blocked)
```
