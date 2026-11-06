"use client";

import { PublicKey } from "@solana/web3.js";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  buildMandateMessage,
  fromBaseUnits,
  reasonHash,
  toBaseUnits,
  toHex,
  type ActivityEvent,
  type MandateState,
  type PayeeState,
  type RequestState,
  type VaultState,
} from "@leash/sdk";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ENV, explorerAddrUrl, explorerTxUrl, short } from "@/lib/env";
import { demoVault, dialToUrl } from "@/lib/leash";
import { ExtLink } from "../cx/icons";
import { OutlineButton, PrimaryButton } from "../ui/buttons";
import { useOwner } from "../wallet/use-owner";

const fmt = (b: bigint) => fromBaseUnits(b);
const ago = (ts: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const countdown = (ts: number) => {
  const s = ts - Math.floor(Date.now() / 1000);
  if (s <= 0) return "expired";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Card({ title, children, right, className = "" }: { title: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`cx-border cx-card rounded-[20px] p-6 sm:p-8 ${className}`} style={{ ["--cx-angle" as string]: "125deg" }}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="cx-h3 !text-[26px] !leading-[34px]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Meter({ value, max, tone = "white" }: { value: bigint; max: bigint; tone?: "white" | "red" }) {
  const pct = max > 0n ? Math.min(100, Number((value * 10000n) / max) / 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${tone === "red" || pct > 85 ? "bg-[#ff4d3d]" : "bg-gradient-to-r from-[#d32800] to-[#fc6d01]"}`} style={{ width: `${pct}%`, transition: "width .6s ease" }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[14px] text-white/60">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-12 rounded-[14px] border border-white/15 bg-black/50 px-4 font-mono text-[14px] outline-none transition-colors placeholder:font-sans placeholder:text-white/35 focus:border-[#d32800]";

function ActivityRow({ e, labels }: { e: ActivityEvent; labels: Map<string, string> }) {
  const tone =
    e.kind === "blocked" || e.kind === "frozen"
      ? "border-l-[#ff4d3d]"
      : e.kind === "spent" || (e.kind === "resolved" && e.approved)
        ? "border-l-[#0cbe4d]"
        : e.kind === "requested"
          ? "border-l-[#f5a524]"
          : "border-l-white/25";
  const title =
    e.kind === "blocked"
      ? `Blocked onchain · ${e.errorName ?? "rejected"}`
      : e.kind === "spent"
        ? `Paid${e.via ? ` via ${e.via}` : ""}`
        : e.kind === "requested"
          ? "Co-sign requested"
          : e.kind === "resolved"
            ? e.approved
              ? "Request approved"
              : "Request rejected"
            : e.kind === "paused"
              ? e.paused
                ? "Vault paused"
                : "Vault unpaused"
              : e.kind === "frozen"
                ? "Tripwire froze the vault"
                : e.kind === "mandate"
                  ? "Mandate updated"
                  : "Policy updated";
  const payee = e.payee ? (labels.get(e.payee) ?? short(e.payee, 5)) : null;
  return (
    <li className={`border-l-2 ${tone} py-3 pl-4`}>
      <div className="flex items-baseline justify-between gap-4">
        <span className={`text-[16px] ${e.kind === "blocked" ? "text-[#ffb0a6]" : ""}`}>{title}</span>
        <span className="shrink-0 text-[13px] text-white/45">{ago(e.ts)}</span>
      </div>
      <div className="tabular mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-white/70">
        {e.amount !== undefined && <span>{fmt(e.amount)} dUSDC</span>}
        {payee && <span>to {payee}</span>}
        <ExtLink tone="quiet" href={explorerTxUrl(e.sig)}>
          Tx
        </ExtLink>
      </div>
      {e.reason && <p className="mt-1.5 text-[14px] leading-5 text-white/55">“{e.reason}”</p>}
    </li>
  );
}

export function VaultDashboard() {
  const { client, wallet, run, toast, pending, mock } = useOwner();
  const vaultAddr = useMemo(() => demoVault(client), [client]);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [payees, setPayees] = useState<PayeeState[]>([]);
  const [mandates, setMandates] = useState<MandateState[]>([]);
  const [requests, setRequests] = useState<RequestState[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const hasVault = useRef(false);
  const [, force] = useState(0);

  // Each section loads on its own: one rate-limited RPC call (public devnet 429s) must not blank the dashboard.
  const load = useCallback(async () => {
    const [v, p, m, r] = await Promise.allSettled([
      client.getVault(vaultAddr),
      client.listPayees(vaultAddr),
      client.listMandates(vaultAddr),
      client.listRequests(vaultAddr),
    ]);
    if (v.status === "fulfilled") {
      hasVault.current = true;
      setVault(v.value);
      setError(null);
    } else if (!hasVault.current) {
      // only an error if we have nothing to show; later hiccups keep the last good state
      setError((v.reason as Error)?.message ?? String(v.reason));
    }
    if (p.status === "fulfilled") setPayees(p.value);
    if (m.status === "fulfilled") setMandates(m.value);
    if (r.status === "fulfilled") setRequests(r.value.sort((x, y) => Number(y.seq - x.seq)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, vaultAddr]);

  // History once (and every 30s); live updates arrive through onActivity.
  const loadHistory = useCallback(async () => {
    try {
      const a = await client.recentActivity(vaultAddr, 25);
      setActivity((cur) => {
        const seen = new Set(a.map((x) => `${x.sig}:${x.kind}`));
        return [...cur.filter((x) => !seen.has(`${x.sig}:${x.kind}`)), ...a].sort((x, y) => y.ts - x.ts).slice(0, 60);
      });
    } catch {
      // keep what we have; the live feed still works
    }
  }, [client, vaultAddr]);

  useEffect(() => {
    void load();
    void loadHistory();
    const off = client.onActivity(vaultAddr, (e) => {
      setActivity((a) => (a.some((x) => x.sig === e.sig && x.kind === e.kind) ? a : [e, ...a].slice(0, 60)));
      void load();
    });
    const hist = setInterval(() => void loadHistory(), 30_000);
    const iv = setInterval(() => void load(), 8000);
    const tick = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      off();
      clearInterval(iv);
      clearInterval(hist);
      clearInterval(tick);
    };
  }, [client, vaultAddr, load, loadHistory]);

  const labels = useMemo(() => new Map(payees.map((p) => [p.payee.toBase58(), p.label])), [payees]);
  const reasons = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of activity) if (e.kind === "requested" && e.request && e.reason) m.set(e.request, e.reason);
    return m;
  }, [activity]);

  const act = async (action: Parameters<typeof run>[0], label: string) => {
    if (await run(action, label)) await load();
  };

  // forms
  const [np, setNp] = useState({ address: "", label: "", perTx: "0.50", budget: "5.00" });
  const [nm, setNm] = useState({ payee: "", maxTotal: "2.00", perTx: "0.50", days: "7", intent: "" });
  const [signed, setSigned] = useState<string | null>(null);

  const addPayee = async () => {
    try {
      await act(
        { type: "addPayee", vault: vaultAddr, payee: new PublicKey(np.address.trim()), label: np.label.trim().slice(0, 32), perTxMax: toBaseUnits(np.perTx), budgetTotal: toBaseUnits(np.budget) },
        `Add payee ${np.label}`,
      );
      setNp({ address: "", label: "", perTx: "0.50", budget: "5.00" });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const createMandate = async () => {
    try {
      await act(
        {
          type: "createMandate",
          vault: vaultAddr,
          payee: new PublicKey(nm.payee.trim()),
          maxTotal: toBaseUnits(nm.maxTotal),
          maxPerTx: toBaseUnits(nm.perTx),
          expiresAt: Math.floor(Date.now() / 1000) + Number(nm.days) * 86400,
          intent: nm.intent.trim() || "Owner-approved purpose",
        },
        "Create mandate",
      );
    } catch (e) {
      alert((e as Error).message);
    }
  };

  /** SHOULD path: owner signs the exact terms off-chain (Phantom signMessage, no tx); the agent redeems them. */
  const signMandate = async () => {
    if (!wallet.signMessage || !vault) return;
    try {
      const terms = {
        vault: vaultAddr,
        payee: new PublicKey(nm.payee.trim()),
        maxTotal: toBaseUnits(nm.maxTotal),
        maxPerTx: toBaseUnits(nm.perTx),
        expiresAt: Math.floor(Date.now() / 1000) + Number(nm.days) * 86400,
        intentHash: reasonHash(nm.intent.trim() || "Owner-approved purpose"),
        nonce: vault.mandateSeq,
      };
      const sig = await wallet.signMessage(buildMandateMessage(terms));
      setSigned(toHex(sig));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const pendingReqs = requests.filter((r) => r.status === "pending");
  const resolvedReqs = requests.filter((r) => r.status !== "pending").slice(0, 4);

  return (
    <div className="mx-auto max-w-[1320px] px-5 pb-10 sm:px-8 min-[1400px]:px-0">
      {(error || mock || toast) && (
        <div className="mb-4 flex flex-col gap-2">
          {mock && (
            <div className="rounded-[16px] border border-white/10 bg-white/[0.03] px-5 py-3 text-[15px] text-white/80">
              Mock mode: the program isn't configured yet (NEXT_PUBLIC_LEASH_VAULT is empty), so this dashboard runs on an in-memory vault. Without a
              wallet, owner actions are simulated; with Phantom, they send a real devnet memo transaction.
            </div>
          )}
          {error && <div className="rounded-[16px] border border-[#ff4d3d]/40 bg-[#ff4d3d]/[0.06] px-5 py-3 text-[15px] text-[#ffb0a6]">Couldn't load the vault: {error}</div>}
          {toast && (
            <div className={`rounded-[16px] border px-5 py-3 text-[15px] ${toast.kind === "err" ? "border-[#ff4d3d]/40 bg-[#ff4d3d]/[0.06] text-[#ffb0a6]" : toast.kind === "ok" ? "border-[#0cbe4d]/40 bg-[#0cbe4d]/[0.06] text-[#8ee8ae]" : "border-white/15 bg-white/[0.03]"}`}>
              {toast.text}{" "}
              {toast.href && (
                <ExtLink href={toast.href} className="ml-2">
                  Explorer
                </ExtLink>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
        {/* Vault card */}
        <Card
          title="Vault"
          right={
            <ExtLink href={explorerAddrUrl(vaultAddr.toBase58())} className="font-mono">
              {short(vaultAddr.toBase58(), 6)}
            </ExtLink>
          }
        >
          {!vault ? (
            <div className="h-48 animate-pulse rounded-[16px] bg-white/[0.03]" />
          ) : (
            <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
              <div>
                <div className="text-[16px] text-white/60">Balance</div>
                <div className="tabular mt-2 text-[56px] leading-none tracking-[-2px]">
                  {Number(fmt(vault.balance)).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  <span className="ml-2 text-[18px] tracking-normal text-white/60">dUSDC</span>
                </div>
                <div className="mt-6 space-y-2">
                  <div className="tabular flex justify-between text-[14px]">
                    <span className="text-white/60">Spent in the last 24h</span>
                    <span>
                      {fmt(vault.spentInWindow)} / {fmt(vault.dailyCap)}
                    </span>
                  </div>
                  <Meter value={vault.spentInWindow} max={vault.dailyCap} />
                </div>
                <dl className="mt-6 grid grid-cols-2 gap-4 text-[14px]">
                  <div>
                    <dt className="text-white/55">Per-payment cap</dt>
                    <dd className="tabular mt-1 text-[16px]">{fmt(vault.perTxCap)} dUSDC</dd>
                  </div>
                  <div>
                    <dt className="text-white/55">Co-sign above</dt>
                    <dd className="tabular mt-1 text-[16px]">{vault.cosignThreshold > 0n ? `${fmt(vault.cosignThreshold)} dUSDC` : "off"}</dd>
                  </div>
                  <div>
                    <dt className="text-white/55">Request TTL</dt>
                    <dd className="tabular mt-1 text-[16px]">{Math.round(vault.requestTtlSecs / 60)} min</dd>
                  </div>
                  <div>
                    <dt className="text-white/55">Agent key</dt>
                    <dd className="tabular mt-1 text-[16px]">{short(vault.agent.toBase58(), 5)}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-col gap-4">
                <div className={`rounded-[20px] border p-5 ${vault.paused ? "border-[#ff4d3d]/50 bg-[#ff4d3d]/[0.07]" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[18px]">Kill switch</div>
                      <div className="mt-1 text-[14px] text-white/65">{vault.paused ? "Paused: nothing leaves the vault." : "Live: policy decides every payment."}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={vault.paused}
                      disabled={!!pending}
                      onClick={() => void act({ type: "setPaused", vault: vaultAddr, paused: !vault.paused }, vault.paused ? "Unpause" : "Pause")}
                      className={`relative h-8 w-14 rounded-full transition-colors duration-300 ${vault.paused ? "bg-[#ff4d3d]" : "bg-white/20"}`}
                    >
                      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all duration-300 ${vault.paused ? "left-7" : "left-1"}`} />
                    </button>
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-5">
                  <div className="text-[18px]">Tripwire</div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-[14px]">
                    <div>
                      <div className="text-white/55">Strikes</div>
                      <div className="tabular mt-1 text-[24px] leading-8">
                        {vault.strikes}
                        <span className="text-[14px] text-white/45">/{vault.freezeAfterStrikes || "∞"}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-white/55">Blocked total</div>
                      <div className="tabular mt-1 text-[24px] leading-8">{vault.blockedCount.toString()}</div>
                    </div>
                    <div>
                      <div className="text-white/55">Last blocked</div>
                      <div className="mt-1 text-[16px] leading-8">{vault.lastBlockedAt ? ago(vault.lastBlockedAt) : "never"}</div>
                    </div>
                  </div>
                  {vault.freezeAfterStrikes > 0 && <Meter value={BigInt(vault.strikes)} max={BigInt(vault.freezeAfterStrikes)} tone="red" />}
                  {(vault.paused || vault.strikes > 0) && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <OutlineButton size="sm" disabled={!!pending} onClick={() => void act({ type: "resetStrikes", vault: vaultAddr }, "Unfreeze")}>
                        Unfreeze &amp; clear strikes
                      </OutlineButton>
                      <ExtLink href={dialToUrl(`${ENV.siteUrl}/api/actions/unfreeze?vault=${vaultAddr.toBase58()}`)} className="!h-9">
                        Unfreeze Blink
                      </ExtLink>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Pending requests */}
        <Card title="Pending co-sign requests" right={<span className="tabular text-[14px] text-white/55">{pendingReqs.length} waiting</span>}>
          {pendingReqs.length === 0 ? (
            <p className="text-[16px] leading-[25.6px] text-white/55">Nothing waiting. Payments at or above the co-sign threshold show up here.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pendingReqs.map((r) => {
                const actionUrl = `${ENV.siteUrl}/api/actions/approve?request=${r.address.toBase58()}`;
                return (
                  <li key={r.address.toBase58()} className="rounded-[20px] border border-[#f5a524]/40 bg-[#f5a524]/[0.06] p-5">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="tabular text-[22px] tracking-[-0.3px]">
                        {fmt(r.amount)} dUSDC to {labels.get(r.payee.toBase58()) ?? short(r.payee.toBase58(), 5)}
                      </div>
                      <span className="tabular shrink-0 text-[14px] text-[#f5c86a]">Expires in {countdown(r.expiresAt)}</span>
                    </div>
                    <p className="mt-2 text-[15px] leading-6 text-white/75">
                      Agent's reason: {reasons.get(r.address.toBase58()) ?? `sha256 ${toHex(r.reasonHash).slice(0, 16)}…`}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <PrimaryButton size="sm" disabled={!!pending} onClick={() => void act({ type: "approveRequest", vault: vaultAddr, request: r.address }, "Approve request")}>
                        Approve
                      </PrimaryButton>
                      <OutlineButton size="sm" tone="danger" disabled={!!pending} onClick={() => void act({ type: "rejectRequest", vault: vaultAddr, request: r.address }, "Reject request")}>
                        Reject
                      </OutlineButton>
                      <ExtLink className="ml-auto" href={`/approve?request=${r.address.toBase58()}`}>
                        Approval page
                      </ExtLink>
                      <ExtLink href={dialToUrl(actionUrl)}>Open as Blink</ExtLink>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {resolvedReqs.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-[14px] text-white/50">Recently resolved</div>
              <ul className="tabular space-y-1.5 text-[14px] text-white/70">
                {resolvedReqs.map((r) => (
                  <li key={r.address.toBase58()} className="flex justify-between">
                    <span>
                      #{r.seq.toString()} · {fmt(r.amount)} dUSDC to {labels.get(r.payee.toBase58()) ?? short(r.payee.toBase58(), 4)}
                    </span>
                    <span className={r.status === "approved" ? "text-[#8ee8ae]" : "text-white/60"}>{r.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-5">
          {/* Payees */}
          <Card title="Allowlisted payees">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="text-[14px] text-white/50">
                  <tr className="border-b border-white/10">
                    <th className="pb-3 font-normal">Service</th>
                    <th className="pb-3 font-normal">Address</th>
                    <th className="pb-3 font-normal">Per payment</th>
                    <th className="w-[28%] pb-3 font-normal">Budget used</th>
                    <th className="pb-3 text-right font-normal">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {payees.map((p) => (
                    <tr key={p.address.toBase58()} className="border-b border-white/[0.06] align-middle">
                      <td className="py-4 text-[16px]">{p.label}</td>
                      <td className="py-4 font-mono text-[13px] text-white/65">
                        <a href={explorerAddrUrl(p.payee.toBase58())} target="_blank" rel="noreferrer" className="hover:underline">
                          {short(p.payee.toBase58(), 5)}
                        </a>
                      </td>
                      <td className="tabular py-4 text-[15px]">{fmt(p.perTxMax)}</td>
                      <td className="py-4 pr-6">
                        <div className="tabular mb-1.5 text-[14px]">
                          {fmt(p.spent)} / {p.budgetTotal > 0n ? fmt(p.budgetTotal) : "∞"}
                        </div>
                        {p.budgetTotal > 0n && <Meter value={p.spent} max={p.budgetTotal} />}
                      </td>
                      <td className="py-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={p.active}
                            disabled={!!pending}
                            onClick={() => void act({ type: "updatePayee", vault: vaultAddr, payee: p.payee, perTxMax: p.perTxMax, budgetTotal: p.budgetTotal, active: !p.active }, p.active ? "Disable payee" : "Enable payee")}
                            className={`relative h-6 w-11 rounded-full transition-colors ${p.active ? "bg-[#d32800]" : "bg-white/15"}`}
                          >
                            <span className={`absolute top-1 h-4 w-4 rounded-full transition-all ${p.active ? "left-6 bg-white" : "left-1 bg-white/80"}`} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${p.label}`}
                            disabled={!!pending}
                            onClick={() => void act({ type: "removePayee", vault: vaultAddr, payee: p.payee }, `Remove ${p.label}`)}
                            className="px-1 text-[14px] text-white/45 hover:text-[#ffb0a6]"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {payees.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-[16px] text-white/55">
                        No payees yet. Every payment would be blocked with PayeeNotAuthorized.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-[1.4fr_1fr_0.6fr_0.6fr_auto] sm:items-end">
              <Field label="Payee wallet">
                <input className={inputCls} value={np.address} onChange={(e) => setNp({ ...np, address: e.target.value })} placeholder="Base58 address" />
              </Field>
              <Field label="Label">
                <input className={inputCls} value={np.label} maxLength={32} onChange={(e) => setNp({ ...np, label: e.target.value })} placeholder="Weather API" />
              </Field>
              <Field label="Per pay">
                <input className={inputCls} value={np.perTx} onChange={(e) => setNp({ ...np, perTx: e.target.value })} />
              </Field>
              <Field label="Budget">
                <input className={inputCls} value={np.budget} onChange={(e) => setNp({ ...np, budget: e.target.value })} />
              </Field>
              <PrimaryButton size="md" disabled={!np.address || !np.label || !!pending} onClick={() => void addPayee()}>
                <span className="whitespace-nowrap">Add payee</span>
              </PrimaryButton>
            </div>
          </Card>

          {/* Mandates */}
          <Card title="Mandates" right={<span className="hidden text-[14px] text-white/55 sm:inline">Owner-signed permission for a new payee</span>}>
            <ul className="flex flex-col gap-3">
              {mandates.map((m) => {
                const expired = m.expiresAt <= Date.now() / 1000;
                return (
                  <li key={m.address.toBase58()} className="rounded-[16px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="text-[16px]">
                        #{m.id.toString()} · {labels.get(m.payee.toBase58()) ?? short(m.payee.toBase58(), 5)}
                      </span>
                      <span className={`text-[14px] ${m.revoked || expired ? "text-[#ffb0a6]" : "text-[#8ee8ae]"}`}>
                        {m.revoked ? "revoked" : expired ? "expired" : `expires ${new Date(m.expiresAt * 1000).toLocaleDateString()}`}
                      </span>
                    </div>
                    <div className="tabular mt-2 grid grid-cols-3 gap-3 text-[14px]">
                      <span>
                        <span className="text-white/50">Used </span>
                        {fmt(m.spent)} / {fmt(m.maxTotal)}
                      </span>
                      <span>
                        <span className="text-white/50">Per pay </span>
                        {fmt(m.maxPerTx)}
                      </span>
                      <span className="truncate font-mono text-[13px] text-white/50" title={toHex(m.intentHash)}>
                        intent {toHex(m.intentHash).slice(0, 12)}…
                      </span>
                    </div>
                    {!m.revoked && !expired && (
                      <div className="mt-3">
                        <OutlineButton size="sm" tone="danger" disabled={!!pending} onClick={() => void act({ type: "revokeMandate", vault: vaultAddr, mandate: m.address }, "Revoke mandate")}>
                          Revoke
                        </OutlineButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Field label="Payee wallet">
                <input className={inputCls} value={nm.payee} onChange={(e) => setNm({ ...nm, payee: e.target.value })} placeholder="Base58 address" />
              </Field>
              <Field label="Intent (shown to you, hashed onchain)">
                <input className={inputCls} value={nm.intent} onChange={(e) => setNm({ ...nm, intent: e.target.value })} placeholder="Weekly wallet-flow reports from Nansen" />
              </Field>
              <div className="grid grid-cols-3 gap-3 sm:col-span-2">
                <Field label="Max total">
                  <input className={inputCls} value={nm.maxTotal} onChange={(e) => setNm({ ...nm, maxTotal: e.target.value })} />
                </Field>
                <Field label="Per payment">
                  <input className={inputCls} value={nm.perTx} onChange={(e) => setNm({ ...nm, perTx: e.target.value })} />
                </Field>
                <Field label="Expires in (days)">
                  <input className={inputCls} value={nm.days} onChange={(e) => setNm({ ...nm, days: e.target.value })} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <PrimaryButton size="md" disabled={!nm.payee || !!pending} onClick={() => void createMandate()}>
                  Create mandate (owner tx)
                </PrimaryButton>
                {!mock && wallet.signMessage && (
                  <OutlineButton size="md" disabled={!nm.payee} onClick={() => void signMandate()}>
                    Sign off-chain (no SOL)
                  </OutlineButton>
                )}
              </div>
              {signed && (
                <p className="break-all font-mono text-[12px] leading-5 text-white/65 sm:col-span-2">
                  Signed mandate (Ed25519). Hand this to the agent to redeem: {signed}
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Activity */}
        <Card title="Activity" right={<span className="text-[14px] text-white/55">Live from program logs</span>} className="xl:max-h-[1400px]">
          <div className="-mt-2 mb-3 flex flex-wrap gap-4 text-[13px] text-white/55">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#0cbe4d]" />Paid</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#ff4d3d]" />Blocked</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#f5a524]" />Pending</span>
          </div>
          <ul data-lenis-prevent className="flex max-h-[1180px] flex-col divide-y divide-white/[0.06] overflow-y-auto pr-2">
            {activity.map((e, i) => (
              <ActivityRow key={`${e.sig}-${e.kind}-${i}`} e={e} labels={labels} />
            ))}
            {activity.length === 0 && <li className="py-6 text-[16px] text-white/55">No activity yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export function VaultWalletButton() {
  return <WalletMultiButton />;
}
