//! Notification methods (OFS-6000).

use crate::client::{Client, IdParams, WalletParams, encode_peer_id};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_notifications::events::{
    DeliveryReport, SignedDeliveryReport, SignedSubscriptionUpdate, SubscriptionUpdate,
};
use openfiat_notifications::{DeliveryReceipt, Subscription};
use openfiat_types::PeerId;

impl Client {
    pub async fn get_subscription(&self, wallet: &PeerId) -> Result<Option<Subscription>> {
        self.call(
            "getSubscription",
            WalletParams {
                wallet: encode_peer_id(wallet),
            },
        )
        .await
    }

    pub async fn get_delivery_receipts_by_wallet(
        &self,
        wallet: &PeerId,
    ) -> Result<Vec<DeliveryReceipt>> {
        self.call(
            "getDeliveryReceiptsByWallet",
            WalletParams {
                wallet: encode_peer_id(wallet),
            },
        )
        .await
    }

    pub async fn get_delivery_receipt(
        &self,
        id: impl Into<String>,
    ) -> Result<Option<DeliveryReceipt>> {
        self.call("getDeliveryReceipt", IdParams { id: id.into() })
            .await
    }

    pub async fn send_subscription_update(
        &self,
        update: SubscriptionUpdate,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedSubscriptionUpdate::sign(update, keypair);
        self.send_signed("sendSubscriptionUpdate", &signed).await
    }

    pub async fn send_delivery_report(
        &self,
        report: DeliveryReport,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedDeliveryReport::sign(report, keypair);
        self.send_signed("sendDeliveryReport", &signed).await
    }
}
