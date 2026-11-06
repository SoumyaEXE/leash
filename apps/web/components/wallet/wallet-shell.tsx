"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import type { ReactNode } from "react";
import { ENV } from "@/lib/env";

/**
 * Devnet wallet context. Phantom (and any Wallet Standard wallet) registers itself, so no adapter list is
 * needed; this keeps @solana/wallet-adapter-wallets' huge dependency tree out of the bundle.
 */
export function WalletShell({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={ENV.rpc} config={{ commitment: "confirmed", wsEndpoint: ENV.ws }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
