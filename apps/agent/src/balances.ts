import { TokenAccountNotFoundError, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { fromBaseUnits } from "@leash/sdk";
import type { DemoBalances, DemoWallet } from "@leash/sdk/demo";
import { connection, settings } from "./env";
import { getLeash } from "./leash";

/**
 * Last balance successfully read per token account. Public devnet RPC rate-limits (429); a failed read must never
 * show up as "0 dUSDC" on screen, so on errors we serve the last known value.
 */
const lastKnown = new Map<string, bigint>();

async function tokenBalance(mint: PublicKey | null, owner: PublicKey | null): Promise<{ ata: string; balance: bigint; stale?: boolean }> {
  if (!mint || !owner) return { ata: "", balance: 0n };
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const key = ata.toBase58();
  try {
    const amount = (await getAccount(connection(), ata, "confirmed")).amount;
    lastKnown.set(key, amount);
    return { ata: key, balance: amount };
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError) return { ata: key, balance: 0n };
    const cached = lastKnown.get(key);
    if (cached !== undefined) return { ata: key, balance: cached, stale: true };
    throw e;
  }
}

async function wallet(label: string, owner: PublicKey | null, mint: PublicKey | null): Promise<DemoWallet> {
  const { ata, balance } = await tokenBalance(mint, owner);
  return { label, address: owner?.toBase58() ?? "", tokenAccount: ata, balance: fromBaseUnits(balance) };
}

/** Coalesce bursts of /balances calls (the page polls every 3s and on every account change). */
let inflight: Promise<DemoBalances & { leashClient: "real" | "mock"; error?: string }> | null = null;
let cachedAt = 0;
let cached: (DemoBalances & { leashClient: "real" | "mock"; error?: string }) | null = null;

export function getBalances(): Promise<DemoBalances & { leashClient: "real" | "mock"; error?: string }> {
  if (cached && Date.now() - cachedAt < 1500) return Promise.resolve(cached);
  inflight ??= readBalances()
    .then((b) => {
      cached = b;
      cachedAt = Date.now();
      return b;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Drop the coalescing cache (after a run or a reset, so the next read is fresh). */
export function invalidateBalances(): void {
  cached = null;
}

async function readBalances(): Promise<DemoBalances & { leashClient: "real" | "mock"; error?: string }> {
  const s = settings();
  const leash = getLeash();
  const [victim, attacker, merchant] = await Promise.all([
    wallet("Unprotected agent", s.victim?.publicKey ?? null, s.mint),
    wallet("Attacker", s.attacker, s.mint),
    wallet("Merchant (demo APIs)", s.merchant, s.mint),
  ]);
  const vaultKey = `vault:${leash.vault.toBase58()}`;
  let vault: DemoWallet;
  try {
    const v = await leash.client.getVault(leash.vault);
    lastKnown.set(vaultKey, v.balance);
    vault = { label: "Leash vault", address: leash.vault.toBase58(), tokenAccount: v.vaultAta.toBase58(), balance: fromBaseUnits(v.balance) };
  } catch (e) {
    const last = lastKnown.get(vaultKey);
    if (last === undefined) throw e;
    const ata = s.mint ? getAssociatedTokenAddressSync(s.mint, leash.vault, true).toBase58() : "";
    vault = { label: "Leash vault", address: leash.vault.toBase58(), tokenAccount: ata, balance: fromBaseUnits(last) };
  }
  return {
    victim,
    vault,
    attacker,
    merchant,
    mint: s.mint?.toBase58() ?? "",
    cluster: "devnet",
    leashClient: leash.kind,
    error: s.mint ? undefined : "DUSDC_MINT is not set. Run pnpm setup:devnet.",
  };
}
