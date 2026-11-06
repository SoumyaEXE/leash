"use client";

import { useEffect, useState } from "react";
import { BlurIn } from "../motion/blur-in";

const PATHS = [
  {
    title: "Allowlisted payee",
    body: "The owner approves known services once, each with its own per-call limit and lifetime budget. x402 calls to them just work, within budget.",
  },
  {
    title: "Signed mandate",
    body: "For a new payee, the owner signs exact terms in Phantom: payee, max total, max per payment, expiry and intent. No SOL, no transaction.",
  },
  {
    title: "Live Blink co-sign",
    body: "Above the co-sign threshold a payment becomes a pending request. One tap on a Blink in Phantom, and the agent continues.",
  },
];

const PERIOD = 6000;

function Screen({ i }: { i: number }) {
  if (i === 0)
    return (
      <div className="font-mono text-[13px] leading-7">
        <div className="mb-4 text-[11px] uppercase tracking-[1px] opacity-50">payees · vault 1</div>
        {[
          ["Market Data API", "0.50", "0.10 / 5.00", "allowed"],
          ["Research API", "0.50", "0.25 / 5.00", "allowed"],
          ["7xKXtg…attacker", "—", "—", "PayeeNotAuthorized"],
        ].map(([l, p, b, s]) => (
          <div key={l} className="grid grid-cols-[1.4fr_0.6fr_1fr_1.2fr] gap-4 border-b border-white/5 py-2">
            <span>{l}</span>
            <span className="opacity-70">{p}</span>
            <span className="opacity-70">{b}</span>
            <span className={s === "allowed" ? "text-[#7ef0bd]" : "text-[#ff4d66]"}>{s}</span>
          </div>
        ))}
      </div>
    );
  if (i === 1)
    return (
      <pre className="whitespace-pre-wrap font-mono text-[13px] leading-6 text-white/85">
        {`LEASH_MANDATE_V1:
{
  vault:      "9pQ…v1",
  payee:      "Nansen API",
  max_total:  2.00 dUSDC,
  max_per_tx: 0.50 dUSDC,
  expires_at: 2026-11-15T00:00Z,
  intent:     "weekly wallet-flow reports",
  nonce:      3
}`}
        <span className="mt-3 block text-[#7ef0bd]">✓ signed by vault owner (Ed25519, verified onchain)</span>
      </pre>
    );
  return (
    <div className="mx-auto max-w-sm rounded-[20px] border border-white/10 bg-black/50 p-5">
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[1px] opacity-60">
        <span className="h-2 w-2 rounded-full bg-[#f5b544]" /> pending request · expires in 58:12
      </div>
      <div className="text-lg font-semibold">Approve 0.25 dUSDC to Research API?</div>
      <p className="mt-2 font-mono text-[12px] leading-5 opacity-70">Agent's reason: deep research summary on SOL ecosystem (x402 call)</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <div className="rounded-[12px] bg-white py-2.5 text-center text-sm font-bold text-black">Approve</div>
        <div className="rounded-[12px] border border-white/15 py-2.5 text-center text-sm font-bold">Reject</div>
      </div>
    </div>
  );
}

/** Product-panel layout: big title, a "screen", and three tabs with auto-advancing progress bars. */
export function ReleasePaths() {
  const [active, setActive] = useState(0);
  const [t0, setT0] = useState(0);
  const [p, setP] = useState(0);

  useEffect(() => {
    setT0(performance.now());
  }, [active]);

  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const prog = Math.min(1, (t - t0) / PERIOD);
      setP(prog);
      if (prog >= 1) setActive((a) => (a + 1) % PATHS.length);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [t0]);

  return (
    <div className="leash-panel relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[60%] bg-[radial-gradient(60%_60%_at_80%_10%,rgba(255,255,255,0.08),transparent)]" aria-hidden />
      <div className="relative px-6 pt-14 text-center sm:px-16 sm:pt-20">
        <h3 className="text-4xl font-medium sm:text-6xl">Three ways to say yes</h3>
        <p className="mx-auto mt-6 max-w-2xl font-mono text-sm font-light leading-6 opacity-80">
          Every payment needs one owner-signed authorization. Caps and a kill switch bound everything else.
        </p>
        <BlurIn inView distance={20} className="mx-auto mt-12 max-w-5xl">
          <div className="rounded-t-[24px] border border-b-0 border-white/10 bg-black/60 p-6 text-left sm:p-10">
            <Screen i={active} />
          </div>
        </BlurIn>
      </div>
      <div className="grid gap-8 border-t border-white/5 bg-[#141414] px-6 py-12 sm:px-12 md:grid-cols-3">
        {PATHS.map((x, i) => (
          <button
            key={x.title}
            type="button"
            onClick={() => setActive(i)}
            className={`text-left transition-opacity duration-300 ${active === i ? "opacity-100" : "opacity-40 hover:opacity-70"}`}
          >
            <h4 className="text-[22px] font-medium">{x.title}</h4>
            <p className="mt-4 min-h-[96px] font-mono text-sm font-light leading-6">{x.body}</p>
            <div className="mt-8 h-px w-full bg-white/15">
              <div className="h-px bg-white" style={{ width: active === i ? `${p * 100}%` : "0%" }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
