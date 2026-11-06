"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { ILeashClient, OwnerAction } from "@leash/sdk";
import { useCallback, useMemo, useState } from "react";
import { getBrowserLeashClient, isMock } from "@/lib/leash";
import { explorerTxUrl } from "@/lib/env";

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
        await connection.confirmTransaction(sig, "confirmed");
        if (isMock(client)) client.apply(action, sig);
        setToast({ kind: "ok", text: `${label}: confirmed.`, href: explorerTxUrl(sig) });
        return true;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        setToast({ kind: "err", text: `${label} failed: ${msg.slice(0, 160)}` });
        return false;
      } finally {
        setPending(null);
      }
    },
    [client, connection, modal, wallet],
  );

  return { client, wallet, connection, run, toast, setToast, pending, mock: isMock(client) };
}
