# Security model

Leash is a hackathon build: **devnet only, not audited.** This page says what the program enforces today, what it
does not, how to reduce what's left, and which known issues are still open. Everything below describes the code on
`main` and the deployed devnet program
[`Cck8fp…`](https://explorer.solana.com/address/Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe?cluster=devnet).

**Reporting:** please report a vulnerability privately to the maintainers (a GitHub security advisory on this
repository), not in a public issue. Only test against vaults you own, on devnet.

## Trust model

| Actor | Trusted for | Notes |
|---|---|---|
| **Owner** (human wallet) | everything: policy, payees, mandates, approvals, withdrawals, pause | Root of trust. Every release path traces back to an owner signature. |
| **Agent key** | nothing on its own | Can *request* payments (`agent_spend`, `guarded_spend`, `request_spend`, `redeem_signed_mandate`). Holds only fee SOL. |
| **Model output** | nothing | Treated as untrusted input, like the web pages, posts and memories it reads. |
| **Allowlisted payee** (e.g. an x402 API) | up to its per-payment max and budget | It can still ask for more; the program refuses. |
| **Leash program** | enforcement | The only place a rule counts. Off-chain checks are UX. |
| **Off-chain services** (agent server, x402 servers, web app, RPC proxy) | demo plumbing | Demo-grade; see the open items below. |
| **Program upgrade authority** | the code itself | Today a single owner key (open item T12). Whoever holds it can change every rule on this page. |

## What Leash stops

Each row is checked by the program, so it holds no matter what the model says or which client sends the tx.

| Attack | What happens onchain | Error |
|---|---|---|
| Injected "send X to attacker" (Bankr Morse echo, poisoned memory, Arena echo trick) | No allowlist entry or mandate covers the attacker | `PayeeNotAuthorized` |
| Hostile x402 API with `payTo` = attacker | Same: the payee isn't authorized | `PayeeNotAuthorized` |
| Allowlisted API asks for more than agreed | Per-payee max and lifetime budget, then vault caps | `ExceedsPayeePerTx`, `PayeeBudgetExceeded`, `ExceedsPerTxCap`, `ExceedsDailyCap` |
| Right payee, wrong destination account (or wrong mint) | Recipient must be a token account of the vault's mint owned by the authorized payee | `RecipientMismatch` |
| Large payment with no human in the loop | Amounts at or above the co-sign threshold need the owner's `approve_request` (Blink) | `RequiresCosign` |
| Hijacked agent spamming the owner with approval requests to an attacker | `request_spend` checks the allowlist/mandate and per-tx limits up front | `PayeeNotAuthorized`, `ExceedsPayeePerTx`, … |
| Stale or reused approvals | Requests are single-use and expire | `RequestNotPending`, `RequestExpired` |
| Using a mandate beyond its terms | Expiry, revocation, per-tx max and total are checked on every spend | `MandateExpired`, `MandateRevoked`, `ExceedsPayeePerTx`, `MandateExhausted` |
| Forged or replayed signed mandate | Ed25519 precompile ix must sit right before ours, verify exactly one signature by the vault owner over the exact message, with all instruction indices = `u16::MAX` and in-bounds offsets; `terms.vault` must be this vault and `terms.nonce` must equal `vault.mandate_seq` (single use) | `InvalidMandateSignature` |
| Owner-only actions by anyone else | `has_one = owner` on every owner instruction | `NotOwner` |
| Spending with any key but the vault's agent | Account constraint on the vault | `NotAgent` |
| Runaway agent | Kill switch (`set_paused`), and the tripwire (`guarded_spend`) can auto-pause after N strikes | `VaultPaused` |
| Stolen agent key | It can only do what the policy already allows; the owner rotates it with `set_agent` or pauses | — |

Test coverage: 45 LiteSVM tests cover the happy paths, every named error except `Overflow`, the tripwire and five
attacks on the signed-mandate path (`programs/leash/tests/leash.rs`).

## What Leash does not stop

1. **Abuse by an allowlisted payee.** A compromised or hostile API that you approved can be paid up to its
   per-payment max on every call until its budget runs out (or forever within the vault caps if `budget_total = 0`).
   A $1 client cap doesn't help here either: $0.99 a call adds up. *Mitigation:* small `per_tx_max`, a finite
   `budget_total` per payee, a low vault `daily_cap`, a co-sign threshold; deactivate (`update_payee`) or remove the
   payee as soon as it misbehaves.
2. **Owner phishing.** Leash executes what the owner signs. A phishing Blink or dapp that gets the owner to sign
   `add_payee(attacker)`, a mandate for the attacker, or `approve_request` for a bad request will move money.
   Signed mandates are worse today: the message is `LEASH_MANDATE_V1:` + hex, so the wallet shows it blind (T5).
   *Mitigation:* check the payee and amount in the wallet prompt; the approve Action (and our `/approve` page, which
   renders it) reads the amount and payee label from chain state, but its description also quotes the agent-written
   reason. Planned: Blink text treats the reason as untrusted (see off-chain items), readable mandate messages (T5),
   and a Squads multisig with a timelock as the owner.
3. **Exfiltration through memos.** The agent's reason travels as a plaintext SPL Memo (`leash:reason:<text>`, up to
   180 chars), and a failed transaction's instructions and logs are public too. A prompt-injected agent can therefore
   publish data (an API key in its context, a user's address) in the "reason" of a payment that the program then
   **blocks**: the money stays, the text is public forever. *Mitigation:* keep secrets out of the agent's context.
   Planned: only the reason hash onchain, text stored off-chain or encrypted to the owner.
4. **A stolen owner key.** Full control: change policy, add payees, withdraw. Out of scope for the program. Use a
   hardware wallet; a Squads owner is on the roadmap.
5. **Prompt injection itself.** The model still gets fooled; Leash stops the payment, not the deception. Anything
   else the agent can do (post, call other tools, leak data) is outside Leash.
6. **Denial of service through the tripwire.** Every refused `guarded_spend` is a strike, including cap errors an
   honest agent can hit, and strikes don't decay. With `freeze_after_strikes = 3`, three injected payments freeze the
   vault until the owner unpauses it (T1). Safety bought with liveness.
7. **A stolen agent key skipping the tripwire.** The thief can call `agent_spend` (reverts, no strike) instead of
   `guarded_spend`, so probing doesn't count toward a freeze (T2).

## Mitigations you control

- Give each service its own payee with a small `per_tx_max` and a finite `budget_total` (the demo uses $0.50 / $5).
- Set `cosign_threshold` low enough that anything unusual becomes a Blink approval (demo: $0.20).
- Keep `per_tx_cap` and `daily_cap` near real usage (demo: $1.00 per tx).
- Use `freeze_after_strikes` only where a freeze is acceptable; the Arena vault uses 0 (never freeze) on purpose.
- Fund the vault with what the agent needs this week, not your treasury; `withdraw` the rest.
- Keep the owner on a hardware wallet. Rotate the agent key with `set_agent` if a host is compromised.
- Treat memo text as public.
- Keep RPC provider keys server-side (`SOLANA_RPC_URL` + the `/api/rpc` proxy), never in `NEXT_PUBLIC_*`.

## Known open items

Found in our Nov 6 review passes (Solana core-dev judge, web3 red team, MLH jury + investor panel). Each row
describes the planned design. **Status "open" means it is not on `main` and not in the deployed program.** Fixes may
be in progress on branches; this table changes only when a fix is merged and, for program items, deployed.

### Program

| # | Issue | Planned design | Status |
|---|---|---|---|
| T1 | Tripwire strikes on *any* refused spend, so an honest agent that hits its caps, or 3 injected payments, freezes the vault | Strike only on unauthorized attempts (`PayeeNotAuthorized`, `RecipientMismatch` to a foreign owner); cap/budget/expiry errors become non-strike blocks; strikes decay per window | open |
| T2 | A stolen agent key can use `agent_spend` and never record a strike | Owner flag `enforce_tripwire`: when set, `agent_spend` behaves like `guarded_spend` | open |
| T3 | The "24h" cap is a fixed window, so a burst at the boundary spends 2× the cap within seconds | Two-bucket sliding window, or rename to "daily window" everywhere | open |
| T4 | Any token account the payee owns is accepted, including stray ones the merchant never watches | Recipient must equal the payee's associated token account for the vault mint and token program | open |
| T5 | Signed mandates are blind-signed hex and not bound to a cluster (replayable where the same program id, owner and vault exist); no way to cancel an unredeemed signature except creating another mandate | Readable canonical UTF-8 message (program id, cluster genesis hash, vault, payee, UI amounts, ISO expiry, nonce, intent text) rebuilt in-program; `bump_mandate_seq` to cancel outstanding signatures | open |
| T6 | Spend requests, mandates and vaults are never closed: rent stays locked, and open requests grow without bound | Close the request on approve/reject (rent back to the agent), `close_mandate`, `close_vault`, cap open requests per vault | open |
| T7 | `initialize_vault` uses `init` for the vault's token account, so anyone who pre-creates it bricks that `vault_id` | Create the vault token account idempotently and constrain it | open |
| T8 | Token-2022 mints with transfer hooks, transfer fees, permanent delegate, pausable or default-frozen state are accepted | Reject those extensions at `initialize_vault` with a named error (or support hooks via remaining accounts) | open |
| T9 | The co-sign threshold is per transaction: 5 × 0.19 passes a 0.20 threshold | Apply the threshold to aggregate spend in the window | open |
| T10 | A co-signed payment (`approve_request`) without a memo can be claimed by an x402 server for any request, because `SpendExecuted` doesn't name the request | Put the request key in `SpendExecuted` (or require a memo on requests) and have the verifier match it | open |
| T11 | Events use `emit!` (log-truncation risk) and spends return no data, so other programs can't compose on the result | `emit_cpi!` for events; `set_return_data` with paid/blocked + error code | open |
| T12 | The program's upgrade authority is the single owner key; no verifiable build | Squads multisig as upgrade authority (or `--final` for the demo build) and a `solana-verify` verifiable build | open |
| T13 | A stale payee account surfaces as Anchor's generic `AccountNotInitialized` (3012), `withdraw` emits no event, and `owner == agent` is allowed | Named error for stale payee PDAs, a withdraw event, reject `owner == agent` | open |

### Tests and CI

| Issue | Planned design | Status |
|---|---|---|
| Cross-vault substitution (vault B's payee or mandate passed to vault A) is enforced (`payee.vault == vault`) but untested | Test ⇒ `PayeeNotAuthorized` | open |
| `approve_request` edge cases: wrong payee account/recipient, payee deactivated or mandate revoked between request and approve, approval via mandate | Tests | open |
| `NotOwner` is tested on `set_paused` only, not on every owner instruction | Test approve, reject, withdraw, add/update/remove payee, create/revoke mandate, policy | open |
| More Ed25519 shapes: garbage signature, `num_sigs = 2`, precompile not adjacent, out-of-bounds offsets, `terms.vault ≠ vault`, expired terms | Tests | open |
| `request_spend` while paused, zero, over cap, via mandate, budget exceeded | Tests | open |
| SDK only has a layout test (58 checks vs the IDL) | Integration tests against LiteSVM/Surfpool: spend allowed/blocked, request → approve, activity parsing | open |
| No CI | GitHub Actions: `anchor build --arch v0`, `cargo test -p leash`, `pnpm -r typecheck`, SDK tests on every push | open |

### SDK

| Issue | Planned design | Status |
|---|---|---|
| The activity feed shows any failed tx that mentions the vault and has a Leash-looking error as "BLOCKED", so anyone can create fake entries (and their memo text) | Count an error only inside the Leash invoke frame of an instruction that targets this vault | open |
| `resolveAuthorization` can pick an exhausted mandate | Skip mandates with `spent >= max_total` | open |
| Guarded spends are sent with `skipPreflight`, though a blocked guarded spend succeeds in simulation anyway | Keep preflight on for guarded mode (project rule: skip only for txs expected to fail) | open |

### Off-chain services

| Issue | Planned design | Status |
|---|---|---|
| x402 paywall race: the nonce and tx signature are marked used only *after* the async onchain verification, so two concurrent requests can redeem one payment | Atomically reserve nonce + signature before verifying; release on failure | open |
| x402 payer binding: the nonce is public once the payment lands, so whoever watches the chain can present the agent's tx signature first and receive the resource the agent paid for | The agent signs `(nonce, resource)`; the verifier checks the signer is the vault's agent | open |
| Reason text is public and attacker-influenced (see "exfiltration" above) | Reason hash onchain only; text off-chain or encrypted to the owner | open |
| Arena command parser: thousands separators (`10,000` is read as `10.000`, i.e. 10), and a refusal that quotes the command ("I won't send 50 dUSDC to…") counts as "fooled" | Parse separators correctly; don't count refusals | open |
| RPC proxy forwards `getProgramAccounts` unfiltered and `sendTransaction` for any program, with no rate limit | Per-IP rate limit, filtered `getProgramAccounts`, `sendTransaction` only for Leash-program txs (or drop it), quota alarm | open |
| Arena rate limits are in memory per server process, trust `x-forwarded-for`, share the main You.com key, and the attempt is written after the onchain call | Shared store (Upstash/Vercel KV), platform IP header only, separate key with a daily budget, write the attempt first | open |
| The agent server listens on all interfaces with no auth on `/run` and `/reset` | Bind `127.0.0.1` locally; bearer token when hosted | open |
| The Blink description includes the agent-written reason | Render it as untrusted text with a length cap; amount and payee from chain state only | open |
| `X402_ACCEPT_MOCK=1` lets the x402 server accept mock signatures (dev only, off by default); the used-signature set is unbounded | Remove the mock path; bound the nonce/signature store | open |
