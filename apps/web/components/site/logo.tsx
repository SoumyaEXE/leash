/** Leash mark: a collar ring with a tag, cut by a check — "held, not stopped". Original artwork. */
export function LeashMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="leash-g" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff4d66" />
          <stop offset="1" stopColor="#b3122c" />
        </linearGradient>
      </defs>
      <path
        d="M20 4.5c8.56 0 15.5 6.94 15.5 15.5S28.56 35.5 20 35.5 4.5 28.56 4.5 20c0-4.1 1.6-7.84 4.2-10.62"
        stroke="url(#leash-g)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="11.2" cy="7.6" r="3.4" fill="url(#leash-g)" />
      <path d="M13.6 20.4l4.3 4.3 8.6-9.4" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LeashWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LeashMark size={36} />
      <span className="text-[22px] font-semibold tracking-[-0.02em]">Leash</span>
    </span>
  );
}
