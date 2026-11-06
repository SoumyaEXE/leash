"use client";

import { type ReactNode } from "react";
import { Aurora } from "../bg/aurora";
import { NoiseOverlay } from "../bg/noise-overlay";
import { BlurIn } from "../motion/blur-in";
import { WordByWord } from "../motion/word-by-word";
import { Nav } from "./nav";

export interface HeroStat {
  label: string;
  value: ReactNode;
}

/**
 * The rounded hero panel: 40px page gutter, radius 32px, aurora + grain, floating nav 64px from the top.
 * full: 112px headline (0.95 line-height), mono sub, CTAs, stats bottom-right.
 * compact: same frame, 64px headline, for inner pages.
 */
export function HeroFrame({
  heading,
  sub,
  actions,
  stats,
  variant = "full",
  navRight,
  children,
  eyebrow,
}: {
  heading: string;
  sub?: ReactNode;
  actions?: ReactNode;
  stats?: HeroStat[];
  variant?: "full" | "compact";
  navRight?: ReactNode;
  children?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const full = variant === "full";
  return (
    <header className="p-3 sm:p-6 xl:p-10">
      <div className="relative flex overflow-hidden rounded-[16px] pb-16 sm:rounded-[32px]">
        {/* flat gradient under the canvas: visible only until WebGL paints its first frame (ref frame 0 → 1) */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#050303] via-[#780f20] to-[#050303]" />
        <div className="absolute inset-0">
          <Aurora intensity={full ? 1 : 0.85} />
        </div>
        <NoiseOverlay />

        <div className="relative z-10 mx-auto w-full max-w-[1280px] px-4 sm:px-8">
          <BlurIn delay={0.1} className="mt-7 lg:mt-10 xl:mt-16">
            <Nav right={navRight} />
          </BlurIn>

          {full ? (
            <div className="flex flex-col items-center pb-24 pt-20 text-center sm:pb-40 sm:pt-28">
              {eyebrow && <BlurIn className="mb-6">{eyebrow}</BlurIn>}
              <h1 className="max-w-[1216px] text-5xl font-medium leading-[1.05] sm:text-7xl lg:text-8xl lg:leading-[0.95]">
                <WordByWord text={heading} />
              </h1>
              {sub && (
                <BlurIn delay={0.35} className="mt-6">
                  <p className="max-w-2xl px-4 font-mono text-[13px] font-light leading-6 opacity-80 sm:text-sm">{sub}</p>
                </BlurIn>
              )}
              {actions && (
                <BlurIn delay={0.7} distance={10} className="mt-14 sm:mt-20">
                  <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">{actions}</div>
                </BlurIn>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-6 pb-4 pt-12 sm:pt-16 lg:flex-row lg:items-end lg:justify-between">
              <div>
                {eyebrow && <BlurIn className="mb-4">{eyebrow}</BlurIn>}
                <h1 className="max-w-3xl text-4xl font-medium leading-[1.05] sm:text-5xl lg:text-[64px]">
                  <WordByWord text={heading} />
                </h1>
                {sub && (
                  <BlurIn delay={0.35} className="mt-5">
                    <p className="max-w-2xl font-mono text-[13px] font-light leading-6 opacity-80 sm:text-sm">{sub}</p>
                  </BlurIn>
                )}
              </div>
              {actions && (
                <BlurIn delay={0.6} distance={10}>
                  <div className="flex flex-wrap items-center gap-3">{actions}</div>
                </BlurIn>
              )}
            </div>
          )}
          {children}
        </div>

        {stats && stats.length > 0 && (
          <BlurIn delay={0.25} distance={5} className="absolute bottom-16 right-10 z-10 hidden xl:block 2xl:right-20">
            <dl className="flex flex-col items-end gap-4 font-mono text-sm">
              {stats.map((s) => (
                <div key={s.label} className="flex items-baseline gap-6">
                  <dt className="font-light opacity-70">{s.label}</dt>
                  <dd className="font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          </BlurIn>
        )}
      </div>
    </header>
  );
}
