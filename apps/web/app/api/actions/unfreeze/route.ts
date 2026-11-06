import { PublicKey } from "@solana/web3.js";
import { actionError, actionJson, actionOptions, origin, serializeUnsigned } from "@/lib/actions";
import { demoVault, isMock } from "@/lib/leash";
import { serverLeashClient } from "@/lib/leash-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function vaultFrom(req: Request): PublicKey | Response {
  const v = new URL(req.url).searchParams.get("vault");
  if (!v) {
    const fallback = process.env.TRIPWIRE_VAULT || process.env.NEXT_PUBLIC_LEASH_VAULT;
    if (fallback) return new PublicKey(fallback);
    return demoVault(serverLeashClient());
  }
  try {
    return new PublicKey(v);
  } catch {
    return actionError("Invalid vault address");
  }
}

export async function GET(req: Request) {
  const vault = vaultFrom(req);
  if (vault instanceof Response) return vault;
  const v = await serverLeashClient()
    .getVault(vault)
    .catch(() => null);
  if (!v) return actionError("Vault not found", 404);
  return actionJson({
    type: "action",
    icon: `${origin(req)}/blink-icon.svg`,
    title: v.paused ? "Unfreeze your Leash vault?" : "Vault is not frozen",
    description: `The tripwire recorded ${v.strikes} strike(s) and ${v.blockedCount.toString()} blocked payment(s) in total. Unfreezing clears the strikes and lets allowlisted payments through again.`,
    label: "Unfreeze",
    disabled: !v.paused,
    links: { actions: [{ type: "transaction", label: "Unfreeze vault", href: `/api/actions/unfreeze?vault=${vault.toBase58()}` }] },
  });
}

export async function POST(req: Request) {
  const vault = vaultFrom(req);
  if (vault instanceof Response) return vault;
  let account: PublicKey;
  try {
    account = new PublicKey(((await req.json()) as { account?: string }).account ?? "");
  } catch {
    return actionError('Body must be { "account": "<owner wallet>" }');
  }
  const client = serverLeashClient();
  if (!isMock(client)) {
    const v = await client.getVault(vault);
    if (!v.owner.equals(account)) return actionError("Only the vault owner can unfreeze it.", 403);
  }
  const tx = await client.buildOwnerTx(account, { type: "setPaused", vault, paused: false });
  if (isMock(client)) client.apply({ type: "setPaused", vault, paused: false });
  return actionJson({ type: "transaction", transaction: serializeUnsigned(tx), message: "Vault unfrozen. Strikes cleared." });
}

export const OPTIONS = actionOptions;
