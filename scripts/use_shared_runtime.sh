#!/usr/bin/env sh
# 載入專案內共用 runtime/cache 路徑；請用 `. scripts/use_shared_runtime.sh` 套用到目前 shell。
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

export MDREP_PROJECT_ROOT="$ROOT"
export UV_CACHE_DIR="$ROOT/.runtime_shared/uv-cache"
export PNPM_STORE_DIR="$ROOT/.runtime_shared/pnpm-store"
export npm_config_store_dir="$PNPM_STORE_DIR"
export PLAYWRIGHT_BROWSERS_PATH="$ROOT/.runtime_shared/ms-playwright"
