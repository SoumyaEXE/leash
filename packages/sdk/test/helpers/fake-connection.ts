/** Just enough of web3.js `Connection` for LeashClient unit tests: accounts in memory, sends recorded. */
import { Keypair, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { Buffer } from "buffer";

export interface FakeAccount {
  owner: PublicKey;
  data: Buffer;
  lamports?: number;
}

export interface Landed {
  err: unknown;
  logs: string[];
}

export class FakeConnection {
  accounts = new Map<string, FakeAccount>();
  tokenBalances = new Map<string, { amount: bigint; decimals: number }>();
  signatures = new Map<string, { signature: string; err: unknown; blockTime: number }[]>();
  txs = new Map<string, { slot: number; blockTime: number; meta: { err: unknown; logMessages: string[]; loadedAddresses?: unknown }; transaction: { message: unknown; signatures: string[] } }>();
  sent: { tx: Transaction; opts: { skipPreflight?: boolean } }[] = [];
  /** What a sent tx "did" onchain. Default: succeeded with no logs. */
  onSend: (tx: Transaction) => Landed = () => ({ err: null, logs: [] });

  setAccount(address: PublicKey, owner: PublicKey, data: Uint8Array): void {
    this.accounts.set(address.toBase58(), { owner, data: Buffer.from(data) });
  }

  addMint(mint: PublicKey, decimals = 6, owner = TOKEN_PROGRAM_ID): void {
    const data = Buffer.alloc(82);
    data[44] = decimals;
    data[45] = 1; // is_initialized
    this.setAccount(mint, owner, data);
  }

  asConnection(): Connection {
    return this as unknown as Connection;
  }

  async getAccountInfo(address: PublicKey) {
    const a = this.accounts.get(address.toBase58());
    return a ? { owner: a.owner, data: a.data, lamports: a.lamports ?? 1_000_000, executable: false, rentEpoch: 0 } : null;
  }

  async getProgramAccounts(programId: PublicKey, cfg: { filters?: { memcmp: { offset: number; bytes: string } }[] }) {
    const out: { pubkey: PublicKey; account: { owner: PublicKey; data: Buffer } }[] = [];
    for (const [k, a] of this.accounts) {
      if (!a.owner.equals(programId)) continue;
      const ok = (cfg.filters ?? []).every((f) => {
        const want = Buffer.from(bs58.decode(f.memcmp.bytes));
        return a.data.subarray(f.memcmp.offset, f.memcmp.offset + want.length).equals(want);
      });
      if (ok) out.push({ pubkey: new PublicKey(k), account: { owner: a.owner, data: a.data } });
    }
    return out;
  }

  async getTokenAccountBalance(address: PublicKey) {
    const b = this.tokenBalances.get(address.toBase58());
    if (!b) throw new Error("failed to get token account balance: Invalid param: could not find account");
    return { context: { slot: 1 }, value: { amount: b.amount.toString(), decimals: b.decimals, uiAmount: null } };
  }

  async getLatestBlockhash() {
    return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000 };
  }

  async sendRawTransaction(raw: Uint8Array, opts: { skipPreflight?: boolean } = {}) {
    const tx = Transaction.from(Buffer.from(raw));
    this.sent.push({ tx, opts });
    const sig = bs58.encode(Keypair.generate().secretKey.slice(0, 64));
    const landed = this.onSend(tx);
    this.txs.set(sig, {
      slot: 10,
      blockTime: 1_000,
      meta: { err: landed.err, logMessages: landed.logs },
      transaction: { message: tx.compileMessage(), signatures: [sig] },
    });
    return sig;
  }

  async confirmTransaction() {
    return { context: { slot: 10 }, value: { err: null } };
  }

  async getTransaction(sig: string) {
    return this.txs.get(sig) ?? null;
  }

  async getSignaturesForAddress(address: PublicKey) {
    return this.signatures.get(address.toBase58()) ?? [];
  }

  /** Register a historical tx (newest first in getSignaturesForAddress order is the caller's job). */
  addHistory(addresses: PublicKey[], sig: string, logs: string[], err: unknown = null, message?: unknown): void {
    this.txs.set(sig, { slot: 5, blockTime: 900, meta: { err, logMessages: logs }, transaction: { message: message ?? null, signatures: [sig] } });
    for (const a of addresses) {
      const list = this.signatures.get(a.toBase58()) ?? [];
      list.push({ signature: sig, err, blockTime: 900 });
      this.signatures.set(a.toBase58(), list);
    }
  }
}
