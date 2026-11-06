"use client";

import Link from "next/link";
import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";

type Common = {
  children: ReactNode;
  href?: string;
  external?: boolean;
  className?: string;
  size?: "lg" | "md" | "sm";
};

const SIZES = {
  lg: "h-16 px-5 text-base rounded-[20px]",
  md: "h-12 px-5 text-[15px] rounded-[16px]",
  sm: "h-9 px-3.5 text-[13px] rounded-[12px]",
} as const;

/** Glow blob that follows the pointer (80px #ea2845, blur 16px, fades in 0.3s). */
function useGlow() {
  const ref = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  const move = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (ref.current) ref.current.style.transform = `translate(${e.clientX - r.left - 40}px, ${e.clientY - r.top - 40}px)`;
  };
  return { ref, on, setOn, move };
}

function Shell({
  children,
  href,
  external,
  className,
  onMouseMove,
  onMouseEnter,
  onMouseLeave,
  buttonProps,
}: {
  children: ReactNode;
  href?: string;
  external?: boolean;
  className: string;
  onMouseMove: (e: MouseEvent<HTMLElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const handlers = { onMouseMove, onMouseEnter, onMouseLeave };
  if (href) {
    if (external)
      return (
        <a href={href} target="_blank" rel="noreferrer" className={className} {...handlers}>
          {children}
        </a>
      );
    return (
      <Link href={href} className={className} {...handlers}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} {...handlers} {...buttonProps}>
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  href,
  external,
  className = "",
  size = "lg",
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  const g = useGlow();
  return (
    <Shell
      href={href}
      external={external}
      onMouseMove={g.move}
      onMouseEnter={() => g.setOn(true)}
      onMouseLeave={() => g.setOn(false)}
      buttonProps={rest}
      className={`group relative inline-flex items-center justify-center overflow-hidden bg-white font-bold text-black
        transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] active:scale-[0.97]
        disabled:opacity-50 disabled:pointer-events-none ${SIZES[size]} ${className}`}
    >
      <span
        ref={g.ref}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-20 w-20 rounded-full bg-[#ea2845] blur-[16px] transition-opacity duration-300"
        style={{ opacity: g.on ? 0.55 : 0 }}
      />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </Shell>
  );
}

export function GhostButton({
  children,
  href,
  external,
  className = "",
  size = "lg",
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  const g = useGlow();
  return (
    <Shell
      href={href}
      external={external}
      onMouseMove={g.move}
      onMouseEnter={() => g.setOn(true)}
      onMouseLeave={() => g.setOn(false)}
      buttonProps={rest}
      className={`group relative inline-flex items-center justify-center overflow-hidden font-bold text-white
        transition-transform duration-100 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none
        ${SIZES[size]} ${className}`}
    >
      <span
        ref={g.ref}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-20 w-20 scale-50 rounded-full bg-[#ea2845] blur-[16px] transition-opacity duration-300"
        style={{ opacity: g.on ? 0.6 : 0 }}
      />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </Shell>
  );
}

/** Bordered outline button used in dashboards. */
export function OutlineButton({
  children,
  className = "",
  size = "md",
  tone = "default",
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "danger" | "ok" }) {
  const tones = {
    default: "border-white/15 hover:border-white/35 hover:bg-white/5",
    danger: "border-[#ea2845]/50 text-[#ff6b80] hover:bg-[#ea2845]/10 hover:border-[#ea2845]",
    ok: "border-[#3ddc97]/40 text-[#7ef0bd] hover:bg-[#3ddc97]/10 hover:border-[#3ddc97]",
  } as const;
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 border font-semibold transition-colors duration-200
        disabled:opacity-40 disabled:pointer-events-none ${SIZES[size]} ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
