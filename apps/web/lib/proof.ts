/** Real devnet transactions from the demo runs (Nov 6, 2026). Shown on the landing page as receipts. */
const tx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export const PROOF = {
  program: "Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe",
  s1VictimDrain: tx("5PPXGSnGvXoLk88G5XuTdDRs3WwX5cvwJ8Rs92T766yZwJtLwgxJ7MU14wCYZpVCRXmm1VZoh7oHr1xeW3FYbqB4"),
  s1LeashedBlocked: tx("5BPBrFWFz6dDNscMN7AejA4V7ErFgiKRoYh2Jxf18ELfGhxMQANXxJFh2GR2NYxvwoLndrEs5Eu1m6Mg7v9ryPq2"),
  s5Blocked: tx("2kNizSFpXEDmcBGM5sC16M7WtNjCBqHgXabuaJEe6myaqW8wQZd5gAP5h3uM24Yz3t79p5VYt4mXf3zAGoHd9byK"),
  s4Paid: tx("4BjvPL5HMvrrPF5T2kocMnhT6Jt72KFxbReEHPMXCEfiyhRxtzjcZe98Jb1RE4UiGTt2GTHurktE3oniaJ9o42DN"),
  blinkApproved: tx("3x9o6yzau9xTyShBvyUCcVeq42oMuQ4apakqz1YHJEMAcS4DTqsfbJCZBbfBD5kLZTtxnBtP64mKPNo5dG6dPKz9"),
  arenaBlocked: tx("2UQvwP9x5KyeRkHXZBjfs9D1BgjHUESEMJAkqpSza4iL6FLE5LQwEqwJyT4NbSqR7wghKUAgp9PJUmWqa8pisKVo"),
} as const;
