import type { ReactNode } from "react";

/** Metallic line icons (white → steel gradient), drawn for Leash. */
function Chrome({ children, size = 64 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <defs>
        <linearGradient id="chrome" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#9a9a9a" />
          <stop offset="0.7" stopColor="#f2f2f2" />
          <stop offset="1" stopColor="#5c5c5c" />
        </linearGradient>
      </defs>
      <g stroke="url(#chrome)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

export const IconKill = () => (
  <Chrome>
    <path d="M32 10v20" />
    <path d="M20.5 17.5a19 19 0 1 0 23 0" />
  </Chrome>
);
export const IconAllowlist = () => (
  <Chrome>
    <rect x="12" y="10" width="40" height="44" rx="7" />
    <path d="m20 24 4 4 7-8M36 25h10M20 40l4 4 7-8M36 41h10" />
  </Chrome>
);
export const IconMandate = () => (
  <Chrome>
    <path d="M16 8h24l10 10v38H16z" />
    <path d="M40 8v10h10M23 30h18M23 38h12" />
    <path d="M24 49c3-4 5 2 8-2s5 1 8-1" />
  </Chrome>
);
export const IconCaps = () => (
  <Chrome>
    <path d="M10 46a22 22 0 1 1 44 0" />
    <path d="m32 46 11-14" />
    <circle cx="32" cy="46" r="3.5" />
    <path d="M15 36h4M45 36h4M32 20v4" />
  </Chrome>
);
export const IconCosign = () => (
  <Chrome>
    <rect x="18" y="6" width="28" height="52" rx="7" />
    <path d="M27 12h10" />
    <path d="m25 33 5 5 10-11" />
  </Chrome>
);
export const IconReason = () => (
  <Chrome>
    <path d="M10 14h44v28H30l-10 9v-9H10z" />
    <path d="M19 25h26M19 32h16" />
  </Chrome>
);
export const IconTripwire = () => (
  <Chrome>
    <path d="M6 40h12l5-12 7 22 7-30 6 20h15" />
    <circle cx="44" cy="40" r="3" />
  </Chrome>
);
export const IconShield = () => (
  <Chrome size={40}>
    <path d="M32 6 52 14v16c0 13-9 23-20 28C21 53 12 43 12 30V14z" />
    <path d="m23 31 6 6 12-13" />
  </Chrome>
);
