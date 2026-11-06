import { docsResponse } from "../../_lib/market-docs";

// A1 lab docs, variant "activation-step" (see app/lab/_lib/market-docs.ts).
export const dynamic = "force-dynamic";

export function GET(): Response {
  return docsResponse("activation-step");
}
