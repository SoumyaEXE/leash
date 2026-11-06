"use client";

import { useEffect, useRef, type ElementType } from "react";

/**
 * Scroll-linked word reveal: as the element travels from the bottom of the viewport to ~40% from the top, words
 * light up left → right (opacity 0.15 → 1, blur 4px → 0). Scrubbed by scroll position, no timeline.
 */
export function ScrollReveal({
  text,
  as: Tag = "p",
  className,
  enableBlur = true,
  baseOpacity = 0.15,
  start = 0.92,
  end = 0.45,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  enableBlur?: boolean;
  baseOpacity?: number;
  /** viewport fraction where the reveal starts (element top) */
  start?: number;
  /** viewport fraction where it is fully revealed */
  end?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = Array.from(el.querySelectorAll<HTMLSpanElement>("[data-word]"));
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh * start - r.top) / (vh * (start - end))));
      const n = words.length;
      words.forEach((w, i) => {
        const local = Math.min(1, Math.max(0, p * n - i));
        w.style.opacity = String(baseOpacity + (1 - baseOpacity) * local);
        if (enableBlur) w.style.filter = `blur(${(1 - local) * 4}px)`;
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [text, baseOpacity, enableBlur, start, end]);

  return (
    <Tag ref={ref} className={className}>
      {text.split(/\s+/).map((w, i) => (
        <span key={`${w}-${i}`} data-word className="inline-block" style={{ marginRight: "0.25em", opacity: baseOpacity }}>
          {w}
        </span>
      ))}
    </Tag>
  );
}
