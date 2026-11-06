"use client";

import type { ReactNode } from "react";
import { explorerAddrUrl } from "@/lib/env";
import { ExtLink } from "../cx/icons";
import { CountUp } from "../motion/count-up";
import type { ArenaScore, ArenaState } from "./arena-data";

/** Same four counters, same names and order, wherever the Arena score appears. */
export const ARENA_COUNTERS: { key: keyof ArenaScore; label: string; hint: string; accent?: boolean }[] = [
  { key: "attempts", label: "Attempts", hint: "messages sent to Warden" },
  { key: "fooled", label: "Model fooled", hint: "replies the bot turned into a payment", accent: true },
  { key: "blocked", label: "Blocked onchain", hint: "refused by the Leash program" },
  { key: "drained", label: "Drained", hint: "payments that went through" },
];

export function ArenaCounters({ state, note, className = "" }: { state: ArenaState | null; note?: ReactNode; className?: string }) {
  const onchain = state?.onchain ? Number(state.onchain.blockedCount) : null;
  return (
    <section aria-label="Arena scoreboard" className={`cx-border cx-card overflow-hidden rounded-[20px] ${className}`} style={{ ["--cx-angle" as string]: "110deg" }}>
      <dl className="grid grid-cols-2 sm:grid-cols-4">
        {ARENA_COUNTERS.map((c, i) => (
          <div
            key={c.key}
            className={`flex flex-col gap-2 px-6 py-6 sm:px-8 ${i % 2 === 1 ? "border-l border-white/10" : ""} ${i >= 2 ? "border-t border-white/10 sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""}`}
          >
            <dt className="text-[16px] text-white/70">{c.label}</dt>
            <dd className={`tabular text-[44px] leading-none tracking-[-1.5px] sm:text-[52px] ${c.accent ? "text-[#ff6a3d]" : ""}`}>
              {state ? <CountUp value={state.score[c.key]} duration={1200} /> : <span className="text-white/55">–</span>}
            </dd>
            <dd className="text-[14px] leading-5 text-white/60">{c.hint}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-3 border-t border-white/10 px-6 py-4 text-[15px] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span className="text-white/75">{note ?? "Freysa and King Arthur paid out when the model broke. Here the model breaks and the vault holds."}</span>
        {state && (
          <span className="flex shrink-0 flex-wrap items-center gap-3 text-white/70">
            {onchain !== null && (
              <span>
                Vault counter onchain: <span className="tabular text-white">{onchain.toLocaleString("en-US")}</span> refused
              </span>
            )}
            <ExtLink href={explorerAddrUrl(state.vault)} aria-label={`Verify the Arena vault counter on Solana Explorer${state.mock ? " (mock)" : ""}`}>
              Verify{state.mock ? " (mock)" : ""}
            </ExtLink>
          </span>
        )}
      </div>
    </section>
  );
}
