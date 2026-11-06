/**
 * Leash program errors. The order here MUST match `LeashError` in programs/leash/src/errors.rs:
 * Anchor assigns codes 6000, 6001, ... in declaration order. Append only; never reorder.
 */
export const LEASH_ERROR_NAMES = [
  "NotAgent", // 6000
  "VaultPaused", // 6001
  "ZeroAmount", // 6002
  "RecipientMismatch", // 6003
  "PayeeNotAuthorized", // 6004
  "ExceedsPayeePerTx", // 6005
  "PayeeBudgetExceeded", // 6006
  "MandateExpired", // 6007
  "MandateRevoked", // 6008
  "MandateExhausted", // 6009
  "ExceedsPerTxCap", // 6010
  "ExceedsDailyCap", // 6011
  "RequiresCosign", // 6012
  "RequestNotPending", // 6013
  "RequestExpired", // 6014
  "InvalidMandateSignature", // 6015
  "Overflow", // 6016
  "NotOwner", // 6017
  "InvalidPolicy", // 6018
  "LabelTooLong", // 6019
  "InsufficientFunds", // 6020
  "InvalidMandateTerms", // 6021
  // appended with the path-to-10 program (T1-T13)
  "AgentIsOwner", // 6022
  "UnsupportedMint", // 6023
  "TooManyOpenRequests", // 6024
  "RequestNotExpired", // 6025
  "RequestVaultMismatch", // 6026
  "VaultNotEmpty", // 6027
  "VaultHasOpenAccounts", // 6028
  "StaleMandateNonce", // 6029
  "InvalidIntent", // 6030
  "MandateSeqNotIncreasing", // 6031
  "VaultJustOpened", // 6032
] as const;

export type LeashErrorName = (typeof LEASH_ERROR_NAMES)[number];

export const LEASH_ERROR_OFFSET = 6000;

export function errorCode(name: LeashErrorName): number {
  return LEASH_ERROR_OFFSET + LEASH_ERROR_NAMES.indexOf(name);
}

export function errorNameFromCode(code: number): LeashErrorName | undefined {
  return LEASH_ERROR_NAMES[code - LEASH_ERROR_OFFSET];
}

export interface FriendlyError {
  title: string;
  detail: string;
}

const FRIENDLY: Record<LeashErrorName, FriendlyError> = {
  NotAgent: {
    title: "Wrong signer",
    detail: "Only this vault's agent key can request payments from it.",
  },
  VaultPaused: {
    title: "Vault is paused",
    detail: "The owner hit the kill switch. Nothing leaves the vault until they unpause it.",
  },
  ZeroAmount: {
    title: "Nothing to send",
    detail: "A payment must be greater than zero.",
  },
  RecipientMismatch: {
    title: "Recipient doesn't match",
    detail: "The receiving token account isn't owned by the authorized payee, or holds a different token.",
  },
  PayeeNotAuthorized: {
    title: "Payee not approved by the owner",
    detail: "This address isn't on the owner's allowlist and no signed mandate covers it. The agent can ask; only the owner can authorize.",
  },
  ExceedsPayeePerTx: {
    title: "Too much for this payee",
    detail: "The amount is above the per-payment limit the owner set for this service.",
  },
  PayeeBudgetExceeded: {
    title: "Service budget used up",
    detail: "This payee's budget is spent. The owner has to raise it before the agent can pay again.",
  },
  MandateExpired: {
    title: "Mandate expired",
    detail: "The owner's signed permission for this payee has run out.",
  },
  MandateRevoked: {
    title: "Mandate revoked",
    detail: "The owner withdrew this permission.",
  },
  MandateExhausted: {
    title: "Mandate used up",
    detail: "The total the owner approved for this purpose has been spent.",
  },
  ExceedsPerTxCap: {
    title: "Over the per-payment cap",
    detail: "No single payment from this vault can be this large.",
  },
  ExceedsDailyCap: {
    title: "Over the 24h cap",
    detail: "This payment would push what left the vault in the last 24 hours past the owner's limit.",
  },
  RequiresCosign: {
    title: "Needs the owner's approval",
    detail:
      "This payment, or the agent's unapproved spending over the last 24 hours, reaches the co-sign threshold. The owner has to approve it (via a Blink).",
  },
  RequestNotPending: {
    title: "Already resolved",
    detail: "This spend request was already approved, rejected or expired.",
  },
  RequestExpired: {
    title: "Request expired",
    detail: "The owner didn't approve this request in time.",
  },
  InvalidMandateSignature: {
    title: "Bad mandate signature",
    detail:
      "The mandate wasn't signed by the vault owner over this exact message (program, cluster, vault, payee, amounts, expiry, nonce, intent).",
  },
  Overflow: {
    title: "Arithmetic overflow",
    detail: "A counter would overflow. The payment was refused.",
  },
  NotOwner: {
    title: "Owner only",
    detail: "Only the vault owner can change policy, payees, mandates or approve requests.",
  },
  InvalidPolicy: {
    title: "Invalid policy",
    detail: "Caps must be positive and the 24h cap can't be below the per-payment cap.",
  },
  LabelTooLong: {
    title: "Label too long",
    detail: "Payee labels are limited to 32 bytes.",
  },
  InsufficientFunds: {
    title: "Vault balance too low",
    detail: "The vault doesn't hold enough tokens for this payment.",
  },
  InvalidMandateTerms: {
    title: "Invalid mandate terms",
    detail: "Mandate limits must be positive and its expiry must be in the future.",
  },
  AgentIsOwner: {
    title: "Agent can't be the owner",
    detail: "The agent key must be different from the owner key, or the agent could approve its own payments.",
  },
  UnsupportedMint: {
    title: "Token not supported",
    detail:
      "This mint uses a Token-2022 feature Leash can't enforce safely (fees, hooks, permanent delegate, pausing...) or has more than 18 decimals.",
  },
  TooManyOpenRequests: {
    title: "Too many open requests",
    detail: "The vault already has 8 open co-sign requests. One has to be approved, rejected or closed (once expired) first.",
  },
  RequestNotExpired: {
    title: "Request still open",
    detail: "Only an expired spend request can be closed by anyone. This one can still be approved or rejected.",
  },
  RequestVaultMismatch: {
    title: "Request from another vault",
    detail: "This spend request belongs to a different vault.",
  },
  VaultNotEmpty: {
    title: "Vault still holds tokens",
    detail: "Withdraw the vault's balance before closing it.",
  },
  VaultHasOpenAccounts: {
    title: "Vault has open accounts",
    detail: "Remove its payees and close its mandates and open requests before closing the vault.",
  },
  StaleMandateNonce: {
    title: "Mandate signature already used",
    detail:
      "This signed mandate was already redeemed or cancelled: its nonce isn't the vault's current mandate sequence. The owner has to sign a new one.",
  },
  InvalidIntent: {
    title: "Invalid mandate intent",
    detail: "The intent must be 1-100 printable ASCII characters (no newlines, emoji or accents).",
  },
  MandateSeqNotIncreasing: {
    title: "Nonce can only go up",
    detail: "The new mandate sequence must be greater than the current one.",
  },
  VaultJustOpened: {
    title: "Vault just opened",
    detail: "A vault can't be closed in the same second it was opened. Try again in a moment.",
  },
};

export function friendlyError(name: string): FriendlyError {
  if ((LEASH_ERROR_NAMES as readonly string[]).includes(name)) {
    return FRIENDLY[name as LeashErrorName];
  }
  return { title: "Transaction failed", detail: name };
}

const ANCHOR_ERROR_RE = /^Program log: AnchorError.*Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/;
const LEGACY_ERROR_RE = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/;
const INVOKE_LINE = /^Program (\w+) invoke \[\d+\]$/;
const EXIT_LINE = /^Program (\w+) (success|failed)/;
const FAILED_CUSTOM = /^Program (\w+) failed: custom program error: 0x([0-9a-fA-F]+)$/;

/**
 * Find a Leash error in program logs ("... Error Code: PayeeNotAuthorized. Error Number: 6004 ...").
 *
 * Pass `programId` (recommended): then only an AnchorError line logged while the Leash program is the innermost
 * running program counts, plus the runtime's own `Program <leash> failed: custom program error` line. Any program
 * can `msg!` a fake "Error Code: PayeeNotAuthorized" line, but no program can write the runtime's invoke/failed
 * lines. Without `programId` any matching line counts (old behaviour).
 */
export function parseLeashErrorFromLogs(
  logs: readonly string[] | null | undefined,
  programId?: { toString(): string },
): { name: string; code?: number; message?: string } | undefined {
  if (!logs) return undefined;
  if (!programId) {
    for (const line of logs) {
      const m = line.match(LEGACY_ERROR_RE);
      if (m) return { name: m[1], code: Number(m[2]), message: m[3] };
    }
    for (const line of logs) {
      const m = line.match(/custom program error: 0x([0-9a-fA-F]+)/);
      if (m) {
        const code = parseInt(m[1], 16);
        return { name: errorNameFromCode(code) ?? `Custom(${code})`, code };
      }
    }
    return undefined;
  }
  const pid = programId.toString();
  const stack: string[] = [];
  let anchor: { name: string; code: number; message: string } | undefined;
  for (const line of logs) {
    const failed = line.match(FAILED_CUSTOM);
    if (failed && failed[1] === pid) {
      const code = parseInt(failed[2], 16);
      const name = errorNameFromCode(code);
      // The runtime line is authoritative; the AnchorError line (same frame) only adds the message.
      if (anchor && anchor.code === code) return anchor;
      return { name: name ?? `Custom(${code})`, code, message: undefined };
    }
    const invoke = line.match(INVOKE_LINE);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (EXIT_LINE.test(line)) {
      stack.pop();
      continue;
    }
    if (stack[stack.length - 1] === pid) {
      const m = line.match(ANCHOR_ERROR_RE);
      if (m) anchor = { name: m[1], code: Number(m[2]), message: m[3] };
    }
  }
  // Simulation logs can end before the runtime's failed line (or be truncated): trust an in-frame AnchorError
  // only if its number really is a Leash error with that name.
  if (anchor && errorNameFromCode(anchor.code) === anchor.name) return anchor;
  return undefined;
}
