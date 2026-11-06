import { ArenaClient } from "@/components/arena/arena-client";
import { Footer } from "@/components/site/footer";
import { HeroFrame } from "@/components/site/hero-frame";
import { Nav } from "@/components/site/nav";

export const metadata = { title: "Red Team Arena · Leash" };

export default function ArenaPage() {
  return (
    <>
      <Nav />
      <main id="main" tabIndex={-1}>
        <HeroFrame
          variant="compact"
          eyebrow="Red Team Arena · devnet"
          heading={"Jailbreak the Agent.\nTry to Drain the Vault."}
          sub="Warden is a deliberately gullible agent guarding 10,000 dUSDC. Fool the model as often as you like. The Solana program is the one you have to beat."
        />
        <ArenaClient />
      </main>
      <Footer />
    </>
  );
}
