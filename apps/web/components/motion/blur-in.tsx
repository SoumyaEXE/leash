"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef, type ElementType, type ReactNode } from "react";

interface BlurInProps {
  children: ReactNode;
  /** seconds */
  delay?: number;
  /** seconds; nestjs.com uses 1.8 */
  duration?: number;
  /** px to rise from */
  distance?: number;
  /** start when scrolled into view instead of on mount */
  inView?: boolean;
  className?: string;
  as?: ElementType;
  targetOpacity?: number;
}

/** Fade + un-blur (+ optional rise). Timing per spec: 1.8s power3.out, blur 10px → 0. */
export function BlurIn({
  children,
  delay = 0,
  duration = 1.8,
  distance = 0,
  inView = false,
  className,
  as: Tag = "div",
  targetOpacity = 1,
}: BlurInProps) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.set(el, { opacity: 0, filter: "blur(10px)", y: distance });
    const play = () =>
      gsap.to(el, { opacity: targetOpacity, filter: "blur(0px)", y: 0, duration, delay, ease: "power3.out" });
    if (!inView) {
      const t = play();
      return () => {
        t.kill();
      };
    }
    let tween: gsap.core.Tween | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          tween = play();
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      tween?.kill();
    };
  }, [delay, duration, distance, inView, targetOpacity]);

  return (
    <Tag ref={ref} className={className} style={{ opacity: 0 }}>
      {children}
    </Tag>
  );
}
