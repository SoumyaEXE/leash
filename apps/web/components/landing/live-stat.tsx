"use client";

import { useEffect, useState } from "react";
import { CountUp } from "../motion/count-up";

/** Reads the Arena scoreboard so the hero stat is a live number, not a claim. */
export function LiveArenaStat({ field }: { field: "attempts" | "fooled" | "blocked" | "drained" }) {
  const [v, setV] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/arena/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.score) setV(Number(j.score[field] ?? 0));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [field]);
  return v === null ? <span className="opacity-60">—</span> : <CountUp value={v} />;
}
