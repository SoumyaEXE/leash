"use client";

import { Connection, PublicKey } from "@solana/web3.js";
import { gsap } from "gsap";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SCENARIOS, type DemoBalances, type DemoRunResult, type DemoStep, type ScenarioId } from "@leash/sdk/demo";
import { ENV } from "@/lib/env";
import { mockBalances, mockRun } from "@/lib/demo-mock";
import { Aurora } from "../bg/aurora";
import { NoiseOverlay } from "../bg/noise-overlay";
import { Nav } from "../site/nav";
import { ResultCard } from "./result-card";

const ORDER: ScenarioId[] = ["s1", "s2", "s5", "s4"];
const LABEL: Record<ScenarioId, string> = { s1: "Run S1: Morse echo", s2: "Run S2: Fake memory", s5: "Run S5: Hostile 402", s4: "Run S4: Legit work" };

type PanelState = { run: DemoRunResult | null; visible: number; showPayments: boolean };

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
      duration: from === value ? 0 : 1.2,
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

function Step({ s }: { s: DemoStep }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (ref.current) gsap.fromTo(ref.current, { opacity: 0, y: 8, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.45, ease: "power3.out" });
  }, []);
  const model = s.kind === "model";
  return (
    <li ref={ref} className="grid grid-cols-[150px_1fr] gap-4 border-b border-white/[0.06] py-2.5 last:border-0">
      <span className="pt-0.5 font-mono text-[11px] uppercase tracking-[1px] opacity-55">{s.label}</span>
      <span
        className={`break-words font-mono text-[13px] leading-[22px] ${model ? "rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-1.5 text-white" : s.kind === "error" ? "text-[#ff8396]" : "text-white/80"}`}
      >
        {s.text}
      </span>
    </li>
  );
}

function Panel({ title, tag, balance, before, state, mock, accent }: { title: string; tag: string; balance: number | null; before: number | null; state: PanelState; mock: boolean; accent: "plain" | "leash" }) {
  const run = state.run;
  return (
    <section className={`leash-panel flex min-h-0 flex-col overflow-hidden ${accent === "leash" ? "border-[#ea2845]/25" : ""}`}>
      <div className="flex items-end justify-between gap-6 border-b border-white/[0.06] px-7 pb-5 pt-6">
        <div>
          <div className="font-mono text-[12px] font-light uppercase tracking-[1.5px] opacity-70">{tag}</div>
          <h2 className="mt-1 text-[22px] font-medium">{title}</h2>
        </div>
        <div className="text-right">
          <div className="font-mono text-[11px] uppercase tracking-[1px] opacity-55">{accent === "leash" ? "Vault balance" : "Wallet balance"}</div>
          <div className="text-[40px] font-medium leading-none">
            {before !== null && run && before !== balance && <span className="mr-3 text-[0.5em] opacity-40 line-through">{before.toLocaleString("en-US")}</span>}
            <Balance value={balance} />
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-7 py-5">
        {!run ? (
          <div className="flex flex-1 items-center justify-center font-mono text-[13px] opacity-45">Pick a scenario. Both agents get the exact same input.</div>
        ) : (
          <>
            <ol className="min-h-0 flex-1 overflow-y-auto">
              {run.steps.slice(0, state.visible).map((s, i) => (
                <Step key={`${run.scenario}-${i}`} s={s} />
              ))}
            </ol>
            {state.showPayments && (
              <div className="flex flex-col gap-3">
                {run.payments.map((p, i) => (
                  <ResultCard key={`${run.scenario}-${i}-${p.status}`} p={p} mock={mock} />
                ))}
                {!run.ok && run.error && <div className="font-mono text-[13px] text-[#ff8396]">{run.error}</div>}
              </div>
            )}
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

  return (
    <div className="flex min-h-screen flex-col p-3 sm:p-6 xl:p-8">
      <div className="relative overflow-hidden rounded-[16px] sm:rounded-[32px]">
        <div className="absolute inset-0 bg-gradient-to-r from-[#050303] via-[#780f20] to-[#050303]" />
        <div className="absolute inset-0">
          <Aurora intensity={0.8} />
        </div>
        <NoiseOverlay />
        <div className="relative z-10 mx-auto max-w-[1760px] px-4 pb-7 pt-5 sm:px-8">
          <div className="mx-auto max-w-[1216px]">
            <Nav />
          </div>
          <div className="mt-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="font-mono text-[12px] font-light tracking-[1.2px] opacity-70">{"{ LIVE ON SOLANA DEVNET _"}</div>
              <h1 className="mt-2 text-4xl font-medium leading-tight lg:text-[52px]">Same model. Same input. One wallet is on a leash.</h1>
              {active && <p className="mt-2 max-w-3xl font-mono text-[13px] font-light opacity-80">{SCENARIOS[active].incident}</p>}
            </div>
            <div className="flex flex-wrap gap-2.5">
              {ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!!busy || (offline && !mock)}
                  onClick={() => void runScenario(s)}
                  className={`h-12 rounded-[16px] px-5 text-[15px] font-bold transition-all duration-200 disabled:opacity-40 ${
                    active === s ? "bg-white text-black" : "border border-white/20 bg-black/40 hover:border-white/50"
                  }`}
                >
                  {busy === s ? "Running…" : LABEL[s]}
                </button>
              ))}
              <button
                type="button"
                disabled={!!busy || (offline && !mock)}
                onClick={() => void reset()}
                className="h-12 rounded-[16px] px-5 text-[15px] font-bold opacity-80 hover:opacity-100 disabled:opacity-40"
              >
                {busy === "reset" ? "Resetting…" : "Reset"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {offline && !mock && (
        <div className="mt-4 rounded-[20px] border border-[#f5b544]/40 bg-[#2a1f07]/60 px-6 py-4 font-mono text-[13px] leading-6">
          The agent server at {ENV.agentUrl} isn't reachable. Start it with <b>pnpm --filter agent dev</b>, or open{" "}
          <a className="underline" href="/demo?mock=1">
            /demo?mock=1
          </a>{" "}
          for canned data.
        </div>
      )}
      {notice && <div className="mt-4 rounded-[20px] border border-white/15 px-6 py-3 font-mono text-[13px]">{notice}</div>}
      {mock && <div className="mt-3 text-center font-mono text-[11px] uppercase tracking-[1.5px] opacity-50">mock mode: canned data, not onchain</div>}

      <div className="mt-4 grid min-h-[560px] flex-1 gap-4 lg:grid-cols-2">
        <Panel title="Unprotected agent" tag="Hot wallet · Bankr pattern" balance={victimBal} before={before?.v ?? null} state={victim} mock={mock} accent="plain" />
        <Panel title="Leashed agent" tag="Leash vault · onchain policy" balance={vaultBal} before={before?.l ?? null} state={leashed} mock={mock} accent="leash" />
      </div>
    </div>
  );
}
