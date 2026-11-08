# Leash SDK (`@soumyaexe/leash-sdk`)

TypeScript client for the Leash Solana program. Works in Node and the browser (`@solana/web3.js` v1), no IDL
codegen needed.

Published on npm as @soumyaexe/leash-sdk; inside this monorepo the workspace package is @leash/sdk.
(`@leash` on npm is an unrelated company's scope: `npm i @leash/sdk` installs *their* package, not this one.)

```bash
pnpm add @soumyaexe/leash-sdk        # or: npm i @soumyaexe/leash-sdk
```

```ts
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LeashClient, toBaseUnits } from "@soumyaexe/leash-sdk";

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

### Signed mandates (owner signs readable text, agent redeems)

The owner signs a plain-text message with the wallet's `signMessage` (no transaction, no SOL). The program
rebuilds the exact same bytes from the redeem instruction and its accounts, so what the wallet shows is what is
enforced. The message names the program, cluster, vault (and when it was opened), payee, mint, amounts, expiry,
nonce and intent, so it can't be replayed on another cluster, program or re-opened vault.

```ts
import { encodeSignedMandate, mandateContextFor, mandateMessageText, signMandate, toBaseUnits } from "@soumyaexe/leash-sdk";

// owner, in the browser
const v = await leash.getVault(vault);
const ctx = mandateContextFor(v, leash.programId, "devnet");
const terms = {
  payee: newApi, maxTotal: toBaseUnits("2.00"), maxPerTx: toBaseUnits("0.50"),
  expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400,
  nonce: v.mandateSeq,                          // single use; bumpMandateSeq cancels unredeemed ones
  intent: "Weekly wallet-flow reports",         // 1-100 printable ASCII
};
console.log(mandateMessageText(ctx, terms));    // exactly what Phantom will show
const json = encodeSignedMandate(await signMandate(wallet, ctx, terms)); // { publicKey, signMessage }

// agent, with its own key: [Ed25519 verify, redeem_signed_mandate] in one tx
const r = await agentLeash.redeemSignedMandate(json);
if (r.ok) console.log("mandate", r.mandate.toBase58(), r.explorerUrl);
```

### What changed with the rolling-window program

- `getVault` returns `spent24h` / `autonomous24h` (rolling 24h from hourly buckets), `createdAt`,
  `enforceTripwire`, `cosignWindowThreshold`, `openRequests`... `windowStart` / `spentInWindow` are kept as
  deprecated aliases (`spentInWindow === spent24h`).
- `Policy` has two required fields, `cosignWindowThreshold` and `enforceTripwire`. Use `policyOf(vault)` to
  change one field without resetting the others.
- Spend requests are closed when approved, rejected or closed after expiry. `listRequests` lists open ones;
  `getRequest` still answers `approved` / `rejected` / `expired` for closed ones (from history, `closed: true`).
- Guarded spends keep preflight on. A guarded refusal succeeds in simulation and lands with `PaymentBlocked`;
  the result carries `strike` (unauthorized attempt) or not (cap / budget / expiry).
- The activity feed only counts a failure when a top-level Leash payment instruction for *this* vault failed with
  a Leash error code, and only shows events emitted by the Leash program for this vault.

| | |
|---|---|
| PDAs | `vaultPda`, `payeePda`, `mandatePda`, `requestPda` |
| Reads | `getVault` (with token balance and rolling 24h sums), `listPayees`, `listMandates`, `listRequests` (open), `getRequest` (open or closed), `resolveAuthorization(vault, payee, mandate?, amount?)` |
| Agent | `spend({ mode: "strict" | "guarded" })`, `requestSpend` (closes expired requests when all 8 slots are taken), `redeemSignedMandate`, `closeExpiredRequests`, `buildSpendTxForFeePayer` (x402 facilitator pays fees) |
| Owner | `initializeVault`, `ownerAction(action)`, `buildOwnerTx(owner, action)`; actions include `bumpMandateSeq`, `closeMandate`, `closeRequest`, `closeVault` |
| Mandates | `mandateMessageText` / `buildMandateMessage`, `signMandate`, `encodeSignedMandate` / `decodeSignedMandate`, `mandateTermsError` |
| Events | `onActivity` (logs subscription + polling fallback), `recentActivity`, `activityFromTransaction`, `parseLeashEvents(logs, programId)` |
| Helpers | `friendlyError`, `parseLeashErrorFromLogs(logs, programId)`, `reasonHash`, `explorerTx`, `toBaseUnits` / `fromBaseUnits`, `policyOf`, `rollingSum` |

Error names match `programs/leash/src/errors.rs` (codes 6000-6032); see `src/errors.ts`.

Security notes (details and open items in the root `SECURITY.md`):

- `reason` is published in plaintext as an SPL Memo (`leash:reason:…`, max 180 chars), even on refused payments.
  Only its sha256 is used by the program. Don't put secrets in it.
- Off-chain checks here are UX: the program re-checks everything. `resolveAuthorization` picks the payee entry if it
  fits the amount, else a live mandate that fits (soonest expiry first); exhausted, revoked and expired mandates are
  skipped.
- The activity feed counts a failure as "blocked" only when the runtime reports a Leash error on a top-level Leash
  payment instruction whose vault account is this vault, and it reads events only from the Leash frame for this
  vault. A forged log line, or another program returning the same code, is ignored. Reason text is still written by
  the agent, so show it as untrusted.

## Tests

```
pnpm --filter @leash/sdk test
```

83 tests, `node:test` via tsx. `test/idl.test.ts` checks every discriminator, account meta, instruction arg, account
and event layout against `src/idl/leash.json` (copied from `anchor build` by `pnpm sdk:sync-idl`) using an
independent IDL-driven codec. `test/mandate.test.ts` uses the program's own message vectors. `test/client.test.ts`
runs the client against an in-memory connection; there are no LiteSVM/Surfpool integration tests yet. CI
(`.github/workflows/ci.yml`) also fails if the committed IDL differs from what the program builds; the workflow runs
on every push and is green.

The IDL in `src/idl/` is the v2 program's, which is the one deployed on devnet since Nov 7. Vaults created by the v1
program (204 bytes, `LEGACY_VAULT_ACCOUNT_SIZE`) can't be loaded: `isLegacyVaultAccount` detects them and
`decodeVault` throws a clear error. Create a new vault (new `vault_id`) instead.
