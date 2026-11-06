import { PublicKey } from "@solana/web3.js";
import { fromBaseUnits, type RequestState } from "@leash/sdk";
import { actionError, actionJson, actionOptions, origin, serializeUnsigned } from "@/lib/actions";
import { isMock } from "@/lib/leash";
import { serverLeashClient } from "@/lib/leash-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(req: Request): Promise<{ request: RequestState; label: string; reason?: string } | Response> {
  const u = new URL(req.url);
  const id = u.searchParams.get("request");
  if (!id) return actionError("Missing ?request=<spend request address>");
  let pda: PublicKey;
  try {
    pda = new PublicKey(id);
  } catch {
    return actionError("Invalid request address");
  }
  const client = serverLeashClient();
  const request = await client.getRequest(pda);
  if (!request) return actionError("Spend request not found", 404);
  const payees = await client.listPayees(request.vault).catch(() => []);
  const label = payees.find((p) => p.payee.equals(request.payee))?.label ?? `${request.payee.toBase58().slice(0, 4)}…${request.payee.toBase58().slice(-4)}`;
  const recent = await client.recentActivity(request.vault, 100).catch(() => []);
  const reason = recent.find((e) => e.kind === "requested" && e.request === pda.toBase58())?.reason;
  return { request, label, reason };
}

export async function GET(req: Request) {
  const r = await load(req);
  if (r instanceof Response) return r;
  const { request, label, reason } = r;
  const amount = fromBaseUnits(request.amount);
  const base = origin(req);
  const q = `request=${request.address.toBase58()}`;
  const pending = request.status === "pending";
  return actionJson({
    type: "action",
    icon: `${base}/blink-icon.svg`,
    title: `Approve ${amount} dUSDC to ${label}?`,
    description: `${reason ? `Agent's reason: ${reason}. ` : ""}Leash co-sign request #${request.seq.toString()} · expires ${new Date(request.expiresAt * 1000).toUTCString()}. Signing runs approve_request on the Leash program (devnet).`,
    label: "Approve",
    disabled: !pending,
    ...(pending ? {} : { error: { message: `This request is already ${request.status}.` } }),
    links: {
      actions: [
        { type: "transaction", label: `Approve ${amount} dUSDC`, href: `/api/actions/approve?${q}&decision=approve` },
        { type: "transaction", label: "Reject", href: `/api/actions/approve?${q}&decision=reject` },
      ],
    },
  });
}

export async function POST(req: Request) {
  const r = await load(req);
  if (r instanceof Response) return r;
  const { request, label } = r;
  let account: PublicKey;
  try {
    const body = (await req.json()) as { account?: string };
    account = new PublicKey(body.account ?? "");
  } catch {
    return actionError('Body must be { "account": "<owner wallet>" }');
  }
  if (request.status !== "pending") return actionError(`This request is already ${request.status}.`, 409);

  const client = serverLeashClient();
  if (!isMock(client)) {
    const vault = await client.getVault(request.vault);
    if (!vault.owner.equals(account)) return actionError("Only the vault owner can approve or reject this request.", 403);
  }
  const decision = new URL(req.url).searchParams.get("decision") === "reject" ? "rejectRequest" : "approveRequest";
  const tx = await client.buildOwnerTx(account, { type: decision, vault: request.vault, request: request.address });
  if (isMock(client)) client.apply({ type: decision, vault: request.vault, request: request.address });
  return actionJson({
    type: "transaction",
    transaction: serializeUnsigned(tx),
    message: decision === "approveRequest" ? `Approved ${fromBaseUnits(request.amount)} dUSDC to ${label}.` : "Request rejected.",
  });
}

export const OPTIONS = actionOptions;
