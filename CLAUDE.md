# CLAUDE.md — Leash (MLH Solana Hackathon, Nov 6-8, 2026)

You are building **Leash**: a Solana program + SDK that makes AI agent wallets safe against prompt injection by
enforcing owner-approved spending onchain. The specs live in the planning kit, outside this repo (added with
`--add-dir`): `/mnt/c/Users/Soumya/Desktop/DEV/leash-solana-hackathon/docs/` (on Windows:
`C:\Users\Soumya\Desktop\DEV\leash-solana-hackathon\docs\`). "docs/xx" below means that folder. Read
`docs/02-product-spec.md` and `docs/03-architecture.md` before writing code. The doc for your area is the spec;
follow it, and note any deviation in this repo's `NOTES.md`.

**Hackathon rule:** all code in this repo is written during the event (MLH: no prior work). Write code fresh from
the specs; don't copy the kit's snippets verbatim, and never copy the kit's docs into this repo.

## Priorities (in order)
1. **Working demo over breadth.** A judge must see, within 2 minutes: an unprotected agent drained, the Leash agent
   given the same malicious input, and the Solana program rejecting the transfer with a named error in the explorer.
2. **Correct onchain enforcement.** Every rule that matters lives in the Anchor program. Off-chain checks are UX only.
3. **Polish of the demo path** (dashboard, Arena, Blink approval) over extra features.
Scope tiers are in `docs/02-product-spec.md`. Do not start a SHOULD item while a MUST item is broken.

## Repo layout (monorepo, pnpm workspaces)
```
programs/leash/          Anchor program (Rust)
tests/                   Anchor/LiteSVM tests
packages/sdk/            @leash/sdk  — TS client (PDAs, ix builders, policy helpers, event decoding)
packages/mcp/            @leash/mcp  — MCP server exposing Leash tools
packages/plugin-sak/     Solana Agent Kit plugin
packages/plugin-eliza/   ElizaOS plugin (stretch)
apps/agent/              Demo agents: victim + leashed (Node, TS)
apps/x402-servers/       Demo paid APIs (x402) + "leash" scheme verifier
apps/web/                Next.js dashboard + Red Team Arena + Solana Actions (Blinks) routes
scripts/                 devnet setup: mint dUSDC, init vault, seed allowlist, fund wallets
NOTES.md                 Deviations from the specs, decisions, spike results
```

## Environment
- **This machine has no WSL/Docker (owner's choice).** Rust/Solana/Anchor run in a **GitHub Codespace**
  (`gh codespace ssh -c "..."`); the Node apps run natively on Windows. See `NOTES.md`.
- Toolchain (verified Nov 5, 2026): Rust stable, Solana CLI (Agave), **Anchor 1.2.x** via `avm`, Surfpool.
  One-shot install: `curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash`.
  Check with `solana --version`, `anchor --version`, `avm list`. If installed versions differ from the docs, trust
  the installed version and note it in `NOTES.md`.
- Anchor 1.x specifics: TS client is **`@anchor-lang/core`** (not `@coral-xyz/anchor`); `CpiContext::new*` take the
  program id as a `Pubkey`; `anchor test` runs on **Surfpool** by default; program tests use the generated Rust
  LiteSVM template.
- Pinned/current libs: `@x402/core` `@x402/svm` (> 2.22.0) `@x402/fetch` `@x402/express` (x402 v2 — not the
  deprecated `x402-*` v1 packages); `@modelcontextprotocol/server` (MCP SDK v2); `solana-agent-kit` 2.0.10 (pin);
  `@solana/actions` 1.6.6 (old but current) + `@solana/actions-spec` types.
- Cluster: **devnet only.** Never use mainnet keys. RPC URL from `.env` (`SOLANA_RPC_URL`), default public devnet.
- Package manager: pnpm. Node LTS. TypeScript strict.

## Commands (keep this section updated as scripts are added)
```
# program (run in the Codespace: gh codespace ssh -c leash-chain-67jq4qr4x9j34xg4)
anchor build --arch v0            # sBPFv0: devnet has no sBPFv3 yet; regenerates target/idl + target/types
cargo test -p leash               # 45 Rust LiteSVM tests
solana program deploy target/deploy/leash.so --program-id keys/leash-program.json --url devnet
pnpm sdk:sync-idl                 # copy IDL + types into packages/sdk/src/idl

# devnet state
pnpm --filter scripts keys        # keypairs in keys/ (gitignored), addresses into .env
pnpm --filter scripts balances    # SOL balances, who needs funding
pnpm setup:devnet                 # dUSDC mint, wallets, vaults 1/2/3, payees (idempotent)
pnpm reset:demo                   # restore seeded demo state (~15 s)

# apps
pnpm --filter x402-servers dev    # paid demo APIs on :4021
pnpm --filter agent dev           # demo runner HTTP on :4020 (/balances /run /run-split /reset)
pnpm --filter web dev             # dashboard on :3000 (/demo /vault /arena)
pnpm --filter agent demo:split -- --scenario s1   # also: demo:victim, demo:leashed, s2 s4 s5

# tests / checks
pnpm --filter @leash/sdk test      # SDK: 83 tests incl. IDL conformance, mandate bytes, activity feed
pnpm --filter @leash/mcp build && pnpm --filter @leash/mcp test:smoke   # MCP over stdio on devnet
pnpm --filter @leash/plugin-sak example   # SAK plugin: legit pay + blocked injection
pnpm -r typecheck
```

## Rules
- **Secrets:** keypairs and API keys live in `.env` / `~/.config/solana/*.json`, never in git. `.gitignore` covers
  `*.json` keypairs under `keys/`. Never print private keys in logs or UI.
- **Don't invent APIs.** For Anchor, Solana web3, x402, Solana Agent Kit, ElizaOS, Solana Actions: check the
  current docs or the package's README/types (`npm view <pkg>`, read `node_modules/<pkg>/dist/*.d.ts`) before
  using a function. Docs: anchor-lang.com (repo github.com/otter-sec/anchor), solana.com/docs, docs.x402.org
  (repo github.com/x402-foundation/x402), solana.com/docs/tools/actions, docs.elizaos.ai,
  github.com/sendaifun/solana-agent-kit (v2 branch), github.com/modelcontextprotocol/typescript-sdk.
- **AI models: You.com** (owner's choice, replaces the Anthropic plan). Use `@leash/llm` (`packages/llm`):
  `youAnswer()` (Answer API, free credits) and `youSearch()`. The Inference Router needs purchased credits and is
  opt-in (`LLM_PROVIDER=youcom-router`). The Answer API is Q&A, not chat: phrase prompts as questions, keep them
  under 400 chars. `YDC_API_KEY` is server-side only — never import `@leash/llm` from client components.
- **UI:** nestjs.com look (Manrope + Geist Mono, `#050303` bg, `#ea2845` accent), rebuilt in our own code.
  Never copy files from `nestjs/marketing-ui` (unlicensed); never use the NestJS logo, name or copy.
- **Program changes** must update: the IDL (via `anchor build`), `packages/sdk`, tests, and `NOTES.md` if they
  deviate from `docs/04-onchain-program.md`.
- **Never claim "first"** in UI copy or README. Caps, allowlists, Blink approvals and signed intents exist in other
  projects; the README credits them (`docs/01-research.md` §5).
- **Every program error is named and human-readable** (`#[msg("...")]`). The UI maps error codes to friendly text.
- **Demo transactions that are expected to fail** are sent with `skipPreflight: true` so the failed tx lands
  onchain and has an explorer link. Everywhere else, keep preflight on.
- Commit small and often with clear messages. Never force-push `main`.

## Definition of done (per feature)
- Program instruction: unit tests for the happy path and for every error it can return.
- SDK function: typed, used by at least one app, example in its README.
- UI: works on a 1280px laptop screen and in the recording resolution (1920x1080), no console errors.
- Demo path: can be run end-to-end from a fresh terminal using only the commands above + `.env`.
