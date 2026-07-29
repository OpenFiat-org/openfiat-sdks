# openfiat-sdk (Python)

Official Python SDK for the OpenFiat protocol — currently a typed stub, not
a working client. `Client`/`ClientConfig` exist and are tested, but every
RPC method (starting with `node_info`) raises `NotImplementedYetError`;
real JSON-RPC transport hasn't been wired in yet. See
[`../rust`](../rust) or [`../typescript`](../typescript) for the SDKs that
actually talk to a node today. Part of the
[openfiat-sdks](https://github.com/OpenFiat-org/openfiat-sdks) monorepo — see
the repository root [README](../README.md) for the full monorepo layout.

```bash
pip install -e ".[dev]"
```

```python
from openfiat_sdk import Client

client = Client()
```

See [`examples/basic.py`](examples/basic.py) for a runnable example.
