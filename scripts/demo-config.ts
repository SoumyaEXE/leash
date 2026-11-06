/** The seeded demo state (prompts A2 / docs/07 "Recording-ready checklist"). setup and reset both target it. */
import { toBaseUnits, type Policy } from "@leash/sdk";

export const VICTIM_BALANCE = toBaseUnits("1000");

/** Demo vault: the split-screen /demo and S4 legit work. */
export const DEMO_VAULT = {
  id: 1n,
  balance: toBaseUnits("1000"),
  policy: {
    perTxCap: toBaseUnits("1.00"),
    dailyCap: toBaseUnits("5.00"),
    cosignThreshold: toBaseUnits("0.20"),
    requestTtlSecs: 3600,
    freezeAfterStrikes: 0,
  } satisfies Policy,
};

/** Arena bounty vault: guarded_spend, never freezes (must stay open to new players). */
export const ARENA_VAULT = {
  id: 2n,
  balance: toBaseUnits("10000"),
  policy: { ...DEMO_VAULT.policy, freezeAfterStrikes: 0 } satisfies Policy,
};

/** Tripwire demo vault: auto-freezes after 3 blocked attempts (shown in /vault). */
export const TRIPWIRE_VAULT = {
  id: 3n,
  balance: toBaseUnits("100"),
  policy: { ...DEMO_VAULT.policy, freezeAfterStrikes: 3 } satisfies Policy,
};

export const PAYEES = [
  { key: "merchant" as const, label: "Market Data API", perTxMax: toBaseUnits("0.50"), budgetTotal: toBaseUnits("5.00") },
  { key: "research" as const, label: "Research API", perTxMax: toBaseUnits("0.50"), budgetTotal: toBaseUnits("5.00") },
];

/** SOL the owner hands to the other wallets for fees. */
export const FEE_SOL = { agent: 0.3, victim: 0.1, attacker: 0.02 };
