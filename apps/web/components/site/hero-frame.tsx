"use client";

import { type ReactNode } from "react";
import { Badge, Container, Reveal } from "../cx/primitives";

export interface HeroStat {
  label: string;
  value: ReactNode;
}

/**
 * Inner-page hero in the template style: warm flare at the top, then a centered stack of sparkle badge,
 * gradient title, paragraph and actions. The page renders <Nav /> itself and puts this inside its <main>, so
 * there is one banner landmark (the nav) and the page title sits inside the main landmark.
 */
export function HeroFrame({
  heading,
  sub,
  actions,
  stats,
  children,
  eyebrow,
}: {
  heading: string;
  sub?: ReactNode;
  actions?: ReactNode;
  stats?: HeroStat[];
  variant?: "full" | "compact";
  children?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden pt-[150px]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-440px] h-[760px] w-[1000px] -translate-x-1/2 rounded-full blur-[130px]"
        style={{ background: "rgb(252 109 1 / 0.36)" }}
      />
      <Container className="relative flex flex-col items-center pb-14 text-center">
        <Reveal>{typeof eyebrow === "string" || eyebrow === undefined ? <Badge>{(eyebrow as string) || "Leash"}</Badge> : eyebrow}</Reveal>
        <Reveal delay={80} as="h1" className="cx-h2 mt-9 max-w-[820px]">
          {heading.split("\n").map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line}
            </span>
          ))}
        </Reveal>
        {sub && (
          <Reveal delay={160} as="p" className="cx-body mt-5 max-w-[640px] text-white/80">
            {sub}
          </Reveal>
        )}
        {actions && (
          <Reveal delay={220} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {actions}
          </Reveal>
        )}
        {stats && stats.length > 0 && (
          <dl className="mt-10 grid w-full grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-white/10 text-left sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="bg-[#070100] px-6 py-5">
                <dt className="text-[14px] text-white/60">{s.label}</dt>
                <dd className="tabular mt-1 text-[32px] leading-none tracking-[-0.5px]">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </Container>
    </div>
  );
}
