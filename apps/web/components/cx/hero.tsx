"use client";

import Link from "next/link";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { prefersReducedMotion } from "../motion/reduced-motion";
import { Check, ChevronDown, Copy, Pause, Plus, Shield } from "./icons";
import { Arrow, Badge, Reveal } from "./primitives";

/**
 * Landing hero in the template's layout: centered badge, two-line gradient headline, sub, one CTA, then the
 * device collage. As the page scrolls, the side cards slide out from behind the phone and the flare lights up.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden pt-[148px]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-454px] h-[782px] w-[970px] -translate-x-1/2 rounded-full blur-[140px]"
        style={{ background: "rgb(252 109 1 / 0.4)" }}
      />
      <div className="relative mx-auto flex max-w-[1320px] flex-col items-center px-5 text-center">
        <Reveal>
          <Badge>Onchain guardrails for AI agent wallets</Badge>
        </Reveal>
        <Reveal delay={90} as="h1" className="cx-h1 mt-[34px] max-w-[860px]">
          Your Agent Can Be Fooled.
          <br />
          Your Vault Can&apos;t.
        </Reveal>
        <Reveal delay={180} as="p" className="mt-[30px] max-w-[500px] text-[16px] leading-[27.2px] text-white/85">
          Leash is a Solana program that holds an AI agent&apos;s funds and pays only what its owner approved.
        </Reveal>
        <Reveal delay={260} className="mt-[35px]">
          <Link href="/demo" className="cx-btn group">
            Watch the attack replay
            <Arrow />
          </Link>
        </Reveal>
      </div>
      <DeviceCollage />
    </section>
  );
}

/* ───────────── collage ───────────── */

/**
 * Scroll progress of the collage, written to a CSS variable so every layer can derive its own transform.
 * With reduced motion the cards sit in their final place and nothing moves with the scroll.
 */
function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.setProperty("--p", "1");
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const p = Math.min(1, Math.max(0, (window.scrollY - 60) / 560));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}

/** A card that starts tucked toward the phone and slides out to its place as --p goes 0 → 1. */
function Slide({ side, x, y, w, rotate = 0, children, className = "" }: { side: "l" | "r"; x: number; y: number; w: number; rotate?: number; children: ReactNode; className?: string }) {
  const dir = side === "l" ? 1 : -1;
  const style: CSSProperties = {
    left: `calc(50% + ${x}px)`,
    top: y,
    width: w,
    transform: `translateX(calc((1 - var(--p, 0)) * ${dir * 240}px)) scale(calc(0.84 + var(--p, 0) * 0.16)) rotate(calc(${rotate}deg * (0.4 + var(--p, 0) * 0.6)))`,
    opacity: "min(1, calc(var(--p, 0) * 1.8))",
    transformOrigin: side === "l" ? "right center" : "left center",
  };
  return (
    <div className={`absolute hidden will-change-transform md:block ${className}`} style={style}>
      {children}
    </div>
  );
}

function DeviceCollage() {
  const ref = useScrollProgress<HTMLDivElement>();
  return (
    // decorative: a mock of the vault UI; the real one is at /vault
    <div ref={ref} aria-hidden className="relative mx-auto mt-[188px] h-[640px] max-w-[1440px]" style={{ ["--p" as string]: 0 }}>
      {/* the template's flare, lit by scroll */}
      <img
        src="/cx/flare-hero.webp"
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-170px] w-[1800px] max-w-none -translate-x-1/2"
        style={{ opacity: "calc(0.12 + var(--p, 0) * 0.88)" }}
      />

      {/* tilted cards peek out from behind the phone (z below it) */}
      <Slide side="l" x={-272} y={290} w={196} rotate={-9} className="z-0">
        <Glass className="h-[214px] overflow-hidden p-4">
          <div className="text-[12px] text-white/60">Blocked attempts</div>
          <svg viewBox="0 0 160 120" className="mt-2 h-[140px] w-full" aria-hidden>
            <path
              d="M0 96 L8 70 L14 88 L20 40 L26 74 L32 52 L38 90 L46 30 L52 66 L58 48 L66 84 L72 22 L80 70 L88 58 L94 92 L102 44 L110 76 L118 36 L126 80 L134 60 L142 88 L150 50 L160 72"
              fill="none"
              stroke="#fc6d01"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <div className="text-[11px] text-white/45">Nov 01</div>
        </Glass>
      </Slide>
      <Slide side="r" x={206} y={300} w={200} rotate={30} className="z-0">
        <Glass className="h-[150px] p-4">
          <div className="flex items-center gap-2.5">
            <Coin className="bg-white text-black">W</Coin>
            <div>
              <div className="text-[16px] leading-5">Warden</div>
              <div className="text-[12px] text-white/50">(Arena)</div>
            </div>
          </div>
          <Spark className="mt-4 w-[120px]" />
        </Glass>
      </Slide>

      {/* phone */}
      <Reveal delay={200} className="absolute left-1/2 top-0 z-10 -translate-x-1/2" style={{ ["--cx-y" as string]: "150px" }}>
        <Phone />
      </Reveal>

      {/* left cluster */}
      <Slide side="l" x={-619} y={73} w={340} className="z-[5]">
        <Glass className="h-[190px] p-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex h-12 items-center gap-2 rounded-full border border-white/10 bg-black/30 pl-1.5 pr-3.5 text-[16px]">
              <Coin className="h-9 w-9 bg-[#2775ca] text-[15px] text-white">$</Coin>
              dUSDC
              <ChevronDown size={14} className="text-white/70" />
            </span>
            <Chip>Spend</Chip>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Chip>Agent</Chip>
            <span className="tabular text-[44px] leading-none tracking-[-1px]">500.00</span>
            <Chip tone="bad">Refused</Chip>
          </div>
          <div className="mt-4 text-center font-mono text-[13px] text-white/65">6004 · PayeeNotAuthorized</div>
        </Glass>
      </Slide>
      <Slide side="l" x={-619} y={286} w={340} className="z-[5]">
        <Row coin={<Coin className="bg-white text-[15px] text-black">M</Coin>} name="Market Data" sub="(x402)" value="0.05" delta="in budget" />
      </Slide>

      {/* right cluster */}
      <Slide side="r" x={277} y={73} w={338} className="z-[5]">
        <div
          className="relative h-[96px] overflow-hidden rounded-[20px] p-4 shadow-[0_20px_60px_rgb(0_0_0/0.45)]"
          style={{ background: "linear-gradient(100deg, rgb(240 88 42 / 0.92), rgb(226 64 34 / 0.9) 55%, rgb(244 128 90 / 0.85))" }}
        >
          <div className="flex items-center justify-between text-[16px] text-white/90">
            <span>24h cap</span>
            <span className="tabular text-[14px]">*** devnet</span>
          </div>
          <div className="tabular mt-1.5 text-[24px] leading-8">0.30 / 5.00</div>
          <span className="absolute bottom-4 right-4 flex" aria-hidden>
            <span className="h-4 w-4 rounded-full bg-[#ff3b30]/90" />
            <span className="-ml-1.5 h-4 w-4 rounded-full bg-[#ffb02e]/90" />
          </span>
        </div>
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/35" />
        </div>
      </Slide>
      <Slide side="r" x={277} y={200} w={338} className="z-[5]">
        <Row coin={<Coin className="bg-[#f7931a] text-white"><Check size={18} strokeWidth={2.2} /></Coin>} name="Research API" sub="(co-sign)" value="0.25" delta="via Blink" />
      </Slide>

      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[260px] bg-gradient-to-t from-black via-black/90 to-transparent" />
    </div>
  );
}

function Glass({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[24px] border border-white/[0.12] shadow-[0_24px_70px_rgb(0_0_0/0.55)] backdrop-blur-[14px] ${className}`}
      style={{ background: "linear-gradient(160deg, rgb(48 44 42 / 0.62), rgb(18 16 15 / 0.7))" }}
    >
      {children}
    </div>
  );
}

function Coin({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-medium ${className}`}>{children}</span>;
}

function Chip({ children, tone }: { children: ReactNode; tone?: "bad" }) {
  return (
    <span className={`inline-flex h-8 items-center rounded-full px-3.5 text-[14px] ${tone === "bad" ? "bg-[#d32800]/25 text-[#ffb39f]" : "bg-white/[0.08] text-white/90"}`}>
      {children}
    </span>
  );
}

function Spark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 28" className={className} aria-hidden>
      <path d="M0 22 C10 24 14 14 22 17 S34 25 42 18 54 8 62 12 74 16 80 9 92 4 100 2" fill="none" stroke="#2ad46b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Row({ coin, name, sub, value, delta }: { coin: ReactNode; name: string; sub: string; value: string; delta: string }) {
  return (
    <Glass className="flex h-[66px] items-center gap-3 rounded-[20px] px-3">
      {coin}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-[16px] leading-5">{name}</div>
        <div className="text-[12px] text-white/50">{sub}</div>
      </div>
      <Spark className="h-7 w-[60px] shrink-0" />
      <div className="w-[58px] shrink-0 text-right">
        <div className="tabular text-[16px] leading-5">{value}</div>
        <div className="text-[11px] text-[#2ad46b]">{delta}</div>
      </div>
    </Glass>
  );
}

/** The device: a Leash vault screen built in code, laid out like the template's wallet screen. */
function Phone() {
  return (
    <div
      className="relative h-[860px] w-[420px] origin-top rounded-[68px] p-[3px] max-sm:scale-[0.82] shadow-[0_50px_140px_rgb(0_0_0/0.85)] [mask-image:linear-gradient(#000_58%,transparent_80%)]"
      style={{ background: "linear-gradient(150deg, #e2cfae 0%, #7a6852 14%, #2b2723 32%, #161514 62%, #6f604d 88%, #c9b796 100%)" }}
    >
      <div className="h-full w-full rounded-[65px] bg-[#050505] p-[9px]">
        <div className="relative h-full w-full overflow-hidden rounded-[56px] bg-[#0b0705] text-left">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(118deg, transparent 34%, rgb(255 176 102 / 0.32) 47%, transparent 60%), radial-gradient(110% 62% at 72% 0%, rgb(255 122 32 / 0.95) 0%, rgb(211 40 0 / 0.6) 42%, rgb(30 8 2 / 0) 78%)",
            }}
          />
          {/* status bar + island */}
          <div className="relative flex h-[60px] items-center justify-between px-[38px] pt-2">
            <span className="text-[18px] font-semibold">9:41</span>
            <span className="absolute left-1/2 top-[18px] flex h-[36px] w-[120px] -translate-x-1/2 items-center justify-end gap-2 rounded-full bg-black pr-4" aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-[#ff4d1a]" />
            </span>
            <span className="flex items-center gap-1.5" aria-hidden>
              <span className="flex items-end gap-[2px]">
                {[5, 7, 9, 11].map((h) => (
                  <span key={h} className="w-[3px] rounded-sm bg-white" style={{ height: h }} />
                ))}
              </span>
              <span className="ml-1 h-[11px] w-[22px] rounded-[3px] border border-white/80 p-[1.5px]">
                <span className="block h-full w-[80%] rounded-[1.5px] bg-white" />
              </span>
            </span>
          </div>
          <div className="relative px-[26px] pt-5">
            <div className="flex items-center justify-between">
              <span className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/10 pl-1.5 pr-3 text-[13px] backdrop-blur-[6px]">
                <span className="flex">
                  <span className="grid h-[26px] w-[26px] place-items-center rounded-full border border-black/30 bg-[#2775ca] text-[12px]">$</span>
                  <span className="-ml-2 grid h-[26px] w-[26px] place-items-center rounded-full border border-black/30" style={{ background: "linear-gradient(135deg,#9945ff,#14f195)" }} />
                  <span className="-ml-2 grid h-[26px] w-[26px] place-items-center rounded-full border border-black/30 bg-[#f56a16]">
                    <Shield size={14} strokeWidth={2} />
                  </span>
                </span>
                Agent vault
                <ChevronDown size={13} />
              </span>
              <span className="flex gap-2.5" aria-hidden>
                <span className="grid h-10 w-10 place-items-center rounded-full text-black" style={{ background: "linear-gradient(135deg,#d8f36a,#8bd14b)" }}>
                  <Shield size={18} strokeWidth={2} />
                </span>
                <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-white/80 bg-[#2b1a12] text-[14px]">O</span>
              </span>
            </div>
            <div className="mt-7 text-[32px] font-semibold leading-9 tracking-[-0.5px]">Agent Vault</div>
            <div className="mt-2 flex items-center gap-2 text-[15px] text-white/70">
              (8Zx5Du…bQcpkK · devnet)
              <Copy size={16} />
            </div>
            <div className="mt-6 rounded-[24px] border border-white/10 bg-black/25 px-[18px] pb-4 pt-4 backdrop-blur-[10px]">
              <div className="text-[15px] text-white/80">Vault balance</div>
              <div className="tabular mt-1.5 flex items-baseline gap-2">
                <span className="text-[36px] font-semibold leading-10 tracking-[-0.5px]">1,000.00</span>
                <span className="text-[15px] text-white/70">dUSDC</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[14px]">
                <span className="text-[#2ad46b]">0 drained</span>
                <span className="text-white/70">· 6 refused this week</span>
              </div>
              <div className="mt-4 flex items-start gap-3">
                <span className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-full text-[19px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]" style={{ background: "linear-gradient(180deg,#ff7a1f,#f05a10)" }}>
                  <Plus size={20} strokeWidth={2} />
                  Add payee
                </span>
                {[
                  { l: "Approve", i: <Check size={20} /> },
                  { l: "Pause", i: <Pause size={20} /> },
                ].map((b) => (
                  <span key={b.l} className="flex flex-col items-center gap-1.5 text-[13px] text-white/85">
                    <span className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.07]">{b.i}</span>
                    {b.l}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <span className="text-[19px]">Payees</span>
              <span className="text-[15px] text-[#ff7a2e]">View all</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {[
                { n: "Market Data", s: "0.05 / 5.00", c: "M" },
                { n: "Research API", s: "0.25 / 5.00", c: "R" },
              ].map((p) => (
                <div key={p.n} className="flex items-center gap-2.5 rounded-[18px] border border-white/10 bg-white/[0.04] p-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-[13px]">{p.c}</span>
                  <div>
                    <div className="text-[14px] leading-4">{p.n}</div>
                    <div className="tabular mt-1 text-[11px] text-white/55">{p.s}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
