const CREDITS = [
  { name: "Squads v4", what: "Onchain spending limits, destination allowlists and multisig approvals.", href: "https://docs.squads.so/main/development/reference/spending-limits" },
  { name: "Cloaked Agent", what: "Onchain caps, expiry and freeze for agent wallets, with x402 support.", href: "https://github.com/CloakedAgent/cloaked" },
  { name: "AgentSafe", what: "Blink-based \"Approve Transfer\" co-signing for agent payments.", href: "https://github.com/0xNaezo/AgentSafe" },
  { name: "blueshift solana-intent-system", what: "Ed25519-signed intents verified inside the program.", href: "https://github.com/blueshift-gg/solana-intent-system" },
  { name: "x402 Foundation", what: "The HTTP 402 payment protocol our paid APIs speak (v2).", href: "https://github.com/x402-foundation/x402" },
  { name: "Solana Actions & Blinks", what: "The spec behind our one-tap owner approvals.", href: "https://solana.com/docs/tools/actions" },
];

/** Bordered 3-column grid (enterprise-section style). */
export function Credits() {
  return (
    <div className="grid overflow-hidden rounded-[24px] border border-[#262626] sm:grid-cols-2 lg:grid-cols-3">
      {CREDITS.map((c) => (
        <a
          key={c.name}
          href={c.href}
          target="_blank"
          rel="noreferrer"
          className="group border-b border-r border-[#262626] p-8 transition-colors duration-300 hover:bg-white/[0.03] sm:p-12"
        >
          <h3 className="text-lg font-medium">{c.name}</h3>
          <p className="mt-3 font-mono text-[13px] font-light leading-6 opacity-70">{c.what}</p>
          <span className="mt-6 inline-block font-mono text-[12px] uppercase tracking-[1px] opacity-50 transition-opacity group-hover:opacity-100">
            Read ↗
          </span>
        </a>
      ))}
    </div>
  );
}
