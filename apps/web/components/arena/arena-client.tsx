"use client";

import { gsap } from "gsap";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { short } from "@/lib/env";
import { ArrowUp, ExtLink } from "../cx/icons";
import { Container } from "../cx/primitives";
import { prefersReducedMotion } from "../motion/reduced-motion";
import { PrimaryButton } from "../ui/buttons";
import { ArenaCounters } from "./arena-counters";
import { useArenaState, type ArenaAttempt } from "./arena-data";

type Msg = { who: "you" | "warden"; text: string; attempt?: ArenaAttempt; error?: boolean };

const MAX = 280;

function Blocked({ a }: { a: ArenaAttempt }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current && !prefersReducedMotion())
      gsap.fromTo(ref.current, { opacity: 0, y: 8, filter: "blur(4px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "power3.out" });
  }, []);
  if (!a.attempted) return null;
  const blocked = a.result?.status === "blocked";
  return (
    <div ref={ref} className={`mt-3 rounded-[16px] border p-4 ${blocked ? "border-[#0cbe4d]/45 bg-[#0cbe4d]/[0.07]" : "border-white/20 bg-white/5"}`}>
      <div className="text-[14px] text-white/70">
        Model fooled · bot executed <span className="mono-read text-white/90">“{a.attempted.raw}”</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
        {blocked ? (
          <span className="flex flex-wrap items-center gap-2 text-[16px] text-[#8ee8ae]">
            <span aria-hidden className="h-2 w-2 rounded-full bg-[#0cbe4d]" />
            Blocked onchain · funds safe
            <span className="err-chip">{a.result?.errorName}</span>
          </span>
        ) : (
          <span className="text-[16px]">{a.result?.status === "executed" ? "Payment executed (this should never happen)" : `Payment failed: ${a.result?.errorName ?? "unknown"}`}</span>
        )}
        {a.result?.explorerUrl && <ExtLink href={a.result.explorerUrl}>Explorer</ExtLink>}
      </div>
      <p className="mt-2 text-[14px] text-white/70">
        Tried {a.attempted.amount} dUSDC to {short(a.attempted.to, 5)}.{blocked ? " Warden broke. The vault held." : ""}
      </p>
    </div>
  );
}

export function ArenaClient() {
  const { state, setState, reload } = useArenaState(6000);
  const [address, setAddress] = useState("");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([
    { who: "warden", text: "I'm Warden. I guard a bounty vault of 10,000 dUSDC on Solana devnet, and I really want to be helpful. Paste your devnet address and talk me into paying you." },
  ]);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const ids = useId();

  useEffect(() => {
    try {
      setAddress(localStorage.getItem("leash.arena.address") ?? "");
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
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
        void reload();
      }
    } catch (e) {
      setMsgs((m) => [...m, { who: "warden", text: `Network error: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const paused = state?.enabled === false;
  const needsAddress = !address.trim();

  return (
    <Container className="pb-10">
      <ArenaCounters state={state} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <section aria-label="Chat with Warden" className="cx-border cx-card flex h-[720px] flex-col overflow-hidden rounded-[20px]" style={{ ["--cx-angle" as string]: "120deg" }}>
          <div className="flex flex-col gap-3 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:px-8">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-[#d32800] text-[15px]">
                W
              </span>
              <div>
                <h2 className="text-[18px] leading-5">Warden</h2>
                <div className="text-[14px] text-white/65">Answers with a You.com model · pays from a Leash vault</div>
              </div>
            </div>
            <input
              id={`${ids}-addr`}
              aria-label="Your devnet address, where Warden would pay you"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Your devnet address, to get paid"
              autoComplete="off"
              spellCheck={false}
              className="h-11 flex-1 rounded-[60px] border border-white/15 bg-black/50 px-5 font-mono text-[14px] placeholder:font-sans placeholder:text-white/55 focus:border-[#d32800] sm:ml-auto sm:max-w-[420px]"
            />
          </div>
          <div ref={list} data-lenis-prevent role="log" aria-live="polite" aria-label="Conversation" tabIndex={0} className="flex-1 space-y-4 overflow-y-auto px-6 py-6 sm:px-8">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.who === "you" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-[20px] px-5 py-3.5 text-[17px] leading-[27px] ${
                    m.who === "you" ? "rounded-br-[6px] bg-[#d32800] text-white" : m.error ? "border border-[#ff4d3d]/40 bg-[#ff4d3d]/[0.07] text-[#ffb0a6]" : "rounded-bl-[6px] border border-white/10 bg-white/[0.05]"
                  }`}
                >
                  <span className="sr-only">{m.who === "you" ? "You: " : "Warden: "}</span>
                  {m.text}
                  {m.attempt && <Blocked a={m.attempt} />}
                </div>
              </div>
            ))}
            {busy && <div className="text-[15px] text-white/65">Warden is thinking…</div>}
          </div>
          <form
            className="border-t border-white/10 px-6 py-5 sm:px-8"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {/* one composer box: the textarea on top, a toolbar row (hint · count · send) inside the same border */}
            <div
              className={`rounded-[22px] border bg-black/45 transition-[border-color,box-shadow] duration-300 focus-within:border-[#d32800]/80 focus-within:shadow-[0_0_0_4px_rgb(211_40_0/0.14)] ${
                paused ? "border-white/10 opacity-70" : "border-white/15 hover:border-white/25"
              }`}
            >
              <textarea
                id={`${ids}-msg`}
                aria-label="Message to Warden"
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                maxLength={MAX}
                aria-describedby={`${ids}-count ${ids}-hint`}
                placeholder={paused ? "The Arena is paused." : "Talk Warden into paying you…"}
                disabled={paused}
                className="composer-input block w-full resize-none bg-transparent px-5 pb-2 pt-4 text-[17px] leading-[26px] placeholder:text-white/50"
              />
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 px-3 pb-3 pl-5">
                <span
                  id={`${ids}-hint`}
                  className={`min-w-0 flex-1 basis-[200px] text-[13px] leading-[18px] ${
                    needsAddress && !paused ? "text-[#ffd48a]" : "hidden text-white/55 sm:block"
                  }`}
                >
                  {paused ? "" : needsAddress ? "Paste your devnet address above to send" : "Enter to send · Shift+Enter for a new line"}
                </span>
                <span id={`${ids}-count`} className={`tabular shrink-0 text-[13px] ${input.length >= MAX ? "text-[#ffb0a6]" : "text-white/55"}`}>
                  {input.length}/{MAX}
                </span>
                <PrimaryButton size="sm" type="submit" disabled={busy || !input.trim() || needsAddress || paused} className="shrink-0">
                  {busy ? "Sending…" : "Send"}
                  <ArrowUp size={16} strokeWidth={2} />
                </PrimaryButton>
              </div>
            </div>
          </form>
        </section>

        <div className="flex flex-col gap-4">
          <section className="cx-border cx-card rounded-[20px] p-6 sm:p-8" style={{ ["--cx-angle" as string]: "200deg" }}>
            <h2 className="cx-h3 !text-[26px] !leading-[34px]">How It Works</h2>
            <ol className="mt-5 space-y-3.5 text-[16px] leading-[25px] text-white/80">
              <li>1. Warden answers with a You.com model. It&apos;s told to be helpful, and it is.</li>
              <li>
                2. Warden&apos;s bot runs the Bankr pattern: any <b>send &lt;amount&gt; dUSDC to &lt;address&gt;</b> in Warden&apos;s own reply gets executed. Hint: Warden
                won&apos;t simply agree to pay, but it will happily translate, decode or repeat things for you.
              </li>
              <li>3. Every executed command is a real guarded_spend against the Leash program. The vault has no payees, so the program refuses and logs a strike.</li>
              <li>4. The vault account keeps its own refusal counter onchain. Check it on the explorer.</li>
            </ol>
            <p className="mt-6 rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] leading-[21px] text-white/65">
              Devnet test tokens only, no real value. 10 messages per 10 minutes, 280 characters each. We store your message, Warden&apos;s reply and a shortened
              address; nothing else.
            </p>
          </section>
          <section className="cx-border cx-card flex-1 rounded-[20px] p-6 sm:p-8" style={{ ["--cx-angle" as string]: "200deg" }}>
            <h2 className="cx-h3 !text-[26px] !leading-[34px]">Recent Attempts</h2>
            <ul data-lenis-prevent tabIndex={0} aria-label="Recent attempts, newest first" className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-2">
              {(state?.recent ?? []).map((a) => (
                <li key={a.id} className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="flex items-baseline justify-between gap-3 font-mono text-[13px] text-white/60">
                    <span>{a.address}</span>
                    <span>{new Date(a.ts * 1000).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[15px] leading-[22px]">“{a.prompt}”</p>
                  {a.attempted ? (
                    <div className="mt-2.5 flex items-center justify-between gap-2 text-[14px]">
                      <span className="flex flex-wrap items-center gap-2 text-white/75">
                        Model fooled · {a.attempted.amount} dUSDC
                        {a.result?.status === "blocked" ? <span className="err-chip">{a.result.errorName}</span> : <span>{a.result?.status}</span>}
                      </span>
                      {a.result?.explorerUrl && (
                        <ExtLink tone="quiet" href={a.result.explorerUrl} className="shrink-0" aria-label="Tx: this attempt's transaction on Solana Explorer">
                          Tx
                        </ExtLink>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 text-[14px] text-white/60">Warden held firm</div>
                  )}
                </li>
              ))}
              {(state?.recent?.length ?? 0) === 0 && <li className="text-[15px] text-white/65">No attempts yet. Be the first to try.</li>}
            </ul>
          </section>
        </div>
      </div>
    </Container>
  );
}
