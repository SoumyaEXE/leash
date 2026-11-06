"use client";

import { useRef, useState, type ReactNode } from "react";

/** A surface with a soft radial light that follows the pointer (opacity transition 0.12s). */
export function Spotlight({
  children,
  className = "",
  color = "rgba(255,255,255,0.07)",
  size = 420,
}: {
  children: ReactNode;
  className?: string;
  color?: string;
  size?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [on, setOn] = useState(false);
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      onMouseMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-[120ms]"
        style={{
          opacity: on ? 1 : 0,
          background: `radial-gradient(${size}px circle at ${pos.x}px ${pos.y}px, ${color}, transparent 70%)`,
        }}
      />
      {children}
    </div>
  );
}
