"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Inertial page scroll (Lenis). Inner scroll areas opt out with data-lenis-prevent. Off for reduced motion. */
export function SmoothScroll() {
  const path = usePathname();
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ autoRaf: true, lerp: 0.1, anchors: { offset: -100 } });
    return () => lenis.destroy();
  }, [path]);
  return null;
}
