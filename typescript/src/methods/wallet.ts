/**
 * Proving you hold a wallet, for the reads that are not everyone's.
 *
 * Most of a node's read surface is open, because what it returns is
 * already replicated to every node. A handful of reads are not, and the
 * line between them is not "is this secret" — nothing here is secret —
 * but "does answering this to a stranger assemble something the protocol
 * deliberately leaves scattered". The trade graph is that something:
 * which merchant a wallet always returns to, and who a busy merchant's
 * regulars are, is a physical-safety question in a P2P fiat market.
 *
 * So `getSettlements`, `getReservations` and `getDisputes` answer with
 * the redacted `Public*` shapes, and a party reads their own records in
 * full through `getMySettlements`, `getMyReservations` and
 * `getMyDisputes` — each of which takes a {@link WalletProof} rather than
 * a wallet parameter, so there is no way to spell "somebody else's
 * history".
 *
 * The exchange is two calls: `getWalletChallenge` hands out a single-use,
 * expiring nonce (deliberately open — a nonce is worthless without the
 * private key that signs it), and the wallet answers it by signing
 * `"<domain>:<subject>:<nonce>"`. One issuer serves every gated surface,
 * because a nonce carries no domain of its own; the separation is
 * entirely in what gets signed, which is why each domain module declares
 * its own `CHALLENGE_DOMAIN` and why those constants are transcribed
 * from the node's own.
 *
 * None of this is confidentiality — these records gossip to every node.
 * What it protects is the ease of the query: the difference between
 * `curl`-ing a stranger's public access node and standing up a node to
 * index the network.
 */
import type { Client } from "../client.js";
import { type Keypair, peerIdFromPublicKey, sign } from "../crypto.js";
import type { WalletChallenge } from "../types.js";

/** A wallet answering a challenge: whose records, which nonce, the key
 *  claiming to be that wallet, and its signature over the challenge. */
export interface WalletProof {
  /** Base64 PeerId, matching every other wallet-scoped method. */
  wallet: string;
  /** Base64 raw 32-byte Ed25519 public key. Sent explicitly rather than
   *  left for the node to recover from `wallet`, so the identity claim is
   *  something the caller states and the node checks. */
  public_key: string;
  nonce: string;
  /** Base64, matching every other signed payload on this surface. */
  signature: string;
}

/**
 * Ask for a single-use challenge for `wallet` (raw PeerId bytes) to sign.
 *
 * Prefer the `getMy*` methods, which perform both steps. This is exposed
 * for callers whose signing key lives somewhere the SDK cannot reach — a
 * browser wallet's `signMessage`, for instance — who need
 * {@link walletChallengeBytes} and then build a {@link WalletProof}
 * themselves.
 */
export async function getWalletChallenge(
  client: Client,
  wallet: Uint8Array,
): Promise<WalletChallenge> {
  return client.call("getWalletChallenge", {
    wallet: Buffer.from(wallet).toString("base64"),
  });
}

/** The exact bytes a wallet signs to answer `challenge` on the surface
 *  `domain` names. */
export function walletChallengeBytes(challenge: WalletChallenge, domain: string): Uint8Array {
  return new TextEncoder().encode(`${domain}:${challenge.subject}:${challenge.nonce}`);
}

/**
 * Fetch a challenge for `keypair`'s own wallet and answer it under
 * `domain`.
 *
 * The wallet is derived from the keypair rather than taken as an
 * argument: the node refuses any proof whose key does not derive to the
 * wallet named, so a wallet parameter could only ever be right or be an
 * error, and taking one would suggest otherwise.
 */
export async function walletProof(
  client: Client,
  keypair: Keypair,
  domain: string,
): Promise<WalletProof> {
  const challenge = await getWalletChallenge(client, peerIdFromPublicKey(keypair.publicKey));
  const signature = await sign(keypair, walletChallengeBytes(challenge, domain));
  return {
    // The subject the node issued, not a re-encoding of the peer id — it
    // is what the node rebuilds the signing bytes from.
    wallet: challenge.subject,
    public_key: Buffer.from(keypair.publicKey).toString("base64"),
    nonce: challenge.nonce,
    signature: Buffer.from(signature).toString("base64"),
  };
}
