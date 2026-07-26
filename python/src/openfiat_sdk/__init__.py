"""Official Python SDK for the OpenFiat protocol.

Provides a typed client for interacting with an OpenFiat node's RPC surface.
This currently defines the public API surface only; transport implementation
lands alongside ``openfiat-core``'s RPC layer.
"""

from .client import Client, ClientConfig
from .errors import NotImplementedYetError, OpenFiatError

__all__ = [
    "Client",
    "ClientConfig",
    "OpenFiatError",
    "NotImplementedYetError",
]

__version__ = "0.1.0"
