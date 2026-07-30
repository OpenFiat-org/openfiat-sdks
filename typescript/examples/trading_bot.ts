/**
 * A minimal trading bot (OFS-2100/OFS-2200): a merchant publishes a Sell
 * advertisement, then a separate "bot" identity discovers it and opens a
 * reservation against it.
 *
 * Run against a local node with `pnpm tsx examples/trading_bot.ts`. By
 * default it targets `http://localhost:7080` — start one with
 * `CLI_HTTP_ADDR=127.0.0.1:7080 cargo run -p openfiat-cli` from
 * `openfiat-core`.
 */
import {
  Client,
  advertisements,
  generateKeypair,
  peerIdFromPublicKey,
  reservations,
  toBytes,
  type AdvertisementCreate,
  type ReservationRequest,
} from "../src/index.js";

async function main() {
  const endpoint = process.env.OPENFIAT_NODE_URL ?? "http://localhost:7080";
  const client = new Client({ endpoint, timeoutMs: 30_000 });

  // In production, load a persistent identity instead — see
  // loadWalletFile from "@openfiat/sdk/node" (../src/node.js here).
  const merchant = await generateKeypair();
  const bot = await generateKeypair();

  console.log("publishing a USDT/KES Sell advertisement...");
  const create: AdvertisementCreate = {
    id: "example-trading-bot-ad-ts",
    merchant: toBytes(peerIdFromPublicKey(merchant.publicKey)),
    merchant_public_key: toBytes(merchant.publicKey),
    // The devnet USDT mint, not the string "USDT". An advertisement names
    // the token by its address because a ticker is a label the merchant
    // picked and nothing ties it to what the escrow moves. The buyer still
    // reads "USDT" — the node resolves that from this address on the way
    // out, as `asset_symbol`.
    asset_mint: "C4rSGhdxWhSFQuFcAxQti1JvBxriwHJoHtJjfhs5p24Y",
    direction: "Sell",
    fiat_currency: "KES",
    min_trade: { base_units: 1_000, decimals: 2 },
    max_trade: { base_units: 50_000, decimals: 2 },
    initial_liquidity: { base_units: 200_000, decimals: 2 },
    pricing: { Fixed: { price: { base_units: 12_950, decimals: 2 } } },
    payment_methods: ["M-Pesa"],
    timestamp: Date.now(),
  };
  const adId = await advertisements.sendAdvertisementCreate(client, create, merchant);
  console.log(`advertisement live: ${adId}`);

  // A real bot would instead call `advertisements.getAdvertisements(client, {
  // filter: { ... } })` with the mint, currency, side and size it trades —
  // and follow `next_cursor`, or iterate with
  // `advertisements.eachAdvertisement`, if it wants more than one page.
  // Reservation just needs the ID.
  console.log("reserving against it as a separate bot identity...");
  const request: ReservationRequest = {
    id: "example-trading-bot-reservation-ts",
    advertisement_id: adId,
    requester: toBytes(peerIdFromPublicKey(bot.publicKey)),
    requester_public_key: toBytes(bot.publicKey),
    amount: { base_units: 5_000, decimals: 2 },
    // The price the bot is agreeing to, which for a fixed advertisement
    // is the merchant's signed number exactly. The node refuses a
    // reservation whose price does not follow from the ad rather than
    // binding the taker to a number they never signed.
    agreed_price: { base_units: 12_950, decimals: 2 },
    // No oracle behind a fixed price, so no mid to record.
    agreed_mid: null,
    timestamp: Date.now(),
  };
  const reservationId = await reservations.sendReservationRequest(client, request, bot);
  console.log(`reservation opened: ${reservationId}`);

  const reservation = await reservations.getReservation(client, reservationId);
  console.log(`reservation status: ${reservation?.state}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
