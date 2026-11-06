"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Slot-machine number: each digit is a reel that spins a couple of turns and settles on its value when the
 * number scrolls into view. Non-digit characters ($, k, %, ~, .) stay put. Screen readers get the plain value.
 */
export function SlotNumber({ value, className = "", duration = 2600, delay = 0, turns = 2 }: { value: string; className?: string; duration?: number; delay?: number; turns?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInstant(true);
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  let reel = 0;
  return (
    <span ref={ref} className={`tabular inline-flex items-baseline ${className}`}>
      <span className="sr-only">{value}</span>
      {value.split("").map((c, i) => {
        if (!/\d/.test(c)) {
          return (
            <span key={i} aria-hidden className="inline-block whitespace-pre leading-[1.15]">
              {c}
            </span>
          );
        }
        const n = reel++;
        const target = (turns + n) * 10 + Number(c); // later reels spin one extra turn each, and still land on the digit
        return (
          <span
            key={i}
            aria-hidden
            className="relative inline-block overflow-hidden leading-[1.15] [mask-image:linear-gradient(transparent,#000_18%,#000_82%,transparent)]"
            style={{ height: "1.15em" }}
          >
            <span
              className="block"
              style={{
                transform: `translateY(${on ? -target * 1.15 : 0}em)`,
                transition: instant ? "none" : `transform ${duration + n * 280}ms cubic-bezier(0.12, 0.75, 0.18, 1) ${delay + n * 110}ms`,
              }}
            >
              {Array.from({ length: target + 1 }, (_, k) => (
                <span key={k} className="block" style={{ height: "1.15em" }}>
                  {k % 10}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
