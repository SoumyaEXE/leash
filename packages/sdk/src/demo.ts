/**
 * Wire contract between apps/agent (demo runner, HTTP on AGENT_SERVER_PORT) and apps/web (/demo page).
 *
 *   GET  /health                       -> { ok: true }
 *   GET  /balances                     -> DemoBalances
 *   POST /run        { mode, scenario }-> DemoRunResult
 *   POST /run-split  { scenario }      -> { victim: DemoRunResult; leashed: DemoRunResult }
 *   POST /reset                        -> { ok: boolean; log: string[] }
 *
 * Amounts on this wire are UI strings ("500", "0.25"), never base units.
 */
export type DemoMode = "victim" | "leashed";

/** s1 Morse echo (Bankr) · s2 fake memory (FC26) · s4 legit x402 work · s5 hostile 402 (V12) */
export type ScenarioId = "s1" | "s2" | "s4" | "s5";

export interface DemoStep {
  kind: "input" | "model" | "parser" | "http" | "payment" | "info" | "error";
  /** short label shown in the transcript, e.g. "Post (Morse)", "Model output", "Command parser" */
  label: string;
  text: string;
  /** ms since the run started */
  t: number;
}

export interface DemoPayment {
  status: "executed" | "blocked" | "pending_approval" | "failed";
  amount: string;
  /** recipient wallet address */
  to: string;
  toLabel?: string;
  sig?: string;
  explorerUrl?: string;
  /** program error name when blocked, e.g. "PayeeNotAuthorized" */
  errorName?: string;
  friendly?: { title: string; detail: string };
  /** for pending_approval: the Blink / Action URL and the request PDA */
  blinkUrl?: string;
  request?: string;
}

export interface DemoRunResult {
  mode: DemoMode;
  scenario: ScenarioId;
  ok: boolean;
  error?: string;
  steps: DemoStep[];
  payments: DemoPayment[];
  /** raw model output (what the bot's command parser read) */
  modelOutput: string;
  balanceBefore: string;
  balanceAfter: string;
  durationMs: number;
}

export interface DemoWallet {
  label: string;
  address: string;
  tokenAccount: string;
  balance: string;
}

export interface DemoBalances {
  victim: DemoWallet;
  vault: DemoWallet;
  attacker: DemoWallet;
  merchant: DemoWallet;
  mint: string;
  cluster: "devnet";
}

export const SCENARIOS: Record<ScenarioId, { title: string; short: string; incident: string; source: string }> = {
  s1: {
    title: "Morse echo",
    short: "A post hides a transfer command in Morse code. The model decodes it; the bot executes its own output.",
    incident: "Grok × Bankr, May 2026: over $150,000 drained by a hidden Morse-code instruction.",
    source: "https://cointelegraph.com/news/grok-bankr-wallet-free-nft-prompt-injection",
  },
  s2: {
    title: "Fake memory",
    short: "An injected 'owner note' in the agent's memory redirects invoice payments to the attacker.",
    incident: "Princeton × Sentient (FC26): fake memories steer ElizaOS agents into unauthorized transfers.",
    source: "https://arxiv.org/abs/2503.16248",
  },
  s4: {
    title: "Legit work",
    short: "The agent pays two x402 APIs within budget; the bigger call needs the owner's Blink co-sign.",
    incident: "Leash still lets the agent do its job: per-service budgets, per-call payments.",
    source: "https://docs.x402.org",
  },
  s5: {
    title: "Hostile 402",
    short: "A paid API answers 402 demanding the full balance, with payTo swapped to the attacker.",
    incident: "V12, Oct 2026: the default x402 client had no spending limit.",
    source: "https://thehackernews.com/2026/10/critical-x402-sdk-flaw-could-let.html",
  },
};
