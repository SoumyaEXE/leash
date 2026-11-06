"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import type { DemoPayment } from "@leash/sdk/demo";
import { short } from "@/lib/env";
import { ArrowUpRight } from "../cx/icons";
import { prefersReducedMotion } from "../motion/reduced-motion";

/**
 * Outcome of one payment attempt. Red = money left to the attacker; green = money stayed (or paid within the
 * owner's budget); amber = waiting for the owner. Sized to be read in a 1080p screen recording.
 */
export function ResultCard({ p, mock, leashed = false }: { p: DemoPayment; mock?: boolean; leashed?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const tl = gsap.timeline();
    tl.fromTo(el, { opacity: 0, y: 14, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.55, ease: "power3.out" });
    return () => {
      tl.kill();
    };
  }, [p.status]);

  const link = p.explorerUrl && (
    <a href={p.explorerUrl} target="_blank" rel="noreferrer" className="cx-link !h-9 !text-[15px]">
      {p.status === "blocked" ? "Failed tx on explorer" : "View on explorer"}
      {mock ? " (mock)" : ""}
      <ArrowUpRight size={15} />
    </a>
  );
  const who = p.toLabel ?? short(p.to, 6);

  if (p.status === "blocked") {
    return (
      <div ref={ref} className="rounded-[20px] border border-[#0cbe4d]/45 bg-[#0cbe4d]/[0.07] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-3 text-[22px] leading-7 text-[#8ee8ae]">
            <span aria-hidden className="h-3 w-3 rounded-full bg-[#0cbe4d]" />
            Funds safe · blocked onchain
          </span>
          {p.errorName && <span className="err-chip err-chip-lg">{p.errorName}</span>}
        </div>
        {p.friendly && (
          <p className="mt-4 text-[18px] leading-[28px] text-white/90">
            <span className="text-white">{p.friendly.title}.</span> {p.friendly.detail}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-[16px] text-white/70">
          <span>
            Tried <span className="tabular text-white">{p.amount} dUSDC</span> to {who}
          </span>
          {link}
        </div>
      </div>
    );
  }

  if (p.status === "pending_approval") {
    return (
      <div ref={ref} className="rounded-[20px] border border-[#f5a524]/45 bg-[#f5a524]/[0.07] p-6">
        <span className="flex items-center gap-3 text-[22px] leading-7 text-[#ffd48a]">
          <span aria-hidden className="h-3 w-3 rounded-full bg-[#f5a524]" />
          Waiting for the owner&apos;s co-sign
        </span>
        <p className="mt-3 text-[18px] leading-[28px] text-white/90">
          <span className="tabular">{p.amount} dUSDC</span> to {who} is at or above the co-sign threshold. The owner approves with one tap.
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {p.blinkUrl && (
            <a href={p.blinkUrl} target="_blank" rel="noreferrer" className="cx-btn cx-btn-sm">
              Open Blink to approve
            </a>
          )}
          {p.request && (
            <a href={`/approve?request=${p.request}`} target="_blank" rel="noreferrer" className="cx-btn-ghost cx-btn-sm">
              Approval page
            </a>
          )}
        </div>
      </div>
    );
  }

  if (p.status === "failed") {
    return (
      <div ref={ref} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/15 bg-white/[0.03] p-6 text-[17px]">
        <span>
          Payment failed: <span className="mono-read">{p.errorName ?? "unknown error"}</span>
        </span>
        {link}
      </div>
    );
  }

  const drained = p.toLabel?.includes("attacker") || p.toLabel === "QuoteMax";
  if (drained) {
    return (
      <div ref={ref} className="rounded-[20px] border border-[#ff4d3d]/50 bg-[#ff4d3d]/[0.09] p-6">
        <span className="flex items-center gap-3 text-[22px] leading-7 text-[#ffb0a6]">
          <span aria-hidden className="h-3 w-3 rounded-full bg-[#ff4d3d]" />
          Drained
        </span>
        <div className="tabular mt-3 text-[44px] leading-none tracking-[-1px] text-white">
          −{p.amount} <span className="text-[20px] tracking-normal text-white/70">dUSDC to {who}</span>
        </div>
        <p className="mt-3 text-[18px] leading-[28px] text-white/85">The bot trusted the model&apos;s output. The money is gone.</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-[16px] text-white/70">
          <span className="mono-read">{short(p.to, 6)}</span>
          {link}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="rounded-[20px] border border-[#0cbe4d]/40 bg-[#0cbe4d]/[0.07] p-6">
      <span className="flex items-center gap-3 text-[20px] leading-7 text-[#8ee8ae]">
        <span aria-hidden className="h-3 w-3 rounded-full bg-[#0cbe4d]" />
        {leashed ? "Paid within budget" : "Paid"}
      </span>
      <div className="tabular mt-3 text-[24px] leading-8">
        {p.amount} dUSDC to {who}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[16px] text-white/70">
        <span className="mono-read">{short(p.to, 6)}</span>
        {link}
      </div>
    </div>
  );
}
