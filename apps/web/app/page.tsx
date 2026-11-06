import { Hero } from "@/components/cx/hero";
import { Cta, Evidence, Faq, FeatureBento, IncidentGrid, Integrate, Numbers, SecurityBento, StackMarquee, VaultSplit } from "@/components/cx/sections";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <StackMarquee />
        <Numbers />
        <FeatureBento />
        <SecurityBento />
        <IncidentGrid />
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
