#!/usr/bin/env bash
set -euo pipefail

# 安裝使用者層級 launchd 排程：每日 00:30 抓取前一天 DSP / SSP。
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LABEL="com.mattkuo.mdreport.daily-fetch"
SOURCE_PLIST="${ROOT_DIR}/deploy/${LABEL}.plist"
TARGET_DIR="${HOME}/Library/LaunchAgents"
TARGET_PLIST="${TARGET_DIR}/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
API_CONFIG_PATH="${MDREPORT_API_CONFIG_PATH:-${HOME}/MDreport/config/api_config.py}"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

if [ ! -f "${SOURCE_PLIST}" ]; then
  echo "找不到 plist: ${SOURCE_PLIST}" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"
launchctl bootout "${DOMAIN}" "${TARGET_PLIST}" >/dev/null 2>&1 || true
sed \
  -e "s/__MDREPORT_ROOT__/$(escape_sed_replacement "${ROOT_DIR}")/g" \
  -e "s/__MDREPORT_API_CONFIG_PATH__/$(escape_sed_replacement "${API_CONFIG_PATH}")/g" \
  "${SOURCE_PLIST}" > "${TARGET_PLIST}"
chmod 644 "${TARGET_PLIST}"
launchctl bootstrap "${DOMAIN}" "${TARGET_PLIST}"
launchctl enable "${DOMAIN}/${LABEL}"

echo "已安裝 ${LABEL}"
echo "plist=${TARGET_PLIST}"
echo "schedule=每日 00:30，並在載入/重新登入後 RunAtLoad"
