"use client";

import { useEffect, useRef, useState } from "react";

/** "{ LABEL _" — mono 12px, 1.2px tracking, typed in when visible, blinking cursor. */
export function SectionLabel({ children, className = "" }: { children: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(0);
  const text = children.toUpperCase();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          let i = 0;
          timer = setInterval(() => {
            i += 1;
            setN(i);
            if (i >= text.length && timer) clearInterval(timer);
          }, 40);
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
    };
  }, [text]);

  return (
    <div ref={ref} className={`font-mono text-[12px] leading-4 font-light tracking-[1.2px] opacity-70 ${className}`}>
      <span>{"{ "}</span>
      <span>{text.slice(0, n)}</span>
      <span className="inline-block animate-blink tracking-[-0.3px]">{" _"}</span>
    </div>
  );
}
