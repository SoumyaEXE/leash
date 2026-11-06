"use client";

import { Connection, PublicKey } from "@solana/web3.js";
import { gsap } from "gsap";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SCENARIOS, type DemoBalances, type DemoRunResult, type DemoStep, type ScenarioId } from "@leash/sdk/demo";
import { ENV } from "@/lib/env";
import { mockBalances, mockRun } from "@/lib/demo-mock";
import { Badge, Container, Reveal, Sparkle } from "../cx/primitives";
import { prefersReducedMotion } from "../motion/reduced-motion";
import { Nav } from "../site/nav";
import { ResultCard } from "./result-card";

const ORDER: ScenarioId[] = ["s1", "s2", "s5", "s4"];
/** Tab labels come from the scenario titles, in the order a viewer should watch them. */
const LABEL: Record<ScenarioId, string> = { s1: SCENARIOS.s1.title, s2: SCENARIOS.s2.title, s5: SCENARIOS.s5.title, s4: SCENARIOS.s4.title };

type PanelState = { run: DemoRunResult | null; visible: number; showPayments: boolean };

/**
 * What is shared between the two panels, said plainly (red team A6): in the model scenarios the agent server
 * makes one model call per run and both bots read that same answer; the x402 scenarios have no model at all.
 */
const ONE_CALL = "Both panels show the same single model call: the server asks the model once and hands that answer to both bots.";
const SHARED_NOTE: Record<ScenarioId | "none", string> = {
  none: ONE_CALL,
  s1: ONE_CALL,
  s2: ONE_CALL,
  s5: "No model in this run: both agents call the same hostile paid API and get the same 402.",
  s4: "No model in this run: both agents call the same two paid APIs.",
};

/** Text of the run's model step, used to show that both panels display the same output. */
const modelText = (run: DemoRunResult | null) => run?.steps.find((x) => x.kind === "model")?.text ?? null;

function Balance({ value, unit = "dUSDC" }: { value: number | null; unit?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (value === null || !ref.current) return;
    const from = last.current ?? value;
    last.current = value;
    const o = { v: from };
    const t = gsap.to(o, {
      v: value,
      duration: from === value || prefersReducedMotion() ? 0 : 1.2,
      ease: "power3.out",
      onUpdate: () => {
        if (ref.current) ref.current.textContent = o.v.toLocaleString("en-US", { maximumFractionDigits: 2 });
      },
    });
    return () => {
      t.kill();
    };
  }, [value]);
  return (
    <span className="tabular-nums">
      <span ref={ref}>{value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
      <span className="ml-2 text-[0.45em] font-normal opacity-60">{unit}</span>
    </span>
  );
}

/** Morse, base58 addresses and signatures read as code; everything else as prose. */
const looksLikeCode = (t: string) => /^[-./ ]+$/.test(t) ||/[1-9A-HJ-NP-Za-km-z]{32,}/.test(t);

function Step({ s, shared }: { s: DemoStep; shared?: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (ref.current && !prefersReducedMotion())
      gsap.fromTo(ref.current, { opacity: 0, y: 8, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.45, ease: "power3.out" });
  }, []);
  const model = s.kind === "model";
  return (
    <li ref={ref} className="grid grid-cols-[minmax(112px,148px)_1fr] gap-5 border-b border-white/[0.07] py-3.5 last:border-0">
      <span className="pt-0.5 text-[15px] leading-6 text-white/65">{s.label}</span>
      {model ? (
        <span className="min-w-0">
          <span className="mono-read block rounded-[14px] border border-white/15 bg-white/[0.06] px-4 py-2.5 text-[16px] text-white [overflow-wrap:anywhere]">{s.text}</span>
          {shared && (
            <span className="mt-2 inline-flex items-center gap-2 text-[14px] text-white/70">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white/70" />
              One model call, same output in both panels
            </span>
          )}
        </span>
      ) : (
        <span
          className={`min-w-0 [overflow-wrap:anywhere] ${s.kind === "error" ? "text-[17px] leading-[27px] text-[#ffb0a6]" : looksLikeCode(s.text) ? "mono-read text-[15px] text-white/80" : "text-[17px] leading-[27px] text-white/90"}`}
        >
          {s.text}
        </span>
      )}
    </li>
  );
}

function Panel({
  title,
  tag,
  balance,
  before,
  state,
  mock,
  accent,
  sharedModel,
}: {
  title: string;
  tag: string;
  balance: number | null;
  before: number | null;
  state: PanelState;
  mock: boolean;
  accent: "plain" | "leash";
  sharedModel: boolean;
}) {
  const run = state.run;
  const headingId = `panel-${accent}`;
  return (
    <section aria-labelledby={headingId} className="cx-border cx-card flex min-h-0 flex-col overflow-hidden rounded-[20px]" style={{ ["--cx-angle" as string]: accent === "leash" ? "120deg" : "200deg" }}>
      <div className="flex items-end justify-between gap-6 border-b border-white/10 px-7 pb-6 pt-6">
        <div>
          <div className="text-[15px] text-white/65">{tag}</div>
          <h2 id={headingId} className="mt-1 text-[28px] leading-9 tracking-[-0.5px]">
            {title}
          </h2>
        </div>
        <div className="text-right">
          <div className="text-[15px] text-white/65">{accent === "leash" ? "Vault balance" : "Wallet balance"}</div>
          <div className="mt-1 whitespace-nowrap text-[48px] leading-none tracking-[-1px]">
            {before !== null && run && before !== balance && (
              <span className="mr-3 text-[0.45em] opacity-50 line-through">
                <span className="sr-only">was </span>
                {before.toLocaleString("en-US")}
              </span>
            )}
            <Balance value={balance} />
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-7 py-5">
        {!run ? (
          <div className="flex flex-1 items-center justify-center text-center text-[18px] text-white/60">Pick a scenario. Both agents get the exact same input.</div>
        ) : (
          <>
            <ol className="min-h-0 flex-1 overflow-y-auto">
              {run.steps.slice(0, state.visible).map((s, i) => (
                <Step key={`${run.scenario}-${i}`} s={s} shared={sharedModel && s.kind === "model"} />
              ))}
            </ol>
            <div aria-live="polite" className="flex flex-col gap-3">
              {state.showPayments && (
                <>
                  {run.payments.map((p, i) => (
                    <ResultCard key={`${run.scenario}-${i}-${p.status}`} p={p} mock={mock} leashed={accent === "leash"} />
                  ))}
                  {!run.ok && run.error && <div className="text-[17px] text-[#ffb0a6]">{run.error}</div>}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function DemoClient() {
  const params = useSearchParams();
  const mock = params.get("mock") === "1";
  const [balances, setBalances] = useState<DemoBalances | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<ScenarioId | "reset" | null>(null);
  const [active, setActive] = useState<ScenarioId | null>(null);
  const [victim, setVictim] = useState<PanelState>({ run: null, visible: 0, showPayments: false });
  const [leashed, setLeashed] = useState<PanelState>({ run: null, visible: 0, showPayments: false });
  const [before, setBefore] = useState<{ v: number; l: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mockBal = useRef({ victim: 1000, vault: 1000 });

  const refresh = useCallback(async () => {
    if (mock) {
      setBalances(mockBalances(mockBal.current.victim, mockBal.current.vault));
      setOffline(false);
      return;
    }
    let r: Response;
    try {
      r = await fetch(`${ENV.agentUrl}/balances`, { cache: "no-store" });
    } catch {
      setOffline(true); // agent server unreachable
      return;
    }
    setOffline(false);
    // A 5xx here is an RPC hiccup (devnet 429s): keep showing the last balances instead of zeros.
    if (r.ok) setBalances((await r.json()) as DemoBalances);
  }, [mock]);

  // live balances: account subscriptions on both token accounts + 3s polling fallback (public devnet WS is flaky)
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 3000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    if (mock || !balances?.victim.tokenAccount || !balances.vault.tokenAccount) return;
    const conn = new Connection(ENV.rpc, { commitment: "confirmed", wsEndpoint: ENV.ws });
    const ids: number[] = [];
    for (const acct of [balances.victim.tokenAccount, balances.vault.tokenAccount]) {
      try {
        ids.push(conn.onAccountChange(new PublicKey(acct), () => void refresh(), { commitment: "confirmed" }));
      } catch {
        /* polling covers it */
      }
    }
    return () => ids.forEach((id) => void conn.removeAccountChangeListener(id).catch(() => {}));
  }, [mock, balances?.victim.tokenAccount, balances?.vault.tokenAccount, refresh]);

  const reveal = (run: DemoRunResult, set: (s: PanelState) => void) =>
    new Promise<void>((resolve) => {
      let i = 0;
      const n = run.steps.length;
      set({ run, visible: 0, showPayments: false });
      const tick = () => {
        i += 1;
        set({ run, visible: i, showPayments: false });
        if (i < n) setTimeout(tick, 650);
        else
          setTimeout(() => {
            set({ run, visible: n, showPayments: true });
            resolve();
          }, 700);
      };
      setTimeout(tick, 250);
    });

  const runScenario = async (s: ScenarioId) => {
    setBusy(s);
    setActive(s);
    setNotice(null);
    setVictim({ run: null, visible: 0, showPayments: false });
    setLeashed({ run: null, visible: 0, showPayments: false });
    const b = { v: Number(balances?.victim.balance ?? 0), l: Number(balances?.vault.balance ?? 0) };
    setBefore(b);
    try {
      let res: { victim: DemoRunResult; leashed: DemoRunResult };
      if (mock) {
        await new Promise((r) => setTimeout(r, 900));
        res = { victim: mockRun(s, "victim", mockBal.current.victim), leashed: mockRun(s, "leashed", mockBal.current.vault) };
      } else {
        const r = await fetch(`${ENV.agentUrl}/run-split`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: s }) });
        if (!r.ok) throw new Error(`agent server answered ${r.status}`);
        res = await r.json();
      }
      await Promise.all([reveal(res.victim, setVictim), reveal(res.leashed, setLeashed)]);
      if (mock) {
        mockBal.current.victim = Number(res.victim.balanceAfter);
        mockBal.current.vault = Number(res.leashed.balanceAfter);
      }
      await refresh();
    } catch (e) {
      setNotice(`Run failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy("reset");
    setNotice(null);
    try {
      if (mock) {
        mockBal.current = { victim: 1000, vault: 1000 };
      } else {
        const r = await fetch(`${ENV.agentUrl}/reset`, { method: "POST" });
        const j = (await r.json()) as { ok: boolean; log: string[] };
        if (!j.ok) setNotice(`Reset: ${j.log.at(-1) ?? "failed"}`);
      }
      setVictim({ run: null, visible: 0, showPayments: false });
      setLeashed({ run: null, visible: 0, showPayments: false });
      setActive(null);
      setBefore(null);
      await refresh();
    } catch (e) {
      setNotice(`Reset failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const victimBal = balances ? Number(balances.victim.balance) : null;
  const vaultBal = balances ? Number(balances.vault.balance) : null;
  const vModel = modelText(victim.run);
  const sharedModel = vModel !== null && vModel === modelText(leashed.run);

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
      <div className="relative overflow-hidden pt-[150px]">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-440px] h-[760px] w-[1000px] -translate-x-1/2 rounded-full blur-[130px]" style={{ background: "rgb(252 109 1 / 0.36)" }} />
        <Container className="relative flex flex-col items-center pb-10 text-center">
          <Reveal>
            <Badge>Live on Solana devnet</Badge>
          </Reveal>
          <Reveal delay={80} as="h1" className="cx-h2 mt-9 max-w-[820px]">
            Same Model. Same Input.
            <br /> One Wallet Is on a Leash.
          </Reveal>
          <Reveal delay={160} as="p" className="cx-body mt-5 max-w-[640px] text-white/80">
            {active ? SCENARIOS[active].incident : "Both agents read the same post and get the same model output. Only the wallet is different."}
          </Reveal>
          <Reveal delay={220} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <div role="group" aria-label="Run a scenario" className="inline-flex flex-wrap justify-center gap-1 rounded-[60px] bg-white/[0.04] p-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] backdrop-blur-[10px]">
              {ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active === s}
                  disabled={!!busy || (offline && !mock)}
                  onClick={() => void runScenario(s)}
                  className={`h-11 rounded-[60px] px-5 text-[16px] transition-[background-color,color,box-shadow] duration-200 disabled:opacity-40 ${
                    active === s ? "bg-[#d32800] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22),inset_0_1px_0_rgb(255_255_255/0.25)]" : "text-white/75 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  {busy === s ? "Running…" : LABEL[s]}
                </button>
              ))}
            </div>
            <button type="button" disabled={!!busy || (offline && !mock)} onClick={() => void reset()} className="cx-btn-ghost cx-btn-sm !h-14">
              {busy === "reset" ? "Resetting…" : "Reset balances"}
            </button>
          </Reveal>
          <Reveal delay={260} as="p" className="mt-6 flex max-w-[760px] items-start justify-center gap-2.5 text-[16px] leading-[25px] text-white/75">
            <Sparkle size={16} className="mt-[4px] shrink-0" />
            <span>{SHARED_NOTE[active ?? "none"]}</span>
          </Reveal>
        </Container>
      </div>
      <Container className="flex flex-1 flex-col pb-10">
      {offline && !mock && (
        <div className="mt-2 rounded-[20px] border border-[#f5a524]/40 bg-[#f5a524]/[0.07] px-6 py-4 text-[15px] leading-6">
          The agent server at {ENV.agentUrl} isn't reachable. Start it with <b>pnpm --filter agent dev</b>, or open{" "}
          <a className="underline" href="/demo?mock=1">
            /demo?mock=1
          </a>{" "}
          for canned data.
        </div>
      )}
      {notice && <div className="mt-2 rounded-[20px] border border-white/15 px-6 py-3 text-[15px]">{notice}</div>}
      {mock && <div className="mt-2 text-center text-[14px] text-white/65">Mock mode: canned data, not onchain</div>}

      <div data-demo-panels className="mt-4 grid min-h-[560px] flex-1 gap-4 lg:grid-cols-2">
        <Panel title="Unprotected agent" tag="Hot wallet · Bankr pattern" balance={victimBal} before={before?.v ?? null} state={victim} mock={mock} accent="plain" sharedModel={sharedModel} />
        <Panel title="Leashed agent" tag="Leash vault · onchain policy" balance={vaultBal} before={before?.l ?? null} state={leashed} mock={mock} accent="leash" sharedModel={sharedModel} />
      </div>
      </Container>
      </main>
    </div>
  );
}
