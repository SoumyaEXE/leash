/** Instruction builders for every Leash instruction. Account order = field order of the Rust Accounts structs. */
import {
  type AccountMeta,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { IX, ixData, writePolicy, type MandateTermsArgs, encodeMandateTerms } from "./layout";
import type { Policy } from "./types";

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });
/** Anchor optional account: `None` is encoded as the program id in that slot. */
const opt = (programId: PublicKey, pk: PublicKey | null | undefined, writable: boolean): AccountMeta =>
  pk ? { pubkey: pk, isSigner: false, isWritable: writable } : r(programId);

function ix(programId: PublicKey, keys: AccountMeta[], data: Buffer): TransactionInstruction {
  return new TransactionInstruction({ programId, keys, data });
}

export function initializeVaultIx(
  programId: PublicKey,
  a: { owner: PublicKey; vault: PublicKey; mint: PublicKey; vaultAta: PublicKey; tokenProgram: PublicKey },
  args: { vaultId: bigint; agent: PublicKey; policy: Policy },
): TransactionInstruction {
  return ix(
    programId,
    [
      w(a.owner, true),
      w(a.vault),
      r(a.mint),
      w(a.vaultAta),
      r(a.tokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    ixData(IX.initializeVault, (wr) => writePolicy(wr.u64(args.vaultId).pubkey(args.agent), args.policy)),
  );
}

function ownerVaultIx(programId: PublicKey, owner: PublicKey, vault: PublicKey, data: Buffer): TransactionInstruction {
  return ix(programId, [r(owner, true), w(vault)], data);
}

export const updatePolicyIx = (programId: PublicKey, owner: PublicKey, vault: PublicKey, policy: Policy) =>
  ownerVaultIx(programId, owner, vault, ixData(IX.updatePolicy, (wr) => writePolicy(wr, policy)));

export const setAgentIx = (programId: PublicKey, owner: PublicKey, vault: PublicKey, agent: PublicKey) =>
  ownerVaultIx(programId, owner, vault, ixData(IX.setAgent, (wr) => wr.pubkey(agent)));

export const setPausedIx = (programId: PublicKey, owner: PublicKey, vault: PublicKey, paused: boolean) =>
  ownerVaultIx(programId, owner, vault, ixData(IX.setPaused, (wr) => wr.bool(paused)));

export const resetStrikesIx = (programId: PublicKey, owner: PublicKey, vault: PublicKey) =>
  ownerVaultIx(programId, owner, vault, ixData(IX.resetStrikes));

export function addPayeeIx(
  programId: PublicKey,
  a: { owner: PublicKey; vault: PublicKey; payeeAccount: PublicKey },
  args: { payee: PublicKey; label: string; perTxMax: bigint; budgetTotal: bigint },
): TransactionInstruction {
  return ix(
    programId,
    [w(a.owner, true), r(a.vault), w(a.payeeAccount), r(SystemProgram.programId)],
    ixData(IX.addPayee, (wr) => wr.pubkey(args.payee).string(args.label).u64(args.perTxMax).u64(args.budgetTotal)),
  );
}

export function updatePayeeIx(
  programId: PublicKey,
  a: { owner: PublicKey; vault: PublicKey; payeeAccount: PublicKey },
  args: { perTxMax: bigint; budgetTotal: bigint; active: boolean },
): TransactionInstruction {
  return ix(
    programId,
    [r(a.owner, true), r(a.vault), w(a.payeeAccount)],
    ixData(IX.updatePayee, (wr) => wr.u64(args.perTxMax).u64(args.budgetTotal).bool(args.active)),
  );
}

export function removePayeeIx(
  programId: PublicKey,
  a: { owner: PublicKey; vault: PublicKey; payeeAccount: PublicKey },
): TransactionInstruction {
  return ix(programId, [w(a.owner, true), r(a.vault), w(a.payeeAccount)], ixData(IX.removePayee));
}

export function createMandateIx(
  programId: PublicKey,
  a: { owner: PublicKey; vault: PublicKey; mandate: PublicKey },
  args: { payee: PublicKey; maxTotal: bigint; maxPerTx: bigint; expiresAt: number; intentHash: Uint8Array },
): TransactionInstruction {
  return ix(
    programId,
    [w(a.owner, true), w(a.vault), w(a.mandate), r(SystemProgram.programId)],
    ixData(IX.createMandate, (wr) =>
      wr.pubkey(args.payee).u64(args.maxTotal).u64(args.maxPerTx).i64(args.expiresAt).fixed(args.intentHash, 32),
    ),
  );
}

export function redeemSignedMandateIx(
  programId: PublicKey,
  a: { agent: PublicKey; vault: PublicKey; mandate: PublicKey },
  terms: MandateTermsArgs,
): TransactionInstruction {
  return ix(
    programId,
    [w(a.agent, true), w(a.vault), w(a.mandate), r(SYSVAR_INSTRUCTIONS_PUBKEY), r(SystemProgram.programId)],
    ixData(IX.redeemSignedMandate, (wr) => wr.raw(encodeMandateTerms(terms))),
  );
}

export function revokeMandateIx(
  programId: PublicKey,
  a: { owner: PublicKey; vault: PublicKey; mandate: PublicKey },
): TransactionInstruction {
  return ix(programId, [r(a.owner, true), r(a.vault), w(a.mandate)], ixData(IX.revokeMandate));
}

export interface SpendAccounts {
  agent: PublicKey;
  vault: PublicKey;
  mint: PublicKey;
  vaultAta: PublicKey;
  recipientAta: PublicKey;
  payeeAccount?: PublicKey | null;
  mandateAccount?: PublicKey | null;
  tokenProgram: PublicKey;
}

/** agent_spend (strict) or guarded_spend (tripwire). The agent signs but is not writable: an x402 facilitator can pay fees. */
export function spendIx(
  programId: PublicKey,
  a: SpendAccounts,
  args: { amount: bigint; reasonHash: Uint8Array; memo?: Uint8Array | null },
  guarded = false,
): TransactionInstruction {
  return ix(
    programId,
    [
      r(a.agent, true),
      w(a.vault),
      r(a.mint),
      w(a.vaultAta),
      w(a.recipientAta),
      opt(programId, a.payeeAccount, true),
      opt(programId, a.mandateAccount, true),
      r(a.tokenProgram),
    ],
    ixData(guarded ? IX.guardedSpend : IX.agentSpend, (wr) =>
      wr.u64(args.amount).fixed(args.reasonHash, 32).optionFixed(args.memo ?? null, 32),
    ),
  );
}

export function requestSpendIx(
  programId: PublicKey,
  a: { agent: PublicKey; vault: PublicKey; request: PublicKey; payeeAccount?: PublicKey | null; mandateAccount?: PublicKey | null },
  args: { payee: PublicKey; amount: bigint; reasonHash: Uint8Array; memo?: Uint8Array | null },
): TransactionInstruction {
  return ix(
    programId,
    [
      w(a.agent, true),
      w(a.vault),
      w(a.request),
      opt(programId, a.payeeAccount, false),
      opt(programId, a.mandateAccount, false),
      r(SystemProgram.programId),
    ],
    ixData(IX.requestSpend, (wr) =>
      wr.pubkey(args.payee).u64(args.amount).fixed(args.reasonHash, 32).optionFixed(args.memo ?? null, 32),
    ),
  );
}

export function approveRequestIx(
  programId: PublicKey,
  a: {
    owner: PublicKey;
    vault: PublicKey;
    request: PublicKey;
    mint: PublicKey;
    vaultAta: PublicKey;
    recipientAta: PublicKey;
    payeeAccount?: PublicKey | null;
    mandateAccount?: PublicKey | null;
    tokenProgram: PublicKey;
  },
): TransactionInstruction {
  return ix(
    programId,
    [
      r(a.owner, true),
      w(a.vault),
      w(a.request),
      r(a.mint),
      w(a.vaultAta),
      w(a.recipientAta),
      opt(programId, a.payeeAccount, true),
      opt(programId, a.mandateAccount, true),
      r(a.tokenProgram),
    ],
    ixData(IX.approveRequest),
  );
}

export function rejectRequestIx(
  programId: PublicKey,
  a: { owner: PublicKey; vault: PublicKey; request: PublicKey },
): TransactionInstruction {
  return ix(programId, [r(a.owner, true), r(a.vault), w(a.request)], ixData(IX.rejectRequest));
}

export function withdrawIx(
  programId: PublicKey,
  a: { owner: PublicKey; vault: PublicKey; mint: PublicKey; vaultAta: PublicKey; ownerTokenAccount: PublicKey; tokenProgram: PublicKey },
  amount: bigint,
): TransactionInstruction {
  return ix(
    programId,
    [r(a.owner, true), r(a.vault), r(a.mint), w(a.vaultAta), w(a.ownerTokenAccount), r(a.tokenProgram)],
    ixData(IX.withdraw, (wr) => wr.u64(amount)),
  );
}
