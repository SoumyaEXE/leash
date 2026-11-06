"use client";

import Link from "next/link";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { Arrow } from "../cx/primitives";

type Common = {
  children: ReactNode;
  href?: string;
  external?: boolean;
  className?: string;
  size?: "lg" | "md" | "sm";
  arrow?: boolean;
};

function Shell({
  children,
  href,
  external,
  className,
  buttonProps,
}: {
  children: ReactNode;
  href?: string;
  external?: boolean;
  className: string;
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  if (href) {
    if (external)
      return (
        <a href={href} target="_blank" rel="noreferrer" className={className}>
          {children}
        </a>
      );
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} {...buttonProps}>
      {children}
    </button>
  );
}

const PRIMARY_SIZES = { lg: "", md: "cx-btn-sm", sm: "cx-btn-sm !h-9 !px-4 !text-[14px]" } as const;

/** Brand pill: #D32800 with the inner glow. */
export function PrimaryButton({ children, href, external, className = "", size = "lg", arrow = false, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Shell href={href} external={external} buttonProps={rest} className={`cx-btn group ${PRIMARY_SIZES[size]} disabled:pointer-events-none disabled:opacity-40 ${className}`}>
      {children}
      {arrow && <Arrow />}
    </Shell>
  );
}

const GHOST_SIZES = { lg: "h-[59px] px-8 text-[18px]", md: "h-11 px-[22px] text-[16px]", sm: "h-9 px-4 text-[14px]" } as const;
const GHOST_CX = { lg: "", md: "cx-btn-sm", sm: "cx-btn-sm !h-9 !px-4 !text-[14px]" } as const;

/** Secondary pill: glass fill with a hairline that turns brand on hover. */
export function GhostButton({ children, href, external, className = "", size = "lg", arrow = false, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Shell
      href={href}
      external={external}
      buttonProps={rest}
      className={`cx-btn-ghost group ${GHOST_CX[size]} ${className}`}
    >
      {children}
      {arrow && <Arrow />}
    </Shell>
  );
}

/** Dashboard action pill with an optional semantic tone. */
export function OutlineButton({
  children,
  className = "",
  size = "md",
  tone = "default",
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "danger" | "ok" }) {
  const tones = {
    default: "border-white/15 bg-white/[0.04] text-white hover:border-[#f53f16]/60 hover:bg-white/[0.07]",
    danger: "border-[#ff4d3d]/45 bg-[#ff4d3d]/[0.06] text-[#ffb0a6] hover:bg-[#ff4d3d]/15",
    ok: "border-[#0cbe4d]/45 bg-[#0cbe4d]/[0.06] text-[#8ee8ae] hover:bg-[#0cbe4d]/12",
  } as const;
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[60px] border transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${GHOST_SIZES[size]} ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
