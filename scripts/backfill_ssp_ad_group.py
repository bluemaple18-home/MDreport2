#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from domain.services import SSP_AD_GROUP_CATALOG
from infra.sqlite.bootstrap import build_config, resolve_manifest_rel


def _parse_day(raw: str) -> date:
    return date.fromisoformat(raw)


def _day_range(start_day: date, end_day: date) -> list[str]:
    days: list[str] = []
    current = start_day
    while current <= end_day:
        days.append(current.isoformat())
        current += timedelta(days=1)
    return days


def _default_start_day(conn: sqlite3.Connection) -> str:
    raw = conn.execute("SELECT MIN(substr(date, 1, 10)) FROM ssp_raw WHERE length(date) >= 10").fetchone()[0]
    if not raw:
        raise RuntimeError("ssp_raw 沒有可用日期，請明確指定 --start-day")
    return str(raw)


def _default_end_day(conn: sqlite3.Connection) -> str:
    raw = conn.execute("SELECT MIN(date) FROM ssp_ad_group_daily_metrics").fetchone()[0]
    if raw:
        return (date.fromisoformat(str(raw)) - timedelta(days=1)).isoformat()
    raw = conn.execute("SELECT MAX(substr(date, 1, 10)) FROM ssp_raw WHERE length(date) >= 10").fetchone()[0]
    if not raw:
        raise RuntimeError("ssp_raw 沒有可用日期，請明確指定 --end-day")
    return str(raw)


def _existing_runs(conn: sqlite3.Connection) -> set[tuple[str, int]]:
    table_exists = conn.execute(
        "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='ssp_ad_group_report_runs'"
    ).fetchone()
    if not table_exists or int(table_exists[0] or 0) <= 0:
        return set()
    return {
        (str(row[0]), int(row[1]))
        for row in conn.execute(
            """
            SELECT start_day, zone_group_id
            FROM ssp_ad_group_report_runs
            WHERE start_day = end_day
            """
        ).fetchall()
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backfill SSP ad group data one day and one group at a time")
    parser.add_argument("--root", default=str(ROOT_DIR))
    parser.add_argument("--env", default=None)
    parser.add_argument("--manifest", default=None)
    parser.add_argument("--start-day", default=None)
    parser.add_argument("--end-day", default=None)
    parser.add_argument("--zone-group-id", type=int, action="append", default=[])
    parser.add_argument("--pause-seconds", type=float, default=0.5)
    parser.add_argument("--max-failures", type=int, default=3)
    parser.add_argument("--print-every", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    root = Path(args.root).resolve()
    manifest_rel = resolve_manifest_rel(args.manifest, args.env)
    cfg = build_config(root, manifest_rel, args.env)
    group_ids = [int(item) for item in args.zone_group_id] if args.zone_group_id else [int(item["id"]) for item in SSP_AD_GROUP_CATALOG]

    log_dir = root / "logs" / "ssp_ad_group_backfill"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"backfill_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
    latest_path = log_dir / "latest.jsonl"

    with sqlite3.connect(str(cfg.db_path)) as conn:
        start_day = _parse_day(args.start_day or _default_start_day(conn))
        end_day = _parse_day(args.end_day or _default_end_day(conn))
        existing = _existing_runs(conn)

    tasks = [
        (day, group_id)
        for day in _day_range(start_day, end_day)
        for group_id in group_ids
        if (day, group_id) not in existing
    ]
    print(
        json.dumps(
            {
                "event": "plan",
                "root": str(root),
                "db_path": str(cfg.db_path),
                "start_day": start_day.isoformat(),
                "end_day": end_day.isoformat(),
                "group_count": len(group_ids),
                "task_count": len(tasks),
                "log_path": str(log_path),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    if args.dry_run or not tasks:
        return 0

    python_cmd = root / ".venv" / "bin" / "python"
    if not python_cmd.exists():
        python_cmd = Path(sys.executable)

    failures = 0
    completed = 0
    print_every = max(1, int(args.print_every or 1))
    with log_path.open("a", encoding="utf-8") as log_file:
        for index, (day, group_id) in enumerate(tasks, start=1):
            started_at = datetime.now().isoformat(timespec="seconds")
            cmd = [
                str(python_cmd),
                str(root / "app" / "main.py"),
                "--root",
                str(root),
            ]
            if args.env:
                cmd.extend(["--env", str(args.env)])
            cmd.extend(["fetch-ssp-ad-group-api", "--date", day, "--zone-group-id", str(group_id)])
            proc = subprocess.run(cmd, cwd=str(root), text=True, capture_output=True)
            finished_at = datetime.now().isoformat(timespec="seconds")
            payload: dict[str, object]
            try:
                payload = json.loads(proc.stdout or "{}")
            except json.JSONDecodeError:
                payload = {"raw_stdout": proc.stdout[-2000:]}
            result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
            record = {
                "event": "done" if proc.returncode == 0 else "fail",
                "index": index,
                "total": len(tasks),
                "date": day,
                "zone_group_id": group_id,
                "returncode": proc.returncode,
                "row_count": int(result.get("row_count") or 0) if isinstance(result, dict) else 0,
                "records_total": int(result.get("records_total") or 0) if isinstance(result, dict) else 0,
                "report_id": int(result.get("report_id") or 0) if isinstance(result, dict) else 0,
                "started_at": started_at,
                "finished_at": finished_at,
            }
            if proc.returncode != 0:
                failures += 1
                record["stderr"] = proc.stderr[-2000:]
                record["stdout"] = proc.stdout[-2000:]
            else:
                completed += 1
            line = json.dumps(record, ensure_ascii=False)
            log_file.write(line + "\n")
            log_file.flush()
            latest_path.write_text(log_path.read_text(encoding="utf-8"), encoding="utf-8")
            if proc.returncode != 0 or index % print_every == 0 or index == len(tasks):
                print(
                    json.dumps(
                        {
                            "event": "progress" if proc.returncode == 0 else "fail",
                            "index": index,
                            "total": len(tasks),
                            "completed": completed,
                            "failures": failures,
                            "date": day,
                            "zone_group_id": group_id,
                            "row_count": record["row_count"],
                            "records_total": record["records_total"],
                            "report_id": record["report_id"],
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
            if failures >= args.max_failures:
                print(json.dumps({"event": "stop", "reason": "max_failures", "failures": failures}, ensure_ascii=False), flush=True)
                return 1
            if args.pause_seconds > 0:
                time.sleep(float(args.pause_seconds))

    print(json.dumps({"event": "summary", "completed": completed, "failures": failures}, ensure_ascii=False), flush=True)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
