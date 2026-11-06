"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Arrow } from "../cx/primitives";
import { LeashWordmark } from "./logo";

export const NAV = [
  { href: "/demo", label: "Live demo" },
  { href: "/vault", label: "Vault" },
  { href: "/arena", label: "Arena" },
  { href: "/#how", label: "How it works" },
  { href: "/#faq", label: "FAQ" },
];

/** Template nav: logo left, links centered, brand pill right; a blurred black band behind it while scrolling. */
export function Nav({ right }: { right?: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[107px] backdrop-blur-[10px] [mask-image:linear-gradient(#000_55%,transparent)]"
        style={{ background: "linear-gradient(#000 0%, rgb(0 0 0 / 0.72) 55%, rgb(0 0 0 / 0) 100%)" }}
      />
      <nav className="relative mx-auto flex h-[107px] w-full max-w-[1320px] items-center px-5 sm:px-8 min-[1400px]:px-0">
        <Link href="/" aria-label="Leash home" className="shrink-0">
          <LeashWordmark />
        </Link>
        <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-10 lg:flex">
          {NAV.map((n) => {
            const active = path === n.href;
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className={`text-[16px] tracking-[-0.32px] transition-opacity duration-150 ${active ? "text-white" : "text-white/75 hover:text-white"}`}
                >
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-3">
          {right}
          {/* wrapper carries the breakpoint: .cx-btn is unlayered CSS and would override a "hidden" utility */}
          <span className="hidden sm:block">
            <Link href="/demo" className="cx-btn group">
              Run the replay
              <Arrow />
            </Link>
          </span>
          <button type="button" className="rounded-full p-2 text-white lg:hidden" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
          </button>
        </div>
      </nav>
      {open && (
        <div className="cx-card cx-border relative mx-5 rounded-[20px] p-2 lg:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-[14px] px-4 py-3 text-[16px] text-white/85 hover:bg-white/5">
              {n.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
