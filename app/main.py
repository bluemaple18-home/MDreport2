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
from infra.sqlite.bootstrap import ensure_acceptance_gate, get_feature_flags, resolve_manifest_rel
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
    parser.add_argument("--env")
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


def _service(root: Path, manifest_rel: str, runtime_env: str | None = None) -> CanonicalService:
    ensure_acceptance_gate(root, manifest_rel, runtime_env)
    cfg = build_bootstrap_config(root, manifest_rel, runtime_env)
    feature_flags = get_feature_flags(root, manifest_rel, runtime_env)
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


def _resolve_fetch_range(*, single_date: str | None, start_day: str | None, end_day: str | None) -> tuple[str, str]:
    raw_date = str(single_date or "").strip()
    raw_start = str(start_day or "").strip()
    raw_end = str(end_day or "").strip()
    if raw_date:
        if raw_start or raw_end:
            raise ValueError("date cannot be combined with start-day/end-day")
        return raw_date, raw_date
    if not raw_start or not raw_end:
        raise ValueError("fetch api requires --date or both --start-day/--end-day")
    return raw_start, raw_end


def _build_parser() -> argparse.ArgumentParser:
    parser = JsonArgumentParser(description="MDREP public CLI shell", add_help=True)
    parser.add_argument("--root", default=".", help="Project root")
    parser.add_argument("--env", default=None, help="Runtime env profile: prod | test")
    parser.add_argument("--manifest", default=None, help="Manifest relative path")

    sub = parser.add_subparsers(dest="command")
    sub.required = True
    sub.add_parser("bootstrap", help="Run bootstrap init")
    sub.add_parser("health", help="Run bootstrap health check")
    seed_p = sub.add_parser("seed-bootstrap", help="Build data seed scaffold")
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
    import_p = sub.add_parser("seed-import-mdreport", help="Import MDreport seed into current seed scaffold")
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
    fetch_ssp_p = sub.add_parser("fetch-ssp-api", help="Fetch SSP data from the regular HolmesMind API flow")
    fetch_ssp_p.add_argument("--date", default=None, help="Single fetch date (YYYY-MM-DD)")
    fetch_ssp_p.add_argument("--start-day", default=None, help="Fetch range start date (YYYY-MM-DD)")
    fetch_ssp_p.add_argument("--end-day", default=None, help="Fetch range end date (YYYY-MM-DD)")
    fetch_ssp_p.add_argument("--template-version", default="v1")
    fetch_ssp_p.add_argument("--rule-version", default="v1")
    fetch_ssp_p.add_argument("--email", default=None)
    fetch_ssp_p.add_argument("--password", default=None)
    fetch_ssp_p.add_argument("--scope-check-url", default=None)
    fetch_ssp_p.add_argument("--api-base-url", default=None)
    fetch_ssp_p.add_argument("--auth-decrypt-key", default=None)
    fetch_ssp_p.add_argument("--service-id", type=int, default=None)
    fetch_ssp_p.add_argument("--source-name", default=None)
    fetch_ssp_p.add_argument("--timeout-seconds", type=int, default=None)
    fetch_ssp_excluding_p = sub.add_parser("fetch-ssp-excluding-padding-api", help="Fetch SSP regular rows with pb=1 into performance facts only")
    fetch_ssp_excluding_p.add_argument("--date", default=None, help="Single fetch date (YYYY-MM-DD)")
    fetch_ssp_excluding_p.add_argument("--start-day", default=None, help="Fetch range start date (YYYY-MM-DD)")
    fetch_ssp_excluding_p.add_argument("--end-day", default=None, help="Fetch range end date (YYYY-MM-DD)")
    fetch_ssp_excluding_p.add_argument("--template-version", default="v1")
    fetch_ssp_excluding_p.add_argument("--rule-version", default="v1")
    fetch_ssp_excluding_p.add_argument("--email", default=None)
    fetch_ssp_excluding_p.add_argument("--password", default=None)
    fetch_ssp_excluding_p.add_argument("--scope-check-url", default=None)
    fetch_ssp_excluding_p.add_argument("--api-base-url", default=None)
    fetch_ssp_excluding_p.add_argument("--auth-decrypt-key", default=None)
    fetch_ssp_excluding_p.add_argument("--service-id", type=int, default=None)
    fetch_ssp_excluding_p.add_argument("--source-name", default=None)
    fetch_ssp_excluding_p.add_argument("--timeout-seconds", type=int, default=None)
    fetch_ssp_ad_group_p = sub.add_parser("fetch-ssp-ad-group-api", help="Fetch SSP ad group demand data from the regular HolmesMind API flow")
    fetch_ssp_ad_group_p.add_argument("--date", default=None, help="Single fetch date (YYYY-MM-DD)")
    fetch_ssp_ad_group_p.add_argument("--start-day", default=None, help="Fetch range start date (YYYY-MM-DD)")
    fetch_ssp_ad_group_p.add_argument("--end-day", default=None, help="Fetch range end date (YYYY-MM-DD)")
    fetch_ssp_ad_group_p.add_argument("--zone-group-id", type=int, action="append", default=[], help="Fetch one zone group id; repeatable. Default: all configured groups")
    fetch_ssp_ad_group_p.add_argument("--template-version", default="v1")
    fetch_ssp_ad_group_p.add_argument("--rule-version", default="v1")
    fetch_ssp_ad_group_p.add_argument("--email", default=None)
    fetch_ssp_ad_group_p.add_argument("--password", default=None)
    fetch_ssp_ad_group_p.add_argument("--scope-check-url", default=None)
    fetch_ssp_ad_group_p.add_argument("--api-base-url", default=None)
    fetch_ssp_ad_group_p.add_argument("--auth-decrypt-key", default=None)
    fetch_ssp_ad_group_p.add_argument("--service-id", type=int, default=None)
    fetch_ssp_ad_group_p.add_argument("--source-name", default=None)
    fetch_ssp_ad_group_p.add_argument("--timeout-seconds", type=int, default=None)
    fetch_monthly_ssp_p = sub.add_parser(
        "fetch-monthly-ssp-api",
        help="Fetch SSP monthly report rows into data/monthly_report.sqlite",
    )
    fetch_monthly_ssp_p.add_argument("--date", default=None, help="Single fetch date (YYYY-MM-DD)")
    fetch_monthly_ssp_p.add_argument("--start-day", default=None, help="Fetch range start date (YYYY-MM-DD)")
    fetch_monthly_ssp_p.add_argument("--end-day", default=None, help="Fetch range end date (YYYY-MM-DD)")
    fetch_monthly_ssp_p.add_argument("--pb", type=int, default=1)
    fetch_monthly_ssp_p.add_argument("--email", default=None)
    fetch_monthly_ssp_p.add_argument("--password", default=None)
    fetch_monthly_ssp_p.add_argument("--scope-check-url", default=None)
    fetch_monthly_ssp_p.add_argument("--api-base-url", default=None)
    fetch_monthly_ssp_p.add_argument("--auth-decrypt-key", default=None)
    fetch_monthly_ssp_p.add_argument("--service-id", type=int, default=None)
    fetch_monthly_ssp_p.add_argument("--source-name", default=None)
    fetch_monthly_ssp_p.add_argument("--timeout-seconds", type=int, default=None)
    monthly_media_cost_p = sub.add_parser(
        "monthly-media-cost-analysis",
        help="Build media cost analysis snapshot from data/monthly_report.sqlite",
    )
    monthly_media_cost_p.add_argument("--month", required=True, help="Target month (YYYY-MM)")
    monthly_dimension_p = sub.add_parser(
        "monthly-dimension-summary",
        help="Build zone, campaign, and ad format summary from data/monthly_report.sqlite",
    )
    monthly_dimension_p.add_argument("--month", required=True, help="Target month (YYYY-MM)")
    monthly_dimension_p.add_argument("--limit", type=int, default=20)
    monthly_zone_group_p = sub.add_parser(
        "import-monthly-zone-group",
        help="Import monthly zone group IDs from CSV into data/monthly_report.sqlite",
    )
    monthly_zone_group_p.add_argument("--csv", required=True, help="CSV path; first column must be zone_id")
    monthly_zone_group_p.add_argument("--group-id", type=int, required=True)
    monthly_zone_group_p.add_argument("--group-name", required=True)
    fetch_dsp_p = sub.add_parser("fetch-dsp-api", help="Fetch DSP data from the regular HolmesMind API flow")
    fetch_dsp_p.add_argument("--date", default=None, help="Single fetch date (YYYY-MM-DD)")
    fetch_dsp_p.add_argument("--start-day", default=None, help="Fetch range start date (YYYY-MM-DD)")
    fetch_dsp_p.add_argument("--end-day", default=None, help="Fetch range end date (YYYY-MM-DD)")
    fetch_dsp_p.add_argument("--template-version", default="v1")
    fetch_dsp_p.add_argument("--rule-version", default="v1")
    fetch_dsp_p.add_argument("--email", default=None)
    fetch_dsp_p.add_argument("--password", default=None)
    fetch_dsp_p.add_argument("--scope-check-url", default=None)
    fetch_dsp_p.add_argument("--api-base-url", default=None)
    fetch_dsp_p.add_argument("--auth-decrypt-key", default=None)
    fetch_dsp_p.add_argument("--service-id", type=int, default=None)
    fetch_dsp_p.add_argument("--source-name", default=None)
    fetch_dsp_p.add_argument("--timeout-seconds", type=int, default=None)

    archive_dsp_p = sub.add_parser("archive-dsp-month", help="Archive a closed DSP month into monthly summary canonical rows")
    archive_dsp_p.add_argument("--month", required=True, help="Month to archive (YYYY-MM)")
    archive_dsp_p.add_argument("--force", action="store_true", help="Rebuild archive even if the month was archived before")

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
    exp_p.add_argument("--artifact-root", default=None)
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
        manifest_rel = resolve_manifest_rel(args.manifest, args.env)

        if args.command == "bootstrap":
            return _ok(bootstrap_init(root, manifest_rel, args.env))
        if args.command == "health":
            health = bootstrap_health(root, manifest_rel, args.env)
            if health.get("status") != "ok":
                code = str(health.get("reason_code") or "HEALTH_CHECK_FAILED")
                return _fail(code, "health check failed", {"health": health})
            return _ok(health)
        if args.command == "seed-bootstrap":
            return _ok(
                bootstrap_data_seed(
                    root,
                    manifest_rel=manifest_rel,
                    seed_root_override=args.seed_root,
                    raw_source_overrides=list(args.raw_source or []),
                )
            )
        if args.command == "seed-rebuild":
            svc = _service(root, manifest_rel, args.env)
            return _ok(
                rebuild_canonical_from_seed(
                    root,
                    manifest_rel,
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
                    manifest_rel=manifest_rel,
                    mdreport_root=Path(str(args.mdreport_root)).resolve(),
                    seed_root_override=args.seed_root,
                )
            )
        if args.command == "seed-promote-live":
            # 升版前先確保 live DB schema 與 registry 已就緒。
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            return _ok(
                promote_seed_canonical_to_live(
                    root,
                    manifest_rel,
                    service=svc,
                    seed_root_override=args.seed_root,
                    source_db_rel=args.source_db_rel,
                    workflow=args.workflow,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                )
            )
        if args.command == "fetch-ssp-api":
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            start_day, end_day = _resolve_fetch_range(
                single_date=args.date,
                start_day=args.start_day,
                end_day=args.end_day,
            )
            return _ok(
                svc.fetch_ssp_api(
                    start_day=start_day,
                    end_day=end_day,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                    email=args.email,
                    password=args.password,
                    scope_check_url=args.scope_check_url,
                    api_base_url=args.api_base_url,
                    auth_decrypt_key=args.auth_decrypt_key,
                    service_id=args.service_id,
                    source_name=args.source_name,
                    timeout_seconds=args.timeout_seconds,
                )
            )
        if args.command == "fetch-ssp-excluding-padding-api":
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            start_day, end_day = _resolve_fetch_range(
                single_date=args.date,
                start_day=args.start_day,
                end_day=args.end_day,
            )
            return _ok(
                svc.fetch_ssp_excluding_padding_api(
                    start_day=start_day,
                    end_day=end_day,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                    email=args.email,
                    password=args.password,
                    scope_check_url=args.scope_check_url,
                    api_base_url=args.api_base_url,
                    auth_decrypt_key=args.auth_decrypt_key,
                    service_id=args.service_id,
                    source_name=args.source_name,
                    timeout_seconds=args.timeout_seconds,
                )
            )
        if args.command == "fetch-ssp-ad-group-api":
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            start_day, end_day = _resolve_fetch_range(
                single_date=args.date,
                start_day=args.start_day,
                end_day=args.end_day,
            )
            common_kwargs = {
                "start_day": start_day,
                "end_day": end_day,
                "template_version": args.template_version,
                "rule_version": args.rule_version,
                "email": args.email,
                "password": args.password,
                "scope_check_url": args.scope_check_url,
                "api_base_url": args.api_base_url,
                "auth_decrypt_key": args.auth_decrypt_key,
                "service_id": args.service_id,
                "source_name": args.source_name,
                "timeout_seconds": args.timeout_seconds,
            }
            zone_group_ids = [int(item) for item in (args.zone_group_id or []) if int(item or 0) > 0]
            if zone_group_ids:
                groups = [
                    svc.fetch_ssp_ad_group_api(zone_group_id=zone_group_id, **common_kwargs)
                    for zone_group_id in zone_group_ids
                ]
                return _ok(
                    {
                        "status": "ok",
                        "workflow": "ssp",
                        "start_day": start_day,
                        "end_day": end_day,
                        "group_count": len(groups),
                        "row_count": sum(int(item.get("row_count") or 0) for item in groups),
                        "records_total": sum(int(item.get("records_total") or 0) for item in groups),
                        "groups": groups,
                    }
                )
            return _ok(svc.fetch_all_ssp_ad_group_api(**common_kwargs))
        if args.command == "fetch-monthly-ssp-api":
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            start_day, end_day = _resolve_fetch_range(
                single_date=args.date,
                start_day=args.start_day,
                end_day=args.end_day,
            )
            return _ok(
                svc.fetch_monthly_report_ssp_regular_api(
                    start_day=start_day,
                    end_day=end_day,
                    pb=args.pb,
                    email=args.email,
                    password=args.password,
                    scope_check_url=args.scope_check_url,
                    api_base_url=args.api_base_url,
                    auth_decrypt_key=args.auth_decrypt_key,
                    service_id=args.service_id,
                    source_name=args.source_name,
                    timeout_seconds=args.timeout_seconds,
                )
            )
        if args.command == "monthly-media-cost-analysis":
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            return _ok(svc.build_monthly_media_cost_analysis(month=args.month))
        if args.command == "monthly-dimension-summary":
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            return _ok(svc.build_monthly_dimension_summary(month=args.month, limit=args.limit))
        if args.command == "import-monthly-zone-group":
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            return _ok(
                svc.import_monthly_zone_group_csv(
                    csv_path=args.csv,
                    group_id=args.group_id,
                    group_name=args.group_name,
                )
            )
        if args.command == "fetch-dsp-api":
            bootstrap_init(root, manifest_rel, args.env)
            svc = _service(root, manifest_rel, args.env)
            start_day, end_day = _resolve_fetch_range(
                single_date=args.date,
                start_day=args.start_day,
                end_day=args.end_day,
            )
            return _ok(
                svc.fetch_dsp_api(
                    start_day=start_day,
                    end_day=end_day,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                    email=args.email,
                    password=args.password,
                    scope_check_url=args.scope_check_url,
                    api_base_url=args.api_base_url,
                    auth_decrypt_key=args.auth_decrypt_key,
                    service_id=args.service_id,
                    source_name=args.source_name,
                    timeout_seconds=args.timeout_seconds,
                )
            )

        if args.command == "archive-dsp-month":
            svc = _service(root, manifest_rel, args.env)
            return _ok(svc.archive_dsp_month(month=args.month, force=bool(args.force)))

        if args.command == "save":
            rows = _load_json_list(Path(args.rows_json), "INVALID_ROWS_JSON")
            svc = _service(root, manifest_rel, args.env)
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
            svc = _service(root, manifest_rel, args.env)
            return _ok(
                svc.modify(
                    workflow=args.workflow,
                    updates=updates,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                )
            )

        if args.command == "export":
            svc = _service(root, manifest_rel, args.env)
            main_tab = args.main_tab
            sub_tab = args.sub_tab
            delivery_meta: dict[str, str] = {}
            if args.workflow == "dsp":
                resolved_week_start, resolved_week_end = svc._resolve_export_period(
                    week_start=args.week_start,
                    week_end=args.week_end,
                )
                # CLI baseline 對齊 UI/export 契約：DSP 預設走 Tab4 overview。
                main_tab = main_tab or "dsp_tab4"
                sub_tab = sub_tab or "overview"
                # CLI 是離線補資料/重建的正常入口，這裡自動補一個 tab3->tab4 交付快照，
                # 避免要求操作者先走一次 UI action 才能 export。
                svc.mark_tab4_delivery(
                    workflow="dsp",
                    main_tab="dsp_tab3",
                    sub_tab="pivot",
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                    week_start=resolved_week_start,
                    week_end=resolved_week_end,
                )
                delivery_meta = svc.validate_dsp_export_request(
                    workflow="dsp",
                    main_tab=main_tab,
                    sub_tab=sub_tab,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                    week_start=resolved_week_start,
                    week_end=resolved_week_end,
                )
            else:
                resolved_week_start = args.week_start
                resolved_week_end = args.week_end
            cfg = build_bootstrap_config(root, manifest_rel, args.env)
            resolved_artifact_root = cfg.artifact_root
            if isinstance(args.artifact_root, str) and args.artifact_root.strip():
                resolved_artifact_root = (root / args.artifact_root).resolve()
            return _ok(
                svc.export(
                    workflow=args.workflow,
                    artifact_root=resolved_artifact_root,
                    template_version=args.template_version,
                    rule_version=args.rule_version,
                    week_start=resolved_week_start,
                    week_end=resolved_week_end,
                    delivery_snapshot_token=delivery_meta.get("delivery_snapshot_token"),
                    delivery_run_id=delivery_meta.get("delivery_run_id"),
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
