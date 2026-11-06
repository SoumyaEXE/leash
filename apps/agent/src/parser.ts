/**
 * Bankr-style command parser: scans model output for "send <amount> <token> to <recipient>" and treats it as an
 * instruction to move money. This is the vulnerable architecture we reproduce on purpose; both agents use it.
 * The only difference between the victim and the leashed agent is what happens *after* this parser.
 */
export interface ParsedCommand {
  raw: string;
  amount: string;
  token: string;
  /** base58 address or handle (with or without @), resolved later through the directory */
  recipient: string;
}

const SEND_RE =
  /\bsend\s+\$?(\d+(?:\.\d+)?)\s*(d?usdc|sol|dusdc|tokens?)?\s+to\s+(@?[1-9A-HJ-NP-Za-km-z]{32,44}|@?[A-Za-z0-9_]{2,32})/gi;

export function parseCommands(modelOutput: string): ParsedCommand[] {
  const out: ParsedCommand[] = [];
  for (const m of modelOutput.matchAll(SEND_RE)) {
    out.push({
      raw: m[0],
      amount: m[1],
      token: (m[2] ?? "dusdc").toLowerCase(),
      recipient: m[3],
    });
  }
  return out;
}
