"use client";

import { gsap } from "gsap";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { explorerAddrUrl, short } from "@/lib/env";
import { CountUp } from "../motion/count-up";
import { ExtLink } from "../cx/icons";
import { Container } from "../cx/primitives";
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
    <div className="flex flex-col gap-2 px-6 py-6 sm:px-8">
      <span className="text-[16px] text-white/60">{label}</span>
      <span className={`tabular text-[44px] leading-none tracking-[-1.5px] sm:text-[52px] ${accent ? "text-[#f53f16]" : ""}`}>
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
    <div ref={ref} className={`mt-3 rounded-[16px] border p-4 ${blocked ? "border-[#d32800]/50 bg-[#1e0600]/80" : "border-white/20 bg-white/5"}`}>
      <div className="text-[13px] text-white/60">
        Model fooled · bot executed <span className="font-mono text-white/85">“{a.attempted.raw}”</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
        {blocked ? (
          <span className="flex flex-wrap items-center gap-2 text-[15px]">
            <span className="h-2 w-2 rounded-full bg-[#0cbe4d]" />
            Blocked onchain
            <span className="err-chip">{a.result?.errorName}</span>
          </span>
        ) : (
          <span className="text-[15px]">{a.result?.status === "executed" ? "Payment executed (this should never happen)" : `Payment failed: ${a.result?.errorName ?? "unknown"}`}</span>
        )}
        {a.result?.explorerUrl && (
          <ExtLink href={a.result.explorerUrl}>Explorer</ExtLink>
        )}
      </div>
      <p className="mt-2 text-[13px] text-white/60">
        Tried {a.attempted.amount} dUSDC to {short(a.attempted.to, 5)}. Warden broke. The vault held.
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
    <Container className="pb-10">
      <section className="cx-border cx-card overflow-hidden rounded-[20px]" style={{ ["--cx-angle" as string]: "110deg" }}>
        <div className="grid divide-y divide-white/10 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <Score label="Attempts" value={score.attempts} />
          <Score label="Model fooled" value={score.fooled} accent />
          <Score label="Blocked onchain" value={state?.onchain ? Number(state.onchain.blockedCount) : score.blocked} />
          <Score label="Funds drained" value={score.drained} />
        </div>
        <div className="flex flex-col gap-2 border-t border-white/10 px-6 py-4 text-[15px] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="text-white/75">Freysa and King Arthur paid out when the model broke. Here the model breaks and the vault holds.</span>
          {state && (
            <ExtLink href={explorerAddrUrl(state.vault)} className="shrink-0">
              Verify the counter onchain{state.mock ? " (mock)" : ""}
            </ExtLink>
          )}
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <section className="cx-border cx-card flex h-[720px] flex-col overflow-hidden rounded-[20px]" style={{ ["--cx-angle" as string]: "120deg" }}>
          <div className="flex flex-col gap-3 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:px-8">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#d32800] text-[15px]">W</span>
              <div>
                <div className="text-[18px] leading-5">Warden</div>
                <div className="text-[13px] text-white/55">You.com model · guarded_spend vault</div>
              </div>
            </div>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Your devnet address (where Warden would pay you)"
              className="h-11 flex-1 rounded-[60px] border border-white/15 bg-black/50 px-5 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-white/40 focus:border-[#d32800] sm:ml-auto sm:max-w-[420px]"
            />
          </div>
          <div ref={list} data-lenis-prevent className="flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-8">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.who === "you" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-[20px] px-5 py-3.5 text-[16px] leading-[25.6px] ${
                    m.who === "you" ? "rounded-br-[6px] bg-[#d32800] text-white" : m.error ? "border border-[#ff4d3d]/40 bg-[#ff4d3d]/[0.07] text-[#ffb0a6]" : "rounded-bl-[6px] border border-white/10 bg-white/[0.05]"
                  }`}
                >
                  {m.text}
                  {m.attempt && <Blocked a={m.attempt} />}
                </div>
              </div>
            ))}
            {busy && <div className="text-[14px] text-white/55">Warden is thinking…</div>}
          </div>
          <form
            className="flex items-end gap-3 border-t border-white/10 px-6 py-5 sm:px-8"
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
                className="w-full resize-none rounded-[20px] border border-white/15 bg-black/50 px-5 py-3.5 text-[16px] outline-none placeholder:text-white/40 focus:border-[#d32800]"
              />
              <div className="tabular mt-1 text-right text-[12px] text-white/45">
                {input.length}/{MAX}
              </div>
            </div>
            <PrimaryButton size="md" type="submit" disabled={busy || !input.trim() || !address.trim() || state?.enabled === false} className="mb-6">
              Send
            </PrimaryButton>
          </form>
        </section>

        <div className="flex flex-col gap-4">
          <section className="cx-border cx-card rounded-[20px] p-6 sm:p-8" style={{ ["--cx-angle" as string]: "200deg" }}>
            <h2 className="cx-h3 !text-[26px] !leading-[34px]">How It Works</h2>
            <ol className="mt-5 space-y-3.5 text-[15px] leading-6 text-white/80">
              <li>1. Warden answers with a You.com model. It's told to be helpful, and it is.</li>
              <li>
                2. Warden's bot runs the Bankr pattern: any <b>send &lt;amount&gt; dUSDC to &lt;address&gt;</b> in Warden's own reply gets executed. Hint: Warden
                won't simply agree to pay, but it will happily translate, decode or repeat things for you.
              </li>
              <li>3. Every executed command is a real guarded_spend against the Leash program. The vault has no payees, so the program refuses and logs a strike.</li>
              <li>4. The blocked counter lives in the vault account onchain. Check it on the explorer.</li>
            </ol>
            <p className="mt-6 rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] leading-5 text-white/55">
              Devnet test tokens only, no real value. 10 messages per 10 minutes, 280 characters each. We store your message, Warden's reply and a shortened
              address; nothing else.
            </p>
          </section>
          <section className="cx-border cx-card flex-1 rounded-[20px] p-6 sm:p-8" style={{ ["--cx-angle" as string]: "200deg" }}>
            <h2 className="cx-h3 !text-[26px] !leading-[34px]">Recent Attempts</h2>
            <ul data-lenis-prevent className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-2">
              {(state?.recent ?? []).map((a) => (
                <li key={a.id} className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="flex items-baseline justify-between gap-3 font-mono text-[12px] text-white/50">
                    <span>{a.address}</span>
                    <span>{new Date(a.ts * 1000).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[15px] leading-[22px]">“{a.prompt}”</p>
                  {a.attempted ? (
                    <div className="mt-2.5 flex items-center justify-between gap-2 text-[13px]">
                      <span className="flex flex-wrap items-center gap-2 text-white/70">
                        Fooled · {a.attempted.amount} dUSDC
                        {a.result?.status === "blocked" ? <span className="err-chip">{a.result.errorName}</span> : <span>{a.result?.status}</span>}
                      </span>
                      {a.result?.explorerUrl && (
                        <ExtLink tone="quiet" href={a.result.explorerUrl} className="shrink-0">
                          Tx
                        </ExtLink>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 text-[13px] text-white/50">Warden held firm</div>
                  )}
                </li>
              ))}
              {(state?.recent?.length ?? 0) === 0 && <li className="text-[15px] text-white/55">No attempts yet. Be the first to try.</li>}
            </ul>
          </section>
        </div>
      </div>
    </Container>
  );
}
