#!/usr/bin/env python3
"""Validate reference-data JSON files against their JSON Schemas.

No external dependencies: implements the small subset of JSON Schema draft-07
used by schema/*.schema.json, to avoid pulling in `jsonschema` for a bootstrap
script. Swap in the `jsonschema` package if validation needs grow.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def validate_item(item: dict, schema: dict, path: str) -> list[str]:
    errors = []
    for field in schema.get("required", []):
        if field not in item:
            errors.append(f"{path}: missing required field '{field}'")
    for field, spec in schema.get("properties", {}).items():
        if field not in item:
            continue
        value = item[field]
        pattern = spec.get("pattern")
        if pattern and isinstance(value, str) and not re.match(pattern, value):
            errors.append(f"{path}.{field}: '{value}' does not match pattern {pattern}")
    return errors


def validate_file(data_path: Path, schema_path: Path) -> list[str]:
    schema = json.loads(schema_path.read_text())
    items = json.loads(data_path.read_text())
    errors = []
    for i, item in enumerate(items):
        errors.extend(validate_item(item, schema, f"{data_path.name}[{i}]"))
    return errors


def main() -> int:
    pairs = [
        (ROOT / "data" / "countries.json", ROOT / "schema" / "country.schema.json"),
        (ROOT / "data" / "currencies.json", ROOT / "schema" / "currency.schema.json"),
    ]
    all_errors: list[str] = []
    for data_path, schema_path in pairs:
        all_errors.extend(validate_file(data_path, schema_path))

    if all_errors:
        print(f"Found {len(all_errors)} validation error(s):", file=sys.stderr)
        for e in all_errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print("All reference-data files valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
