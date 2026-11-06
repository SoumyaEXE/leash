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
    detail: "This payment would push the vault past its rolling 24-hour limit.",
  },
  RequiresCosign: {
    title: "Needs the owner's approval",
    detail: "Payments this large need a live co-signature from the owner (via a Blink).",
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
    detail: "The mandate wasn't signed by the vault owner over these exact terms.",
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
};

export function friendlyError(name: string): FriendlyError {
  if ((LEASH_ERROR_NAMES as readonly string[]).includes(name)) {
    return FRIENDLY[name as LeashErrorName];
  }
  return { title: "Transaction failed", detail: name };
}

/** Find a Leash error in program logs ("... Error Code: PayeeNotAuthorized. Error Number: 6004 ..."). */
export function parseLeashErrorFromLogs(
  logs: readonly string[] | null | undefined,
): { name: string; code?: number; message?: string } | undefined {
  if (!logs) return undefined;
  for (const line of logs) {
    const m = line.match(/Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/);
    if (m) return { name: m[1], code: Number(m[2]), message: m[3] };
  }
  for (const line of logs) {
    const m = line.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (m) {
      const code = parseInt(m[1], 16);
      const name = errorNameFromCode(code);
      if (name) return { name, code };
      return { name: `Custom(${code})`, code };
    }
  }
  return undefined;
}
