"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ENV, explorerTxUrl } from "@/lib/env";
import { dialToUrl } from "@/lib/leash";
import { ExtLink } from "../cx/icons";
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
    return (
      <div className="mx-auto max-w-[560px] text-center">
        <h1 className="cx-h3">Approve a Request</h1>
        <p className="cx-body mt-3 text-white/75">
          Open this page from a pending co-sign request: the demo, the vault dashboard and the Blink all link here with <span className="font-mono text-[16px]">?request=&lt;address&gt;</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="cx-border cx-card overflow-hidden rounded-[24px]" style={{ ["--cx-angle" as string]: "130deg" }}>
        {meta?.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.icon} alt="" aria-hidden className="aspect-square w-full object-cover" />
        )}
        <div className="p-7">
          <span className="cx-badge cx-border !h-9 !px-4 !text-[14px]">Solana Action · devnet</span>
          <h1 className="cx-h3 mt-5">{meta?.title ?? (err ? "Couldn't load this action" : "Loading…")}</h1>
          {meta?.description && <p className="cx-small mt-3">{meta.description}</p>}
          {meta?.error && <p className="mt-3 text-[15px] text-[#f5c86a]">{meta.error.message}</p>}
          {err && (
            <p role="alert" className="mt-3 text-[15px] text-[#ffb0a6]">
              {err}
            </p>
          )}

          {done ? (
            <div role="status" className="mt-6 rounded-[16px] border border-[#0cbe4d]/40 bg-[#0cbe4d]/[0.07] p-4">
              <div className="text-[16px] text-[#8ee8ae]">{done.message ?? "Done."}</div>
              <ExtLink href={explorerTxUrl(done.sig)} className="mt-3">
                View transaction
              </ExtLink>
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
      <p className="mt-5 text-center text-[14px] text-white/60">
        Also available as a Blink:{" "}
        <ExtLink tone="quiet" href={dialToUrl(`${ENV.siteUrl}${base}`)} className="text-[#ff8a6b]">
          Open on dial.to
        </ExtLink>
      </p>
    </div>
  );
}
