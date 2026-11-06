import { PublicKey } from "@solana/web3.js";
import { fromBaseUnits, reasonHash, toHex, type RequestState } from "@leash/sdk";
import { actionError, actionJson, actionOptions, origin, serializeUnsigned } from "@/lib/actions";
import { isMock } from "@/lib/leash";
import { serverLeashClient } from "@/lib/leash-server";
import { shortAddress, untrustedText } from "../../_lib/untrusted-text";

/** Max characters of the agent's reason shown in the Blink. */
const REASON_MAX = 140;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the owner is asked to sign comes from chain state: amount, payee and expiry from the SpendRequest
 * account, the payee's label from the vault's own Payee account (written by the owner). The agent's reason is the
 * only agent-written text: it is read from the request tx's memo, flattened by untrustedText(), capped, quoted and
 * labeled as the agent's words, and flagged when it doesn't match the reason hash stored in the request.
 */
async function load(req: Request): Promise<{ request: RequestState; payeeName: string; reason?: string } | Response> {
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
  const payee = request.payee.toBase58();
  const label = untrustedText(payees.find((p) => p.payee.equals(request.payee) && p.vault.equals(request.vault))?.label, 32);
  // label (owner-set) + the address itself, so a misleading label can't hide where the money goes
  const payeeName = label ? `${label} (${shortAddress(payee)})` : shortAddress(payee);
  const recent = await client.recentActivity(request.vault, 100).catch(() => []);
  const raw = recent.find((e) => e.kind === "requested" && e.request === pda.toBase58())?.reason;
  let reason: string | undefined;
  if (raw) {
    const text = untrustedText(raw, REASON_MAX);
    const matches = toHex(reasonHash(raw)) === toHex(request.reasonHash);
    reason = `Agent's note (written by the agent, not verified): “${text}”${matches ? "" : " [does not match the request's onchain reason hash]"}. `;
  }
  return { request, payeeName, reason };
}

export async function GET(req: Request) {
  const r = await load(req);
  if (r instanceof Response) return r;
  const { request, payeeName, reason } = r;
  const amount = fromBaseUnits(request.amount);
  const base = origin(req);
  const q = `request=${request.address.toBase58()}`;
  const pending = request.status === "pending";
  return actionJson({
    type: "action",
    icon: `${base}/blink-icon.svg`,
    title: `Approve ${amount} dUSDC to ${payeeName}?`,
    description:
      `Pays ${amount} dUSDC from vault ${shortAddress(request.vault.toBase58())} to ${request.payee.toBase58()} (amount and payee read from the onchain request). ` +
      (reason ?? "") +
      `Leash co-sign request #${request.seq.toString()} · expires ${new Date(request.expiresAt * 1000).toUTCString()}. Signing runs approve_request on the Leash program (devnet).`,
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
  const { request, payeeName } = r;
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
    message: decision === "approveRequest" ? `Approved ${fromBaseUnits(request.amount)} dUSDC to ${payeeName}.` : "Request rejected.",
  });
}

export const OPTIONS = actionOptions;
