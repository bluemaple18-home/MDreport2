#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TOOLCHAIN_PATHS="${HOME}/ai-core/config/toolchain_paths.sh"
DEFAULT_CODEGRAPH_BIN="${HOME}/ai-core/.tools/codegraph/node_modules/.bin/codegraph"
STATE_FILE="${ROOT_DIR}/.codegraph/auto-sync.state"
LOCK_DIR="${ROOT_DIR}/.codegraph/auto-sync.lock"
LOG_DIR="${ROOT_DIR}/logs/codegraph"
LOG_FILE="${LOG_DIR}/auto_sync.log"

if [ -f "${TOOLCHAIN_PATHS}" ]; then
  # shellcheck source=/dev/null
  source "${TOOLCHAIN_PATHS}"
fi

CODEGRAPH_BIN="${CODEGRAPH_BIN:-}"
if [ -z "${CODEGRAPH_BIN}" ] && [ -x "${DEFAULT_CODEGRAPH_BIN}" ]; then
  CODEGRAPH_BIN="${DEFAULT_CODEGRAPH_BIN}"
fi
if [ -z "${CODEGRAPH_BIN}" ]; then
  CODEGRAPH_BIN="$(command -v codegraph 2>/dev/null || true)"
fi

if [ -z "${CODEGRAPH_BIN}" ] || [ ! -x "${CODEGRAPH_BIN}" ] || [ ! -d "${ROOT_DIR}/.codegraph" ]; then
  exit 0
fi

mkdir -p "${ROOT_DIR}/.codegraph" "${LOG_DIR}"

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  exit 0
fi

SIGNATURE_INPUT="$(mktemp "${TMPDIR:-/tmp}/mdreport-codegraph-sync.XXXXXX")"
cleanup() {
  rm -f "${SIGNATURE_INPUT}"
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

{
  for source_dir in .ai app domain frontend infra scripts tests; do
    if [ -d "${ROOT_DIR}/${source_dir}" ]; then
      find "${ROOT_DIR}/${source_dir}" \
        -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) \
        ! -path '*/node_modules/*' \
        ! -path '*/.runtime_shared/*' \
        ! -path '*/.venv/*' \
        -print
    fi
  done
  for source_file in pyproject.toml frontend/package.json frontend/pnpm-lock.yaml .codegraph/config.json; do
    if [ -f "${ROOT_DIR}/${source_file}" ]; then
      printf '%s\n' "${ROOT_DIR}/${source_file}"
    fi
  done
} | LC_ALL=C sort -u | while IFS= read -r tracked_file; do
  stat -f '%N %m %z' "${tracked_file}" 2>/dev/null || true
done >"${SIGNATURE_INPUT}"

SIGNATURE="$(shasum "${SIGNATURE_INPUT}" | awk '{print $1}')"
if [ -f "${STATE_FILE}" ] && [ "$(cat "${STATE_FILE}")" = "${SIGNATURE}" ]; then
  exit 0
fi

if "${CODEGRAPH_BIN}" sync --quiet "${ROOT_DIR}"; then
  printf '%s\n' "${SIGNATURE}" >"${STATE_FILE}"
  printf '%s synced signature=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${SIGNATURE}" >>"${LOG_FILE}"
else
  printf '%s sync_failed signature=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${SIGNATURE}" >>"${LOG_FILE}"
  exit 1
fi
