"use client";

import { HeroFrame } from "@/components/site/hero-frame";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { VaultDashboard, VaultWalletButton } from "@/components/vault/vault-dashboard";
import { WalletShell } from "@/components/wallet/wallet-shell";

export default function VaultPage() {
  return (
    <WalletShell>
      <Nav />
      <main id="main" tabIndex={-1}>
        <HeroFrame
          variant="compact"
          eyebrow="Owner dashboard · devnet"
          heading={"You Decide What Your\nAgent Can Pay For."}
          sub="Allowlist services with their own budgets, sign mandates for new ones, co-sign big payments, or stop everything with one switch. The Solana program enforces all of it."
          actions={<VaultWalletButton />}
        />
        <VaultDashboard />
      </main>
      <Footer />
    </WalletShell>
  );
}
