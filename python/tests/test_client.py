from openfiat_sdk import Client, ClientConfig


def test_default_endpoint() -> None:
    client = Client()
    assert client.config.endpoint == "https://rpc.openfiat.org"


def test_custom_config() -> None:
    client = Client(ClientConfig(endpoint="http://localhost:8899"))
    assert client.config.endpoint == "http://localhost:8899"
