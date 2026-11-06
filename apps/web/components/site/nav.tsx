"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ENV, explorerAddrUrl } from "@/lib/env";
import { Spotlight } from "../ui/spotlight";
import { LeashMark } from "./logo";

export const NAV = [
  { href: "/demo", label: "Live demo" },
  { href: "/vault", label: "Vault" },
  { href: "/arena", label: "Arena" },
  { href: "/#how", label: "How it works" },
  { href: "/#credits", label: "Prior work" },
];

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function ChainIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </svg>
  );
}

/** Floating pill nav: radius 32, rgba(0,0,0,.6), 20px padding, links 16/500 with 20px side padding. */
export function Nav({ right }: { right?: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const programUrl = ENV.programId ? explorerAddrUrl(ENV.programId) : "https://explorer.solana.com/?cluster=devnet";
  return (
    <div className="relative rounded-[16px] sm:rounded-[32px]">
      <Spotlight className="rounded-[16px] sm:rounded-[32px]">
        <div className="pointer-events-none absolute inset-0 rounded-[16px] border border-white/10 sm:rounded-[32px]" />
        <nav className="relative flex items-center rounded-[16px] bg-black/60 p-5 sm:rounded-[32px]">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Leash home">
            <LeashMark size={40} />
            <span className="hidden text-[20px] font-semibold tracking-[-0.02em] sm:inline">Leash</span>
          </Link>
          <ul className="mx-auto hidden items-center lg:flex">
            {NAV.map((n) => {
              const active = path === n.href;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    className={`block px-5 text-base font-medium transition-all duration-300 hover:opacity-100 ${active ? "opacity-100" : "opacity-90 hover:text-white"}`}
                  >
                    <span className={active ? "border-b border-[#ea2845] pb-0.5" : ""}>{n.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="ml-auto flex items-center gap-5 lg:ml-0">
            {right}
            <a href={ENV.repoUrl} target="_blank" rel="noreferrer" className="opacity-90 transition-opacity duration-150 hover:opacity-60" aria-label="Source on GitHub">
              <GithubIcon />
            </a>
            <a href={programUrl} target="_blank" rel="noreferrer" className="opacity-90 transition-opacity duration-150 hover:opacity-60" aria-label="Program on Solana Explorer (devnet)">
              <ChainIcon />
            </a>
            <button type="button" className="lg:hidden" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
              </svg>
            </button>
          </div>
        </nav>
      </Spotlight>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-[24px] border border-white/15 bg-black/80 p-2 backdrop-blur-lg lg:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-[16px] px-4 py-3 font-medium hover:bg-white/10">
              {n.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
