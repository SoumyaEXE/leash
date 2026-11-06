import { Suspense } from "react";
import { DemoClient } from "@/components/demo/demo-client";

export const metadata = { title: "Live demo · Leash" };

export default function DemoPage() {
  return (
    <Suspense>
      <DemoClient />
    </Suspense>
  );
}
