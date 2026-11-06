"use client";

import Link from "next/link";
import { useState } from "react";
import { ENV } from "@/lib/env";
import { ArrowUpRight, Check, Copy } from "../cx/icons";
import { Container, Reveal } from "../cx/primitives";
import { LeashWordmark } from "./logo";

const COLS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Live demo", href: "/demo" },
      { label: "Owner vault", href: "/vault" },
      { label: "Red Team Arena", href: "/arena" },
      { label: "Approve a request", href: "/approve" },
      { label: "How it works", href: "/#how" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "TypeScript SDK", href: `${ENV.repoUrl}/tree/main/packages/sdk`, external: true },
      { label: "MCP server", href: `${ENV.repoUrl}/tree/main/packages/mcp`, external: true },
      { label: "Agent Kit plugin", href: `${ENV.repoUrl}/tree/main/packages/plugin-sak`, external: true },
      { label: "x402 protocol", href: "https://docs.x402.org", external: true },
      { label: "Source", href: ENV.repoUrl, external: true },
    ],
  },
];

const INSTALL = "pnpm add @leash/sdk";

/** Template footer: brand + tagline, two link columns, the install pill, and a giant wordmark melting into the glow. */
export function Footer() {
  const [copied, setCopied] = useState(false);
  return (
    <footer className="relative mt-[120px] overflow-hidden border-t border-white/10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 118%, rgb(252 109 1 / 0.85) 0%, rgb(211 40 0 / 0.45) 35%, rgb(60 8 0 / 0.25) 60%, transparent 80%), linear-gradient(#000, #120200)",
        }}
      />
      <Container className="relative">
        <div className="grid gap-12 pb-10 pt-16 md:grid-cols-[1fr_auto]">
          <div className="max-w-[282px]">
            <LeashWordmark />
            <div className="mt-6 border-t border-white/10 pt-6 text-[18px] leading-[27px] text-white/60">The agent can ask. Only the owner can authorize.</div>
            <div className="mt-6 text-[14px] text-white/40">© 2026 Leash · MIT · Devnet only</div>
          </div>
          <div className="grid gap-12 sm:grid-cols-[auto_auto_358px] sm:gap-[90px]">
            {COLS.map((c) => (
              <div key={c.title}>
                <div className="text-[20px] tracking-[-0.3px]">{c.title}</div>
                <ul className="mt-5 space-y-[10px]">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a href={l.href} target="_blank" rel="noreferrer" className="cx-small group inline-flex items-center gap-1 transition-colors hover:text-[#ff8a6b]">
                          {l.label}
                          <ArrowUpRight size={13} className="opacity-0 transition-opacity group-hover:opacity-100" />
                        </a>
                      ) : (
                        <Link href={l.href} className="cx-small transition-colors hover:text-[#ff8a6b]">
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <div className="text-[20px] tracking-[-0.3px]">Install</div>
              <div className="mt-5 flex h-[60px] items-center justify-between rounded-[60px] bg-black/40 pl-6 pr-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)] backdrop-blur-[8px]">
                <code className="font-mono text-[14px] text-white/85">{INSTALL}</code>
                <button
                  type="button"
                  aria-label="Copy install command"
                  className="cx-btn !h-12 !px-4 !text-[16px]"
                  onClick={() => {
                    navigator.clipboard?.writeText(INSTALL).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1400);
                    });
                  }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Container>
      {/* giant wordmark, cut by the footer edge and blended into the glow */}
      <Reveal className="relative -mb-[0.2em] select-none text-center" style={{ ["--cx-y" as string]: "80px" }}>
        <div
          aria-hidden
          className="font-semibold leading-[0.8] tracking-[-0.07em] mix-blend-screen"
          style={{
            fontSize: "clamp(120px, 29vw, 470px)",
            backgroundImage: "linear-gradient(180deg, rgb(255 236 226 / 0.55) 0%, rgb(255 140 80 / 0.28) 45%, rgb(211 40 0 / 0.05) 85%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          LEASH
        </div>
      </Reveal>
    </footer>
  );
}
