import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { fromBaseUnits } from "@leash/sdk";
import type { DemoBalances, DemoWallet } from "@leash/sdk/demo";
import { connection, settings } from "./env";
import { getLeash } from "./leash";

async function tokenBalance(mint: PublicKey | null, owner: PublicKey | null): Promise<{ ata: string; balance: bigint }> {
  if (!mint || !owner) return { ata: "", balance: 0n };
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  try {
    return { ata: ata.toBase58(), balance: (await getAccount(connection(), ata)).amount };
  } catch {
    return { ata: ata.toBase58(), balance: 0n };
  }
}

async function wallet(label: string, owner: PublicKey | null, mint: PublicKey | null): Promise<DemoWallet> {
  const { ata, balance } = await tokenBalance(mint, owner);
  return { label, address: owner?.toBase58() ?? "", tokenAccount: ata, balance: fromBaseUnits(balance) };
}

export async function getBalances(): Promise<DemoBalances & { leashClient: "real" | "mock"; error?: string }> {
  const s = settings();
  const leash = getLeash();
  const [victim, attacker, merchant] = await Promise.all([
    wallet("Unprotected agent", s.victim?.publicKey ?? null, s.mint),
    wallet("Attacker", s.attacker, s.mint),
    wallet("Merchant (demo APIs)", s.merchant, s.mint),
  ]);
  let vault: DemoWallet = { label: "Leash vault", address: leash.vault.toBase58(), tokenAccount: "", balance: "0" };
  try {
    const v = await leash.client.getVault(leash.vault);
    vault = { label: "Leash vault", address: leash.vault.toBase58(), tokenAccount: v.vaultAta.toBase58(), balance: fromBaseUnits(v.balance) };
  } catch (e) {
    vault.tokenAccount = (e as Error).message.slice(0, 120);
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
