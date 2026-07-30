//! A minimal trading bot (OFS-2100/OFS-2200): a merchant publishes a Sell
//! advertisement, then a separate "bot" identity discovers it and opens a
//! reservation against it.
//!
//! Run against a local node with `cargo run --example trading_bot`. By
//! default it targets `http://localhost:7080` — start one with
//! `CLI_HTTP_ADDR=127.0.0.1:7080 cargo run -p openfiat-cli` from
//! `openfiat-core`.
//!
//! The reservation below is refused by a current node: it carries no
//! `agreed_price`, and cannot, for the reason
//! [`openfiat_sdk::methods::reservations`]' module doc gives.

use openfiat_advertisements::AdvertisementId;
use openfiat_advertisements::events::AdvertisementCreate;
use openfiat_advertisements::record::{Direction, PricingModel};
use openfiat_network::identity::peer_id_from_public_key;
use openfiat_reservations::ReservationId;
use openfiat_reservations::events::ReservationRequest;
use openfiat_sdk::wallet::Keypair;
use openfiat_sdk::{Client, ClientConfig};
use openfiat_types::{Amount, PeerId, Timestamp};

fn peer_id(keypair: &Keypair) -> PeerId {
    peer_id_from_public_key(&keypair.public_key())
        .expect("a freshly generated keypair's public key always derives a peer id")
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint =
        std::env::var("OPENFIAT_NODE_URL").unwrap_or_else(|_| "http://localhost:7080".to_string());
    let client = Client::new(ClientConfig {
        endpoint,
        ..ClientConfig::default()
    });

    // In production, load a persistent identity instead — see
    // openfiat_sdk::wallet::solana_keyfile::load.
    let merchant = Keypair::generate();
    let bot = Keypair::generate();

    println!("publishing a USDT/KES Sell advertisement...");
    let create = AdvertisementCreate {
        id: AdvertisementId::new("example-trading-bot-ad"),
        merchant: peer_id(&merchant),
        merchant_public_key: merchant.public_key(),
        asset: "USDT".to_string(),
        direction: Direction::Sell,
        fiat_currency: "KES".to_string(),
        min_trade: Amount::new(1_000, 2),
        max_trade: Amount::new(50_000, 2),
        initial_liquidity: Amount::new(200_000, 2),
        pricing: PricingModel::Fixed {
            price: Amount::new(12_950, 2),
        },
        payment_methods: vec!["M-Pesa".to_string()],
        timestamp: Timestamp::now(),
    };
    let ad_id = client.send_advertisement_create(create, &merchant).await?;
    println!("advertisement live: {}", ad_id.as_str());

    // A real bot would instead call `client.get_advertisements(&query)`
    // with an `AdvertisementFilter` describing its strategy — the mint,
    // the currency, the side and the size it trades — and follow
    // `next_cursor` if it wants more than the first page. Reservation just
    // needs the ID.
    println!("reserving against it as a separate bot identity...");
    let request = ReservationRequest {
        id: ReservationId::new("example-trading-bot-reservation"),
        advertisement_id: ad_id,
        requester: peer_id(&bot),
        requester_public_key: bot.public_key(),
        amount: Amount::new(5_000, 2),
        timestamp: Timestamp::now(),
    };
    let reservation_id = client.send_reservation_request(request, &bot).await?;
    println!("reservation opened: {}", reservation_id.as_str());

    let reservation = client
        .get_reservation(reservation_id.as_str())
        .await?
        .expect("just opened this reservation");
    println!("reservation status: {:?}", reservation.state);

    Ok(())
}
