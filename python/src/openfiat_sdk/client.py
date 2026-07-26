"""Client for talking to an OpenFiat node."""

from __future__ import annotations

from dataclasses import dataclass

from .errors import NotImplementedYetError


@dataclass(frozen=True)
class ClientConfig:
    """Configuration for a :class:`Client`."""

    endpoint: str = "https://rpc.openfiat.org"
    timeout_ms: int = 30_000


class Client:
    """Entry point for the OpenFiat SDK.

    This is currently a typed stub: transport wiring will be added once
    ``openfiat-core``'s RPC surface stabilizes.
    """

    def __init__(self, config: ClientConfig | None = None) -> None:
        self.config = config or ClientConfig()

    def node_info(self) -> None:
        """Placeholder for a future ``get_node_info`` RPC call."""
        raise NotImplementedYetError("node_info")
