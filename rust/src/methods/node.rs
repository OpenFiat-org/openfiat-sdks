//! Node methods (OFS-8200 §6's "Node" row).

use crate::client::Client;
use crate::error::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct VersionResult {
    version: String,
}

impl Client {
    pub async fn get_version(&self) -> Result<String> {
        Ok(self
            .call::<_, VersionResult>("getVersion", ())
            .await?
            .version)
    }

    pub async fn get_health(&self) -> Result<String> {
        self.call("getHealth", ()).await
    }
}
