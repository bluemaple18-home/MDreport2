from __future__ import annotations

import hashlib
import json
import csv
import re
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from infra.sqlite.bootstrap import build_config, load_manifest

RAW_EXCLUDE_KEYWORDS = ("probe", "debug", "rerun", "workbook-first", "tmp", "temp")
RAW_ALLOWED_SUFFIXES = {".json", ".csv", ".tsv", ".parquet", ".txt", ".gz", ".zip"}
LEGACY_CANONICAL_SQLITE_NAMES = (
    "mdreport.sqlite",
    "mdreport_dsp.sqlite",
    "anomaly.sqlite",
    "volume.sqlite",
)
MDREPORT_RAW_INCLUDE_PATTERNS = (
    re.compile(r"^dsp_rawdata_\d{8}_\d{6}_recalc\.json$", re.IGNORECASE),
    re.compile(r"^dsp_weekly_accum_\d{8}_\d{6}_weekly_meta\.json$", re.IGNORECASE),
    re.compile(r"^dsp_dataset_manifest\.json$", re.IGNORECASE),
)


@dataclass(frozen=True)
class SeedLayout:
    seed_root: Path
    raw_root: Path
    canonical_root: Path
    logs_root: Path
    trm_root: Path
    manifests_root: Path


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalize_raw_source_paths(root: Path, source_values: object) -> list[Path]:
    out: list[Path] = []
    if isinstance(source_values, list):
        for value in source_values:
            if not isinstance(value, str) or not value.strip():
                continue
            out.append((root / value).resolve())
    return out


def _guess_workflow(path: Path) -> str:
    token = str(path).lower()
    if "ssp" in token:
        return "ssp"
    if "dsp" in token:
        return "dsp"
    return "unknown"


def _extract_source_date(path: Path) -> str:
    name = path.stem
    iso_match = re.search(r"(20\d{2}-\d{2}-\d{2})", name)
    if iso_match:
        return iso_match.group(1)
    compact_match = re.search(r"(20\d{2})(\d{2})(\d{2})", name)
    if compact_match:
        return f"{compact_match.group(1)}-{compact_match.group(2)}-{compact_match.group(3)}"
    return ""


def _load_data_seed_section(root: Path, manifest_rel: str) -> tuple[str, list[Path]]:
    manifest_path = (root / manifest_rel).resolve()
    manifest = load_manifest(manifest_path)
    raw_section = manifest.get("data_seed", {})
    if not isinstance(raw_section, dict):
        raw_section = {}
    seed_root_rel = str(raw_section.get("root", "data_seed"))
    raw_sources = _normalize_raw_source_paths(root, raw_section.get("raw_sources", []))
    return seed_root_rel, raw_sources


def _resolve_layout(root: Path, seed_root_rel: str) -> SeedLayout:
    seed_root = (root / seed_root_rel).resolve()
    return SeedLayout(
        seed_root=seed_root,
        raw_root=seed_root / "raw_seed",
        canonical_root=seed_root / "canonical",
        logs_root=seed_root / "logs",
        trm_root=seed_root / "templates_rules_mapping",
        manifests_root=seed_root / "manifests",
    )


def _ensure_layout(layout: SeedLayout) -> None:
    for path in (
        layout.raw_root,
        layout.raw_root / "dsp",
        layout.raw_root / "ssp",
        layout.raw_root / "unknown",
        layout.canonical_root,
        layout.logs_root,
        layout.trm_root,
        layout.manifests_root,
    ):
        path.mkdir(parents=True, exist_ok=True)


def _copy_runtime_assets(root: Path, cfg_db_path: Path, layout: SeedLayout, manifest_rel: str) -> dict[str, str]:
    # 用 sqlite backup 建 canonical snapshot，避免直接複製 WAL 狀態導致不一致。
    canonical_snapshot = layout.canonical_root / "mdrep.sqlite"
    src = sqlite3.connect(str(cfg_db_path))
    dst = sqlite3.connect(str(canonical_snapshot))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    copied: dict[str, str] = {
        "canonical_db": str(canonical_snapshot.relative_to(layout.seed_root)),
    }
    candidates = [
        (root / manifest_rel, layout.trm_root / "bootstrap.manifest.json"),
        (root / "templates" / "template_registry.seed.json", layout.trm_root / "template_registry.seed.json"),
        (root / "templates" / "ruleset.seed.json", layout.trm_root / "ruleset.seed.json"),
        (root / "contracts" / "fields_contract.json", layout.trm_root / "fields_contract.json"),
    ]
    for src_path, dst_path in candidates:
        if src_path.exists():
            shutil.copy2(src_path, dst_path)
            copied[src_path.name] = str(dst_path.relative_to(layout.seed_root))
    return copied


def _dump_db_table(conn: sqlite3.Connection, table: str, output_path: Path, order_by: str) -> int:
    cur = conn.execute(f"SELECT * FROM {table} ORDER BY {order_by}")
    col_names = [str(col[0]) for col in cur.description]
    rows = [dict(zip(col_names, raw)) for raw in cur.fetchall()]
    output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(rows)


def _snapshot_logs(cfg_db_path: Path, layout: SeedLayout) -> dict[str, object]:
    conn = sqlite3.connect(str(cfg_db_path))
    try:
        run_log_count = _dump_db_table(conn, "run_log", layout.logs_root / "run_log.json", "created_at DESC")
        audit_log_count = _dump_db_table(conn, "audit_log", layout.logs_root / "audit_log.json", "created_at DESC")
        publish_count = _dump_db_table(conn, "publish_runs", layout.logs_root / "publish_runs.json", "created_at DESC")
        evidence_count = _dump_db_table(conn, "evidence_index", layout.logs_root / "evidence_index.json", "created_at DESC")
    finally:
        conn.close()
    return {
        "run_log": {"path": str((layout.logs_root / "run_log.json").relative_to(layout.seed_root)), "count": run_log_count},
        "audit_log": {"path": str((layout.logs_root / "audit_log.json").relative_to(layout.seed_root)), "count": audit_log_count},
        "publish_runs": {"path": str((layout.logs_root / "publish_runs.json").relative_to(layout.seed_root)), "count": publish_count},
        "evidence_index": {"path": str((layout.logs_root / "evidence_index.json").relative_to(layout.seed_root)), "count": evidence_count},
    }


def _latest_run_ids_by_type(cfg_db_path: Path, workflow: str, run_type: str) -> str:
    conn = sqlite3.connect(str(cfg_db_path))
    try:
        row = conn.execute(
            """
            SELECT run_id
            FROM run_log
            WHERE workflow = ? AND run_type = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (workflow, run_type),
        ).fetchone()
    finally:
        conn.close()
    return str(row[0]) if row else ""


def _should_include_raw(path: Path) -> bool:
    lower = path.name.lower()
    if any(token in lower for token in RAW_EXCLUDE_KEYWORDS):
        return False
    if any(token in lower for token in ("check", "pivot_snapshot", "publish_meta", "save_profile")):
        return False
    return path.suffix.lower() in RAW_ALLOWED_SUFFIXES


def _collect_raw_entries(
    layout: SeedLayout,
    source_dirs: list[Path],
    canonical_db_rel: str,
    cfg_db_path: Path,
) -> tuple[list[dict[str, object]], list[str]]:
    entries: list[dict[str, object]] = []
    warnings: list[str] = []
    for source_dir in source_dirs:
        if not source_dir.exists() or not source_dir.is_dir():
            warnings.append(f"raw source 不存在或非目錄: {source_dir}")
            continue
        for src in sorted(source_dir.rglob("*")):
            if not src.is_file():
                continue
            if not _should_include_raw(src):
                continue
            workflow = _guess_workflow(src)
            workflow_root = layout.raw_root / workflow
            relative_name = src.name
            dest = workflow_root / relative_name
            if dest.exists():
                stem = src.stem
                suffix = src.suffix
                dest = workflow_root / f"{stem}-{_sha256_file(src)[:8]}{suffix}"
            shutil.copy2(src, dest)
            checksum = _sha256_file(dest)
            import_run_id = _latest_run_ids_by_type(cfg_db_path, workflow, "save") if workflow in {"dsp", "ssp"} else ""
            latest_run_id = _latest_run_ids_by_type(cfg_db_path, workflow, "export") if workflow in {"dsp", "ssp"} else ""
            entries.append(
                {
                    "raw_file_rel_path": str(dest.relative_to(layout.seed_root)),
                    "source_rel_path": str(src),
                    "workflow": workflow,
                    "source_date": _extract_source_date(src),
                    "checksum_sha256": checksum,
                    "size_bytes": int(dest.stat().st_size),
                    "canonical_db_rel_path": canonical_db_rel,
                    "import_run_id": import_run_id,
                    "latest_run_id": latest_run_id,
                }
            )
    return entries, warnings


def bootstrap_data_seed(
    root: Path,
    manifest_rel: str = "bootstrap.manifest.json",
    seed_root_override: str | None = None,
    raw_source_overrides: list[str] | None = None,
) -> dict[str, object]:
    cfg = build_config(root, manifest_rel)
    if not cfg.db_path.exists():
        raise FileNotFoundError(f"DB 不存在，請先完成 bootstrap/save: {cfg.db_path}")
    seed_root_rel, manifest_raw_sources = _load_data_seed_section(root, manifest_rel)
    if seed_root_override:
        seed_root_rel = seed_root_override
    raw_sources = list(manifest_raw_sources)
    if raw_source_overrides:
        raw_sources.extend((root / rel).resolve() for rel in raw_source_overrides)
    # 去重且維持順序
    seen: set[str] = set()
    dedup_raw_sources: list[Path] = []
    for raw in raw_sources:
        key = str(raw)
        if key in seen:
            continue
        seen.add(key)
        dedup_raw_sources.append(raw)

    layout = _resolve_layout(root, seed_root_rel)
    _ensure_layout(layout)
    copied_assets = _copy_runtime_assets(root, cfg.db_path, layout, manifest_rel)
    logs_snapshot = _snapshot_logs(cfg.db_path, layout)
    canonical_db_rel = str((layout.canonical_root / "mdrep.sqlite").relative_to(layout.seed_root))
    raw_entries, raw_warnings = _collect_raw_entries(layout, dedup_raw_sources, canonical_db_rel, cfg.db_path)

    manifest_payload = {
        "seed_manifest_version": "v1",
        "generated_at": _now_iso(),
        "project_root": str(root),
        "seed_root": str(layout.seed_root),
        "layers": {
            "raw_seed": {
                "root": str(layout.raw_root.relative_to(layout.seed_root)),
                "entry_count": len(raw_entries),
                "exclude_keywords": list(RAW_EXCLUDE_KEYWORDS),
            },
            "canonical": {"db_snapshot": canonical_db_rel},
            "logs": logs_snapshot,
            "templates_rules_mapping": copied_assets,
        },
        "entries": raw_entries,
        "warnings": raw_warnings,
    }
    manifest_path = layout.manifests_root / "seed_manifest.json"
    manifest_path.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "status": "ok",
        "seed_root": str(layout.seed_root),
        "manifest_path": str(manifest_path),
        "raw_entry_count": len(raw_entries),
        "raw_source_count": len(dedup_raw_sources),
        "warnings": raw_warnings,
        "layers": manifest_payload["layers"],
    }


def _is_mdreport_raw_candidate(path: Path) -> bool:
    name = path.name
    for pattern in MDREPORT_RAW_INCLUDE_PATTERNS:
        if pattern.match(name):
            return True
    return False


def _copy_mdreport_canonical_and_mapping(mdreport_root: Path, layout: SeedLayout) -> dict[str, object]:
    data_root = mdreport_root / "data"
    if not data_root.exists():
        raise FileNotFoundError(f"找不到 MDreport data 目錄: {data_root}")

    copied_dbs: list[str] = []
    for db_name in LEGACY_CANONICAL_SQLITE_NAMES:
        src = data_root / db_name
        if not src.exists():
            continue
        dst = layout.canonical_root / db_name
        shutil.copy2(src, dst)
        copied_dbs.append(str(dst.relative_to(layout.seed_root)))

    if not copied_dbs:
        raise FileNotFoundError(f"MDreport data 目錄沒有可用 sqlite: {data_root}")

    copied_mapping: dict[str, str] = {}
    group_overrides = data_root / "group_overrides.json"
    if group_overrides.exists():
        dst = layout.trm_root / "group_overrides.json"
        shutil.copy2(group_overrides, dst)
        copied_mapping["group_overrides"] = str(dst.relative_to(layout.seed_root))
    return {"canonical_sqlite_files": copied_dbs, "mapping_files": copied_mapping}


def _collect_mdreport_raw_entries(layout: SeedLayout, mdreport_root: Path) -> tuple[list[dict[str, object]], list[str]]:
    artifacts_root = mdreport_root / "artifacts"
    if not artifacts_root.exists():
        raise FileNotFoundError(f"找不到 MDreport artifacts 目錄: {artifacts_root}")

    entries: list[dict[str, object]] = []
    warnings: list[str] = []
    for src in sorted(artifacts_root.glob("*.json")):
        if not src.is_file():
            continue
        if not _is_mdreport_raw_candidate(src):
            continue
        workflow = _guess_workflow(src)
        workflow_root = layout.raw_root / workflow
        dst = workflow_root / src.name
        if dst.exists():
            dst = workflow_root / f"{src.stem}-{_sha256_file(src)[:8]}{src.suffix}"
        shutil.copy2(src, dst)
        entries.append(
            {
                "raw_file_rel_path": str(dst.relative_to(layout.seed_root)),
                "source_rel_path": str(src),
                "workflow": workflow,
                "source_date": _extract_source_date(src),
                "checksum_sha256": _sha256_file(dst),
                "size_bytes": int(dst.stat().st_size),
                "canonical_db_rel_path": "",
                "import_run_id": "",
                "latest_run_id": "",
            }
        )
    if not entries:
        warnings.append(f"在 {artifacts_root} 找不到符合規則的 raw seed json")
    return entries, warnings


def import_mdreport_seed(
    root: Path,
    manifest_rel: str = "bootstrap.manifest.json",
    *,
    mdreport_root: Path,
    seed_root_override: str | None = None,
) -> dict[str, object]:
    seed_root_rel, _raw_sources = _load_data_seed_section(root, manifest_rel)
    if seed_root_override:
        seed_root_rel = seed_root_override
    layout = _resolve_layout(root, seed_root_rel)
    _ensure_layout(layout)

    # 同步基礎契約檔，讓 seed 包可單獨解讀。
    copied_assets = {}
    for src_path, dst_path in (
        (root / manifest_rel, layout.trm_root / "bootstrap.manifest.json"),
        (root / "templates" / "template_registry.seed.json", layout.trm_root / "template_registry.seed.json"),
        (root / "templates" / "ruleset.seed.json", layout.trm_root / "ruleset.seed.json"),
        (root / "contracts" / "fields_contract.json", layout.trm_root / "fields_contract.json"),
    ):
        if src_path.exists():
            shutil.copy2(src_path, dst_path)
            copied_assets[src_path.name] = str(dst_path.relative_to(layout.seed_root))

    canonical_mapping = _copy_mdreport_canonical_and_mapping(mdreport_root, layout)
    raw_entries, raw_warnings = _collect_mdreport_raw_entries(layout, mdreport_root)
    primary_canonical = ""
    for candidate in canonical_mapping["canonical_sqlite_files"]:
        if str(candidate).endswith("mdreport_dsp.sqlite"):
            primary_canonical = str(candidate)
            break
    if not primary_canonical and canonical_mapping["canonical_sqlite_files"]:
        primary_canonical = str(canonical_mapping["canonical_sqlite_files"][0])

    ssp_truth_canonical = ""
    for candidate in canonical_mapping["canonical_sqlite_files"]:
        if str(candidate).endswith("mdreport.sqlite"):
            ssp_truth_canonical = str(candidate)
            break
    if not ssp_truth_canonical:
        ssp_truth_canonical = primary_canonical

    legacy_ssp_view_snapshots = [
        item
        for item in canonical_mapping["canonical_sqlite_files"]
        if str(item).endswith("volume.sqlite") or str(item).endswith("anomaly.sqlite")
    ]
    for item in raw_entries:
        item["canonical_db_rel_path"] = primary_canonical

    manifest_payload = {
        "seed_manifest_version": "v1",
        "generated_at": _now_iso(),
        "project_root": str(root),
        "seed_root": str(layout.seed_root),
        "source_project_root": str(mdreport_root),
        "layers": {
            "raw_seed": {
                "root": str(layout.raw_root.relative_to(layout.seed_root)),
                "entry_count": len(raw_entries),
                "include_patterns": [p.pattern for p in MDREPORT_RAW_INCLUDE_PATTERNS],
            },
            "canonical": {
                "db_snapshot": primary_canonical,
                "workflow_truth_db": {
                    "dsp": primary_canonical,
                    "ssp": ssp_truth_canonical,
                },
                "ssp_legacy_view_db_snapshots": legacy_ssp_view_snapshots,
                "additional_db_snapshots": [
                    item for item in canonical_mapping["canonical_sqlite_files"] if item != primary_canonical
                ],
            },
            "logs": {
                "run_log": {"path": "", "count": 0},
                "audit_log": {"path": "", "count": 0},
                "publish_runs": {"path": "", "count": 0},
                "evidence_index": {"path": "", "count": 0},
            },
            "templates_rules_mapping": {
                **copied_assets,
                **canonical_mapping["mapping_files"],
            },
        },
        "entries": raw_entries,
        "warnings": raw_warnings,
    }
    manifest_path = layout.manifests_root / "seed_manifest.json"
    manifest_payload["manifest_name"] = str(manifest_path.name)
    manifest_path.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "status": "ok",
        "seed_root": str(layout.seed_root),
        "manifest_path": str(manifest_path),
        "raw_entry_count": len(raw_entries),
        "canonical_seed_count": len(canonical_mapping["canonical_sqlite_files"]),
        "canonical_seed_files": canonical_mapping["canonical_sqlite_files"],
        "warnings": raw_warnings,
        "layers": manifest_payload["layers"],
    }


def _load_seed_manifest(seed_root: Path, manifest_rel: str = "manifests/seed_manifest.json") -> dict:
    manifest_path = (seed_root / manifest_rel).resolve()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("seed manifest 必須是 object")
    entries = payload.get("entries", [])
    if not isinstance(entries, list):
        raise ValueError("seed manifest entries 必須是 list")
    return payload


def _read_rows_from_seed_file(path: Path) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            maybe_rows = payload.get("rows")
            if isinstance(maybe_rows, list):
                payload = maybe_rows
        if not isinstance(payload, list):
            raise ValueError(f"raw seed json 必須是 list: {path}")
        rows = [row for row in payload if isinstance(row, dict)]
        if len(rows) != len(payload):
            raise ValueError(f"raw seed json 含非 object item: {path}")
        return rows
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, delimiter=delimiter)
            return [dict(row) for row in reader]
    raise ValueError(f"目前不支援的 raw seed 格式: {path.suffix}")


def rebuild_canonical_from_seed(
    root: Path,
    manifest_rel: str,
    *,
    service: object,
    seed_root_override: str | None = None,
    seed_manifest_rel: str = "manifests/seed_manifest.json",
    workflow_filter: list[str] | None = None,
    template_version: str = "v1",
    rule_version: str = "v1",
) -> dict[str, object]:
    seed_root_rel, _raw_sources = _load_data_seed_section(root, manifest_rel)
    if seed_root_override:
        seed_root_rel = seed_root_override
    layout = _resolve_layout(root, seed_root_rel)
    seed_manifest = _load_seed_manifest(layout.seed_root, manifest_rel=seed_manifest_rel)
    entries = seed_manifest.get("entries", [])
    assert isinstance(entries, list)

    target_workflows = {"dsp", "ssp"}
    if workflow_filter:
        target_workflows = {str(item).lower() for item in workflow_filter if str(item).strip()}
    grouped_rows: dict[str, list[dict]] = {}
    warnings: list[str] = []
    files_used = 0
    for item in entries:
        if not isinstance(item, dict):
            continue
        workflow = str(item.get("workflow", "")).lower()
        if workflow not in target_workflows:
            continue
        rel_path = str(item.get("raw_file_rel_path", "")).strip()
        if not rel_path:
            continue
        raw_path = (layout.seed_root / rel_path).resolve()
        if not raw_path.exists():
            warnings.append(f"raw seed 檔案不存在: {raw_path}")
            continue
        try:
            rows = _read_rows_from_seed_file(raw_path)
        except Exception as exc:
            warnings.append(f"略過 raw seed（{raw_path.name}）：{exc}")
            continue
        if not rows:
            continue
        files_used += 1
        grouped_rows.setdefault(workflow, []).extend(rows)

    if not grouped_rows:
        raise ValueError("沒有可重建的 raw seed rows")

    save_fn = getattr(service, "save", None)
    if not callable(save_fn):
        raise ValueError("service 缺少 save 能力")

    rebuilt: dict[str, object] = {}
    for workflow in sorted(grouped_rows.keys()):
        rows = grouped_rows[workflow]
        result = save_fn(
            workflow=workflow,
            rows=rows,
            template_version=template_version,
            rule_version=rule_version,
        )
        rebuilt[workflow] = {
            "row_count": len(rows),
            "run_id": str(result.get("run_id", "")) if isinstance(result, dict) else "",
        }

    return {
        "status": "ok",
        "seed_root": str(layout.seed_root),
        "seed_manifest": str((layout.seed_root / seed_manifest_rel).resolve()),
        "template_version": template_version,
        "rule_version": rule_version,
        "files_used": files_used,
        "workflows": rebuilt,
        "warnings": warnings,
    }


def _read_rows_from_legacy_dsp_db(source_db_path: Path) -> list[dict]:
    if not source_db_path.exists():
        raise FileNotFoundError(f"找不到 seed canonical DB: {source_db_path}")
    conn = sqlite3.connect(str(source_db_path))
    try:
        has_dsp_rawdata = conn.execute(
            "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='dsp_rawdata'"
        ).fetchone()
        has_canonical_raw = conn.execute(
            "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='canonical_raw'"
        ).fetchone()
        rows: list[dict] = []
        if int(has_dsp_rawdata[0] or 0) > 0:
            cur = conn.execute(
                """
                SELECT 日期時間, 經銷商, 訂單, 素材, 廣告形式, 尺寸, 素材樣板, 執行金額, 系統營收, 媒體費用,
                       原始經銷商, 原始廣告形式, 最終經銷商, 規則命中_經銷商, 最終來源_經銷商,
                       分類層級B, 分類層級C, 分類層級D, 最終廣告形式, 規則命中_廣告形式, 最終來源_廣告形式
                FROM dsp_rawdata
                ORDER BY row_order ASC
                """
            )
            cols = [str(c[0]) for c in cur.description]
            for raw in cur.fetchall():
                rows.append(dict(zip(cols, raw)))
            return rows
        if int(has_canonical_raw[0] or 0) > 0:
            cur = conn.execute(
                """
                SELECT 日期時間, 經銷商, 訂單, 素材, 廣告形式, 尺寸, 素材樣板, 執行金額, 系統營收, 媒體費用,
                       原始經銷商, 原始廣告形式, 最終經銷商, 規則命中_經銷商, 最終來源_經銷商,
                       分類層級B, 分類層級C, 分類層級D, 最終廣告形式, 規則命中_廣告形式, 最終來源_廣告形式
                FROM canonical_raw
                WHERE workflow='dsp'
                ORDER BY row_order ASC
                """
            )
            cols = [str(c[0]) for c in cur.description]
            for raw in cur.fetchall():
                rows.append(dict(zip(cols, raw)))
            return rows
    finally:
        conn.close()
    raise ValueError("seed canonical DB 不含可轉換的 dsp_rawdata/canonical_raw")


def _safe_float(value: object) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _safe_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _classify_ssp_ad_format(*tokens: str) -> str:
    joined = " ".join(token.lower() for token in tokens if token).replace(" ", "")
    if "置底展開" in joined:
        return "置底展開"
    if "置底" in joined:
        return "置底"
    if "320x480" in joined:
        return "文中320x480"
    if "300x250" in joined:
        return "文中300x250"
    if "蓋板" in joined:
        return "蓋板"
    return "蓋板"


def _read_rows_from_ssp_raw_db(source_db_path: Path) -> list[dict]:
    if not source_db_path.exists():
        raise FileNotFoundError(f"找不到 seed canonical DB: {source_db_path}")
    conn = sqlite3.connect(str(source_db_path))
    try:
        has_raw = conn.execute(
            "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='raw'"
        ).fetchone()
        if int(has_raw[0] or 0) <= 0:
            raise ValueError("seed canonical DB 不含可轉換的 raw table")

        cur = conn.execute("SELECT * FROM raw")
        col_names = [str(col[0]) for col in cur.description]
        rows: list[dict] = []
        source_name = source_db_path.stem
        for raw in cur.fetchall():
            item = dict(zip(col_names, raw))
            rows.append(
                {
                    "source": _safe_text(item.get("source")) or source_name,
                    "ts": _safe_text(item.get("ts")) or _safe_text(item.get("date")),
                    "date": _safe_text(item.get("date")),
                    "hour": int(item.get("hour") or 0),
                    "placement_id": int(item.get("placement_id") or 0),
                    "placement_name": _safe_text(item.get("placement_name")),
                    "request": _safe_float(item.get("request")),
                    "impression": _safe_float(item.get("impression")),
                    "clicks": _safe_float(item.get("clicks")),
                    "revenue": _safe_float(item.get("revenue")),
                    "dsp_amount": _safe_float(item.get("dsp_amount")),
                    "order_id": _safe_text(item.get("order_id")),
                    "order_name": _safe_text(item.get("order_name")),
                    "supplier_id": int(item.get("supplier_id") or 0),
                    "supplier_name": _safe_text(item.get("supplier_name")),
                    "site_id": int(item.get("site_id") or 0),
                    "site_name": _safe_text(item.get("site_name")),
                }
            )
        return rows
    finally:
        conn.close()


def promote_seed_canonical_to_live(
    root: Path,
    manifest_rel: str,
    *,
    service: object,
    seed_root_override: str | None = None,
    source_db_rel: str | None = None,
    workflow: str = "dsp",
    template_version: str = "v1",
    rule_version: str = "v1",
) -> dict[str, object]:
    seed_root_rel, _raw_sources = _load_data_seed_section(root, manifest_rel)
    if seed_root_override:
        seed_root_rel = seed_root_override
    layout = _resolve_layout(root, seed_root_rel)
    workflow_name = workflow.lower()
    effective_source_db_rel = source_db_rel
    if not effective_source_db_rel:
        # 單一真相預設：
        # - DSP: 仍用 mdreport_dsp.sqlite
        # - SSP: 收斂到 mdreport.sqlite（volume/anomaly 僅作視角來源）
        effective_source_db_rel = "canonical/mdreport.sqlite" if workflow_name == "ssp" else "canonical/mdreport_dsp.sqlite"
    source_db_path = (layout.seed_root / effective_source_db_rel).resolve()
    if workflow_name == "dsp":
        rows = _read_rows_from_legacy_dsp_db(source_db_path)
    elif workflow_name == "ssp":
        rows = _read_rows_from_ssp_raw_db(source_db_path)
    else:
        raise ValueError("目前 seed-promote-live 僅支援 workflow=dsp/ssp")
    if not rows:
        raise ValueError(f"seed canonical DB 沒有可升版資料: {source_db_path}")

    repo = getattr(service, "repo", None)
    if repo is None:
        raise ValueError("service 缺少 repo")
    save_fn = getattr(service, "save", None)
    if workflow_name == "dsp":
        if not callable(save_fn):
            raise ValueError("service 缺少 save 能力")
        result = save_fn(
            workflow=workflow_name,
            rows=rows,
            template_version=template_version,
            rule_version=rule_version,
        )
    else:
        if not callable(getattr(repo, "save_ssp_raw_rows", None)):
            raise ValueError("repo 缺少 save_ssp_raw_rows 能力")
        with repo.connect() as conn:
            repo.resolve_trace_binding(conn, workflow_name, template_version, rule_version)
            conn.execute("DELETE FROM canonical_raw WHERE workflow = 'ssp'")
            written = repo.save_ssp_raw_rows(conn, rows)
            trace = repo.build_trace_meta(conn, workflow_name, template_version, rule_version)
            run_id = repo.insert_run_log(
                conn,
                run_type="save",
                workflow=workflow_name,
                status="ok",
                trace=trace,
                detail={"row_count": written, "target_table": "ssp_raw"},
            )
            repo.append_audit_event(
                conn,
                event_type="save",
                scope="service",
                status="ok",
                payload={
                    "workflow": workflow_name,
                    "run_id": run_id,
                    "template_version": template_version,
                    "rule_version": rule_version,
                    "canonical_token": trace.canonical_token,
                    "row_count": written,
                    "target_table": "ssp_raw",
                },
            )
            conn.commit()
        result = {"run_id": run_id, "row_count": written}
    return {
        "status": "ok",
        "seed_root": str(layout.seed_root),
        "source_db": str(source_db_path),
        "workflow": workflow_name,
        "row_count": len(rows),
        "run_id": str(result.get("run_id", "")) if isinstance(result, dict) else "",
        "template_version": template_version,
        "rule_version": rule_version,
    }
