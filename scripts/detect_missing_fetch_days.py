#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from infra.sqlite.bootstrap import build_config, resolve_manifest_rel, resolve_project_root


def _parse_day(raw: str, *, field_name: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be YYYY-MM-DD: {raw}") from exc


def _yesterday_taipei() -> date:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("Asia/Taipei")).date() - timedelta(days=1)
    except Exception:
        return date.today() - timedelta(days=1)


def _day_range(start_day: date, end_day: date) -> list[str]:
    if start_day > end_day:
        return []
    out: list[str] = []
    current = start_day
    while current <= end_day:
        out.append(current.isoformat())
        current += timedelta(days=1)
    return out


def _existing_days(conn: sqlite3.Connection, workflow: str) -> set[str]:
    if workflow == "dsp":
        rows = conn.execute(
            """
            SELECT DISTINCT substr("日期時間", 1, 10)
            FROM canonical_raw
            WHERE workflow = 'dsp'
              AND length("日期時間") >= 10
            """
        ).fetchall()
    elif workflow == "ssp":
        table_exists = conn.execute(
            "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='ssp_raw'"
        ).fetchone()
        if not table_exists or int(table_exists[0] or 0) <= 0:
            return set()
        rows = conn.execute(
            """
            SELECT DISTINCT substr(date, 1, 10)
            FROM ssp_raw
            WHERE length(date) >= 10
            """
        ).fetchall()
    else:
        raise ValueError(f"unsupported workflow: {workflow}")
    return {str(row[0]) for row in rows if _is_iso_day(str(row[0]))}


def _is_iso_day(raw: str) -> bool:
    try:
        date.fromisoformat(raw)
        return True
    except ValueError:
        return False


def _detect_missing(conn: sqlite3.Connection, workflow: str, start_day: date | None, end_day: date) -> list[str]:
    existing = _existing_days(conn, workflow)
    if start_day is None:
        if existing:
            start_day = min(date.fromisoformat(day) for day in existing)
        else:
            start_day = end_day
    expected = set(_day_range(start_day, end_day))
    return sorted(expected - existing)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detect missing DSP/SSP daily fetch tasks")
    parser.add_argument("--root", default=None)
    parser.add_argument("--env", default=None)
    parser.add_argument("--manifest", default=None)
    parser.add_argument("--start-day", default=None)
    parser.add_argument("--end-day", default=None)
    parser.add_argument("--workflow", action="append", choices=["dsp", "ssp"], default=[])
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    root = resolve_project_root(args.root)
    manifest_rel = resolve_manifest_rel(args.manifest, args.env)
    cfg = build_config(root, manifest_rel, args.env)
    end_day = _parse_day(args.end_day, field_name="end-day") if args.end_day else _yesterday_taipei()
    start_day = _parse_day(args.start_day, field_name="start-day") if args.start_day else None
    workflows = list(args.workflow or ["dsp", "ssp"])

    with sqlite3.connect(str(cfg.db_path)) as conn:
        for workflow in workflows:
            for missing_day in _detect_missing(conn, workflow, start_day, end_day):
                print(f"{workflow}\t{missing_day}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
