"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

/** Words fade + un-blur one after another: 0.85s each, 0.15s stagger, power3.out (spec: hero H1). */
export function WordByWord({
  text,
  delay = 0,
  stagger = 0.15,
  duration = 0.85,
  className,
}: {
  text: string;
  delay?: number;
  stagger?: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const words = ref.current?.querySelectorAll<HTMLSpanElement>("[data-word]");
    if (!words?.length) return;
    const t = gsap.fromTo(
      words,
      { opacity: 0, filter: "blur(10px)" },
      { opacity: 1, filter: "blur(0px)", duration, stagger, delay, ease: "power3.out" },
    );
    return () => {
      t.kill();
    };
  }, [text, delay, stagger, duration]);

  return (
    <span ref={ref} className={className}>
      {/* "\n" in the text forces a line break (only on lg+, where the hero type is large) */}
      {text.split("\n").map((line, li) => (
        <span key={li}>
          {li > 0 && <br className="hidden lg:block" />}
          {line
            .trim()
            .split(/\s+/)
            .map((w, i) => (
              <span key={`${w}-${i}`} data-word className="inline-block" style={{ marginRight: "0.25em", opacity: 0 }}>
                {w}
              </span>
            ))}{" "}
        </span>
      ))}
    </span>
  );
}
