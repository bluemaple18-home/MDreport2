from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

DEFAULT_MANIFEST_REL = "bootstrap.manifest.json"
ENV_MANIFEST_MAP = {
    "prod": "bootstrap.manifest.json",
    "test": "bootstrap.test.manifest.json",
}

REQUIRED_TABLES = {
    "schema_migrations",
    "canonical_raw",
    "overrides_adjustments",
    "template_registry",
    "ruleset_versions",
    "rule_bindings",
    "run_log",
    "audit_log",
    "publish_runs",
    "evidence_index",
}

FEATURE_FLAG_DEFAULTS = {
    "enable_test_hooks": False,
    "enable_trace_markers": False,
    "strict_acceptance_gate": False,
}


class AcceptanceGateError(RuntimeError):
    def __init__(self, reason_code: str, checks: dict[str, object]) -> None:
        super().__init__(f"strict acceptance gate failed: {reason_code}")
        self.reason_code = reason_code
        self.checks = checks


@dataclass
class BootstrapConfig:
    root: Path
    manifest_path: Path
    manifest_rel: str
    runtime_env: str
    db_path: Path
    artifact_root: Path
    data_seed_root: Path
    target_version: str
    template_seed_path: Path
    rule_seed_path: Path
    feature_flags: dict[str, bool]


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_manifest(manifest_path: Path) -> dict:
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("bootstrap manifest 必須是 object")
    return raw


def _coerce_bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _normalize_feature_flags(raw_flags: object) -> dict[str, bool]:
    flags = dict(FEATURE_FLAG_DEFAULTS)
    if isinstance(raw_flags, dict):
        for key, default in FEATURE_FLAG_DEFAULTS.items():
            flags[key] = _coerce_bool(raw_flags.get(key), default)
    return flags


def normalize_runtime_env(value: object) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"prod", "production"}:
        return "prod"
    if raw in {"test", "testing"}:
        return "test"
    return ""


def resolve_manifest_rel(manifest_rel: str | None = None, runtime_env: str | None = None) -> str:
    explicit = str(manifest_rel or "").strip()
    if explicit:
        return explicit
    env = normalize_runtime_env(runtime_env)
    if env:
        return ENV_MANIFEST_MAP[env]
    return DEFAULT_MANIFEST_REL


def build_config(root: Path, manifest_rel: str | None = None, runtime_env: str | None = None) -> BootstrapConfig:
    resolved_manifest_rel = resolve_manifest_rel(manifest_rel, runtime_env)
    manifest_path = (root / resolved_manifest_rel).resolve()
    manifest = load_manifest(manifest_path)

    db_path = (root / str(manifest.get("db", {}).get("path", "data/mdrep.sqlite"))).resolve()
    artifact_root = (root / str(manifest.get("artifact_root", "artifacts"))).resolve()
    data_seed_root = (root / str(manifest.get("data_seed", {}).get("root", "data_seed"))).resolve()
    target_version = str(manifest.get("schema", {}).get("target_version", "0001"))
    template_seed = str(manifest.get("template_registry", {}).get("seed", "templates/template_registry.seed.json"))
    rule_seed = str(manifest.get("rule_registry", {}).get("seed", "templates/ruleset.seed.json"))
    feature_flags = _normalize_feature_flags(manifest.get("feature_flags", {}))
    normalized_env = normalize_runtime_env(runtime_env) or normalize_runtime_env(manifest.get("runtime_env") or manifest.get("env")) or "prod"

    return BootstrapConfig(
        root=root,
        manifest_path=manifest_path,
        manifest_rel=resolved_manifest_rel,
        runtime_env=normalized_env,
        db_path=db_path,
        artifact_root=artifact_root,
        data_seed_root=data_seed_root,
        target_version=target_version,
        template_seed_path=(root / template_seed).resolve(),
        rule_seed_path=(root / rule_seed).resolve(),
        feature_flags=feature_flags,
    )


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def _migration_checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def apply_migration(conn: sqlite3.Connection, migration_path: Path, version: str) -> None:
    existing = conn.execute("SELECT checksum FROM schema_migrations WHERE version = ?", (version,)).fetchone()
    checksum = _migration_checksum(migration_path)
    if existing:
        if str(existing[0]) != checksum:
            raise RuntimeError(f"migration {version} checksum mismatch")
        return

    sql = migration_path.read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.execute(
        "INSERT INTO schema_migrations(version, applied_at, checksum) VALUES(?, ?, ?)",
        (version, _now_iso(), checksum),
    )
    conn.commit()


def _load_seed_rows(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"seed 必須是 list: {path}")
    rows: list[dict] = []
    for row in payload:
        if isinstance(row, dict):
            rows.append(row)
    return rows


def append_audit_event(
    conn: sqlite3.Connection,
    *,
    event_type: str,
    scope: str,
    status: str,
    payload: dict,
    strict: bool = False,
) -> bool:
    try:
        conn.execute(
            """
            INSERT INTO audit_log(event_type, scope, status, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (event_type, scope, status, json.dumps(payload, ensure_ascii=False), _now_iso()),
        )
        return True
    except Exception:
        if strict:
            raise
        return False


def seed_template_registry(conn: sqlite3.Connection, seed_path: Path) -> int:
    rows = _load_seed_rows(seed_path)
    now = _now_iso()
    for row in rows:
        conn.execute(
            """
            INSERT OR REPLACE INTO template_registry(
              template_id, template_version, workflow, mapping_version,
              is_active, meta_json, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(row.get("template_id", "")),
                str(row.get("template_version", "")),
                str(row.get("workflow", "")),
                str(row.get("mapping_version", "")),
                int(row.get("is_active", 1)),
                json.dumps(row.get("meta_json", {}), ensure_ascii=False),
                now,
            ),
        )
    conn.commit()
    return len(rows)


def seed_rule_versions(conn: sqlite3.Connection, seed_path: Path) -> int:
    rows = _load_seed_rows(seed_path)
    now = _now_iso()
    for row in rows:
        conn.execute(
            """
            INSERT OR REPLACE INTO ruleset_versions(
              rule_version, rule_hash, activated_at, meta_json
            ) VALUES(?, ?, ?, ?)
            """,
            (
                str(row.get("rule_version", "")),
                str(row.get("rule_hash", "")),
                now,
                json.dumps(row.get("meta_json", {}), ensure_ascii=False),
            ),
        )
    conn.commit()
    return len(rows)


def seed_rule_bindings(conn: sqlite3.Connection) -> int:
    templates = conn.execute(
        """
        SELECT template_id, workflow
        FROM template_registry
        WHERE is_active = 1
        ORDER BY workflow, template_id
        """
    ).fetchall()
    rule_row = conn.execute(
        "SELECT rule_version FROM ruleset_versions ORDER BY activated_at DESC, rule_version DESC LIMIT 1"
    ).fetchone()
    if not rule_row:
        raise RuntimeError("缺少可綁定的 rule version")
    rule_version = str(rule_row[0])
    now = _now_iso()
    count = 0
    for template_id, workflow in templates:
        conn.execute(
            """
            INSERT OR REPLACE INTO rule_bindings(
              workflow, template_id, rule_version, activated_at
            ) VALUES(?, ?, ?, ?)
            """,
            (str(workflow), str(template_id), rule_version, now),
        )
        count += 1
    conn.commit()
    return count


def run_health_check(conn: sqlite3.Connection, target_version: str, *, require_binding: bool = True) -> None:
    tables = {
        str(r[0])
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    missing = REQUIRED_TABLES - tables
    if missing:
        raise RuntimeError(f"缺少必要資料表: {sorted(missing)}")

    version = conn.execute(
        "SELECT version FROM schema_migrations WHERE version = ?",
        (target_version,),
    ).fetchone()
    if not version:
        raise RuntimeError(f"缺少 target migration: {target_version}")

    template_count = conn.execute(
        "SELECT COUNT(1) FROM template_registry WHERE is_active = 1"
    ).fetchone()
    if int(template_count[0] or 0) <= 0:
        raise RuntimeError("缺少啟用中的 template registry")

    rule_count = conn.execute(
        "SELECT COUNT(1) FROM ruleset_versions"
    ).fetchone()
    if int(rule_count[0] or 0) <= 0:
        raise RuntimeError("缺少 ruleset version")

    if require_binding:
        binding_count = conn.execute(
            "SELECT COUNT(1) FROM rule_bindings"
        ).fetchone()
        if int(binding_count[0] or 0) <= 0:
            raise RuntimeError("缺少 rule binding")


def _collect_missing_bindings(conn: sqlite3.Connection) -> list[dict[str, str]]:
    active_templates = conn.execute(
        "SELECT workflow, template_id FROM template_registry WHERE is_active = 1 ORDER BY workflow, template_id"
    ).fetchall()
    missing_bindings: list[dict[str, str]] = []
    for workflow, template_id in active_templates:
        has_binding = conn.execute(
            """
            SELECT COUNT(1)
            FROM rule_bindings rb
            JOIN ruleset_versions rv ON rv.rule_version = rb.rule_version
            WHERE rb.workflow = ? AND rb.template_id = ?
            """,
            (str(workflow), str(template_id)),
        ).fetchone()
        if int(has_binding[0] or 0) <= 0:
            missing_bindings.append({"workflow": str(workflow), "template_id": str(template_id)})
    return missing_bindings


def get_feature_flags(root: Path, manifest_rel: str | None = None, runtime_env: str | None = None) -> dict[str, bool]:
    cfg = build_config(root, manifest_rel, runtime_env)
    return dict(cfg.feature_flags)


def evaluate_acceptance_gate(root: Path, manifest_rel: str | None = None, runtime_env: str | None = None) -> dict:
    cfg = build_config(root, manifest_rel, runtime_env)
    enabled = bool(cfg.feature_flags.get("strict_acceptance_gate", False))
    if not enabled:
        return {"enabled": False, "status": "skipped"}

    health = bootstrap_health(root, cfg.manifest_rel, runtime_env)
    if health.get("status") != "ok":
        return {
            "enabled": True,
            "status": "fail",
            "reason_code": str(health.get("reason_code") or "HEALTH_CHECK_FAILED"),
            "checks": health.get("checks", {}),
        }
    return {
        "enabled": True,
        "status": "ok",
        "checks": health.get("checks", {}),
    }


def ensure_acceptance_gate(root: Path, manifest_rel: str | None = None, runtime_env: str | None = None) -> dict:
    gate = evaluate_acceptance_gate(root, manifest_rel, runtime_env)
    if gate.get("enabled") and gate.get("status") != "ok":
        raise AcceptanceGateError(
            reason_code=str(gate.get("reason_code") or "STRICT_ACCEPTANCE_GATE_FAILED"),
            checks=dict(gate.get("checks") or {}),
        )
    return gate


def bootstrap_init(root: Path, manifest_rel: str | None = None, runtime_env: str | None = None) -> dict:
    cfg = build_config(root, manifest_rel, runtime_env)
    migration_path = cfg.root / "migrations" / f"{cfg.target_version}_initial.sql"
    if not migration_path.exists():
        migration_path = cfg.root / "migrations" / f"{cfg.target_version}.sql"
    if not migration_path.exists():
        raise FileNotFoundError(f"找不到 migration: {cfg.target_version}")

    required_dirs = [
        cfg.artifact_root,
        cfg.root / "templates",
        cfg.root / "contracts",
        cfg.db_path.parent,
    ]
    for d in required_dirs:
        d.mkdir(parents=True, exist_ok=True)

    if not cfg.template_seed_path.exists():
        raise FileNotFoundError(f"找不到 template seed: {cfg.template_seed_path}")
    if not cfg.rule_seed_path.exists():
        raise FileNotFoundError(f"找不到 rule seed: {cfg.rule_seed_path}")

    conn = _connect(cfg.db_path)
    try:
        # 僅做 schema + registry seed + health check，不執行業務資料 seed/搬運。
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL)"
        )
        apply_migration(conn, migration_path, cfg.target_version)
        tpl_count = seed_template_registry(conn, cfg.template_seed_path)
        rule_count = seed_rule_versions(conn, cfg.rule_seed_path)
        binding_count = seed_rule_bindings(conn)
        run_health_check(conn, cfg.target_version, require_binding=False)
        gate_status = "skipped"
        gate_reason = ""
        if cfg.feature_flags.get("strict_acceptance_gate", False):
            missing_bindings = _collect_missing_bindings(conn)
            if missing_bindings:
                gate_status = "fail"
                gate_reason = "RULE_BINDING_INCOMPLETE"
                raise AcceptanceGateError(gate_reason, {"missing_bindings": missing_bindings})
            gate_status = "ok"
        try:
            audit_logged = append_audit_event(
                conn,
                event_type="bootstrap_init",
                scope="system",
                status="ok",
                payload={
                    "target_version": cfg.target_version,
                    "db_path": str(cfg.db_path),
                    "template_seed_count": tpl_count,
                    "rule_seed_count": rule_count,
                    "rule_binding_count": binding_count,
                },
            )
        except Exception:
            audit_logged = False
        conn.commit()
    finally:
        conn.close()

    return {
        "db_path": str(cfg.db_path),
        "artifact_root": str(cfg.artifact_root),
        "data_seed_root": str(cfg.data_seed_root),
        "runtime_env": cfg.runtime_env,
        "manifest": cfg.manifest_rel,
        "target_version": cfg.target_version,
        "template_seed_count": tpl_count,
        "rule_seed_count": rule_count,
        "rule_binding_count": binding_count,
        "feature_flags": dict(cfg.feature_flags),
        "acceptance_gate": {
            "enabled": bool(cfg.feature_flags.get("strict_acceptance_gate", False)),
            "status": gate_status,
            "reason_code": gate_reason,
        },
        "audit_log_status": "ok" if audit_logged else "soft_failed",
        "status": "ok",
    }


def bootstrap_health(root: Path, manifest_rel: str | None = None, runtime_env: str | None = None) -> dict:
    resolved_manifest_rel = resolve_manifest_rel(manifest_rel, runtime_env)
    manifest_path = (root / resolved_manifest_rel).resolve()
    if not manifest_path.exists():
        return {
            "status": "fail",
            "reason_code": "MANIFEST_NOT_FOUND",
            "checks": {
                "manifest_path": str(manifest_path),
                "manifest_exists": False,
            },
        }
    try:
        cfg = build_config(root, resolved_manifest_rel, runtime_env)
    except json.JSONDecodeError as exc:
        return {
            "status": "fail",
            "reason_code": "MANIFEST_JSON_INVALID",
            "reason": str(exc),
            "checks": {
                "manifest_path": str(manifest_path),
                "manifest_exists": True,
            },
        }
    except ValueError as exc:
        return {
            "status": "fail",
            "reason_code": "MANIFEST_NOT_OBJECT",
            "reason": str(exc),
            "checks": {
                "manifest_path": str(manifest_path),
                "manifest_exists": True,
            },
        }
    migration_path = cfg.root / "migrations" / f"{cfg.target_version}_initial.sql"
    if not migration_path.exists():
        migration_path = cfg.root / "migrations" / f"{cfg.target_version}.sql"

    checks: dict[str, object] = {
        "manifest_path": str(cfg.manifest_path),
        "manifest": cfg.manifest_rel,
        "runtime_env": cfg.runtime_env,
        "db_path": str(cfg.db_path),
        "artifact_root": str(cfg.artifact_root),
        "data_seed_root": str(cfg.data_seed_root),
        "target_version": cfg.target_version,
        "migration_path": str(migration_path),
        "template_seed_path": str(cfg.template_seed_path),
        "rule_seed_path": str(cfg.rule_seed_path),
        "manifest_exists": cfg.manifest_path.exists(),
        "db_exists": cfg.db_path.exists(),
        "migration_exists": migration_path.exists(),
        "template_seed_exists": cfg.template_seed_path.exists(),
        "rule_seed_exists": cfg.rule_seed_path.exists(),
        "feature_flags": dict(cfg.feature_flags),
    }

    if not cfg.manifest_path.exists():
        return {"status": "fail", "reason_code": "MANIFEST_NOT_FOUND", "checks": checks}
    if not migration_path.exists():
        return {"status": "fail", "reason_code": "MIGRATION_NOT_FOUND", "checks": checks}
    if not cfg.template_seed_path.exists():
        return {"status": "fail", "reason_code": "TEMPLATE_SEED_NOT_FOUND", "checks": checks}
    if not cfg.rule_seed_path.exists():
        return {"status": "fail", "reason_code": "RULE_SEED_NOT_FOUND", "checks": checks}
    if not cfg.db_path.exists():
        return {"status": "fail", "reason_code": "DB_NOT_FOUND", "checks": checks}

    conn = _connect(cfg.db_path)
    try:
        run_health_check(conn, cfg.target_version)
        missing_bindings = _collect_missing_bindings(conn)
        strict_gate = bool(cfg.feature_flags.get("strict_acceptance_gate", False))
        checks["acceptance_gate"] = {
            "enabled": strict_gate,
            "status": "ok" if not missing_bindings else ("fail" if strict_gate else "warning"),
            "reason_code": "RULE_BINDING_INCOMPLETE" if missing_bindings else "",
        }
        if missing_bindings:
            checks["missing_bindings"] = missing_bindings
            if strict_gate:
                return {"status": "fail", "reason_code": "RULE_BINDING_INCOMPLETE", "checks": checks}
    except Exception as exc:
        return {"status": "fail", "reason_code": "HEALTH_CHECK_EXCEPTION", "reason": str(exc), "checks": checks}
    finally:
        conn.close()
    return {"status": "ok", "checks": checks}
