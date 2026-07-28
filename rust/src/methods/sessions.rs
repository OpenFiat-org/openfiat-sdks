//! Session methods (OFS-1400).

use crate::client::{Client, IdParams, WalletParams, encode_peer_id};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_sessions::events::{
    SessionCreate, SessionMigrate, SessionRenew, SessionRevoke, SignedSessionCreate,
    SignedSessionMigrate, SignedSessionRenew, SignedSessionRevoke,
};
use openfiat_sessions::{Session, SessionId};
use openfiat_types::PeerId;

impl Client {
    pub async fn get_session(&self, id: impl Into<String>) -> Result<Option<Session>> {
        self.call("getSession", IdParams { id: id.into() }).await
    }

    pub async fn get_sessions_by_wallet(&self, wallet: &PeerId) -> Result<Vec<Session>> {
        self.call(
            "getSessionsByWallet",
            WalletParams {
                wallet: encode_peer_id(wallet),
            },
        )
        .await
    }

    pub async fn send_session_establish(
        &self,
        create: SessionCreate,
        keypair: &Keypair,
    ) -> Result<SessionId> {
        let signed = SignedSessionCreate::sign(create, keypair);
        let id: String = self.send_signed("sendSessionEstablish", &signed).await?;
        Ok(SessionId::new(id))
    }

    pub async fn send_session_renew(&self, renew: SessionRenew, keypair: &Keypair) -> Result<()> {
        let signed = SignedSessionRenew::sign(renew, keypair);
        self.send_signed("sendSessionRenew", &signed).await
    }

    pub async fn send_session_revoke(
        &self,
        revoke: SessionRevoke,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedSessionRevoke::sign(revoke, keypair);
        self.send_signed("sendSessionRevoke", &signed).await
    }

    pub async fn send_session_migrate(
        &self,
        migrate: SessionMigrate,
        keypair: &Keypair,
    ) -> Result<()> {
        let signed = SignedSessionMigrate::sign(migrate, keypair);
        self.send_signed("sendSessionMigrate", &signed).await
    }
}
