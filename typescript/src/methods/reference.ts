import type { Client } from "../client.js";
import type { ReferenceData } from "../types.js";

/**
 * The countries, fiat currencies, payment methods and token mints to
 * offer a user to choose from.
 *
 * # Why ask a node at all
 *
 * Because the alternative is what every interface did before: ship its own
 * table. Two honest builds could then disagree about what the network
 * supports, and adding a payment method meant releasing a new version of
 * every app that wanted to offer it. Asking the node makes it one list
 * that every client reads and a node operator updates.
 *
 * The list is compiled into the node rather than derived from anything, so
 * it is still hand-maintained — it is one table instead of many, which is
 * the whole of the improvement and is worth being clear about.
 *
 * # A suggestion list, never a validation gate
 *
 * Do not use this to decide what is permitted. Nothing on the node's own
 * surface consults it: an advertisement in a currency absent from
 * `currencies` is accepted exactly as one that is present, because a
 * currency code is checked for form and deliberately not for membership of
 * any list — otherwise a node built last year would reject an
 * advertisement in a currency added since, and two honest nodes would
 * disagree about which advertisements are valid.
 *
 * The same applies to payment methods: a merchant who trades a rail this
 * node has never heard of must still be able to name it, so an interface
 * built on this should let them type one in rather than restricting them
 * to what came back.
 *
 * `mints` needs the sharpest version of that warning, because a real
 * enforcement list does exist elsewhere: the settlement allowlist lives
 * on chain in the escrow program's `FeeConfig` and governance can change
 * it. This list is a phrasebook for turning an address into a name, and
 * the two sets are not guaranteed equal in either direction — governance
 * can allowlist a mint no build has a name for, and a named mint can be
 * de-listed without a node hearing about it.
 *
 * Look mints up by address. A ticker is a nickname: `USDC` names a
 * different address on every cluster, and this network settles wrapped
 * SOL under `wSOL`, so a client routing on `SOL` matches nothing at all.
 *
 * # Caching
 *
 * The answer is a few tens of kilobytes and changes about as often as the
 * node is upgraded. Fetch it once per session and hold it; `revision`
 * changes when and only when the data does, so it is what to key a longer-
 * lived cache on.
 *
 * There is no offline fallback here on purpose. A client that quietly
 * substitutes its own copy when the node is unreachable is back to
 * shipping its own table, and worse, cannot tell the user that is what
 * happened — "could not load" is a real state and should look different
 * from "empty".
 */
export async function getReferenceData(client: Client): Promise<ReferenceData> {
  return client.call("getReferenceData", {});
}
