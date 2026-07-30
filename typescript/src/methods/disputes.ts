/** Dispute methods (OFS-2400). */
import type { Client } from "../client.js";
import type { Keypair } from "../crypto.js";
import type { Dispute, PublicDispute } from "../types.js";
import { walletProof } from "./wallet.js";

/** Domain separator for `getMyDisputes`, transcribed from
 *  `openfiat-rpc`'s `methods::disputes::CHALLENGE_DOMAIN`. */
export const CHALLENGE_DOMAIN = "openfiat-my-disputes";

/**
 * Read one dispute as a stranger sees it: status, arbitrator counts and
 * outcome survive; the parties, the free-text `reason` and which
 * arbitrator voted how do not. The pairing is what makes pressuring an
 * arbitrator worth the effort, so counts are published and the pairing
 * is not.
 */
export async function getDispute(client: Client, id: string): Promise<PublicDispute | null> {
  return client.call("getDispute", { id });
}

/** Every dispute on the network, redacted. */
export async function getDisputes(client: Client): Promise<PublicDispute[]> {
  return client.call("getDisputes", {});
}

/**
 * Every dispute `keypair`'s wallet is a party to — or is a seated
 * arbitrator on — in full, proved by signing a freshly issued wallet
 * challenge.
 *
 * An arbitrator qualifies because reading the whole case is the job they
 * were seated to do.
 */
export async function getMyDisputes(client: Client, keypair: Keypair): Promise<Dispute[]> {
  return client.call("getMyDisputes", await walletProof(client, keypair, CHALLENGE_DOMAIN));
}
