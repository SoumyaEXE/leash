import { ArenaClient } from "@/components/arena/arena-client";
import { SectionLabel } from "@/components/motion/section-label";
import { Footer } from "@/components/site/footer";
import { HeroFrame } from "@/components/site/hero-frame";

export const metadata = { title: "Red Team Arena · Leash" };

export default function ArenaPage() {
  return (
    <>
      <HeroFrame
        variant="compact"
        eyebrow={<SectionLabel>Red Team Arena · devnet</SectionLabel>}
        heading="Jailbreak the agent. Try to drain the vault."
        sub="Warden is a deliberately gullible agent guarding 10,000 dUSDC. Fool the model as often as you like. The Solana program is the one you have to beat."
      />
      <ArenaClient />
      <Footer />
    </>
  );
}
