"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { errorNameFromCode, friendlyError, parseLeashErrorFromLogs, type ILeashClient, type OwnerAction } from "@leash/sdk";
import { useCallback, useMemo, useState } from "react";
import { getBrowserLeashClient, isMock } from "@/lib/leash";
import { explorerTxUrl } from "@/lib/env";

/** "NotOwner: Only the vault owner can…" from a wallet / RPC error that carries a Leash error code, else the message. */
function describeError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  const m = msg.match(/custom program error: 0x([0-9a-fA-F]+)/) ?? msg.match(/"Custom":\s*(\d+)/);
  const code = m ? (m[0].startsWith("custom") ? parseInt(m[1], 16) : Number(m[1])) : undefined;
  const name = code !== undefined ? errorNameFromCode(code) : undefined;
  return name ? `${friendlyError(name).title}: ${friendlyError(name).detail}` : msg.slice(0, 160);
}

export interface Toast {
  kind: "ok" | "err" | "info";
  text: string;
  href?: string;
}

/** Leash client bound to the connected wallet + a helper that signs owner actions with it. */
export function useOwner() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const modal = useWalletModal();
  const [toast, setToast] = useState<Toast | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const client: ILeashClient = useMemo(
    () =>
      getBrowserLeashClient(
        connection,
        wallet.publicKey && wallet.signTransaction
          ? { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction as never }
          : undefined,
      ),
    [connection, wallet.publicKey, wallet.signTransaction],
  );

  const run = useCallback(
    async (action: OwnerAction, label: string): Promise<boolean> => {
      setPending(label);
      setToast(null);
      try {
        if (!wallet.publicKey) {
          if (isMock(client)) {
            client.apply(action);
            setToast({ kind: "info", text: `${label}: simulated (mock mode, no wallet connected).` });
            return true;
          }
          modal.setVisible(true);
          return false;
        }
        const tx = await client.buildOwnerTx(wallet.publicKey, action);
        const sig = await wallet.sendTransaction(tx, connection);
        const confirmed = await connection.confirmTransaction(sig, "confirmed");
        if (confirmed.value.err) {
          // Landed but refused: show the program's named error, not "confirmed".
          const landed = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
          const parsed = parseLeashErrorFromLogs(landed?.meta?.logMessages, client.programId);
          const text = parsed ? `${friendlyError(parsed.name).title}: ${friendlyError(parsed.name).detail}` : describeError(new Error(JSON.stringify(confirmed.value.err)));
          setToast({ kind: "err", text: `${label} failed: ${text}`, href: explorerTxUrl(sig) });
          return false;
        }
        if (isMock(client)) client.apply(action, sig);
        setToast({ kind: "ok", text: `${label}: confirmed.`, href: explorerTxUrl(sig) });
        return true;
      } catch (e) {
        setToast({ kind: "err", text: `${label} failed: ${describeError(e)}` });
        return false;
      } finally {
        setPending(null);
      }
    },
    [client, connection, modal, wallet],
  );

  return { client, wallet, connection, run, toast, setToast, pending, mock: isMock(client) };
}
