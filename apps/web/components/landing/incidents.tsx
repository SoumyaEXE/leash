import { BlurIn } from "../motion/blur-in";
import { Spotlight } from "../ui/spotlight";

const INCIDENTS = [
  {
    when: "May 2026 · Base",
    title: "Grok × Bankr",
    amount: "over $150,000",
    what: "A hidden Morse-code instruction. Grok decoded it, and the bot executed the model's own output as a transfer. No key leak, no contract bug.",
    src: "https://cointelegraph.com/news/grok-bankr-wallet-free-nft-prompt-injection",
    srcLabel: "Cointelegraph",
  },
  {
    when: "Feb 2026 · Solana",
    title: "Lobstar Wilde",
    amount: "~$441,000",
    what: "An agent sent its token stash to a stranger who asked for 4 SOL. A payee allowlist would have stopped it.",
    src: "https://cointelegraph.com/news/openai-employee-s-ai-agent-accidentally-sent-442k-to-beggar",
    srcLabel: "Cointelegraph",
  },
  {
    when: "Oct 2026 · x402",
    title: "x402 SDK flaw",
    amount: "full balance",
    what: "V12 showed the default x402 client had no spending limit: a hostile API could simply ask for everything.",
    src: "https://thehackernews.com/2026/10/critical-x402-sdk-flaw-could-let.html",
    srcLabel: "The Hacker News",
  },
  {
    when: "FC26 · ElizaOS",
    title: "Fake memories",
    amount: "unauthorized transfers",
    what: "Princeton and Sentient injected 'memories' that steer agents into payments, an attack the paper calls stealthy and persistent.",
    src: "https://arxiv.org/abs/2503.16248",
    srcLabel: "arXiv 2503.16248",
  },
];

export function Incidents() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {INCIDENTS.map((x, i) => (
        <BlurIn key={x.title} inView delay={i * 0.08} distance={12}>
          <Spotlight className="leash-card h-full rounded-[24px]" color="rgba(234,40,69,0.10)">
            <article className="relative z-10 flex h-full min-h-[320px] flex-col p-7">
              <div className="font-mono text-[12px] font-light uppercase tracking-[1px] opacity-60">{x.when}</div>
              <h3 className="mt-6 text-2xl font-medium">{x.title}</h3>
              <div className="mt-1 text-[40px] font-medium leading-tight text-[#ff4d66]">{x.amount}</div>
              <p className="mt-4 font-mono text-[13px] font-light leading-6 opacity-70">{x.what}</p>
              <a
                href={x.src}
                target="_blank"
                rel="noreferrer"
                className="mt-auto pt-6 font-mono text-[12px] uppercase tracking-[1px] opacity-70 transition-opacity hover:opacity-100"
              >
                Source: {x.srcLabel} ↗
              </a>
            </article>
          </Spotlight>
        </BlurIn>
      ))}
    </div>
  );
}
