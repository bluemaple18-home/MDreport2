from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.main import normalize_bootstrap_wrapper_argv, run_cli


def main() -> int:
    # 相容入口：轉送到公開 app shell 的 bootstrap 子命令，維持單一輸出契約。
    return run_cli(normalize_bootstrap_wrapper_argv(sys.argv[1:]))


if __name__ == "__main__":
    raise SystemExit(main())
