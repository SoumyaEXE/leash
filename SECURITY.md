# Security model

Leash is a hackathon build: **devnet only, not audited.** This page says what the program enforces today, what it
does not, how to reduce what's left, and which known issues are still open. Everything below describes the code on
`main` and the deployed devnet program
[`Cck8fp…`](https://explorer.solana.com/address/Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe?cluster=devnet), which
runs **v2** since the in-place upgrade on Nov 7, 2026, 00:43 IST
([deploy tx](https://explorer.solana.com/tx/yJACR6xj6ojU9yz5UCUyu6tSytUpgru4MkAg7CMUNpFK4eK4t9Dq94bTAqLj8adFJHBKef1SRXz9nNXuBLSDywT?cluster=devnet),
slot 519400635).

**Reporting:** please report a vulnerability privately to the maintainers (a GitHub security advisory on this
repository), not in a public issue. Only test against vaults you own, on devnet.

## Trust model

| Actor | Trusted for | Notes |
|---|---|---|
| **Owner** (human wallet) | everything: policy, payees, mandates, approvals, withdrawals, pause | Root of trust. Every release path traces back to an owner signature. |
| **Agent key** | nothing on its own | Can *request* payments (`agent_spend`, `guarded_spend`, `request_spend`, `redeem_signed_mandate`). Holds only fee SOL. Can never be the owner key (`AgentIsOwner`). |
| **Model output** | nothing | Treated as untrusted input, like the web pages, posts and memories it reads. |
| **Allowlisted payee** (e.g. an x402 API) | up to its per-payment max and budget | It can still ask for more; the program refuses. |
| **Leash program** | enforcement | The only place a rule counts. Off-chain checks are UX. |
| **Off-chain services** (agent server, x402 servers, web app, RPC proxy) | demo plumbing | Demo-grade, hardened on Nov 7 (see the off-chain items below). Rate limits are in memory per process. |
| **Program upgrade authority** | the code itself | Still a single owner key (open item T12). Whoever holds it can change every rule on this page. |

## What Leash stops

Each row is checked by the program, so it holds no matter what the model says or which client sends the tx.

| Attack | What happens onchain | Error |
|---|---|---|
| Injected "send X to attacker" (Bankr Morse echo, poisoned memory, Arena echo trick) | No allowlist entry or mandate of this vault covers the attacker | `PayeeNotAuthorized` |
| Hostile x402 API with `payTo` = attacker | Same: the payee isn't authorized | `PayeeNotAuthorized` |
| Allowlisted API asks for more than agreed | Per-payee max and lifetime budget, then the vault's per-tx cap and rolling 24h cap | `ExceedsPayeePerTx`, `PayeeBudgetExceeded`, `ExceedsPerTxCap`, `ExceedsDailyCap` |
| Burst at a window boundary | The 24h cap is rolling (25 hourly buckets): each payment counts for 24-25h, so no 24h period sees more than `daily_cap` leave the vault | `ExceedsDailyCap` |
| Right payee, wrong destination account (or wrong mint) | Recipient must be the authorized payee's associated token account for the vault's mint and token program | `RecipientMismatch` |
| Large payment with no human in the loop | A single payment at or above `cosign_threshold`, or one that brings the agent's un-co-signed 24h total to `cosign_window_threshold`, needs the owner's `approve_request` (Blink) | `RequiresCosign` |
| Hijacked agent spamming the owner with approval requests to an attacker | `request_spend` checks the allowlist/mandate and per-tx limits up front; at most 8 open requests per vault | `PayeeNotAuthorized`, `ExceedsPayeePerTx`, `TooManyOpenRequests`, … |
| Stale or reused approvals | Requests expire and are closed when approved or rejected (rent back to the agent); anyone can close an expired one | `RequestNotPending`, `RequestExpired` |
| Using a mandate beyond its terms | Revocation, expiry, per-tx max and total are checked on every spend | `MandateRevoked`, `MandateExpired`, `ExceedsPayeePerTx`, `MandateExhausted` |
| Forged, blind-signed or replayed signed mandate | The program rebuilds a readable text message (program id, cluster, vault and its opening time, payee, mint, amounts, expiry, nonce, intent) and requires the vault owner's Ed25519 signature over exactly those bytes: precompile ix right before ours, exactly one signature, all instruction indices = `u16::MAX`, in-bounds offsets. `nonce` must equal `vault.mandate_seq` (single use); `bump_mandate_seq` cancels unredeemed signatures | `InvalidMandateSignature`, `StaleMandateNonce`, `InvalidIntent` |
| Closed, foreign or fake payee/mandate account passed to a spend | Loaded by hand and refused, not Anchor's generic 3012 | `PayeeNotAuthorized` |
| Vault created over a risky Token-2022 mint | Only an allow-list of mint extensions (metadata, group, confidential transfer); fees, hooks, permanent delegate, pausable, default state, non-transferable, close authority, interest-bearing/scaled amounts and unknown extensions are refused; decimals ≤ 18 | `UnsupportedMint` |
| Front-running `initialize_vault` by pre-creating the vault's token account | The vault ATA is `init_if_needed` (Anchor still checks it is the ATA of vault + mint) | — |
| Owner-only actions by anyone else | `has_one = owner` on every owner instruction | `NotOwner` |
| Spending with any key but the vault's agent | Account constraint on the vault | `NotAgent` |
| Runaway agent | Kill switch (`set_paused`); the tripwire can auto-pause after N strikes (unauthorized attempts) within 24h | `VaultPaused` |
| Stolen agent key | It can only do what the policy already allows. With `enforce_tripwire` set it can't dodge the tripwire either; the owner rotates it with `set_agent` or pauses | — |

Test coverage: 78 LiteSVM integration tests plus 3 unit tests (81 passing, `cargo test -p leash` in the Codespace)
cover the happy paths, every named error except `Overflow` and `RequestVaultMismatch`, the tripwire classes, the
rolling-window boundary burst, Token-2022 mints, rent refunds, transaction size and compute budget, and the Ed25519
bypass attempts on the signed-mandate path (`programs/leash/tests/leash.rs`).

## What Leash does not stop

1. **Abuse by an allowlisted payee.** A compromised or hostile API that you approved can be paid up to its
   per-payment max on every call until its budget runs out (or forever within the vault caps if `budget_total = 0`).
   A $1 client cap doesn't help here either: $0.99 a call adds up. *Mitigation:* small `per_tx_max`, a finite
   `budget_total` per payee, a low vault `daily_cap`, a co-sign threshold and `cosign_window_threshold`; deactivate
   (`update_payee`) or remove the payee as soon as it misbehaves.
2. **Owner phishing.** Leash executes what the owner signs. A phishing Blink or dapp that gets the owner to sign
   `add_payee(attacker)`, a mandate for the attacker, or `approve_request` for a bad request will move money.
   Signed mandates are now readable text (T5, deployed in v2), so the wallet shows the payee, amounts and expiry,
   but an owner who doesn't read the prompt can still be phished. *Mitigation:* check the payee and amount in the
   wallet prompt. The approve Action (and our `/approve` page, which renders it) reads the amount, payee and expiry
   from chain state and shows the agent-written reason only as flattened, capped, quoted text. Planned: a Squads
   multisig with a timelock as the owner.
3. **Exfiltration through memos.** The agent's reason travels as a plaintext SPL Memo (`leash:reason:<text>`, up to
   180 chars), and a failed transaction's instructions and logs are public too. A prompt-injected agent can therefore
   publish data (an API key in its context, a user's address) in the "reason" of a payment that the program then
   **blocks**: the money stays, the text is public forever. *Mitigation:* keep secrets out of the agent's context.
   Planned: only the reason hash onchain, text stored off-chain or encrypted to the owner.
4. **A stolen owner key.** Full control: change policy, add payees, withdraw. Out of scope for the program. Use a
   hardware wallet; a Squads owner is on the roadmap.
5. **Prompt injection itself.** The model can still be fooled; Leash stops the payment, not the deception. Anything
   else the agent can do (post, call other tools, leak data) is outside Leash.
6. **Denial of service through the tripwire.** Since v2 only unauthorized attempts strike (T1): caps, budgets and
   expiry never do, and strikes reset 24h after the strike window opened. But an attacker who can inject payments to
   unapproved payees still freezes a vault with `freeze_after_strikes = 3` after three of them within 24h. That is
   the trade: safety bought with liveness. Use `freeze_after_strikes = 0` where liveness matters (the Arena does).
7. **A stolen agent key skipping the tripwire, on vaults without `enforce_tripwire`.** The thief can call
   `agent_spend` (reverts, no strike) instead of `guarded_spend`. Setting `enforce_tripwire` closes this (T2). Our
   demo vault leaves it off on purpose, so S1's `agent_spend` reverts as a visible failed transaction.

## Mitigations you control

- Give each service its own payee with a small `per_tx_max` and a finite `budget_total` (the demo uses $0.50 / $5).
- Set `cosign_threshold` low enough that anything unusual becomes a Blink approval (demo: $0.20), and
  `cosign_window_threshold` to stop many small payments adding up without you (off on the demo vaults, because S4
  makes two small autonomous payments).
- Keep `per_tx_cap` and `daily_cap` near real usage (demo: $1.00 per tx, $5.00 per rolling 24h).
- Set `enforce_tripwire` so every refusal is recorded and counted, whichever spend instruction the agent key calls
  (the Arena and tripwire vaults do).
- Use `freeze_after_strikes` only where a freeze is acceptable; the Arena vault uses 0 (never freeze) on purpose.
- Fund the vault with what the agent needs this week, not your treasury; `withdraw` the rest.
- Keep the owner on a hardware wallet. Rotate the agent key with `set_agent` if a host is compromised.
- If you signed a mandate you no longer want redeemed, call `bump_mandate_seq`.
- Treat memo text as public.
- Keep RPC provider keys server-side (`SOLANA_RPC_URL` + the `/api/rpc` proxy), never in `NEXT_PUBLIC_*`.
- When hosting: set `AGENT_TOKEN`, keep the agent server on loopback or a private network (`HOST` unset), point the
  dashboard at `/api/agent`, and set `TRUSTED_IP_HEADER` for your platform.

## Known open items

Found in our Nov 6 review passes (Solana core-dev judge, web3 red team, MLH jury + investor panel). Statuses:

- **open**: not on `main`, and for program items not in the deployed program.
- **fixed (deployed Nov 7, v2)**: on `main` and in the program running on devnet since the v2 upgrade.
- **fixed on main (Nov 7)**: off-chain code (SDK, servers, web app, tests) merged to `main`. These run from source;
  there is no hosted deployment to update.

Each fixed row says how. The table changes only when a fix is merged and, for program items, deployed.

### Program

| # | Issue | Planned design | Status |
|---|---|---|---|
| T1 | Tripwire strikes on *any* refused spend, so an honest agent that hits its caps, or 3 injected payments, freezes the vault | Strike only on unauthorized attempts (`PayeeNotAuthorized`, `RecipientMismatch` to a foreign owner); cap/budget/expiry errors become non-strike blocks; strikes decay per window | **fixed (deployed Nov 7, v2)**: strikes only for `PayeeNotAuthorized` and money sent to an account the payee doesn't own; other refusals are recorded as `PaymentBlocked` with `strike: false`; strikes count inside a 24h window that opens at the first strike |
| T2 | A stolen agent key can use `agent_spend` and never record a strike | Owner flag `enforce_tripwire`: when set, `agent_spend` behaves like `guarded_spend` | **fixed (deployed Nov 7, v2)**: `Policy.enforce_tripwire`; on for the Arena and tripwire vaults, off for the demo vault on purpose (S1 shows a reverted tx) |
| T3 | The "24h" cap is a fixed window, so a burst at the boundary spends 2× the cap within seconds | Two-bucket sliding window, or rename to "daily window" everywhere | **fixed (deployed Nov 7, v2)**: true rolling 24h from 25 hourly buckets; each payment counts for 24-25h, co-signed ones included |
| T4 | Any token account the payee owns is accepted, including stray ones the merchant never watches | Recipient must equal the payee's associated token account for the vault mint and token program | **fixed (deployed Nov 7, v2)**: recipient must be that ATA; the payee's own non-ATA account is refused without a strike, anyone else's account is a strike |
| T5 | Signed mandates are blind-signed hex and not bound to a cluster (replayable where the same program id, owner and vault exist); no way to cancel an unredeemed signature except creating another mandate | Readable canonical UTF-8 message (program id, cluster genesis hash, vault, payee, UI amounts, ISO expiry, nonce, intent text) rebuilt in-program; `bump_mandate_seq` to cancel outstanding signatures | **fixed (deployed Nov 7, v2)**: readable `Leash spending mandate v2` message rebuilt in-program, plus mint and the vault's opening time; intent is 1-100 printable ASCII; `bump_mandate_seq` added. Deviation: the cluster is a build-time tag (`devnet`, or `mainnet-beta` with `--features mainnet`), not the genesis hash, which a program can't read |
| T6 | Spend requests, mandates and vaults are never closed: rent stays locked, and open requests grow without bound | Close the request on approve/reject (rent back to the agent), `close_mandate`, `close_vault`, cap open requests per vault | **fixed (deployed Nov 7, v2)**: approve/reject close the request, anyone can `close_request` an expired one, `close_mandate`, `close_vault` (empty vault, nothing open), at most 8 open requests |
| T7 | `initialize_vault` uses `init` for the vault's token account, so anyone who pre-creates it bricks that `vault_id` | Create the vault token account idempotently and constrain it | **fixed (deployed Nov 7, v2)**: `init_if_needed` with the ATA constraints |
| T8 | Token-2022 mints with transfer hooks, transfer fees, permanent delegate, pausable or default-frozen state are accepted | Reject those extensions at `initialize_vault` with a named error (or support hooks via remaining accounts) | **fixed (deployed Nov 7, v2)**: extension allow-list, everything else (and decimals > 18) is `UnsupportedMint` |
| T9 | The co-sign threshold is per transaction: 5 × 0.19 passes a 0.20 threshold | Apply the threshold to aggregate spend in the window | **fixed (deployed Nov 7, v2)**: `Policy.cosign_window_threshold` over the agent's un-co-signed rolling 24h total (0 = off, which the demo vaults use) |
| T10 | A co-signed payment (`approve_request`) without a memo can be claimed by an x402 server for any request, because `SpendExecuted` doesn't name the request | Put the request key in `SpendExecuted` (or require a memo on requests) and have the verifier match it | **fixed (deployed Nov 7, v2)** in the program: `SpendExecuted.request` names the request. The x402 verifier still matches on memo = nonce; its memo-less fallback reads the request account, which v2 closes on approve, so that fallback now always refuses. Follow-up: match `SpendExecuted.request` there |
| T11 | Events use `emit!` (log-truncation risk) and spends return no data, so other programs can't compose on the result | `emit_cpi!` for events; `set_return_data` with paid/blocked + error code | open (not in v2, deliberately) |
| T12 | The program's upgrade authority is the single owner key; no verifiable build | Squads multisig as upgrade authority (or `--final` for the demo build) and a `solana-verify` verifiable build | open (not in v2, deliberately): v2 was deployed with the same single-key authority and without `--final`, so it can still be fixed or rolled back during the event |
| T13 | A stale payee account surfaces as Anchor's generic `AccountNotInitialized` (3012), `withdraw` emits no event, and `owner == agent` is allowed | Named error for stale payee PDAs, a withdraw event, reject `owner == agent` | **fixed (deployed Nov 7, v2)**: closed or foreign payee/mandate accounts are `PayeeNotAuthorized`, `Withdrawn` event, `AgentIsOwner` at init and in `set_agent` |

### Tests and CI

| Issue | Planned design | Status |
|---|---|---|
| Cross-vault substitution (vault B's payee or mandate passed to vault A) is enforced (`payee.vault == vault`) but untested | Test ⇒ `PayeeNotAuthorized` | **fixed on main (Nov 7)**: `cross_vault_payee_or_mandate_is_payee_not_authorized` |
| `approve_request` edge cases: wrong payee account/recipient, payee deactivated or mandate revoked between request and approve, approval via mandate | Tests | **fixed on main (Nov 7)**: `approve_rechecks_authorization`, `approve_after_mandate_revoked_is_refused`, `request_spend_via_mandate_then_approve` |
| `NotOwner` is tested on `set_paused` only, not on every owner instruction | Test approve, reject, withdraw, add/update/remove payee, create/revoke mandate, policy | **fixed on main (Nov 7)**: `err_not_owner_on_every_owner_ix` covers all 15 owner instructions |
| More Ed25519 shapes: garbage signature, `num_sigs = 2`, precompile not adjacent, out-of-bounds offsets, `terms.vault ≠ vault`, expired terms | Tests | **fixed on main (Nov 7)**: all of these, plus another cluster/program/vault/mint, a re-opened vault, invalid intent and a replayed nonce |
| `request_spend` while paused, zero, over cap, via mandate, budget exceeded | Tests | **fixed on main (Nov 7)**: `request_spend_refusals` |
| SDK only has a layout test (58 checks vs the IDL) | Integration tests against LiteSVM/Surfpool: spend allowed/blocked, request → approve, activity parsing | partly fixed on main (Nov 7): 83 `node:test` tests (IDL conformance, the program's mandate-message vectors, activity forgery, the client against an in-memory connection). Still open: integration against LiteSVM/Surfpool |
| No CI | GitHub Actions: `anchor build --arch v0`, `cargo test -p leash`, `pnpm -r typecheck`, SDK tests on every push | added, not yet run: `.github/workflows/ci.yml` (typecheck, SDK tests, `anchor build --arch v0`, committed-IDL check, `cargo test -p leash`). The repo hasn't been pushed, so the workflow has never run |

### SDK

| Issue | Planned design | Status |
|---|---|---|
| The activity feed shows any failed tx that mentions the vault and has a Leash-looking error as "BLOCKED", so anyone can create fake entries (and their memo text) | Count an error only inside the Leash invoke frame of an instruction that targets this vault | **fixed on main (Nov 7)**: a failure counts only when the runtime reports a Leash error on a top-level Leash payment instruction for this vault; events are read only from the Leash frame for this vault |
| `resolveAuthorization` can pick an exhausted mandate | Skip mandates with `spent >= max_total` | **fixed on main (Nov 7)**: exhausted, revoked and expired mandates are skipped |
| Guarded spends are sent with `skipPreflight`, though a blocked guarded spend succeeds in simulation anyway | Keep preflight on for guarded mode (project rule: skip only for txs expected to fail) | **fixed on main (Nov 7)** in the SDK: preflight stays on unless the caller passes `expectFailure`. The Arena route still passes it for its guarded spends |

### Off-chain services

| Issue | Planned design | Status |
|---|---|---|
| x402 paywall race: the nonce and tx signature are marked used only *after* the async onchain verification, so two concurrent requests can redeem one payment | Atomically reserve nonce + signature before verifying; release on failure | **fixed on main (Nov 7)**: `NonceStore.reserve()` claims both in one synchronous step, then commit or release |
| x402 payer binding: the nonce is public once the payment lands, so whoever watches the chain can present the agent's tx signature first and receive the resource the agent paid for | The agent signs `(nonce, resource)`; the verifier checks the signer is the vault's agent | **fixed on main (Nov 7)**: the payer signs `leash-x402-payer:v1` + nonce + resource URL; the server requires the vault's agent read from chain (or the debited wallet for `transfer`). `@leash/mcp` and the demo agent sign it |
| Reason text is public and attacker-influenced (see "exfiltration" above) | Reason hash onchain only; text off-chain or encrypted to the owner | open |
| Arena command parser: thousands separators (`10,000` is read as `10.000`, i.e. 10), and a refusal that quotes the command ("I won't send 50 dUSDC to…") counts as "fooled" | Parse separators correctly; don't count refusals | **fixed on main (Nov 7)** (Arena and demo-agent parsers) |
| RPC proxy forwards `getProgramAccounts` unfiltered and `sendTransaction` for any program, with no rate limit | Per-IP rate limit, filtered `getProgramAccounts`, `sendTransaction` only for Leash-program txs (or drop it), quota alarm | **fixed on main (Nov 7)**: read-method allowlist, `getProgramAccounts` only on the Leash program with a vault/owner `memcmp`, send/simulate only for txs with a top-level Leash instruction, per-IP limit (`RPC_RATE_LIMIT_PER_MIN`), daily alarm and optional hard stop (`RPC_DAILY_ALARM`, `RPC_DAILY_MAX`) |
| Arena rate limits are in memory per server process, trust `x-forwarded-for`, share the main You.com key, and the attempt is written after the onchain call | Shared store (Upstash/Vercel KV), platform IP header only, separate key with a daily budget, write the attempt first | partly fixed on main (Nov 7): platform IP header only (`TRUSTED_IP_HEADER`, or Vercel's), a daily You.com call budget (`ARENA_YOU_DAILY_BUDGET`), attempt written before the onchain call. Still open: a shared KV store (limits are in memory per process) and a separate You.com key |
| The agent server listens on all interfaces with no auth on `/run` and `/reset` | Bind `127.0.0.1` locally; bearer token when hosted | **fixed on main (Nov 7)**: loopback only unless `HOST` is set; `AGENT_TOKEN` bearer on `/run`, `/run-split`, `/reset`; the web app's `/api/agent` proxy adds the token server-side and rate-limits runs |
| The Blink description includes the agent-written reason | Render it as untrusted text with a length cap; amount and payee from chain state only | **fixed on main (Nov 7)**: amount, payee and expiry from the request account, label from the owner's payee account; the reason is flattened (control, zero-width and bidi characters removed, links defanged), capped at 140 characters, quoted, and flagged if it doesn't match the stored reason hash |
| `X402_ACCEPT_MOCK=1` lets the x402 server accept mock signatures (dev only, off by default); the used-signature set is unbounded | Remove the mock path; bound the nonce/signature store | **fixed on main (Nov 7)**: mock path removed; the store keeps at most `X402_MAX_NONCES` terms (default 10,000) and 50,000 signatures, and 402 terms are limited per IP (`X402_ISSUE_PER_MINUTE`) |
