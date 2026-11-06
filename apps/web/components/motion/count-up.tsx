"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./reduced-motion";

/**
 * Counts from 0 to `value` once visible (ease-out cubic), then tweens between later values. Formats with
 * thousands separators. Jumps straight to the value when the visitor prefers reduced motion.
 */
export function CountUp({ value, duration = 2000, decimals = 0, className }: { value: number; duration?: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (v: number) => {
      shownRef.current = v;
      setShown(v);
    };
    if (prefersReducedMotion()) {
      started.current = true;
      set(value);
      return;
    }
    let raf = 0;
    const run = () => {
      const t0 = performance.now();
      const from = started.current ? shownRef.current : 0;
      started.current = true;
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const e = 1 - Math.pow(1 - p, 3);
        set(from + (value - from) * e);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}
