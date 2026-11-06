"use client";

import { HeroFrame } from "@/components/site/hero-frame";
import { Footer } from "@/components/site/footer";
import { VaultDashboard, VaultWalletButton } from "@/components/vault/vault-dashboard";
import { WalletShell } from "@/components/wallet/wallet-shell";
import { SectionLabel } from "@/components/motion/section-label";

export default function VaultPage() {
  return (
    <WalletShell>
      <HeroFrame
        variant="compact"
        eyebrow={<SectionLabel>Owner dashboard · devnet</SectionLabel>}
        heading="You decide what your agent can pay for."
        sub="Allowlist services with their own budgets, sign mandates for new ones, co-sign big payments, or stop everything with one switch. The Solana program enforces all of it."
        actions={<VaultWalletButton />}
      />
      <VaultDashboard />
      <Footer />
    </WalletShell>
  );
}
