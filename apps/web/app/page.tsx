import { BlurIn } from "@/components/motion/blur-in";
import { ScrollReveal } from "@/components/motion/scroll-reveal";
import { SectionLabel } from "@/components/motion/section-label";
import { BounceCards } from "@/components/landing/bounce-cards";
import { Credits } from "@/components/landing/credits";
import {
  IconAllowlist,
  IconCaps,
  IconCosign,
  IconKill,
  IconMandate,
  IconReason,
  IconTripwire,
} from "@/components/landing/icons";
import { Incidents } from "@/components/landing/incidents";
import { LiveArenaStat } from "@/components/landing/live-stat";
import { ReleasePaths } from "@/components/landing/release-paths";
import { Footer } from "@/components/site/footer";
import { HeroFrame } from "@/components/site/hero-frame";
import { GhostButton, PrimaryButton } from "@/components/ui/buttons";

const LAYERS = [
  { icon: <IconKill />, title: "Kill switch", description: "One owner flag pauses the vault. Nothing leaves until they unpause it." },
  { icon: <IconAllowlist />, title: "Allowlist", description: "Known payees only, each with its own per-call limit and budget." },
  { icon: <IconMandate />, title: "Mandates", description: "Owner-signed terms for a new payee: amount, expiry and intent." },
  { icon: <IconCaps />, title: "Caps", description: "Per-payment and rolling 24h caps bound the blast radius." },
  { icon: <IconCosign />, title: "Blink co-sign", description: "Big payments wait for one tap from the owner in Phantom." },
  { icon: <IconReason />, title: "Stated reason", description: "Every spend carries the agent's reason, hashed onchain." },
  { icon: <IconTripwire />, title: "Tripwire", description: "Blocked attempts become onchain strikes; enough of them freeze the vault." },
];

export default function Home() {
  return (
    <>
      <HeroFrame
        heading={"Your agent will get\nprompt-injected.\nYour money won't move."}
        sub="Leash is a Solana program that holds an AI agent's funds and only releases them when an owner-signed authorization covers the payment. The agent can ask. Only the owner can authorize."
        actions={
          <>
            <PrimaryButton href="/vault">Open dashboard</PrimaryButton>
            <GhostButton href="/arena">Try to jailbreak our agent →</GhostButton>
          </>
        }
        stats={[
          { label: "Arena attempts", value: <LiveArenaStat field="attempts" /> },
          { label: "Blocked onchain", value: <LiveArenaStat field="blocked" /> },
          { label: "Funds drained", value: "0" },
        ]}
      />

      {/* Incidents */}
      <section className="mt-20 flex justify-center md:mt-28">
        <div className="container mx-auto max-w-[1280px] px-5 md:px-0">
          <div className="grid gap-0 sm:grid-cols-[60%_5%_35%] md:grid-cols-[60%_10%_30%]">
            <div>
              <SectionLabel className="mb-4">Why this exists</SectionLabel>
              <ScrollReveal
                as="h2"
                className="mb-4 text-4xl font-medium leading-12 sm:text-3xl sm:leading-10 md:text-5xl md:leading-14"
                text="Every agent drain so far had the same root cause: the system treated the model's output as permission to move money"
              />
            </div>
            <span />
            <ScrollReveal
              as="p"
              className="pt-4 font-mono text-sm font-light leading-6 opacity-70 sm:pt-10"
              text="Prompts and off-chain filters can't fix that, because the attacker controls the model's input. Leash moves the decision out of the model and into a Solana program."
            />
          </div>
          <div className="mt-16">
            <Incidents />
          </div>
        </div>
      </section>

      {/* Layers: bounce cards */}
      <section className="flex justify-center overflow-hidden pb-16 pt-32 lg:pb-32 lg:pt-44">
        <BounceCards cards={LAYERS} />
      </section>

      <section className="flex justify-center px-6 sm:px-20">
        <div className="text-center">
          <ScrollReveal
            as="h2"
            text="Caps limit how much you lose."
            className="text-5xl font-medium leading-[1.05] sm:text-7xl lg:text-[112px]"
            baseOpacity={0.15}
          />
          <ScrollReveal
            as="h2"
            text="Mandates decide whether you lose anything."
            className="text-5xl font-medium leading-[1.05] sm:text-7xl lg:text-[112px]"
            baseOpacity={0.15}
            end={0.35}
          />
        </div>
      </section>

      {/* Release paths */}
      <section id="how" className="mt-32 scroll-mt-10 p-3 sm:p-10">
        <ReleasePaths />
      </section>

      {/* Arena teaser */}
      <section className="mt-24 flex justify-center">
        <div className="container mx-auto grid max-w-[1280px] items-end gap-10 px-5 md:grid-cols-[60%_10%_30%] md:px-0">
          <div>
            <SectionLabel className="mb-4">Red Team Arena</SectionLabel>
            <h2 className="text-4xl font-medium leading-12 md:text-5xl md:leading-14">
              Freysa and King Arthur paid out when the model broke. Here the model breaks and the vault holds.
            </h2>
          </div>
          <span />
          <BlurIn inView distance={10}>
            <p className="font-mono text-sm font-light leading-6 opacity-70">
              Chat with Warden, a deliberately gullible agent guarding a devnet bounty vault. Every payment it attempts runs for real against
              Leash. The counters are onchain, so you can check them yourself.
            </p>
            <div className="mt-8">
              <PrimaryButton href="/arena" size="md">
                Enter the Arena
              </PrimaryButton>
            </div>
          </BlurIn>
        </div>
      </section>

      {/* Prior work */}
      <section id="credits" className="mt-32 flex scroll-mt-10 justify-center">
        <div className="container mx-auto max-w-[1280px] px-5 md:px-0">
          <SectionLabel className="mb-4">Prior work we build on</SectionLabel>
          <div className="mb-12 grid gap-6 md:grid-cols-[60%_10%_30%]">
            <h2 className="text-4xl font-medium leading-12 md:text-5xl md:leading-14">
              Caps, allowlists, Blink approvals and signed intents exist. Leash puts all three release paths in one program.
            </h2>
            <span />
            <p className="font-mono text-sm font-light leading-6 opacity-70 md:pt-10">
              What's ours: per-service x402 budgets enforced onchain, three owner-signed ways to release money in one vault, live replays of
              real incidents, and an Arena whose counters live onchain.
            </p>
          </div>
          <Credits />
        </div>
      </section>

      <Footer />
    </>
  );
}
