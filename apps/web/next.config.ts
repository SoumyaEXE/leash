import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// One .env for the whole monorepo (repo root). Server-only vars (YDC_API_KEY, keypair paths) stay server-side;
// only NEXT_PUBLIC_* are inlined into the browser bundle.
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const publicEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k, v]) => k.startsWith("NEXT_PUBLIC_") && typeof v === "string"),
) as Record<string, string>;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // no floating dev badge in screen recordings
  devIndicators: false,
  transpilePackages: ["@leash/sdk", "@leash/llm"],
  env: publicEnv,
  // keep heavy node-only deps out of the server bundle
  serverExternalPackages: ["@anchor-lang/core"],
  async headers() {
    return [
      {
        source: "/actions.json",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
