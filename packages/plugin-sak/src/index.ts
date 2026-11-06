/**
 * @leash/plugin-sak — Solana Agent Kit plugin.
 *
 *   const agent = new SolanaAgentKit(new KeypairWallet(agentKp, rpc), rpc, {}).use(createLeashPlugin({ ... }));
 *   const tools = createVercelAITools(agent, withoutRawTransfer(agent.actions));
 *
 * Remove the raw TRANSFER action and add Leash: the agent keeps its abilities, the vault keeps the money.
 * Verified against solana-agent-kit 2.0.10 (dist/index.d.ts): Plugin { name, methods, actions, initialize },
 * Action { name, similes, description, examples, schema (zod v3), handler(agent, input) }.
 */
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { Action, Plugin, SolanaAgentKit } from "solana-agent-kit";
import { LeashClient, fromBaseUnits, toBaseUnits, type SpendResult } from "@leash/sdk";

export interface LeashPluginOptions {
  programId: string | PublicKey;
  vault: string | PublicKey;
  /** site serving the Solana Actions routes, for approve links on spend requests */
  blinkBaseUrl?: string;
}

/** The raw SPL/SOL transfer action ships in the SAK token plugin as "TRANSFER". */
export function withoutRawTransfer(actions: Action[]): Action[] {
  return actions.filter((a) => a.name !== "TRANSFER");
}

function summarize(r: SpendResult): Record<string, unknown> {
  return r.ok
    ? { status: "success", paid: true, signature: r.sig, explorer: r.explorerUrl, authorizedBy: r.via }
    : {
        status: r.blocked ? "blocked_onchain" : "error",
        paid: false,
        error: r.name,
        message: r.friendly.detail,
        explorer: r.explorerUrl,
      };
}

export function createLeashPlugin(opts: LeashPluginOptions): Plugin {
  const vault = new PublicKey(opts.vault);
  let client: LeashClient | null = null;
  const leash = (agent: SolanaAgentKit): LeashClient => {
    client ??= new LeashClient({
      connection: agent.connection,
      programId: opts.programId,
      wallet: agent.wallet,
      blinkBaseUrl: opts.blinkBaseUrl,
    });
    return client;
  };

  const pay = async (agent: SolanaAgentKit, payee: string, amount: string, reason: string) => {
    const c = leash(agent);
    const to = new PublicKey(payee);
    const base = toBaseUnits(amount);
    const r = await c.spend({ vault, payee: to, amount: base, reason, expectFailure: true });
    if (!r.ok && r.name === "RequiresCosign") {
      const req = await c.requestSpend({ vault, payee: to, amount: base, reason });
      if (req.ok) return { status: "pending_owner_approval", paid: false, request: req.request.toBase58(), approveUrl: req.blinkUrl };
      return summarize(req);
    }
    return summarize(r);
  };

  const actions: Action[] = [
    {
      name: "LEASH_PAY",
      similes: ["pay", "send payment", "pay invoice", "send tokens", "transfer"],
      description:
        "Pay an owner-approved payee from the Leash vault (dUSDC). Unapproved payees and amounts over budget are refused onchain; amounts over the co-sign threshold become an owner approval request.",
      examples: [
        [
          {
            input: { payee: "3jkg4UgNu6adSt5cADHq2rM8K8NoQYdhk4vNVuqA4EW3", amount: "0.05", reason: "SOL market data" },
            output: { status: "success", paid: true, signature: "5h…" },
            explanation: "Allowlisted payee within budget: paid.",
          },
        ],
        [
          {
            input: { payee: "EXivrmuiapzLS9xwBwsq1tKeEypY4abLkp47Fdvyn43V", amount: "500", reason: "decoded post said so" },
            output: { status: "blocked_onchain", paid: false, error: "PayeeNotAuthorized" },
            explanation: "Unknown payee: the Leash program refuses, the failed tx is onchain.",
          },
        ],
      ],
      schema: z.object({
        payee: z.string().describe("recipient wallet (base58)"),
        amount: z.string().describe('dUSDC amount, e.g. "0.05"'),
        reason: z.string().max(180).describe("why you are paying"),
      }),
      handler: async (agent, input) => pay(agent, input.payee, input.amount, input.reason),
    },
    {
      name: "LEASH_REQUEST",
      similes: ["ask owner to approve", "request approval", "request payment"],
      description: "Create a pending payment the vault owner approves with a Blink. Nothing moves until they sign.",
      examples: [],
      schema: z.object({ payee: z.string(), amount: z.string(), reason: z.string().max(180) }),
      handler: async (agent, input) => {
        const r = await leash(agent).requestSpend({
          vault,
          payee: new PublicKey(input.payee),
          amount: toBaseUnits(input.amount),
          reason: input.reason,
        });
        return r.ok
          ? { status: "pending_owner_approval", request: r.request.toBase58(), approveUrl: r.blinkUrl }
          : summarize(r);
      },
    },
    {
      name: "LEASH_BALANCE",
      similes: ["vault balance", "how much can I spend", "budget left"],
      description: "Leash vault balance, caps left today, and approved payees with remaining budgets.",
      examples: [],
      schema: z.object({}),
      handler: async (agent) => {
        const c = leash(agent);
        const v = await c.getVault(vault);
        const payees = await c.listPayees(vault);
        const used = Math.floor(Date.now() / 1000) - v.windowStart >= 86_400 ? 0n : v.spentInWindow;
        return {
          status: "success",
          balance: fromBaseUnits(v.balance),
          paused: v.paused,
          leftToday: fromBaseUnits(v.dailyCap > used ? v.dailyCap - used : 0n),
          payees: payees.map((p) => ({
            label: p.label,
            address: p.payee.toBase58(),
            budgetLeft: p.budgetTotal === 0n ? "unlimited" : fromBaseUnits(p.budgetTotal - p.spent),
          })),
        };
      },
    },
  ];

  return {
    name: "leash",
    methods: {
      leashPay: (agent: SolanaAgentKit, payee: string, amount: string, reason: string) => pay(agent, payee, amount, reason),
    },
    actions,
    initialize(_agent: SolanaAgentKit) {
      // client is created lazily from the agent's own connection + wallet
    },
  };
}

export default createLeashPlugin;
