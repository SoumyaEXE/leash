/**
 * The ONLY difference between the two agents: where the money is and who decides whether it moves.
 * - Victim: the bot's hot wallet holds the tokens and signs any transfer the pipeline asks for (Bankr pattern).
 * - Leashed: the tokens sit in a Leash vault; the agent key can only *request* payments from the program.
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { type Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { MEMO_PROGRAM_ID, explorerTx, fromBaseUnits } from "@leash/sdk";
import type { DemoMode, DemoPayment } from "@leash/sdk/demo";
import { connection } from "./env";
import { getLeash } from "./leash";

export interface PayRequest {
  to: PublicKey;
  toLabel?: string;
  amount: bigint;
  /** the agent's stated reason (Leash: reason_hash + SPL Memo; victim: memo only) */
  reason: string;
  /** 32-byte x402 nonce, when paying a 402 */
  memo?: Uint8Array;
  /** plain-text memo for the victim's direct transfer (x402 "transfer" scheme uses "x402:<nonce hex>") */
  memoText?: string;
}

export interface WalletBackend {
  mode: DemoMode;
  label: string;
  /** wallet shown in the UI: victim hot wallet, or the vault PDA */
  address: PublicKey;
  tokenAccount(): PublicKey | null;
  balance(): Promise<bigint>;
  pay(req: PayRequest): Promise<DemoPayment>;
}

export class VictimWallet implements WalletBackend {
  readonly mode = "victim" as const;
  readonly label = "Unprotected agent (hot wallet)";
  constructor(
    private readonly kp: Keypair,
    private readonly mint: PublicKey | null,
  ) {}
  get address(): PublicKey {
    return this.kp.publicKey;
  }
  tokenAccount(): PublicKey | null {
    return this.mint ? getAssociatedTokenAddressSync(this.mint, this.kp.publicKey) : null;
  }
  async balance(): Promise<bigint> {
    const ata = this.tokenAccount();
    if (!ata) return 0n;
    try {
      return (await getAccount(connection(), ata)).amount;
    } catch {
      return 0n;
    }
  }
  async pay(req: PayRequest): Promise<DemoPayment> {
    const base: DemoPayment = { status: "failed", amount: fromBaseUnits(req.amount), to: req.to.toBase58(), toLabel: req.toLabel };
    if (!this.mint) return { ...base, friendly: { title: "Devnet not set up", detail: "DUSDC_MINT is missing. Run pnpm setup:devnet." } };
    const conn = connection();
    const from = getAssociatedTokenAddressSync(this.mint, this.kp.publicKey);
    const toAta = getAssociatedTokenAddressSync(this.mint, req.to, true);
    const memo = req.memoText ?? `bot: ${req.reason}`.slice(0, 180);
    const tx = new Transaction().add(
      new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(memo, "utf8") }),
      createAssociatedTokenAccountIdempotentInstruction(this.kp.publicKey, toAta, req.to, this.mint),
      createTransferCheckedInstruction(from, this.mint, toAta, this.kp.publicKey, req.amount, 6),
    );
    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [this.kp], { commitment: "confirmed" });
      return { ...base, status: "executed", sig, explorerUrl: explorerTx(sig) };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const insufficient = /insufficient funds|0x1\b/i.test(msg);
      return {
        ...base,
        status: "failed",
        friendly: insufficient
          ? { title: "Wallet is empty", detail: "Nothing left to send: the hot wallet was already drained." }
          : { title: "Transfer failed", detail: msg.slice(0, 200) },
      };
    }
  }
}

export class LeashedWallet implements WalletBackend {
  readonly mode = "leashed" as const;
  readonly label = "Leashed agent (Leash vault)";
  get address(): PublicKey {
    return getLeash().vault;
  }
  tokenAccount(): PublicKey | null {
    return null; // resolved from getVault() in balance()/balances
  }
  async balance(): Promise<bigint> {
    try {
      return (await getLeash().client.getVault(getLeash().vault)).balance;
    } catch {
      return 0n;
    }
  }
  async pay(req: PayRequest): Promise<DemoPayment> {
    const { client, vault } = getLeash();
    const base: DemoPayment = { status: "failed", amount: fromBaseUnits(req.amount), to: req.to.toBase58(), toLabel: req.toLabel };
    let res;
    try {
      res = await client.spend({ vault, payee: req.to, amount: req.amount, reason: req.reason, memo: req.memo, expectFailure: true });
    } catch (e) {
      return { ...base, friendly: { title: "Couldn't reach Solana", detail: (e as Error).message.slice(0, 200) } };
    }
    if (res.ok) return { ...base, status: "executed", sig: res.sig, explorerUrl: res.explorerUrl || undefined };
    if (res.name === "RequiresCosign") {
      // Over the co-sign threshold: ask the owner instead (docs/03 F3).
      const r = await client.requestSpend({ vault, payee: req.to, amount: req.amount, reason: req.reason });
      if (r.ok) {
        return {
          ...base,
          status: "pending_approval",
          sig: r.sig,
          explorerUrl: r.explorerUrl || undefined,
          request: r.request.toBase58(),
          blinkUrl: r.blinkUrl,
          errorName: "RequiresCosign",
          friendly: res.friendly,
        };
      }
      return { ...base, status: "blocked", errorName: r.name, friendly: r.friendly, sig: r.sig, explorerUrl: r.explorerUrl || undefined };
    }
    return {
      ...base,
      status: res.blocked ? "blocked" : "failed",
      errorName: res.name,
      friendly: res.friendly,
      sig: res.sig,
      explorerUrl: res.explorerUrl || undefined,
    };
  }
}
