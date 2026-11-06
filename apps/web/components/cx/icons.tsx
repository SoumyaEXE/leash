import type { AnchorHTMLAttributes, ReactNode, SVGProps } from "react";

/** One icon set for the whole app: 24px grid, 1.6 stroke, round caps (lucide-style, drawn here). */
type IconProps = { size?: number; className?: string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "width" | "height">;

function Icon({ size = 18, className = "", strokeWidth = 1.6, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const ArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
);
export const ArrowUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5 10 17l9-10" />
  </Icon>
);
export const Plus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const Pause = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6v12M15 6v12" />
  </Icon>
);
export const Copy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
  </Icon>
);
export const ChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const Shield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 5 6v5.5c0 4.3 2.9 7.9 7 9.5 4.1-1.6 7-5.2 7-9.5V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Icon>
);
export const Alert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Icon>
);
export const Bolt = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />
  </Icon>
);
export const Wallet = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
    <rect x="4" y="8" width="16" height="11" rx="2.5" />
    <path d="M16 13.5h.1" />
  </Icon>
);
export const Spark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3c.6 5 2.8 7.3 8 8-5.2.7-7.4 3-8 8-.6-5-2.8-7.3-8-8 5.2-.7 7.4-3 8-8z" />
  </Icon>
);
export const Code = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </Icon>
);
export const Terminal = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="m8 10 3 2.2L8 14.4M13 15h3" />
  </Icon>
);
export const Cube = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5" />
  </Icon>
);
export const Power = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v8M7.1 6.3a7 7 0 1 0 9.8 0" />
  </Icon>
);

/** External link as a small pill with a proper icon (replaces bare "↗" glyphs). */
export function ExtLink({
  children,
  className = "",
  tone = "default",
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: "default" | "quiet" }) {
  return (
    <a target="_blank" rel="noreferrer" {...rest} className={`${tone === "quiet" ? "cx-link-quiet" : "cx-link"} ${className}`}>
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
