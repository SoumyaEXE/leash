import { docsResponse } from "../../_lib/market-docs";

// A1 lab docs, variant "clean" (see app/lab/_lib/market-docs.ts).
export const dynamic = "force-dynamic";

export function GET(): Response {
  return docsResponse("clean");
}
