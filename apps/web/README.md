# apps/web — Leash dashboard, demo, Arena and Blinks

Next.js 16 (App Router) · React 19 · Tailwind v4 · gsap · ogl. Reads the repo-root `.env`.

```
pnpm --filter web dev     # http://localhost:3000
pnpm --filter web build
```

| Route | What |
|---|---|
| `/` | Landing: incidents with sources, the seven policy layers, the three owner-signed release paths, prior work |
| `/demo` | Split-screen attack replay (S1 Morse echo, S2 fake memory, S5 hostile 402, S4 legit work). Talks to the agent server (`NEXT_PUBLIC_AGENT_SERVER_URL`: `GET /balances`, `POST /run-split`, `POST /reset`). `/demo?mock=1` uses canned data for UI work and backup recordings. |
| `/vault` | Owner dashboard: balance, caps, 24h meter, kill switch, tripwire strikes, payees, mandates (owner tx or off-chain `signMessage`), pending co-sign requests, live activity |
| `/arena` | Red Team Arena: chat with Warden (You.com Answer API), scoreboard, recent attempts |
| `/approve?request=<pda>` | Our own Blink renderer for the approve/reject Action (Phantom signs the same tx dial.to would get) |
| `/api/actions/approve`, `/api/actions/unfreeze`, `/actions.json` | Solana Actions (GET metadata, POST `{ account }` → base64 tx, OPTIONS), with CORS, `X-Action-Version: 2.4`, `X-Blockchain-Ids` (devnet CAIP-2) |
| `/api/arena/chat`, `/api/arena/state` | Arena backend: rate limits (10 msgs / 10 min per IP and per address), 280-char cap, `ARENA_ENABLED` kill switch, attempts in `apps/web/data/arena.json` (gitignored) |

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

Visual style inspired by [nestjs.com](https://github.com/nestjs/nestjs.com) (MIT). Theme tokens in
`app/globals.css` (Manrope + Geist Mono, `#050303`, `#ea2845`, keyframes) follow nestjs.com's `app/index.css`
(MIT, © Kamil Myśliwiec). Every component here is our own code, rebuilt from captures of the live site; no NestJS
logo, name or copy is used. Capture evidence and the motion spec live in `.reanimate/nestjs/` (gitignored).
