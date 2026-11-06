/**
 * The Bankr-style command parser: the bot scans the *model's output* for "send <amount> [dUSDC] [to <recipient>]"
 * and executes it. This is deliberately the vulnerable architecture we demo. On Leash, executing it only *requests*
 * a payment; the Solana program decides.
 */
const BASE58 = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const SEND_RE = new RegExp(
  String.raw`\b(?:send|transfer|pay)\s+(\d+(?:[.,]\d+)?)\s*(?:d?usdc|tokens?)?(?:\s+(?:to|→)\s+(@?[\w.-]+|${BASE58}))?`,
  "i",
);

export interface ParsedCommand {
  amount: string;
  /** base58 address, @handle, or undefined (bot falls back to the requester, like "send to @me") */
  recipient?: string;
  raw: string;
}

export function parseSendCommand(modelOutput: string): ParsedCommand | null {
  const m = modelOutput.match(SEND_RE);
  if (!m) return null;
  const amount = m[1].replace(",", ".");
  if (Number(amount) <= 0) return null;
  return { amount, recipient: m[2]?.replace(/[.,;:!?)"']+$/, ""), raw: m[0] };
}

export function isBase58Address(s: string | undefined): s is string {
  return !!s && new RegExp(`^${BASE58}$`).test(s);
}
