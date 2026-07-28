//! Snapshot methods (OFS-1300).

use crate::client::{Client, IdParams};
use crate::error::Result;
use openfiat_crypto::Keypair;
use openfiat_snapshot::events::SignedSnapshotAnnounce;
use openfiat_snapshot::{SnapshotId, SnapshotMetadata};

impl Client {
    pub async fn get_snapshot(&self, id: impl Into<String>) -> Result<Option<SnapshotMetadata>> {
        self.call("getSnapshot", IdParams { id: id.into() }).await
    }

    pub async fn get_snapshots(&self) -> Result<Vec<SnapshotMetadata>> {
        self.call("getSnapshots", ()).await
    }

    pub async fn get_latest_snapshot(&self) -> Result<Option<SnapshotMetadata>> {
        self.call("getLatestSnapshot", ()).await
    }

    pub async fn get_checkpoint_height(&self) -> Result<Option<u64>> {
        self.call("getCheckpointHeight", ()).await
    }

    pub async fn send_snapshot_announce(
        &self,
        metadata: SnapshotMetadata,
        keypair: &Keypair,
    ) -> Result<SnapshotId> {
        let signed = SignedSnapshotAnnounce::sign(metadata, keypair);
        let id: String = self.send_signed("sendSnapshotAnnounce", &signed).await?;
        Ok(SnapshotId::new(id))
    }
}
