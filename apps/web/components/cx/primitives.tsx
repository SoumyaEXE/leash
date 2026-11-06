"use client";

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";
import { ArrowRight } from "./icons";

/** The template's 4-point sparkle, redrawn: a big star and a small one, brand orange. */
export function Sparkle({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id="cx-sp" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fc6d01" />
          <stop offset="1" stopColor="#f53f16" />
        </linearGradient>
      </defs>
      <path d="M10 2c.5 4.6 2.4 6.6 7 7.1-4.6.5-6.5 2.4-7 7-.5-4.6-2.4-6.5-7-7 4.6-.5 6.5-2.5 7-7.1Z" fill="url(#cx-sp)" />
      <path d="M18.5 14c.25 2.2 1.1 3.1 3.3 3.35-2.2.25-3.05 1.15-3.3 3.35-.25-2.2-1.15-3.1-3.35-3.35 2.2-.25 3.1-1.15 3.35-3.35Z" fill="url(#cx-sp)" />
    </svg>
  );
}

/** Pill badge with the gradient border and sparkle. */
export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`cx-badge cx-border ${className}`}>
      <Sparkle size={18} />
      {children}
    </span>
  );
}

/** Framer-style appear on scroll: fade, rise 32px, un-blur. */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
  style,
}: {
  children: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`cx-reveal ${className}`} style={{ ...style, ["--cx-delay" as string]: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/**
 * Section heading. Centered by default; "split" puts the title left and the paragraph bottom-right,
 * and only applies when there is a paragraph to fill the right side.
 */
export function SectionHead({
  badge,
  title,
  text,
  split = false,
  className = "",
}: {
  badge: string;
  title: ReactNode;
  text?: ReactNode;
  split?: boolean;
  /** @deprecated centered is the default */
  center?: boolean;
  className?: string;
}) {
  if (!split || !text) {
    return (
      <div className={`flex flex-col items-center text-center ${className}`}>
        <Reveal>
          <Badge>{badge}</Badge>
        </Reveal>
        <Reveal delay={80} as="h2" className="cx-h2 mt-10 max-w-[820px]">
          {title}
        </Reveal>
        {text && (
          <Reveal delay={160} as="p" className="cx-body mt-6 max-w-[440px]">
            {text}
          </Reveal>
        )}
      </div>
    );
  }
  return (
    <div className={`grid gap-8 lg:grid-cols-[1fr_440px] lg:items-end ${className}`}>
      <div>
        <Reveal>
          <Badge>{badge}</Badge>
        </Reveal>
        <Reveal delay={80} as="h2" className="cx-h2 mt-10 max-w-[720px]">
          {title}
        </Reveal>
      </div>
      {text && (
        <Reveal delay={160} as="p" className="cx-body lg:pb-2">
          {text}
        </Reveal>
      )}
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1320px] px-5 sm:px-8 min-[1400px]:px-0 ${className}`}>{children}</div>;
}

/** Arrow used inside buttons; nudges right when the parent has the "group" class and is hovered. */
export function Arrow({ className = "" }: { className?: string }) {
  return <ArrowRight size={18} className={`transition-transform duration-200 group-hover:translate-x-0.5 ${className}`} />;
}
