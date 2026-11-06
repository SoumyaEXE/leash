"use client";

import { gsap } from "gsap";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface BounceCard {
  icon: ReactNode;
  title: string;
  description: string;
}

const ROT = [0, 5, -5, 0, -5, 5, 0];
const STEP = 202.5; // px between card centres (spec)
const PUSH = 160;

/**
 * Seven 350px cards fanned with rotate(r) translate(x); they pop in with elastic.out(1, 0.5), 0.08s stagger,
 * 1s after scrolling into view. Hovering a card lifts it and pushes its siblings ±160px.
 */
export function BounceCards({ cards }: { cards: BounceCard[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [scale, setScale] = useState(1);

  const base = (i: number) => {
    const n = cards.length;
    const r = ROT[i % ROT.length];
    const x = (i - (n - 1) / 2) * STEP;
    return { r, x };
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / 1760));
    fit();
    window.addEventListener("resize", fit);
    const items = el.querySelectorAll<HTMLElement>("[data-card-inner]");
    gsap.set(items, { scale: 0 });
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          gsap.to(items, { scale: 1, duration: 0.8, stagger: 0.08, delay: 1, ease: "elastic.out(1, 0.5)" });
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [cards.length]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>("[data-card]").forEach((c, i) => {
      const { r, x } = base(i);
      let tx = x;
      let rot = r;
      if (hovered !== null && i !== hovered) tx += i < hovered ? -PUSH : PUSH;
      if (hovered === i) rot = 0;
      gsap.to(c, { rotate: rot, x: tx, duration: 0.4, ease: "back.out(1.4)" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered]);

  return (
    <div ref={host} className="relative flex h-[350px] w-full items-center justify-center" style={{ transform: `scale(${scale})` }}>
      {cards.map((c, i) => {
        const { r, x } = base(i);
        return (
          <div
            key={c.title}
            data-card
            className="absolute aspect-square w-[350px]"
            style={{ transform: `translate(${x}px) rotate(${r}deg)`, zIndex: hovered === i ? 20 : 10 - Math.abs(i - 3) }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div data-card-inner className="h-full w-full">
              <div
                className={`leash-card flex h-full w-full flex-col items-center justify-center p-8 text-center ${hovered !== null && hovered !== i ? "opacity-60" : ""}`}
                data-hovered={hovered === i}
              >
                <div className="relative z-10 mb-5 mt-5 flex h-[75px] w-[75px] items-center justify-center">{c.icon}</div>
                <h3 className="relative z-10 mb-2 text-xl font-semibold">{c.title}</h3>
                <p
                  className="relative z-10 font-mono text-sm font-light leading-6 transition-[opacity,filter] duration-200 ease-in-out"
                  style={{ opacity: hovered === i ? 0.8 : 0, filter: hovered === i ? "blur(0)" : "blur(2px)" }}
                >
                  {c.description}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
