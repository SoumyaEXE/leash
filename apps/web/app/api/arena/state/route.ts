import { fromBaseUnits } from "@leash/sdk";
import { readArena } from "@/lib/arena-store";
import { arenaVault, isMock } from "@/lib/leash";
import { serverLeashClient } from "@/lib/leash-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const d = readArena();
  const client = serverLeashClient();
  const vault = arenaVault(client);
  let onchain: { blockedCount: string; strikes: number; balance: string; paused: boolean } | null = null;
  try {
    const v = await client.getVault(vault);
    onchain = { blockedCount: v.blockedCount.toString(), strikes: v.strikes, balance: fromBaseUnits(v.balance, v.decimals), paused: v.paused };
  } catch {
    onchain = null;
  }
  return Response.json(
    {
      enabled: process.env.ARENA_ENABLED !== "false",
      mock: isMock(client),
      vault: vault.toBase58(),
      onchain,
      score: d.score,
      recent: d.attempts.slice(0, 25).map((a) => ({ ...a, address: `${a.address.slice(0, 4)}…${a.address.slice(-4)}` })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
