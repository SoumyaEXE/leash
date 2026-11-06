/**
 * Leash mark in the template's logo style: a glossy orange tile with a white glyph.
 * The glyph is a lead: an "L" stroke that ends in a clip ring.
 */
export function LeashMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={className} aria-hidden>
      <defs>
        <linearGradient id="lm-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7a1a" />
          <stop offset="0.55" stopColor="#f5450f" />
          <stop offset="1" stopColor="#d32800" />
        </linearGradient>
        <linearGradient id="lm-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="28" height="28" rx="7.5" fill="url(#lm-fill)" />
      <rect width="28" height="28" rx="7.5" fill="url(#lm-gloss)" />
      <rect x="0.5" y="0.5" width="27" height="27" rx="7" fill="none" stroke="#fff" strokeOpacity="0.28" />
      <path d="M10 6.5v11.2a2.3 2.3 0 0 0 2.3 2.3h3.2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="19.2" cy="20" r="2.6" fill="none" stroke="#fff" strokeWidth="2.2" />
    </svg>
  );
}

export function LeashWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LeashMark size={28} />
      <span className="text-[25px] font-medium leading-none tracking-[-0.8px]">Leash</span>
    </span>
  );
}
