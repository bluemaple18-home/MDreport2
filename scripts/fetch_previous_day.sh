#!/usr/bin/env bash
set -o pipefail
set -u

# 每日偵測並逐日補抓 DSP / SSP 正規 API 缺漏資料。
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LOG_DIR="${ROOT_DIR}/logs/daily_fetch"
LOCK_DIR="${TMPDIR:-/tmp}/mdreport_daily_fetch.lock"

mkdir -p "${LOG_DIR}"

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "另一個每日抓取程序仍在執行，略過本次排程。"
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

if [ -f "${HOME}/ai-core/config/toolchain_paths.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/ai-core/config/toolchain_paths.sh"
fi

set_python_cmd() {
  if [ -x "${ROOT_DIR}/.venv/bin/python" ]; then
    PYTHON_CMD=("${ROOT_DIR}/.venv/bin/python")
    return
  fi
  if command -v uv >/dev/null 2>&1; then
    PYTHON_CMD=(uv run python)
    return
  fi
  PYTHON_CMD=(python3)
}

resolve_yesterday() {
  if [ -n "${MDREP_DAILY_FETCH_END_DATE:-}" ]; then
    printf '%s\n' "${MDREP_DAILY_FETCH_END_DATE}"
    return
  fi
  if TZ=Asia/Taipei date -v-1d +%F >/dev/null 2>&1; then
    TZ=Asia/Taipei date -v-1d +%F
    return
  fi
  TZ=Asia/Taipei date -d yesterday +%F
}

run_fetch() {
  local workflow="$1"
  local fetch_date="$2"
  local command_name="fetch-${workflow}-api"
  local env_args=()
  if [ -n "${MDREP_DAILY_FETCH_ENV:-}" ]; then
    env_args=(--env "${MDREP_DAILY_FETCH_ENV}")
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] start ${command_name} date=${fetch_date}"
  if [ "${#env_args[@]}" -gt 0 ]; then
    "${PYTHON_CMD[@]}" "${ROOT_DIR}/app/main.py" --root "${ROOT_DIR}" "${env_args[@]}" "${command_name}" --date "${fetch_date}"
  else
    "${PYTHON_CMD[@]}" "${ROOT_DIR}/app/main.py" --root "${ROOT_DIR}" "${command_name}" --date "${fetch_date}"
  fi
  if [ "$?" -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ok ${command_name} date=${fetch_date}"
    return 0
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] fail ${command_name} date=${fetch_date}"
  return 1
}

run_ssp_ad_group_fetch() {
  local fetch_date="$1"
  local command_name="fetch-ssp-ad-group-api"
  local env_args=()
  if [ -n "${MDREP_DAILY_FETCH_ENV:-}" ]; then
    env_args=(--env "${MDREP_DAILY_FETCH_ENV}")
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] start ${command_name} date=${fetch_date} zone_group=all"
  if [ "${#env_args[@]}" -gt 0 ]; then
    "${PYTHON_CMD[@]}" "${ROOT_DIR}/app/main.py" --root "${ROOT_DIR}" "${env_args[@]}" "${command_name}" --date "${fetch_date}"
  else
    "${PYTHON_CMD[@]}" "${ROOT_DIR}/app/main.py" --root "${ROOT_DIR}" "${command_name}" --date "${fetch_date}"
  fi
  if [ "$?" -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ok ${command_name} date=${fetch_date} zone_group=all"
    return 0
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] fail ${command_name} date=${fetch_date} zone_group=all"
  return 1
}

PYTHON_CMD=()
set_python_cmd
END_DATE="$(resolve_yesterday)"
RUN_STAMP="$(date '+%Y%m%d_%H%M%S')"
RUN_LOG="${LOG_DIR}/daily_fetch_${RUN_STAMP}.log"
LATEST_LOG="${LOG_DIR}/latest.log"
TASK_FILE="${LOG_DIR}/tasks_${RUN_STAMP}.tsv"
STATUS=0

{
  detect_args=(--root "${ROOT_DIR}" --end-day "${END_DATE}")
  if [ -n "${MDREP_DAILY_FETCH_ENV:-}" ]; then
    detect_args+=(--env "${MDREP_DAILY_FETCH_ENV}")
  fi
  if [ -n "${MDREP_DAILY_FETCH_START_DATE:-}" ]; then
    detect_args+=(--start-day "${MDREP_DAILY_FETCH_START_DATE}")
  fi

  echo "root=${ROOT_DIR}"
  echo "python=${PYTHON_CMD[*]}"
  echo "end_date=${END_DATE}"
  echo "start_date=${MDREP_DAILY_FETCH_START_DATE:-auto}"
  echo "runtime_env=${MDREP_DAILY_FETCH_ENV:-prod}"

  if ! "${PYTHON_CMD[@]}" "${ROOT_DIR}/scripts/detect_missing_fetch_days.py" "${detect_args[@]}" > "${TASK_FILE}"; then
    echo "缺漏日期偵測失敗，略過本次抓取與前台 DB 同步。"
    STATUS=1
  fi
  echo "task_file=${TASK_FILE}"
  echo "task_count=$(wc -l < "${TASK_FILE}" | tr -d ' ')"

  if [ "${STATUS}" -eq 0 ] && [ ! -s "${TASK_FILE}" ]; then
    echo "沒有偵測到缺漏日期。"
  fi

  if [ "${STATUS}" -eq 0 ]; then
    while IFS=$'\t' read -r workflow fetch_date; do
      [ -n "${workflow}" ] || continue
      [ -n "${fetch_date}" ] || continue
      run_fetch "${workflow}" "${fetch_date}" || STATUS=1
    done < "${TASK_FILE}"

    run_ssp_ad_group_fetch "${END_DATE}" || STATUS=1
  fi

  if [ "${STATUS}" -eq 0 ]; then
    sandbox_args=()
    for sandbox_id in ${MDREP_FRONTEND_SYNC_SANDBOXES:-matt WEN Charlotte Nathan}; do
      sandbox_args+=(--sandbox "${sandbox_id}")
    done
    "${PYTHON_CMD[@]}" "${ROOT_DIR}/scripts/sync_frontend_runtime_db.py" --root "${ROOT_DIR}" "${sandbox_args[@]}"
  else
    echo "有抓取任務失敗，略過前台 DB 同步。"
  fi

  echo "status=${STATUS}"
  exit "${STATUS}"
} 2>&1 | tee "${RUN_LOG}"

PIPE_STATUS="${PIPESTATUS[0]}"
cp "${RUN_LOG}" "${LATEST_LOG}"
exit "${PIPE_STATUS}"
