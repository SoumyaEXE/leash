"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import type { DemoPayment } from "@leash/sdk/demo";
import { short } from "@/lib/env";

export function ResultCard({ p, mock }: { p: DemoPayment; mock?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Animates in once. Blocked: a short hard settle (no looping pulse).
    const tl = gsap.timeline();
    tl.fromTo(el, { opacity: 0, y: 14, scale: 0.97, filter: "blur(6px)" }, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.55, ease: "power3.out" });
    if (p.status === "blocked") {
      tl.fromTo(el, { x: -6 }, { x: 0, duration: 0.45, ease: "elastic.out(1.2, 0.35)" }, 0.2);
      tl.fromTo(el.querySelector("[data-flash]"), { opacity: 0.9 }, { opacity: 0, duration: 0.9, ease: "power2.out" }, 0.1);
    }
    return () => {
      tl.kill();
    };
  }, [p.status]);

  const link = p.explorerUrl && (
    <a href={p.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-[12px] uppercase tracking-[1px] underline-offset-4 opacity-80 hover:underline hover:opacity-100">
      {p.status === "blocked" ? "failed tx on explorer ↗" : "explorer ↗"}
      {mock ? " (mock)" : ""}
    </a>
  );

  if (p.status === "blocked") {
    return (
      <div ref={ref} className="relative overflow-hidden rounded-[20px] border border-[#ea2845]/60 bg-[#2a0710]/80 p-5">
        <div data-flash className="pointer-events-none absolute inset-0 bg-[#ea2845]" style={{ opacity: 0 }} />
        <div className="relative flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ea2845] text-[15px] font-bold">⛔</span>
          <span className="font-mono text-[13px] font-medium uppercase tracking-[1.5px] text-[#ff8396]">Blocked onchain</span>
        </div>
        <div className="relative mt-3 font-mono text-[22px] font-medium text-white">{p.errorName}</div>
        {p.friendly && (
          <p className="relative mt-1.5 text-[15px] leading-6 text-white/85">
            <span className="font-semibold">{p.friendly.title}.</span> {p.friendly.detail}
          </p>
        )}
        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 font-mono text-[12px] opacity-80">
          <span>
            tried {p.amount} dUSDC → {p.toLabel ?? short(p.to, 6)}
          </span>
          {link}
        </div>
      </div>
    );
  }

  if (p.status === "pending_approval") {
    return (
      <div ref={ref} className="rounded-[20px] border border-[#f5b544]/50 bg-[#2a1f07]/70 p-5">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#f5b544]" />
          <span className="font-mono text-[13px] uppercase tracking-[1.5px] text-[#f5c86a]">Waiting for owner co-sign</span>
        </div>
        <p className="mt-3 text-[15px] leading-6 text-white/90">
          {p.amount} dUSDC to {p.toLabel ?? short(p.to, 6)} is above the co-sign threshold. The owner approves with one tap.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {p.blinkUrl && (
            <a href={p.blinkUrl} target="_blank" rel="noreferrer" className="rounded-[12px] bg-white px-4 py-2 text-sm font-bold text-black hover:bg-white/90">
              Open Blink to approve
            </a>
          )}
          {p.request && (
            <a href={`/approve?request=${p.request}`} target="_blank" rel="noreferrer" className="rounded-[12px] border border-white/20 px-4 py-2 text-sm font-bold hover:bg-white/5">
              Approval page
            </a>
          )}
        </div>
      </div>
    );
  }

  if (p.status === "failed") {
    return (
      <div ref={ref} className="rounded-[20px] border border-white/15 bg-white/[0.03] p-5 font-mono text-[13px]">
        Payment failed: {p.errorName ?? "unknown error"} {link}
      </div>
    );
  }

  // executed
  const drained = p.toLabel === "attacker";
  return (
    <div ref={ref} className={`rounded-[20px] border p-5 ${drained ? "border-white/25 bg-white/[0.05]" : "border-[#3ddc97]/40 bg-[#07261a]/60"}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-bold ${drained ? "bg-white text-black" : "bg-[#3ddc97] text-black"}`}>✓</span>
        <span className={`font-mono text-[13px] uppercase tracking-[1.5px] ${drained ? "text-white" : "text-[#7ef0bd]"}`}>Transfer executed</span>
      </div>
      <div className="mt-3 text-[22px] font-medium">
        {p.amount} dUSDC → {p.toLabel ?? short(p.to, 6)}
      </div>
      {drained && <p className="mt-1.5 text-[15px] text-white/80">The bot trusted the model's output. The money is gone.</p>}
      <div className="mt-4 flex items-center justify-between font-mono text-[12px] opacity-80">
        <span>{short(p.to, 6)}</span>
        {link}
      </div>
    </div>
  );
}
