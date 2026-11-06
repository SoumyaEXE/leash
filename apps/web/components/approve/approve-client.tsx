"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ENV, explorerTxUrl } from "@/lib/env";
import { dialToUrl } from "@/lib/leash";
import { OutlineButton, PrimaryButton } from "../ui/buttons";

interface ActionMeta {
  title: string;
  description: string;
  icon: string;
  disabled?: boolean;
  error?: { message: string };
  links?: { actions: { label: string; href: string }[] };
  message?: string;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Our own Blink renderer: GET the Action, POST { account }, sign the returned tx in Phantom. Same endpoint dial.to uses. */
export function ApproveClient() {
  const params = useSearchParams();
  const request = params.get("request");
  const vault = params.get("vault");
  const kind = vault && !request ? "unfreeze" : "approve";
  const base = kind === "unfreeze" ? `/api/actions/unfreeze?vault=${vault}` : `/api/actions/approve?request=${request}`;
  const { connection } = useConnection();
  const wallet = useWallet();
  const [meta, setMeta] = useState<ActionMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ sig: string; message?: string } | null>(null);

  useEffect(() => {
    if (!request && !vault) return;
    fetch(base)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
        setMeta(j);
      })
      .catch((e) => setErr((e as Error).message));
  }, [base, request, vault]);

  const execute = async (href: string, label: string) => {
    if (!wallet.publicKey) return;
    setBusy(label);
    setErr(null);
    try {
      const r = await fetch(href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: wallet.publicKey.toBase58() }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
      const tx = Transaction.from(b64ToBytes(j.transaction));
      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setDone({ sig, message: j.message });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!request && !vault) {
    return <p className="font-mono text-sm opacity-70">Open this page from a pending request (needs ?request=&lt;address&gt;).</p>;
  }

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="leash-panel overflow-hidden">
        {meta?.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.icon} alt="" className="aspect-square w-full object-cover" />
        )}
        <div className="p-7">
          <div className="font-mono text-[11px] uppercase tracking-[1.2px] opacity-60">Solana Action · devnet</div>
          <h1 className="mt-2 text-[26px] font-medium leading-tight">{meta?.title ?? (err ? "Couldn't load this action" : "Loading…")}</h1>
          {meta?.description && <p className="mt-3 font-mono text-[13px] font-light leading-6 opacity-75">{meta.description}</p>}
          {meta?.error && <p className="mt-3 font-mono text-[13px] text-[#f5c86a]">{meta.error.message}</p>}
          {err && <p className="mt-3 font-mono text-[13px] text-[#ff8396]">{err}</p>}

          {done ? (
            <div className="mt-6 rounded-[16px] border border-[#3ddc97]/40 bg-[#07261a]/60 p-4">
              <div className="font-semibold text-[#7ef0bd]">{done.message ?? "Done."}</div>
              <a href={explorerTxUrl(done.sig)} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[12px] underline">
                View transaction ↗
              </a>
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-3">
              {!wallet.publicKey ? (
                <WalletMultiButton />
              ) : (
                meta?.links?.actions.map((a, i) =>
                  i === 0 ? (
                    <PrimaryButton key={a.href} size="md" className="w-full" disabled={!!busy || meta.disabled} onClick={() => void execute(a.href, a.label)}>
                      {busy === a.label ? "Waiting for Phantom…" : a.label}
                    </PrimaryButton>
                  ) : (
                    <OutlineButton key={a.href} size="md" className="w-full" tone="danger" disabled={!!busy || meta.disabled} onClick={() => void execute(a.href, a.label)}>
                      {busy === a.label ? "Waiting for Phantom…" : a.label}
                    </OutlineButton>
                  ),
                )
              )}
            </div>
          )}
        </div>
      </div>
      <p className="mt-4 text-center font-mono text-[12px] opacity-60">
        Also available as a Blink:{" "}
        <a className="underline" href={dialToUrl(`${ENV.siteUrl}${base}`)} target="_blank" rel="noreferrer">
          open on dial.to ↗
        </a>
      </p>
    </div>
  );
}
