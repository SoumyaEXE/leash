"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import type { DemoPayment } from "@leash/sdk/demo";
import { short } from "@/lib/env";
import { ArrowUpRight } from "../cx/icons";

/** Outcome of one payment attempt. Red = money left to the attacker; green = money stayed; amber = waiting for the owner. */
export function ResultCard({ p, mock }: { p: DemoPayment; mock?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tl = gsap.timeline();
    tl.fromTo(el, { opacity: 0, y: 14, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.55, ease: "power3.out" });
    return () => {
      tl.kill();
    };
  }, [p.status]);

  const link = p.explorerUrl && (
    <a href={p.explorerUrl} target="_blank" rel="noreferrer" className="cx-link">
      {p.status === "blocked" ? "Failed tx on explorer" : "View on explorer"}
      {mock ? " (mock)" : ""}
      <ArrowUpRight size={14} />
    </a>
  );
  const who = p.toLabel ?? short(p.to, 6);

  if (p.status === "blocked") {
    return (
      <div ref={ref} className="cx-border cx-glow-soft rounded-[20px] p-6" style={{ ["--cx-angle" as string]: "120deg" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 text-[16px]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#0cbe4d]" />
            Blocked onchain · funds safe
          </span>
          {p.errorName && <span className="err-chip">{p.errorName}</span>}
        </div>
        {p.friendly && (
          <p className="mt-4 text-[16px] leading-[25.6px] text-white/90">
            <span className="text-white">{p.friendly.title}.</span> {p.friendly.detail}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-[14px] text-white/60">
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
        <span className="flex items-center gap-2.5 text-[16px]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#f5a524]" />
          Waiting for the owner&apos;s co-sign
        </span>
        <p className="mt-3 text-[16px] leading-[25.6px] text-white/90">
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
      <div ref={ref} className="rounded-[20px] border border-white/15 bg-white/[0.03] p-6 text-[15px]">
        Payment failed: <span className="font-mono">{p.errorName ?? "unknown error"}</span> {link}
      </div>
    );
  }

  const drained = p.toLabel?.includes("attacker") || p.toLabel === "QuoteMax";
  if (drained) {
    return (
      <div ref={ref} className="rounded-[20px] border border-[#ff4d3d]/45 bg-[#ff4d3d]/[0.08] p-6">
        <span className="flex items-center gap-2.5 text-[16px] text-[#ffb0a6]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff4d3d]" />
          Drained
        </span>
        <div className="tabular mt-3 text-[28px] leading-none tracking-[-0.5px]">
          −{p.amount} <span className="text-[16px] text-white/60">dUSDC to {who}</span>
        </div>
        <p className="mt-3 text-[16px] text-white/80">The bot trusted the model&apos;s output. The money is gone.</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-[14px] text-white/60">
          <span className="font-mono">{short(p.to, 6)}</span>
          {link}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="rounded-[20px] border border-[#0cbe4d]/40 bg-[#0cbe4d]/[0.07] p-6">
      <span className="flex items-center gap-2.5 text-[16px] text-[#8ee8ae]">
        <span className="h-2.5 w-2.5 rounded-full bg-[#0cbe4d]" />
        Paid within budget
      </span>
      <div className="tabular mt-3 text-[22px]">
        {p.amount} dUSDC to {who}
      </div>
      <div className="mt-4 flex items-center justify-between text-[14px] text-white/60">
        <span className="font-mono">{short(p.to, 6)}</span>
        {link}
      </div>
    </div>
  );
}
