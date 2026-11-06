/**
 * True when the visitor asked the OS for less motion. CSS transitions are already cut in globals.css; this is
 * for the JS-driven tweens (GSAP, count-ups, scroll-linked transforms), which CSS can't reach.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
