from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from domain.services import CanonicalService
from infra.sqlite.bootstrap import AcceptanceGateError, bootstrap_health, bootstrap_init
from infra.sqlite.bootstrap import build_config as build_bootstrap_config
from infra.sqlite.bootstrap import ensure_acceptance_gate, get_feature_flags
from infra.sqlite.data_seed import (
    bootstrap_data_seed,
    import_mdreport_seed,
    promote_seed_canonical_to_live,
    rebuild_canonical_from_seed,
)
from infra.sqlite.repository import SQLiteRepository


class CliUsageError(Exception):
    pass


class PayloadJsonError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise CliUsageError(message)


def normalize_bootstrap_wrapper_argv(argv: list[str]) -> list[str]:
    """
    相容 wrapper 的單一轉送規則：
    - 若 argv 已包含 command 位置（第一個非 option token），保持原樣。
    - 若未提供 command，補上 `bootstrap`。
    """
    parser = JsonArgumentParser(add_help=False)
    parser.add_argument("--root")
    parser.add_argument("--manifest")
    parser.add_argument("command", nargs="?")
    parsed, _unknown = parser.parse_known_args(argv)
    if parsed.command is None:
        return [*argv, "bootstrap"]
    return list(argv)


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _ok(result: dict) -> int:
    _json_print({"status": "ok", "result": result})
    return 0


def _fail(code: str, message: str, details: dict | None = None) -> int:
    payload = {"status": "error", "error_code": code, "message": message}
    if details:
        payload["details"] = details
    _json_print(payload)
    return 1


def _service(root: Path, manifest_rel: str) -> CanonicalService:
    ensure_acceptance_gate(root, manifest_rel)
    cfg = build_bootstrap_config(root, manifest_rel)
    feature_flags = get_feature_flags(root, manifest_rel)
    return CanonicalService(
        SQLiteRepository(cfg.db_path, project_root=root),
        feature_flags=feature_flags,
    )


def _load_json_list(path: Path, code: str) -> list[dict]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FileNotFoundError(str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise PayloadJsonError(code, f"invalid json ({exc})") from exc
    if not isinstance(payload, list):
        raise PayloadJsonError(code, "json root must be list")
    out: list[dict] = []
    for row in payload:
        if not isinstance(row, dict):
            raise PayloadJsonError(code, "each item must be object")
        out.append(row)
    return out


def _build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(description="MDREP public CLI shell", add_help=True)
    parser.add_argument("--root", default=".", help="Project root")
    parser.add_argument("--manifest", default="bootstrap.manifest.json", help="Manifest relative path")

    sub = parser.add_subparsers(dest="command")
    sub.required = True
    sub.add_parser("bootstrap", help="Run bootstrap init")
    sub.add_parser("health", help="Run bootstrap health check")
    seed_p = sub.add_parser("seed-bootstrap", help="Build old-data migration seed scaffold")
    seed_p.add_argument("--seed-root", default=None, help="Override data seed root directory (relative to project root)")
    seed_p.add_argument(
        "--raw-source",
        action="append",
        default=[],
        help="Raw seed source directory (relative to project root), can be repeated",
    )
    rebuild_p = sub.add_parser("seed-rebuild", help="Rebuild canonical rows from seed manifest")
    rebuild_p.add_argument("--seed-root", default=None, help="Override data seed root directory (relative to project root)")
    rebuild_p.add_argument(
        "--seed-manifest",
        default="manifests/seed_manifest.json",
        help="Seed manifest path relative to seed root",
    )
    rebuild_p.add_argument(
        "--workflow",
        action="append",
        default=[],
        help="Target workflow, can be repeated (default: dsp + ssp)",
    )
    rebuild_p.add_argument("--template-version", default="v1")
    rebuild_p.add_argument("--rule-version", default="v1")
    import_p = sub.add_parser("seed-import-mdreport", help="Import legacy MDreport seed into current seed scaffold")
    import_p.add_argument("--mdreport-root", required=True, help="Legacy MDreport project root")
    import_p.add_argument("--seed-root", default=None, help="Override data seed root directory (relative to project root)")
    promote_p = sub.add_parser("seed-promote-live", help="Promote seed canonical into live runtime DB")
    promote_p.add_argument("--seed-root", default=None, help="Override data seed root directory (relative to project root)")
    promote_p.add_argument(
        "--source-db-rel",
        default=None,
        help="Source sqlite relative to seed root (default: dsp->canonical/mdreport_dsp.sqlite, ssp->canonical/mdreport.sqlite)",
    )
    promote_p.add_argument("--workflow", default="dsp")
    promote_p.add_argument("--template-version", default="v1")
    promote_p.add_argument("--rule-version", default="v1")

    save_p = sub.add_parser("save", help="Save canonical rows from a JSON file")
    save_p.add_argument("--workflow", required=True)
    save_p.add_argument("--template-version", required=True)
    save_p.add_argument("--rule-version", required=True)
    save_p.add_argument("--rows-json", required=True, help="Path to rows JSON array")

    mod_p = sub.add_parser("modify", help="Apply controlled modifications from a JSON file")
    mod_p.add_argument("--workflow", required=True)
    mod_p.add_argument("--template-version", required=True)
    mod_p.add_argument("--rule-version", required=True)
    mod_p.add_argument("--updates-json", required=True, help="Path to updates JSON array")

    exp_p = sub.add_parser("export", help="Export canonical rows to artifact")
    exp_p.add_argument("--workflow", required=True)
    exp_p.add_argument("--template-version", required=True)
    exp_p.add_argument("--rule-version", required=True)
    exp_p.add_argument("--artifact-root", default="artifacts")
    exp_p.add_argument("--week-start", default=None, help="Export period start date (YYYY-MM-DD)")
    exp_p.add_argument("--week-end", default=None, help="Export period end date (YYYY-MM-DD)")
    exp_p.add_argument("--main-tab", default=None, help="Route main_tab (DSP 預設補 dsp_tab4)")
    exp_p.add_argument("--sub-tab", default=None, help="Route sub_tab (DSP 預設補 overview)")
    return parser


def run_cli(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    try:
        args, unknown = parser.parse_known_args(argv)
        if unknown:
            raise CliUsageError(f"unknown arguments: {' '.join(unknown)}")
        root = Path(args.root).resolve()

        if args.command == "bootstrap":
            return _ok(bootstrap_init(root, args.manifest))
        if args.command == "health":
            health = bootstrap_health(root, args.manifest)
            if health.get("status") != "ok":
                code = str(health.get("reason_code") or "HEALTH_CHECK_FAILED")
                return _fail(code, "health check failed", {"health": health})
            return _ok(health)
        if args.command == "seed-bootstrap":
            return _ok(
                bootstrap_data_seed(
                    root,
                    manifest_rel=args.manifest,
                    seed_root_override=args.seed_root,
                    raw_source_overrides=list(args.raw_source or []),
                )
            )
        if args.command == "seed-rebuild":
            svc = _service(root, args.manifest)
            return _ok(
                rebuild_canonical_from_seed(
                    root,
                    args.manifest,
                    service=svc,
                    seed_root_override=args.seed_root,
                    seed_manifest_rel=args.seed_manifest,
                    workflow_filter=list(args.workflow or []),
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                )
            )
        if args.command == "seed-import-mdreport":
            return _ok(
                import_mdreport_seed(
                    root,
                    manifest_rel=args.manifest,
                    mdreport_root=Path(str(args.mdreport_root)).resolve(),
                    seed_root_override=args.seed_root,
                )
            )
        if args.command == "seed-promote-live":
            # 升版前先確保 live DB schema 與 registry 已就緒。
            bootstrap_init(root, args.manifest)
            svc = _service(root, args.manifest)
            return _ok(
                promote_seed_canonical_to_live(
                    root,
                    args.manifest,
                    service=svc,
                    seed_root_override=args.seed_root,
                    source_db_rel=args.source_db_rel,
                    workflow=args.workflow,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                )
            )

        if args.command == "save":
            rows = _load_json_list(Path(args.rows_json), "INVALID_ROWS_JSON")
            svc = _service(root, args.manifest)
            return _ok(
                svc.save(
                    workflow=args.workflow,
                    rows=rows,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                )
            )

        if args.command == "modify":
            updates = _load_json_list(Path(args.updates_json), "INVALID_UPDATES_JSON")
            svc = _service(root, args.manifest)
            return _ok(
                svc.modify(
                    workflow=args.workflow,
                    updates=updates,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                )
            )

        if args.command == "export":
            svc = _service(root, args.manifest)
            main_tab = args.main_tab
            sub_tab = args.sub_tab
            if args.workflow == "dsp":
                # CLI baseline 對齊 UI/export 契約：DSP 預設走 Tab4 overview。
                main_tab = main_tab or "dsp_tab4"
                sub_tab = sub_tab or "overview"
            return _ok(
                svc.export(
                    workflow=args.workflow,
                    artifact_root=(root / args.artifact_root).resolve(),
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                    main_tab=main_tab,
                    sub_tab=sub_tab,
                    week_start=args.week_start,
                    week_end=args.week_end,
                )
            )

        return _fail("UNKNOWN_COMMAND", f"unsupported command: {args.command}")
    except CliUsageError as exc:
        return _fail("CLI_USAGE_ERROR", str(exc))
    except PayloadJsonError as exc:
        return _fail(exc.code, str(exc))
    except FileNotFoundError as exc:
        return _fail("FILE_NOT_FOUND", str(exc))
    except LookupError as exc:
        return _fail("LOOKUP_ERROR", str(exc))
    except AcceptanceGateError as exc:
        return _fail("STRICT_ACCEPTANCE_GATE_FAILED", str(exc), {"checks": exc.checks, "reason_code": exc.reason_code})
    except ValueError as exc:
        return _fail("VALIDATION_ERROR", str(exc))
    except Exception as exc:
        return _fail("UNHANDLED_EXCEPTION", str(exc))


def main() -> int:
    return run_cli(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
