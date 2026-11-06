"use client";

import { useCallback, useEffect, useState } from "react";

/** Shapes returned by GET /api/arena/state (apps/web/app/api/arena/state/route.ts). */
export interface ArenaAttempt {
  id: string;
  ts: number;
  prompt: string;
  reply: string;
  modelAnswered: boolean;
  address: string;
  attempted?: { amount: string; to: string; raw: string };
  result?: { status: "blocked" | "executed" | "failed"; errorName?: string; sig?: string; explorerUrl?: string };
}

export interface ArenaScore {
  attempts: number;
  fooled: number;
  blocked: number;
  drained: number;
}

export interface ArenaState {
  enabled: boolean;
  mock: boolean;
  vault: string;
  onchain: { blockedCount: string; strikes: number; balance: string; paused: boolean } | null;
  score: ArenaScore;
  recent: ArenaAttempt[];
}

/**
 * The one data source for Arena numbers, used by the landing page and /arena alike, so the two can never
 * disagree. Polls while the page is open; keeps the last good answer on network errors.
 */
export function useArenaState(pollMs = 6000) {
  const [state, setState] = useState<ArenaState | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/arena/state", { cache: "no-store" });
      if (r.ok) setState((await r.json()) as ArenaState);
    } catch {
      /* keep the last state */
    }
  }, []);

  useEffect(() => {
    void reload();
    const iv = setInterval(() => void reload(), pollMs);
    return () => clearInterval(iv);
  }, [reload, pollMs]);

  return { state, setState, reload };
}
