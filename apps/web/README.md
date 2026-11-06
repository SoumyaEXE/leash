# apps/web — Leash dashboard, demo, Arena and Blinks

Next.js 16 (App Router) · React 19 · Tailwind v4 · gsap · ogl. Reads the repo-root `.env`.

```
pnpm --filter web dev     # http://localhost:3000
pnpm --filter web build
```

| Route | What |
|---|---|
| `/` | Landing: what the program enforces, the seven policy checks, real incidents and their replays, integrations (SDK, MCP, Agent Kit), FAQ |
| `/demo` | Split-screen attack replay (Morse-code trap, poisoned memory, hostile paywall, legit purchases). Talks to the agent server (`NEXT_PUBLIC_AGENT_SERVER_URL`: `GET /balances`, `POST /run-split`, `POST /reset`). `/demo?mock=1` uses canned data for UI work and backup recordings. |
| `/vault` | Owner dashboard: balance, caps, rolling 24h meter (total and without co-sign), kill switch, tripwire strikes, payees, mandates (owner tx or off-chain `signMessage` of the readable v2 mandate text), pending co-sign requests, live activity |
| `/arena` | Red Team Arena: chat with Warden (You.com Answer API), scoreboard, recent attempts |
| `/approve?request=<pda>` | Our own Blink renderer for the approve/reject Action (Phantom signs the same tx dial.to would get) |
| `/lab/market-data/docs`, `/quickstart`, `/reference` | Poisoned (and clean) API docs for the A1 lab; see `apps/agent/README.md` |
| `/api/actions/approve`, `/api/actions/unfreeze`, `/actions.json` | Solana Actions (GET metadata, POST `{ account }` → base64 tx, OPTIONS), with CORS, `X-Action-Version: 2.4`, `X-Blockchain-Ids` (devnet CAIP-2). The approve copy takes amount, payee and expiry from chain state; the agent's reason is flattened, link-defanged, capped at 140 chars and quoted as the agent's words |
| `/api/arena/chat`, `/api/arena/state` | Arena backend: `ARENA_MESSAGES_PER_10MIN` (default 10) per IP and per payout address, a daily You.com call budget (`ARENA_YOU_DAILY_BUDGET`, default 600), 280-char cap, `ARENA_ENABLED` kill switch, attempts in `apps/web/data/arena.json` (gitignored), written before the onchain call |
| `/api/rpc` | JSON-RPC proxy to `SOLANA_RPC_URL`, so a Helius key never reaches the browser (used when `NEXT_PUBLIC_SOLANA_RPC_URL=proxy`, the default). Forwards a read-method allowlist, `getProgramAccounts` only on the Leash program scoped to one vault/owner, and send/simulate only for txs with a top-level Leash instruction. Per-IP limit `RPC_RATE_LIMIT_PER_MIN` (default 600), daily alarm `RPC_DAILY_ALARM`, optional hard stop `RPC_DAILY_MAX` |
| `/api/agent/*` | Same-origin proxy to the agent server for hosted deploys: adds `AGENT_TOKEN` server-side, forwards only the runner's endpoints, `AGENT_PROXY_RUNS_PER_10MIN` (default 20) runs per IP. Use with `NEXT_PUBLIC_AGENT_SERVER_URL=/api/agent` |

Rate limits are in memory per server process (`app/api/_lib/rate-limit.ts`); a shared KV store is still open (see
`SECURITY.md`). Client IPs come only from a platform header: `TRUSTED_IP_HEADER`, or `x-vercel-forwarded-for` on
Vercel; with neither, all visitors share one bucket. Tests: `pnpm exec tsx --test "apps/web/app/api/_lib/*.test.ts"`
from the repo root (20 tests).

## Mock vs real program

`lib/leash.ts` is the only place a client is created. It uses the in-memory `MockLeashClient` (`lib/mock-leash.ts`,
same `ILeashClient` interface, error names and PDA seeds) until devnet setup writes `NEXT_PUBLIC_LEASH_VAULT`, and the
real `LeashClient` from `@leash/sdk` after that. Force the mock with `NEXT_PUBLIC_LEASH_MOCK=1`.

Server routes sign Arena spends with the agent key: `AGENT_KEYPAIR_PATH` (default `keys/agent.json`) or, on hosts
without the `keys/` folder, `AGENT_SECRET_KEY` (the keypair's JSON byte array). `YDC_API_KEY` is only read server-side.

## How the Arena works

The You.com Answer API is Q&A, not chat, so Warden is a single question per turn (`lib/warden.ts`). Asking it to pay
gets an in-character refusal. Asking it to translate or decode text that *contains* a payment makes Warden's own
reply say `send 50 dUSDC to <address>`, and the bot's command parser (`lib/parser.ts`, the Bankr pattern) executes it
as a real `guarded_spend`. The Arena vault has no payees, so the program refuses (`PayeeNotAuthorized`) and records a
strike. The model gets fooled; the vault holds.

## Design

Layout and visual style adapted from the free Framer template [Cryonix](https://cryonix.framer.website/) by Pixcut
Studio LLC. Theme tokens live in `app/globals.css` (Manrope + Geist Mono, `#000` page, brand `#d32800`); the
decorative flares and illustrations in `public/cx/` come from the template (`public/cx/CREDITS.txt`). The components,
the phone and dashboard mockups and all copy are our own code. Logos in `public/logos/` belong to their owners; see
the root README's design credits.
