# Examples

Runnable examples live next to each SDK, not in this directory, so they can
depend on that SDK's own manifest without a cross-language build step:

- [`../rust/examples/`](../rust/examples/) — `basic_client`, `notification_provider`,
  `oracle_provider`, `solana_transaction`, `stake_and_vote`, `trading_bot`
- [`../typescript/examples/`](../typescript/examples/) — the same set, in TypeScript
- [`../python/examples/`](../python/examples/) — `basic.py` (the Python SDK is
  still a typed stub, so this is the extent of what's runnable there today)
