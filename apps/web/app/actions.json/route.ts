import { actionJson, actionOptions } from "@/lib/actions";

export const dynamic = "force-static";

export function GET() {
  return actionJson({
    rules: [{ pathPattern: "/api/actions/**", apiPath: "/api/actions/**" }],
  });
}

export const OPTIONS = actionOptions;
