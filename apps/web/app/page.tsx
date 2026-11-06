import idl from "@leash/sdk/idl/leash.json";
import { Hero } from "@/components/cx/hero";
import { ArenaLive, Cta, Evidence, Faq, FeatureBento, IncidentGrid, Integrate, Numbers, SecurityBento, StackMarquee, VaultSplit } from "@/components/cx/sections";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";

/** Program facts read from the IDL at build time, so the landing numbers follow the deployed program. */
const PROGRAM_FACTS = {
  instructions: idl.instructions.length,
  errors: idl.errors.length,
  events: idl.events?.length ?? 0,
};

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main" tabIndex={-1}>
        <Hero />
        <StackMarquee />
        <Numbers facts={PROGRAM_FACTS} />
        <FeatureBento />
        <SecurityBento />
        <IncidentGrid />
        <ArenaLive />
        <Integrate />
        <VaultSplit />
        <Evidence />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
