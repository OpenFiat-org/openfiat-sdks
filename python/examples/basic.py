"""Minimal example: construct a client with default configuration.

Run with: python examples/basic.py
"""

from openfiat_sdk import Client

client = Client()
print(f"configured endpoint: {client.config.endpoint}")
