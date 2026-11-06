/**
 * The swap point between the mock and the real Leash SDK.
 *
 * Today @leash/sdk exports only the contract (types, errors, utils). When it exports `LeashClient`, this file uses
 * it automatically, the equivalent of the one-line swap:
 *   return new LeashClient({ connection, programId, wallet: agentKeypair, blinkBaseUrl });
 * Set LEASH_USE_MOCK=1 to force the mock (e.g. offline UI work).
 */
import * as sdk from "@leash/sdk";
import type { ILeashClient } from "@leash/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MockLeashClient } from "./leash-mock";
import { connection, settings } from "./env";

export interface LeashHandle {
  client: ILeashClient;
  vault: PublicKey;
  kind: "real" | "mock";
}

type LeashClientCtor = new (opts: {
  connection: ReturnType<typeof connection>;
  programId: PublicKey;
  wallet: Keypair;
  blinkBaseUrl?: string;
}) => ILeashClient;

const DUMMY_PROGRAM = new PublicKey("Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe");

let handle: LeashHandle | null = null;

export function getLeash(): LeashHandle {
  if (handle) return handle;
  const s = settings();
  const agent = s.agent ?? Keypair.generate();
  const owner = s.owner?.publicKey ?? Keypair.generate().publicKey;
  const programId = s.programId ?? DUMMY_PROGRAM;
  const RealClient = (sdk as Record<string, unknown>).LeashClient as LeashClientCtor | undefined;

  if (RealClient && !s.forceMock && s.programId && s.mint && s.agent) {
    const client = new RealClient({ connection: connection(), programId, wallet: agent, blinkBaseUrl: s.siteUrl });
    const vault = s.vault ?? client.vaultPda(owner, 1n);
    handle = { client, vault, kind: "real" };
  } else {
    const mock = new MockLeashClient({
      connection: connection(),
      programId,
      owner,
      agent: agent.publicKey,
      signer: agent.publicKey,
      mint: s.mint ?? Keypair.generate().publicKey,
      merchant: s.merchant ?? Keypair.generate().publicKey,
      siteUrl: s.siteUrl,
    });
    handle = { client: mock, vault: mock.demoVault, kind: "mock" };
  }
  return handle;
}

/** Drop the cached client (after .env changes, e.g. post-setup). */
export function resetLeashHandle(): void {
  handle = null;
}
