import type { Client } from "../client.js";
import { type Keypair, sign } from "../crypto.js";
import {
  toBase58,
  type AdvertisementCreate,
  type AdvertisementPage,
  type AdvertisementQuery,
  type AdvertisementView,
  type AdvertisementDisable,
  type AdvertisementPriceUpdate,
  type SignedAdvertisementCreate,
  type SignedAdvertisementDisable,
  type SignedAdvertisementPriceUpdate,
} from "../types.js";

/**
 * Read one advertisement, with the name its `asset_mint` resolves to
 * attached by the node — see {@link AdvertisementView} for why the symbol
 * arrives beside the record rather than in it, and why this SDK resolves
 * no mint names of its own.
 */
export async function getAdvertisement(
  client: Client,
  id: string,
): Promise<AdvertisementView | null> {
  return client.call("getAdvertisement", { id });
}

/**
 * Read one page of the order book, narrowed by `query.filter`.
 *
 * A shape change: this returned a bare array of every advertisement on the
 * network, and now returns `{ advertisements, next_cursor }` — so code
 * that read `result.length` or mapped over the result directly now reads
 * `undefined` and must go through `.advertisements`. See
 * {@link AdvertisementPage} for why the bare array could not survive real
 * volume, and {@link AdvertisementFilter.amount} for the one filter that
 * silently returns nothing when it is sent at the wrong scale.
 *
 * `getAdvertisements(client)` is still valid and still means "the first
 * page of the whole active book"; only its size changed.
 *
 * To read past the first page, hand {@link AdvertisementPage.next_cursor}
 * straight back as `page.after`, or let {@link eachAdvertisement} do it.
 */
export async function getAdvertisements(
  client: Client,
  query: AdvertisementQuery = {},
): Promise<AdvertisementPage> {
  return client.call("getAdvertisements", query);
}

/**
 * Every advertisement matching `query`, one page at a time.
 *
 * Yields rows rather than collecting them: the whole point of the paging
 * is that the book does not have to fit in one response, and a helper that
 * accumulated every page into an array would put that back.
 *
 * The cursor is whatever the node last returned, passed back untouched —
 * this helper derives nothing from the rows themselves. A caller (or a
 * helper) computing its own resume point has to reimplement the node's
 * ordering, and a reader whose ordering disagrees with the node's is
 * handed rows twice and never handed others at all, with nothing to
 * indicate it. `query.filter` travels with every page for the same class
 * of reason: filtering after the fact would drop rows the cursor has
 * already moved past.
 */
export async function* eachAdvertisement(
  client: Client,
  query: AdvertisementQuery = {},
): AsyncGenerator<AdvertisementView, void, undefined> {
  let after = query.page?.after;
  for (;;) {
    const page: AdvertisementPage = await getAdvertisements(client, {
      filter: query.filter,
      page: { ...query.page, after },
    });
    yield* page.advertisements;
    // A null cursor is the node saying this was the last page. Stopping on
    // an empty page instead would end the walk early — a full page does
    // not prove another exists, so the node may hand back a cursor with
    // nothing behind it, and that empty page is a legitimate end rather
    // than the only signal of one.
    //
    // `undefined` is checked alongside `null` even though the type says it
    // cannot happen: the value arrives off the wire, and a reply missing
    // the key would otherwise send this back to `after: undefined` — the
    // first page again, forever.
    if (page.next_cursor === null || page.next_cursor === undefined) return;
    // Straight across, no conversion: `after` accepts exactly what
    // `next_cursor` holds.
    after = page.next_cursor;
  }
}

/** Signs `create` with `keypair` and submits it. Returns the new advertisement's ID. */
export async function sendAdvertisementCreate(
  client: Client,
  create: AdvertisementCreate,
  keypair: Keypair,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(create));
  const signature = await sign(keypair, bytes);
  const signed: SignedAdvertisementCreate = { create, signature: toBase58(signature) };
  return client.sendSigned("sendAdvertisementCreate", signed);
}

/** Signs `disable` with `keypair` and submits it. Only a signature from the
 *  ad's original merchant key will be accepted — see `AdvertisementDisable`. */
export async function sendAdvertisementDisable(
  client: Client,
  disable: AdvertisementDisable,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(disable));
  const signature = await sign(keypair, bytes);
  const signed: SignedAdvertisementDisable = { disable, signature: toBase58(signature) };
  return client.sendSigned("sendAdvertisementDisable", signed);
}

/** Signs `update` with `keypair` and submits it — repricing an existing ad
 *  in place rather than disabling and recreating it (§17). */
export async function sendAdvertisementPriceUpdate(
  client: Client,
  update: AdvertisementPriceUpdate,
  keypair: Keypair,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(update));
  const signature = await sign(keypair, bytes);
  const signed: SignedAdvertisementPriceUpdate = { update, signature: toBase58(signature) };
  return client.sendSigned("sendAdvertisementPriceUpdate", signed);
}
