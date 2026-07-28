use openfiat_sdk::{Client, ClientConfig};

#[test]
fn default_endpoint_is_stable() {
    let client = Client::new(ClientConfig::default());
    assert_eq!(client.config().endpoint, "https://rpc.openfiat.network");
}
