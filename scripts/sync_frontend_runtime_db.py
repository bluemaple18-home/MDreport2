#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


def _backup_db(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(source), timeout=30.0) as src, sqlite3.connect(str(target), timeout=30.0) as dst:
        src.backup(dst)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Sync live runtime DB to frontend test/sandbox DBs")
    parser.add_argument("--root", default=".")
    parser.add_argument("--sandbox", action="append", default=[])
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    root = Path(args.root).resolve()
    source = root / "data" / "mdrep.sqlite"
    if not source.exists():
        raise FileNotFoundError(f"source DB not found: {source}")

    targets = [
        root / "data_test" / "mdrep.test.sqlite",
        root / "data_sandbox" / "_baseline" / "test" / "mdrep.test.sqlite",
        root / "data_sandbox" / "_baseline" / "prod" / "mdrep.sqlite",
    ]
    for sandbox_id in args.sandbox or []:
        normalized = str(sandbox_id or "").strip()
        if normalized:
            targets.append(root / "data_sandbox" / normalized / "mdrep.sqlite")
            targets.append(root / "data_sandbox" / normalized / "mdrep.test.sqlite")

    for target in targets:
        _backup_db(source, target)
        print(f"copied {source.relative_to(root)} -> {target.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
