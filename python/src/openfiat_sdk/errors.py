"""SDK error types."""


class OpenFiatError(Exception):
    """Base class for all OpenFiat SDK errors."""


class NotImplementedYetError(OpenFiatError):
    """Raised when calling an operation that is not implemented yet."""

    def __init__(self, what: str) -> None:
        super().__init__(f"not implemented yet: {what}")
