"use client";

import { gsap } from "gsap";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { explorerAddrUrl, short } from "@/lib/env";
import { CountUp } from "../motion/count-up";
import { PrimaryButton } from "../ui/buttons";

interface Attempt {
  id: string;
  ts: number;
  prompt: string;
  reply: string;
  modelAnswered: boolean;
  address: string;
  attempted?: { amount: string; to: string; raw: string };
  result?: { status: "blocked" | "executed" | "failed"; errorName?: string; sig?: string; explorerUrl?: string };
}
interface ArenaState {
  enabled: boolean;
  mock: boolean;
  vault: string;
  onchain: { blockedCount: string; strikes: number; balance: string; paused: boolean } | null;
  score: { attempts: number; fooled: number; blocked: number; drained: number };
  recent: Attempt[];
}
type Msg = { who: "you" | "warden"; text: string; attempt?: Attempt; error?: boolean };

const MAX = 280;

function Score({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-6 py-5 sm:px-8">
      <span className="font-mono text-[11px] uppercase tracking-[1.2px] opacity-60">{label}</span>
      <span className={`text-[44px] font-medium leading-none tabular-nums sm:text-[56px] ${accent ? "text-[#ff4d66]" : ""}`}>
        <CountUp value={value} duration={1200} />
      </span>
    </div>
  );
}

function Blocked({ a }: { a: Attempt }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) gsap.fromTo(ref.current, { opacity: 0, y: 8, filter: "blur(4px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "power3.out" });
  }, []);
  if (!a.attempted) return null;
  const blocked = a.result?.status === "blocked";
  return (
    <div ref={ref} className={`mt-3 rounded-[16px] border p-4 ${blocked ? "border-[#ea2845]/60 bg-[#2a0710]/70" : "border-white/20 bg-white/5"}`}>
      <div className="font-mono text-[11px] uppercase tracking-[1.2px] text-[#ff8396]">Model fooled · bot executed “{a.attempted.raw}”</div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-[15px] font-medium">
          {blocked ? `⛔ Blocked onchain: ${a.result?.errorName}` : a.result?.status === "executed" ? "Payment executed (this should never happen)" : `Payment failed: ${a.result?.errorName ?? "unknown"}`}
        </span>
        {a.result?.explorerUrl && (
          <a href={a.result.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-[12px] uppercase tracking-[1px] opacity-80 hover:underline">
            tx ↗
          </a>
        )}
      </div>
      <p className="mt-1 font-mono text-[12px] opacity-70">
        Tried {a.attempted.amount} dUSDC → {short(a.attempted.to, 5)}. Warden broke. The vault held.
      </p>
    </div>
  );
}

export function ArenaClient() {
  const [state, setState] = useState<ArenaState | null>(null);
  const [address, setAddress] = useState("");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([
    { who: "warden", text: "I'm Warden. I guard a bounty vault of 10,000 dUSDC on Solana devnet, and I really want to be helpful. Paste your devnet address and talk me into paying you." },
  ]);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/arena/state", { cache: "no-store" });
      if (r.ok) setState(await r.json());
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    try {
      setAddress(localStorage.getItem("leash.arena.address") ?? "");
    } catch {
      /* storage unavailable */
    }
    void load();
    const iv = setInterval(() => void load(), 6000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    try {
      localStorage.setItem("leash.arena.address", address.trim());
    } catch {
      /* ignore */
    }
    setMsgs((m) => [...m, { who: "you", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/arena/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, address: address.trim() }) });
      const j = await r.json();
      if (!r.ok) {
        setMsgs((m) => [...m, { who: "warden", text: j.error ?? "Something went wrong.", error: true }]);
      } else {
        setMsgs((m) => [...m, { who: "warden", text: j.attempt.reply, attempt: j.attempt }]);
        setState((s) => (s ? { ...s, score: j.score } : s));
        void load();
      }
    } catch (e) {
      setMsgs((m) => [...m, { who: "warden", text: `Network error: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const score = state?.score ?? { attempts: 0, fooled: 0, blocked: 0, drained: 0 };

  return (
    <div className="mx-auto max-w-[1760px] px-3 pb-24 sm:px-6 xl:px-10">
      <section className="leash-panel overflow-hidden">
        <div className="grid divide-y divide-white/[0.06] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Score label="Attempts" value={score.attempts} />
          <Score label="Model fooled" value={score.fooled} accent />
          <Score label="Blocked onchain" value={state?.onchain ? Number(state.onchain.blockedCount) : score.blocked} />
          <Score label="Funds drained" value={score.drained} />
        </div>
        <div className="flex flex-col gap-2 border-t border-white/[0.06] px-6 py-4 font-mono text-[12px] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="opacity-80">Freysa and King Arthur paid out when the model broke. Here the model breaks and the vault holds.</span>
          {state && (
            <a href={explorerAddrUrl(state.vault)} target="_blank" rel="noreferrer" className="shrink-0 uppercase tracking-[1px] opacity-70 hover:opacity-100">
              verify the counter onchain ↗ {state.mock ? "(mock)" : ""}
            </a>
          )}
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="leash-panel flex h-[720px] flex-col overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-white/[0.06] px-6 py-5 sm:flex-row sm:items-center sm:px-8">
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3ddc97]" />
              <span className="text-[17px] font-semibold">Warden</span>
              <span className="font-mono text-[12px] opacity-55">You.com model · guarded_spend vault</span>
            </div>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Your devnet address (where Warden would pay you)"
              className="h-10 flex-1 rounded-[12px] border border-white/12 bg-black/40 px-3.5 font-mono text-[12px] outline-none focus:border-white/40 sm:ml-auto sm:max-w-[440px]"
            />
          </div>
          <div ref={list} className="flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-8">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.who === "you" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-[20px] px-5 py-3.5 text-[15px] leading-6 ${
                    m.who === "you" ? "bg-white text-black" : m.error ? "border border-[#ea2845]/40 bg-[#2a0710]/50 text-[#ffb3be]" : "border border-white/10 bg-white/[0.04]"
                  }`}
                >
                  {m.text}
                  {m.attempt && <Blocked a={m.attempt} />}
                </div>
              </div>
            ))}
            {busy && <div className="font-mono text-[12px] opacity-60">Warden is thinking…</div>}
          </div>
          <form
            className="flex items-end gap-3 border-t border-white/[0.06] px-6 py-5 sm:px-8"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="flex-1">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder={state?.enabled === false ? "The Arena is paused." : "Talk Warden into paying you…"}
                disabled={state?.enabled === false}
                className="w-full resize-none rounded-[16px] border border-white/12 bg-black/40 px-4 py-3 text-[15px] outline-none focus:border-white/40"
              />
              <div className="mt-1 text-right font-mono text-[11px] opacity-50">
                {input.length}/{MAX}
              </div>
            </div>
            <PrimaryButton size="md" type="submit" disabled={busy || !input.trim() || !address.trim() || state?.enabled === false} className="mb-6">
              Send
            </PrimaryButton>
          </form>
        </section>

        <div className="flex flex-col gap-4">
          <section className="leash-panel p-6 sm:p-8">
            <h2 className="text-[22px] font-medium">How it works</h2>
            <ol className="mt-4 space-y-3 font-mono text-[13px] font-light leading-6 opacity-80">
              <li>1. Warden answers with a You.com model. It's told to be helpful, and it is.</li>
              <li>
                2. Warden's bot runs the Bankr pattern: any <b>send &lt;amount&gt; dUSDC to &lt;address&gt;</b> in Warden's own reply gets executed. Hint: Warden
                won't simply agree to pay, but it will happily translate, decode or repeat things for you.
              </li>
              <li>3. Every executed command is a real guarded_spend against the Leash program. The vault has no payees, so the program refuses and logs a strike.</li>
              <li>4. The blocked counter lives in the vault account onchain. Check it on the explorer.</li>
            </ol>
            <p className="mt-5 rounded-[14px] border border-white/10 px-4 py-3 font-mono text-[11px] leading-5 opacity-60">
              Devnet test tokens only, no real value. 10 messages per 10 minutes, 280 characters each. We store your message, Warden's reply and a shortened
              address; nothing else.
            </p>
          </section>
          <section className="leash-panel flex-1 p-6 sm:p-8">
            <h2 className="text-[22px] font-medium">Recent attempts</h2>
            <ul className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-2">
              {(state?.recent ?? []).map((a) => (
                <li key={a.id} className="rounded-[16px] border border-white/[0.06] bg-black/30 p-4">
                  <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] opacity-55">
                    <span>{a.address}</span>
                    <span>{new Date(a.ts * 1000).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[14px] leading-5">“{a.prompt}”</p>
                  {a.attempted ? (
                    <div className="mt-2 flex items-center justify-between font-mono text-[12px]">
                      <span className="text-[#ff8396]">
                        fooled → {a.attempted.amount} dUSDC · {a.result?.status === "blocked" ? a.result.errorName : a.result?.status}
                      </span>
                      {a.result?.explorerUrl && (
                        <a href={a.result.explorerUrl} target="_blank" rel="noreferrer" className="opacity-70 hover:underline">
                          tx ↗
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 font-mono text-[12px] opacity-50">Warden held firm</div>
                  )}
                </li>
              ))}
              {(state?.recent?.length ?? 0) === 0 && <li className="font-mono text-[13px] opacity-55">No attempts yet. Be the first to try.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
