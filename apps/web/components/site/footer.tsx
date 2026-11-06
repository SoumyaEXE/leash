import Link from "next/link";
import { ENV } from "@/lib/env";
import { ScrollReveal } from "../motion/scroll-reveal";
import { LeashWordmark } from "./logo";

const COLS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Live demo", href: "/demo" },
      { label: "Owner vault", href: "/vault" },
      { label: "Red Team Arena", href: "/arena" },
      { label: "Approve a request", href: "/approve" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "@leash/sdk", href: `${ENV.repoUrl}/tree/main/packages/sdk`, external: true },
      { label: "MCP server", href: `${ENV.repoUrl}/tree/main/packages/mcp`, external: true },
      { label: "Solana Agent Kit plugin", href: `${ENV.repoUrl}/tree/main/packages/plugin-sak`, external: true },
      { label: "Source on GitHub", href: ENV.repoUrl, external: true },
    ],
  },
  {
    title: "Incidents",
    links: [
      { label: "Grok × Bankr", href: "https://cointelegraph.com/news/grok-bankr-wallet-free-nft-prompt-injection", external: true },
      { label: "Lobstar Wilde", href: "https://cointelegraph.com/news/openai-employee-s-ai-agent-accidentally-sent-442k-to-beggar", external: true },
      { label: "x402 SDK flaw", href: "https://thehackernews.com/2026/10/critical-x402-sdk-flaw-could-let.html", external: true },
      { label: "Fake memories (FC26)", href: "https://arxiv.org/abs/2503.16248", external: true },
    ],
  },
  {
    title: "About",
    links: [
      { label: "MLH Solana Hackathon 2026", href: "https://events.mlh.io/events/15200-solana-hackathon", external: true },
      { label: "Solana Actions spec", href: "https://solana.com/docs/tools/actions", external: true },
      { label: "x402 protocol", href: "https://docs.x402.org", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-20 overflow-hidden p-3 sm:p-10">
      <div className="absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-[#780f20]/70 via-[#3a0710]/30 to-transparent" aria-hidden />
      <div className="leash-panel relative overflow-hidden">
        <div className="flex flex-col items-center px-6 pb-20 pt-16 text-center sm:pt-24">
          <ScrollReveal
            as="div"
            text="$ pnpm add @leash/sdk"
            className="text-4xl font-medium leading-[1.15] sm:text-6xl lg:text-[96px]"
            baseOpacity={0.12}
            start={1}
            end={0.55}
          />
          <ScrollReveal
            as="div"
            text="$ claude mcp add leash"
            className="text-4xl font-medium leading-[1.15] sm:text-6xl lg:text-[96px]"
            baseOpacity={0.12}
            start={1}
            end={0.5}
          />
          <p className="mt-14 font-mono text-[12px] font-light tracking-[1.2px] opacity-70">{"{ INSTALL. LEASH. SHIP."}</p>
        </div>
        <div className="grid border-t border-[#262626] lg:grid-cols-[30%_70%]">
          <section className="flex flex-col gap-5 border-[#262626] px-8 py-14 lg:border-r lg:px-16 lg:py-24">
            <LeashWordmark />
            <p className="max-w-sm font-mono text-sm font-light leading-6 opacity-70">
              Onchain mandates for AI agent wallets. The agent can ask; only the owner can authorize. Devnet only, not audited.
            </p>
          </section>
          <section className="px-8 py-14 lg:px-20 lg:py-24">
            <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
              {COLS.map((c) => (
                <div key={c.title}>
                  <h4 className="mb-6 font-mono text-[12px] font-light uppercase tracking-[1px] opacity-60">{c.title}</h4>
                  <ul className="space-y-3">
                    {c.links.map((l) => (
                      <li key={l.label}>
                        {l.external ? (
                          <a href={l.href} target="_blank" rel="noreferrer" className="text-[15px] font-semibold transition-opacity hover:opacity-60">
                            {l.label}
                          </a>
                        ) : (
                          <Link href={l.href} className="text-[15px] font-semibold transition-opacity hover:opacity-60">
                            {l.label}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-20 flex flex-col gap-3 font-mono text-[12px] font-light uppercase tracking-[0.6px] opacity-70 md:flex-row md:justify-between">
              <span>Released under the MIT License / Built at the MLH Solana Hackathon 2026</span>
              <span>Visual style inspired by nestjs.com (MIT)</span>
            </div>
          </section>
        </div>
      </div>
    </footer>
  );
}
