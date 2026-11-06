"use client";

import { Suspense } from "react";
import { ApproveClient } from "@/components/approve/approve-client";
import { Nav } from "@/components/site/nav";
import { WalletShell } from "@/components/wallet/wallet-shell";

export default function ApprovePage() {
  return (
    <WalletShell>
      <div className="min-h-screen p-3 sm:p-6 xl:p-10">
        <div className="mx-auto max-w-[1216px]">
          <Nav />
        </div>
        <div className="mt-12 flex justify-center pb-20">
          <Suspense>
            <ApproveClient />
          </Suspense>
        </div>
      </div>
    </WalletShell>
  );
}
