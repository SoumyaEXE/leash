# @leash/sdk

TypeScript client for the Leash Solana program. Works in Node and the browser (`@solana/web3.js` v1), no IDL
codegen needed.

```ts
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LeashClient, toBaseUnits } from "@leash/sdk";

const leash = new LeashClient({
  connection: new Connection("https://api.devnet.solana.com", "confirmed"),
  programId: process.env.LEASH_PROGRAM_ID!,
  wallet: agentKeypair,                       // or a wallet adapter for owner actions in the browser
  blinkBaseUrl: "https://your-site.example",   // spend requests get an approve link
});

// The agent asks to pay. The program decides.
const r = await leash.spend({
  vault, payee: merchant, amount: toBaseUnits("0.05"), reason: "SOL market data (x402)",
  expectFailure: true,                         // skipPreflight: refused payments still land onchain
});
if (!r.ok) console.log(r.name, r.friendly.detail, r.explorerUrl); // e.g. PayeeNotAuthorized

// Over the co-sign threshold → owner approves via a Blink
if (!r.ok && r.name === "RequiresCosign") {
  const req = await leash.requestSpend({ vault, payee: merchant, amount: toBaseUnits("0.25"), reason: "research" });
  if (req.ok) console.log("approve at", req.blinkUrl);
}

// Owner side (wallet adapter): unsigned tx for Phantom or a Solana Action
const tx = await leash.buildOwnerTx(owner, { type: "approveRequest", vault, request });

// Live feed, including blocked (failed) transactions, with the agent's reason from the SPL Memo
const stop = leash.onActivity(vault, (e) => console.log(e.kind, e.errorName ?? "", e.reason ?? ""));
```

| | |
|---|---|
| PDAs | `vaultPda`, `payeePda`, `mandatePda`, `requestPda` |
| Reads | `getVault` (with token balance), `listPayees`, `listMandates`, `listRequests`, `getRequest` |
| Agent | `spend({ mode: "strict" \| "guarded" })`, `requestSpend`, `redeemSignedMandate`, `buildSpendTxForFeePayer` (x402 facilitator pays fees) |
| Owner | `initializeVault`, `ownerAction(action)`, `buildOwnerTx(owner, action)` |
| Events | `onActivity` (logs subscription + polling fallback), `recentActivity`, `parseLeashEvents(logs, programId)` |
| Helpers | `friendlyError`, `reasonHash`, `explorerTx`, `toBaseUnits` / `fromBaseUnits`, `buildMandateMessage` |

Error names match `programs/leash/src/errors.rs` (codes 6000+); see `src/errors.ts`.
