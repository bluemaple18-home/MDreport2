#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PYTHONPATH="$ROOT" python3 "$ROOT/app/main.py" --root "$ROOT" bootstrap
PYTHONPATH="$ROOT" python3 "$ROOT/app/main.py" --root "$ROOT" health
PYTHONPATH="$ROOT" python3 -m unittest discover -s "$ROOT/tests" -p 'test_*.py' -v

echo "SMOKE_OK app shell bootstrap + health + tests completed"
