/** The seeded demo state (prompts A2 / docs/07 "Recording-ready checklist"). setup and reset both target it. */
import { toBaseUnits, type Policy } from "@leash/sdk";

export const VICTIM_BALANCE = toBaseUnits("1000");

/**
 * Vault ids are 1, 2, 3 plus LEASH_VAULT_ID_OFFSET from .env (default 0). The rolling-window program changed the
 * Vault layout, so vaults made by the first deployed program can't be loaded any more; setup-devnet.ts moves the
 * offset past them (and saves it) instead of trying to reuse those addresses.
 */
export function vaultIdOffset(): bigint {
  const raw = process.env.LEASH_VAULT_ID_OFFSET?.trim();
  if (!raw) return 0n;
  if (!/^\d+$/.test(raw)) throw new Error(`LEASH_VAULT_ID_OFFSET must be a non-negative integer, got "${raw}"`);
  return BigInt(raw);
}

/** Policy shared by the demo vaults. */
const BASE_POLICY = {
  perTxCap: toBaseUnits("1.00"),
  dailyCap: toBaseUnits("5.00"),
  cosignThreshold: toBaseUnits("0.20"),
  requestTtlSecs: 3600,
  freezeAfterStrikes: 0,
  // T9 aggregate co-sign: off for the live demo (S4 makes two small autonomous payments). ~1.00 shows it off.
  cosignWindowThreshold: 0n,
  enforceTripwire: false,
} satisfies Policy;

/**
 * Demo vault: the split-screen /demo and S4 legit work. enforceTripwire stays OFF: S1 relies on agent_spend
 * reverting, so the failed tx (PayeeNotAuthorized) is visible in the explorer.
 */
export const DEMO_VAULT = {
  baseId: 1n,
  get id(): bigint {
    return this.baseId + vaultIdOffset();
  },
  balance: toBaseUnits("1000"),
  policy: BASE_POLICY,
};

/**
 * Arena bounty vault: guarded_spend, never freezes (must stay open to new players). enforceTripwire ON, so even
 * a caller holding the agent key can't skip the record by using agent_spend.
 */
export const ARENA_VAULT = {
  baseId: 2n,
  get id(): bigint {
    return this.baseId + vaultIdOffset();
  },
  balance: toBaseUnits("10000"),
  policy: { ...BASE_POLICY, freezeAfterStrikes: 0, enforceTripwire: true } satisfies Policy,
};

/** Tripwire demo vault: auto-freezes after 3 strikes (unauthorized attempts) in 24h, on every spend path. */
export const TRIPWIRE_VAULT = {
  baseId: 3n,
  get id(): bigint {
    return this.baseId + vaultIdOffset();
  },
  balance: toBaseUnits("100"),
  policy: { ...BASE_POLICY, freezeAfterStrikes: 3, enforceTripwire: true } satisfies Policy,
};

export const PAYEES = [
  { key: "merchant" as const, label: "Market Data API", perTxMax: toBaseUnits("0.50"), budgetTotal: toBaseUnits("5.00") },
  { key: "research" as const, label: "Research API", perTxMax: toBaseUnits("0.50"), budgetTotal: toBaseUnits("5.00") },
];

/** SOL the owner hands to the other wallets for fees. */
export const FEE_SOL = { agent: 0.3, victim: 0.1, attacker: 0.02 };

/** True when the vault runs exactly this policy. */
export function samePolicy(a: Policy, b: Policy): boolean {
  return (
    a.perTxCap === b.perTxCap &&
    a.dailyCap === b.dailyCap &&
    a.cosignThreshold === b.cosignThreshold &&
    a.requestTtlSecs === b.requestTtlSecs &&
    a.freezeAfterStrikes === b.freezeAfterStrikes &&
    a.cosignWindowThreshold === b.cosignWindowThreshold &&
    a.enforceTripwire === b.enforceTripwire
  );
}
