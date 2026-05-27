#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LABEL="com.mattkuo.mdreport.codegraph-sync"
SOURCE_PLIST="${ROOT_DIR}/deploy/${LABEL}.plist"
TARGET_DIR="${HOME}/Library/LaunchAgents"
TARGET_PLIST="${TARGET_DIR}/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

mkdir -p "${TARGET_DIR}" "${ROOT_DIR}/logs/codegraph"
launchctl bootout "${DOMAIN}" "${TARGET_PLIST}" >/dev/null 2>&1 || true
sed -e "s/__MDREPORT_ROOT__/$(escape_sed_replacement "${ROOT_DIR}")/g" "${SOURCE_PLIST}" > "${TARGET_PLIST}"
chmod 644 "${TARGET_PLIST}"
launchctl bootstrap "${DOMAIN}" "${TARGET_PLIST}"
launchctl enable "${DOMAIN}/${LABEL}"

echo "已安裝 ${LABEL}"
