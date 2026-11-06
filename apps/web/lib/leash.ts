/**
 * The single place the web app gets a Leash client.
 * - Mock (in-memory) until devnet setup writes NEXT_PUBLIC_LEASH_VAULT, or when NEXT_PUBLIC_LEASH_MOCK=1.
 * - Real `LeashClient` from @leash/sdk otherwise. Both implement ILeashClient, so nothing else changes.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { LeashClient, type ILeashClient, type WalletLike } from "@leash/sdk";
import { MockLeashClient } from "./mock-leash";
import { ENV } from "./env";

/** Minimal wallet shape both the wallet adapter and a server Keypair wrapper satisfy. */
export interface LeashWallet {
  publicKey: PublicKey;
  signTransaction?: WalletLike["signTransaction"];
}

export const USE_MOCK = process.env.NEXT_PUBLIC_LEASH_MOCK === "1" || !ENV.vault;

export function programId(): PublicKey {
  return new PublicKey(ENV.programId || "Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");
}

export function createLeashClient(connection: Connection, wallet?: LeashWallet | Keypair): ILeashClient {
  if (USE_MOCK) return new MockLeashClient(connection, programId(), wallet?.publicKey);
  const w = wallet instanceof Keypair ? wallet : wallet?.signTransaction ? (wallet as WalletLike) : undefined;
  return new LeashClient({ connection, programId: programId(), wallet: w, blinkBaseUrl: ENV.siteUrl, cluster: "devnet" });
}

let browserClient: { c: ILeashClient; key: string } | null = null;

/** Browser singleton per wallet (keeps mock state across page navigations). */
export function getBrowserLeashClient(connection: Connection, wallet?: LeashWallet): ILeashClient {
  const key = USE_MOCK ? "mock" : (wallet?.publicKey?.toBase58() ?? "readonly");
  if (!browserClient || browserClient.key !== key) browserClient = { c: createLeashClient(connection, wallet), key };
  return browserClient.c;
}

export function isMock(c: ILeashClient): c is MockLeashClient {
  return (c as { isMock?: boolean }).isMock === true;
}

function mockOwner(client: ILeashClient): PublicKey {
  return (client as unknown as { owner?: PublicKey }).owner ?? PublicKey.default;
}

export function demoVault(client: ILeashClient): PublicKey {
  if (ENV.vault) return new PublicKey(ENV.vault);
  return client.vaultPda(mockOwner(client), 1n);
}

export function arenaVault(client: ILeashClient): PublicKey {
  if (ENV.arenaVault) return new PublicKey(ENV.arenaVault);
  return client.vaultPda(mockOwner(client), 2n);
}

export function dialToUrl(actionUrl: string): string {
  return `https://dial.to/?action=solana-action:${encodeURIComponent(actionUrl)}&cluster=devnet`;
}
