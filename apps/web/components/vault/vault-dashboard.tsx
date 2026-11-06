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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ENV, explorerAddrUrl, explorerTxUrl, short } from "@/lib/env";
import { demoVault, dialToUrl } from "@/lib/leash";
import { SectionLabel } from "../motion/section-label";
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
    <section className={`leash-panel p-6 sm:p-8 ${className}`}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-[22px] font-medium">{title}</h2>
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
      <div className={`h-full rounded-full ${tone === "red" || pct > 85 ? "bg-[#ea2845]" : "bg-white"}`} style={{ width: `${pct}%`, transition: "width .6s ease" }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[1px] opacity-60">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-11 rounded-[12px] border border-white/12 bg-black/40 px-3.5 font-mono text-[13px] outline-none transition-colors focus:border-white/40";

function ActivityRow({ e, labels }: { e: ActivityEvent; labels: Map<string, string> }) {
  const tone =
    e.kind === "blocked" || e.kind === "frozen"
      ? "border-l-[#ea2845]"
      : e.kind === "spent" || (e.kind === "resolved" && e.approved)
        ? "border-l-[#3ddc97]"
        : e.kind === "requested"
          ? "border-l-[#f5b544]"
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
        <span className={`text-[15px] font-semibold ${e.kind === "blocked" ? "text-[#ff8396]" : ""}`}>{title}</span>
        <span className="shrink-0 font-mono text-[11px] opacity-50">{ago(e.ts)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] opacity-75">
        {e.amount !== undefined && <span>{fmt(e.amount)} dUSDC</span>}
        {payee && <span>→ {payee}</span>}
        <a className="underline-offset-4 hover:underline" href={explorerTxUrl(e.sig)} target="_blank" rel="noreferrer">
          tx ↗
        </a>
      </div>
      {e.reason && <p className="mt-1.5 font-mono text-[12px] leading-5 opacity-60">“{e.reason}”</p>}
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
  const [, force] = useState(0);

  const load = useCallback(async () => {
    try {
      const [v, p, m, r, a] = await Promise.all([
        client.getVault(vaultAddr),
        client.listPayees(vaultAddr),
        client.listMandates(vaultAddr),
        client.listRequests(vaultAddr),
        client.recentActivity(vaultAddr, 40),
      ]);
      setVault(v);
      setPayees(p);
      setMandates(m);
      setRequests(r.sort((x, y) => Number(y.seq - x.seq)));
      setActivity(a);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [client, vaultAddr]);

  useEffect(() => {
    void load();
    const off = client.onActivity(vaultAddr, (e) => {
      setActivity((a) => (a.some((x) => x.sig === e.sig && x.kind === e.kind) ? a : [e, ...a].slice(0, 60)));
      void load();
    });
    const iv = setInterval(() => void load(), 5000);
    const tick = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      off();
      clearInterval(iv);
      clearInterval(tick);
    };
  }, [client, vaultAddr, load]);

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
    <div className="mx-auto max-w-[1760px] px-3 pb-24 sm:px-6 xl:px-10">
      {(error || mock || toast) && (
        <div className="mb-4 flex flex-col gap-2">
          {mock && (
            <div className="rounded-[16px] border border-white/10 px-5 py-3 font-mono text-[12px] opacity-80">
              Mock mode: the program isn't configured yet (NEXT_PUBLIC_LEASH_VAULT is empty), so this dashboard runs on an in-memory vault. Without a
              wallet, owner actions are simulated; with Phantom, they send a real devnet memo transaction.
            </div>
          )}
          {error && <div className="rounded-[16px] border border-[#ea2845]/40 px-5 py-3 font-mono text-[12px] text-[#ff8396]">Couldn't load the vault: {error}</div>}
          {toast && (
            <div className={`rounded-[16px] border px-5 py-3 font-mono text-[12px] ${toast.kind === "err" ? "border-[#ea2845]/40 text-[#ff8396]" : toast.kind === "ok" ? "border-[#3ddc97]/40 text-[#7ef0bd]" : "border-white/15"}`}>
              {toast.text}{" "}
              {toast.href && (
                <a className="underline" href={toast.href} target="_blank" rel="noreferrer">
                  explorer ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        {/* Vault card */}
        <Card
          title="Vault"
          right={
            <a href={explorerAddrUrl(vaultAddr.toBase58())} target="_blank" rel="noreferrer" className="font-mono text-[12px] opacity-70 hover:opacity-100">
              {short(vaultAddr.toBase58(), 6)} ↗
            </a>
          }
        >
          {!vault ? (
            <div className="h-48 animate-pulse rounded-[16px] bg-white/[0.03]" />
          ) : (
            <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[1px] opacity-60">Balance</div>
                <div className="mt-1 text-[56px] font-medium leading-none tabular-nums">
                  {Number(fmt(vault.balance)).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  <span className="ml-2 text-xl opacity-60">dUSDC</span>
                </div>
                <div className="mt-6 space-y-2">
                  <div className="flex justify-between font-mono text-[12px]">
                    <span className="opacity-60">Spent in the last 24h</span>
                    <span>
                      {fmt(vault.spentInWindow)} / {fmt(vault.dailyCap)}
                    </span>
                  </div>
                  <Meter value={vault.spentInWindow} max={vault.dailyCap} />
                </div>
                <dl className="mt-6 grid grid-cols-2 gap-4 font-mono text-[12px]">
                  <div>
                    <dt className="opacity-60">Per-payment cap</dt>
                    <dd className="mt-1 text-[15px]">{fmt(vault.perTxCap)} dUSDC</dd>
                  </div>
                  <div>
                    <dt className="opacity-60">Co-sign above</dt>
                    <dd className="mt-1 text-[15px]">{vault.cosignThreshold > 0n ? `${fmt(vault.cosignThreshold)} dUSDC` : "off"}</dd>
                  </div>
                  <div>
                    <dt className="opacity-60">Request TTL</dt>
                    <dd className="mt-1 text-[15px]">{Math.round(vault.requestTtlSecs / 60)} min</dd>
                  </div>
                  <div>
                    <dt className="opacity-60">Agent key</dt>
                    <dd className="mt-1 text-[15px]">{short(vault.agent.toBase58(), 5)}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-col gap-4">
                <div className={`rounded-[20px] border p-5 ${vault.paused ? "border-[#ea2845]/60 bg-[#2a0710]/60" : "border-white/10 bg-black/30"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[17px] font-semibold">Kill switch</div>
                      <div className="mt-1 font-mono text-[12px] opacity-70">{vault.paused ? "Paused: nothing leaves the vault." : "Live: policy decides every payment."}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={vault.paused}
                      disabled={!!pending}
                      onClick={() => void act({ type: "setPaused", vault: vaultAddr, paused: !vault.paused }, vault.paused ? "Unpause" : "Pause")}
                      className={`relative h-8 w-14 rounded-full transition-colors duration-300 ${vault.paused ? "bg-[#ea2845]" : "bg-white/20"}`}
                    >
                      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all duration-300 ${vault.paused ? "left-7" : "left-1"}`} />
                    </button>
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-black/30 p-5">
                  <div className="text-[17px] font-semibold">Tripwire</div>
                  <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-[12px]">
                    <div>
                      <div className="opacity-60">Strikes</div>
                      <div className="mt-1 text-[22px]">
                        {vault.strikes}
                        <span className="text-[13px] opacity-50">/{vault.freezeAfterStrikes || "∞"}</span>
                      </div>
                    </div>
                    <div>
                      <div className="opacity-60">Blocked total</div>
                      <div className="mt-1 text-[22px]">{vault.blockedCount.toString()}</div>
                    </div>
                    <div>
                      <div className="opacity-60">Last blocked</div>
                      <div className="mt-1 text-[15px]">{vault.lastBlockedAt ? ago(vault.lastBlockedAt) : "never"}</div>
                    </div>
                  </div>
                  {vault.freezeAfterStrikes > 0 && <Meter value={BigInt(vault.strikes)} max={BigInt(vault.freezeAfterStrikes)} tone="red" />}
                  {(vault.paused || vault.strikes > 0) && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <OutlineButton size="sm" disabled={!!pending} onClick={() => void act({ type: "resetStrikes", vault: vaultAddr }, "Unfreeze")}>
                        Unfreeze &amp; clear strikes
                      </OutlineButton>
                      <a
                        className="inline-flex h-9 items-center rounded-[12px] px-3 font-mono text-[12px] opacity-70 hover:opacity-100"
                        href={dialToUrl(`${ENV.siteUrl}/api/actions/unfreeze?vault=${vaultAddr.toBase58()}`)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Unfreeze Blink ↗
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Pending requests */}
        <Card title="Pending co-sign requests" right={<span className="font-mono text-[12px] opacity-60">{pendingReqs.length} waiting</span>}>
          {pendingReqs.length === 0 ? (
            <p className="font-mono text-[13px] opacity-55">Nothing waiting. Payments at or above the co-sign threshold show up here.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pendingReqs.map((r) => {
                const actionUrl = `${ENV.siteUrl}/api/actions/approve?request=${r.address.toBase58()}`;
                return (
                  <li key={r.address.toBase58()} className="rounded-[20px] border border-[#f5b544]/40 bg-[#2a1f07]/50 p-5">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="text-[20px] font-medium">
                        {fmt(r.amount)} dUSDC → {labels.get(r.payee.toBase58()) ?? short(r.payee.toBase58(), 5)}
                      </div>
                      <span className="font-mono text-[12px] text-[#f5c86a]">expires in {countdown(r.expiresAt)}</span>
                    </div>
                    <p className="mt-2 font-mono text-[12px] leading-5 opacity-75">
                      Agent's reason: {reasons.get(r.address.toBase58()) ?? `sha256 ${toHex(r.reasonHash).slice(0, 16)}…`}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <PrimaryButton size="sm" disabled={!!pending} onClick={() => void act({ type: "approveRequest", vault: vaultAddr, request: r.address }, "Approve request")}>
                        Approve
                      </PrimaryButton>
                      <OutlineButton size="sm" tone="danger" disabled={!!pending} onClick={() => void act({ type: "rejectRequest", vault: vaultAddr, request: r.address }, "Reject request")}>
                        Reject
                      </OutlineButton>
                      <a className="ml-auto font-mono text-[12px] opacity-75 hover:opacity-100" href={`/approve?request=${r.address.toBase58()}`} target="_blank" rel="noreferrer">
                        Approval page ↗
                      </a>
                      <a className="font-mono text-[12px] opacity-75 hover:opacity-100" href={dialToUrl(actionUrl)} target="_blank" rel="noreferrer">
                        Open as Blink ↗
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {resolvedReqs.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[1px] opacity-50">Recently resolved</div>
              <ul className="space-y-1.5 font-mono text-[12px] opacity-70">
                {resolvedReqs.map((r) => (
                  <li key={r.address.toBase58()} className="flex justify-between">
                    <span>
                      #{r.seq.toString()} · {fmt(r.amount)} dUSDC → {labels.get(r.payee.toBase58()) ?? short(r.payee.toBase58(), 4)}
                    </span>
                    <span className={r.status === "approved" ? "text-[#7ef0bd]" : "text-white/60"}>{r.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* Payees */}
          <Card title="Allowlisted payees">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="font-mono text-[11px] uppercase tracking-[1px] opacity-55">
                  <tr className="border-b border-[#262626]">
                    <th className="pb-3 font-normal">Service</th>
                    <th className="pb-3 font-normal">Address</th>
                    <th className="pb-3 font-normal">Per payment</th>
                    <th className="w-[28%] pb-3 font-normal">Budget used</th>
                    <th className="pb-3 text-right font-normal">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {payees.map((p) => (
                    <tr key={p.address.toBase58()} className="border-b border-[#262626]/70 align-middle">
                      <td className="py-4 text-[15px] font-semibold">{p.label}</td>
                      <td className="py-4 font-mono text-[12px] opacity-75">
                        <a href={explorerAddrUrl(p.payee.toBase58())} target="_blank" rel="noreferrer" className="hover:underline">
                          {short(p.payee.toBase58(), 5)}
                        </a>
                      </td>
                      <td className="py-4 font-mono text-[13px]">{fmt(p.perTxMax)}</td>
                      <td className="py-4 pr-6">
                        <div className="mb-1.5 font-mono text-[12px]">
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
                            className={`relative h-6 w-11 rounded-full transition-colors ${p.active ? "bg-white" : "bg-white/15"}`}
                          >
                            <span className={`absolute top-1 h-4 w-4 rounded-full transition-all ${p.active ? "left-6 bg-black" : "left-1 bg-white"}`} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${p.label}`}
                            disabled={!!pending}
                            onClick={() => void act({ type: "removePayee", vault: vaultAddr, payee: p.payee }, `Remove ${p.label}`)}
                            className="px-1 font-mono text-[13px] opacity-50 hover:text-[#ff8396] hover:opacity-100"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {payees.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 font-mono text-[13px] opacity-55">
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
                Add payee
              </PrimaryButton>
            </div>
          </Card>

          {/* Mandates */}
          <Card title="Mandates" right={<span className="font-mono text-[12px] opacity-60">owner-signed permission for a new payee</span>}>
            <ul className="flex flex-col gap-3">
              {mandates.map((m) => {
                const expired = m.expiresAt <= Date.now() / 1000;
                return (
                  <li key={m.address.toBase58()} className="rounded-[18px] border border-white/10 bg-black/30 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="text-[15px] font-semibold">
                        #{m.id.toString()} → {labels.get(m.payee.toBase58()) ?? short(m.payee.toBase58(), 5)}
                      </span>
                      <span className={`font-mono text-[12px] ${m.revoked || expired ? "text-[#ff8396]" : "text-[#7ef0bd]"}`}>
                        {m.revoked ? "revoked" : expired ? "expired" : `expires ${new Date(m.expiresAt * 1000).toLocaleDateString()}`}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-3 font-mono text-[12px]">
                      <span>
                        <span className="opacity-55">used </span>
                        {fmt(m.spent)} / {fmt(m.maxTotal)}
                      </span>
                      <span>
                        <span className="opacity-55">per pay </span>
                        {fmt(m.maxPerTx)}
                      </span>
                      <span className="truncate opacity-55" title={toHex(m.intentHash)}>
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
                <p className="break-all font-mono text-[11px] leading-5 opacity-70 sm:col-span-2">
                  Signed mandate (Ed25519). Hand this to the agent to redeem: {signed}
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Activity */}
        <Card title="Activity" right={<span className="font-mono text-[12px] opacity-60">live from program logs</span>} className="xl:max-h-[1400px]">
          <SectionLabel className="-mt-3 mb-3">green paid · red blocked · amber pending</SectionLabel>
          <ul className="flex max-h-[1180px] flex-col divide-y divide-white/[0.04] overflow-y-auto pr-2">
            {activity.map((e, i) => (
              <ActivityRow key={`${e.sig}-${e.kind}-${i}`} e={e} labels={labels} />
            ))}
            {activity.length === 0 && <li className="py-6 font-mono text-[13px] opacity-55">No activity yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export function VaultWalletButton() {
  return <WalletMultiButton />;
}
