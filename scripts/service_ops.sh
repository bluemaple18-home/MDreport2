#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DOMAIN="gui/$(id -u)"
UI_LABEL="com.mattkuo.mdreport.ui-shell"
FETCH_LABEL="com.mattkuo.mdreport.daily-fetch"
CODEGRAPH_LABEL="com.mattkuo.mdreport.codegraph-sync"
UI_PLIST="${HOME}/Library/LaunchAgents/${UI_LABEL}.plist"
FETCH_PLIST="${HOME}/Library/LaunchAgents/${FETCH_LABEL}.plist"
CODEGRAPH_PLIST="${HOME}/Library/LaunchAgents/${CODEGRAPH_LABEL}.plist"

usage() {
  cat <<'EOF'
Usage: scripts/service_ops.sh <status|stop|start|reload>

status  Show launchd status for MDreport services.
stop    Unload UI and daily-fetch services before release/update work.
start   Install/load UI and daily-fetch services after verification.
reload  stop + start.
EOF
}

status_one() {
  local label="$1"
  echo "== ${label} =="
  if launchctl list "${label}" >/dev/null 2>&1; then
    launchctl list "${label}"
  else
    echo "not loaded"
  fi
}

stop_one() {
  local label="$1"
  local plist="$2"
  if [ -f "${plist}" ]; then
    launchctl bootout "${DOMAIN}" "${plist}" >/dev/null 2>&1 || true
  else
    launchctl bootout "${DOMAIN}/${label}" >/dev/null 2>&1 || true
  fi
}

stop_services() {
  stop_one "${CODEGRAPH_LABEL}" "${CODEGRAPH_PLIST}"
  stop_one "${FETCH_LABEL}" "${FETCH_PLIST}"
  stop_one "${UI_LABEL}" "${UI_PLIST}"
  echo "MDreport launchd services stopped."
}

start_services() {
  "${ROOT_DIR}/scripts/install_codegraph_sync_launchd.sh"
  "${ROOT_DIR}/scripts/install_daily_fetch_launchd.sh"
  "${ROOT_DIR}/scripts/install_ui_shell_launchd.sh"
  echo "MDreport launchd services started."
}

cmd="${1:-}"
case "${cmd}" in
  status)
    status_one "${UI_LABEL}"
    status_one "${FETCH_LABEL}"
    status_one "${CODEGRAPH_LABEL}"
    ;;
  stop)
    stop_services
    ;;
  start)
    start_services
    ;;
  reload)
    stop_services
    start_services
    ;;
  *)
    usage
    exit 2
    ;;
esac
