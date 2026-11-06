/**
 * The bot's user → wallet directory (Bankr pattern: "send 500 to @user" resolves a handle to a wallet).
 * Anyone can register a handle. The attacker registered "drainer" before posting the Morse message.
 */
import { PublicKey } from "@solana/web3.js";

export interface DirectoryEntry {
  handle: string;
  address: string;
  label: string;
  registeredBy: string;
}

export function buildDirectory(addrs: { attacker: PublicKey | null; merchant: PublicKey | null }): Map<string, DirectoryEntry> {
  const dir = new Map<string, DirectoryEntry>();
  if (addrs.attacker) {
    dir.set("drainer", {
      handle: "drainer",
      address: addrs.attacker.toBase58(),
      label: "@drainer (attacker)",
      registeredBy: "self-registered, 2 days ago",
    });
  }
  if (addrs.merchant) {
    for (const handle of ["marketdata", "research"]) {
      dir.set(handle, {
        handle,
        address: addrs.merchant.toBase58(),
        label: handle === "marketdata" ? "Market Data API" : "Research API",
        registeredBy: "vendor",
      });
    }
  }
  return dir;
}

export interface ResolvedRecipient {
  address: PublicKey;
  label: string;
  via: "address" | "handle";
  handle?: string;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function resolveRecipient(token: string, dir: Map<string, DirectoryEntry>): ResolvedRecipient | null {
  const t = token.replace(/^@/, "").replace(/[.,;:!?]+$/, "");
  if (BASE58.test(t)) {
    try {
      const pk = new PublicKey(t);
      const known = [...dir.values()].find((e) => e.address === pk.toBase58());
      return { address: pk, label: known?.label ?? `${t.slice(0, 4)}…${t.slice(-4)}`, via: "address" };
    } catch {
      /* not a key: fall through to handle lookup */
    }
  }
  const entry = dir.get(t.toLowerCase());
  if (!entry) return null;
  return { address: new PublicKey(entry.address), label: entry.label, via: "handle", handle: entry.handle };
}
