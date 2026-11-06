"use client";

import { Suspense } from "react";
import { ApproveClient } from "@/components/approve/approve-client";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { WalletShell } from "@/components/wallet/wallet-shell";

export default function ApprovePage() {
  return (
    <WalletShell>
      <Nav />
      <main className="relative overflow-hidden pt-[150px]">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-420px] h-[760px] w-[1000px] -translate-x-1/2 rounded-full opacity-70 blur-[120px]"
          style={{ background: "radial-gradient(closest-side, rgb(252 109 1 / 0.45), rgb(211 40 0 / 0.18) 55%, transparent)" }}
        />
        <div className="relative flex justify-center px-5 pb-10">
          <Suspense>
            <ApproveClient />
          </Suspense>
        </div>
      </main>
      <Footer />
    </WalletShell>
  );
}
