#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${MDREP_LAN_HOST:-0.0.0.0}"
PORT="${MDREP_LAN_PORT:-8510}"
PYTHON="${PYTHON:-$ROOT/.venv/bin/python}"
NODE="${NODE:-node}"

. "$ROOT/scripts/use_shared_runtime.sh"

"$PYTHON" "$ROOT/app/main.py" bootstrap

if [[ "${MDREP_SKIP_FRONTEND_BUILD:-0}" != "1" ]]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm -C "$ROOT/frontend" build
  else
    "$NODE" "$ROOT/frontend/node_modules/typescript/bin/tsc" --noEmit -p "$ROOT/frontend/tsconfig.json"
    "$NODE" "$ROOT/frontend/node_modules/typescript/bin/tsc" --noEmit -p "$ROOT/frontend/tsconfig.node.json"
    "$NODE" "$ROOT/frontend/node_modules/vite/bin/vite.js" build --root "$ROOT/frontend"
  fi
fi

LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
if [[ -n "$LAN_IP" ]]; then
  echo "MDREP LAN URL: http://$LAN_IP:$PORT/"
else
  echo "MDREP LAN URL: http://<this-machine-ip>:$PORT/"
fi

exec "$PYTHON" "$ROOT/app/ui_shell.py" --host "$HOST" --port "$PORT"
