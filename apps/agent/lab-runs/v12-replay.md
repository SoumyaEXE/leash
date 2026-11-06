## V12 replay, Nov 6, 2026 (devnet), `pnpm --filter agent v12 --loop 5`

These are three real clients against one hostile x402 v2 server, run by the attacker, who is also the fee payer for
`exact`. The 2.22.0 and 2.30.0 clients pay from the victim hot wallet, which held 1000 dUSDC. Leash pays from the
demo vault. Raw results were saved to `apps/agent/data/v12/2026-11-06T17-47-15-514Z.json`. Every signature below
was read back with `pnpm --filter agent lab verify`.

| Client | 0.99 dUSDC/call loop ×5 → attacker | Hostile 402: whole balance → attacker |
|---|---|---|
| `@x402/fetch` 2.22.0 (no spend controls) | **paid 5/5** (4.95) | **paid 990.1**: wallet emptied, [2VDbBn…CngZVk](https://explorer.solana.com/tx/2VDbBnxfiaL9BtTCxmcRThj56Qxdz4nkBkHKMgiJov1KmwZbW6z1DgmALrSL4WxVtrNj2ZjRQMW4Zm4NQtCngZVk?cluster=devnet) |
| `@x402/fetch` 2.30.0, spendControls with dUSDC capped at $1 | **paid 5/5** (4.95): the cap allows $0.99 | refused before signing: "All payment requirements were rejected by spendControls.allowedAssets maxAmountPerPayment" |
| Leash vault | stopped at call 1: **PayeeNotAuthorized (6004)**, [55k379…JHTz](https://explorer.solana.com/tx/55k379hsT5quzfimMKQhtRzWyC1wjEhyH4CkwuokiTd8kALU9EmDn7fXsMvcmU3XfJidQDYGY53gcd7gRAJ3JHTz?cluster=devnet) | **PayeeNotAuthorized (6004)**, [3bV7Wm…NuXjKgE](https://explorer.solana.com/tx/3bV7Wm1p1QacRZvpBEtSiUhLGR4SpfoN21gAr5vFLdi6JZS2zRq49GQvjU43RLpkNPLTAteg7QEkzD1bXnuNjKgE?cluster=devnet) |

Allowlisted API turned hostile: the same 0.99 loop, but `payTo` is the approved Market Data payee. Leash stops it
at call 1 with **ExceedsPayeePerTx (6005)**, because that payee's per-payment max is 0.50:
[2Vokdg…bah8y1Gj](https://explorer.solana.com/tx/2VokdgwLVtenwnYW4T8LP4Npq9yyiqQHzanUuHXXkh8fUMXgwYqB4vWexkBtG6XChz2841ZU4YfNSWehbah8y1Gj?cluster=devnet).
A loop priced under that per-payment max ends at the payee's total budget (`PayeeBudgetExceeded`) or the vault's
24h cap (`ExceedsDailyCap`). We did not run that loop on the shared demo vault, because it would use up the 24h
window the live demo needs. Both errors are covered by the LiteSVM program tests in
`programs/leash/tests/leash.rs`.

Loop payments by the two x402 clients (each 0.99 dUSDC → attacker `EXivrm…yn43V`):

- 2.22.0: [3fyxrm…3tc5](https://explorer.solana.com/tx/3fyxrmcgqzvpCyxHufVYDhxoAzY4LMjiVDcHe5TtmT59VYKGP2LzCgsbt8AiMVrcbaWNNjVJJqswc1ktr6vD3tc5?cluster=devnet),
  [54b68q…Xfgb](https://explorer.solana.com/tx/54b68qWobVKae3SJsx4mG2xtk2JynmtXb2FuWiLykVFVBmPuzFDn5yJLqyogG4CLUNW26VY5cVDkgkwBXqifXfgb?cluster=devnet),
  [3Z5AHY…664V](https://explorer.solana.com/tx/3Z5AHYthzJMyAZVW6wbZx9QvQCWsXu6nt1hvuXEKK6tUpq4MwQUPCd5FRTkgs5B8UYjdSrBCPF6ik1tV3SAX664V?cluster=devnet),
  [62j7Wk…5UPUa](https://explorer.solana.com/tx/62j7WkGeViBrCBLpvSYjaW7tAH2bcB3zdYz2VcrwsNuQA7NvDvoxuQH6P66SFjPmWH8kXyw5S67x7Zhcqkm5UPUa?cluster=devnet),
  [4RCEEk…1Hw9](https://explorer.solana.com/tx/4RCEEkjBNcC33dqgY8Shorr3CwxkEeM8hHmCHmVLcLWMJViFac8UaLhdPWNJmcd6uFQqPw2RGqb1t7dppf8s1Hw9?cluster=devnet)
- 2.30.0 (capped): [636H2J…2Ftz](https://explorer.solana.com/tx/636H2JzMCH8JZXFeVL1HH8cXEcmtQFJdh6iywdP8yspcpb6DVYpFMySUvZnhy2vEppgcqduTkKs7Kx4TUQYh2Ftz?cluster=devnet),
  [5Gw6ny…28rb](https://explorer.solana.com/tx/5Gw6nyv3shDFjUzqhhtWrcDkSrgs9wwKsrJcGcGMTq6ycwivb6Tf1Pjom7aUkoNdPp8yntpE47yQrpwZeXHT28rb?cluster=devnet),
  [3QKBcM…4xkz](https://explorer.solana.com/tx/3QKBcMC2ygQKHneHPoUr7U32pWeJCYh4tJqiG18iHmduHPSC5g5X8njkJjzQxNHJwoFwPTUHzwdjzHujwCc54xkz?cluster=devnet),
  [4NwK2M…rtAN](https://explorer.solana.com/tx/4NwK2MmUBFSkzc1abRy84Htf7VNd2R3FSuC5K6fLFwNppEcEvyezrGLHUd9AnUDYfbhFNyEwzRzukp4uPksAMtrN?cluster=devnet),
  [RgMKRA…AQv](https://explorer.solana.com/tx/RgMKRA6N1tp3PA6k1U66NtPqQhEq6wSvR22Vh21ujYnCtnN6pKj9j6mUtGQkHSKuxBEgXvSx8HiNbceRM8qZAQv?cluster=devnet)

Notes:
- With default spend controls, 2.30.0 refuses devnet dUSDC outright, because it is not an asset the SDK
  recognizes. That would also refuse every legitimate dUSDC payment. The capped client opts dUSDC in with
  `maxAmountPerPayment: "1000000"` (6 decimals, so $1), the same cap the default puts on USDC.
- The attacker's server co-signs as fee payer and submits whatever the client signed. It does no facilitator
  checks, because it is the attacker's own server.
- Demo balances were restored afterwards with `curl -X POST http://localhost:4020/reset` ("refunded 1000 dUSDC
  attacker → victim").
