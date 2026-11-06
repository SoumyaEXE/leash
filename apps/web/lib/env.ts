// Browser-safe config. Each NEXT_PUBLIC_* must be referenced literally so Next inlines it.
export const ENV = {
  rpc: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com",
  programId: process.env.NEXT_PUBLIC_LEASH_PROGRAM_ID || "",
  vault: process.env.NEXT_PUBLIC_LEASH_VAULT || "",
  arenaVault: process.env.NEXT_PUBLIC_ARENA_VAULT || "",
  mint: process.env.NEXT_PUBLIC_DUSDC_MINT || "",
  agentUrl: process.env.NEXT_PUBLIC_AGENT_SERVER_URL || "http://localhost:4020",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  explorer: process.env.NEXT_PUBLIC_EXPLORER || "https://explorer.solana.com",
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/SoumyaEXE/leash",
} as const;

export const DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export function explorerTxUrl(sig: string): string {
  return `${ENV.explorer}/tx/${sig}?cluster=devnet`;
}

export function explorerAddrUrl(addr: string): string {
  return `${ENV.explorer}/address/${addr}?cluster=devnet`;
}

export function short(addr: string | undefined | null, n = 4): string {
  if (!addr) return "—";
  return addr.length <= n * 2 + 1 ? addr : `${addr.slice(0, n)}…${addr.slice(-n)}`;
}
