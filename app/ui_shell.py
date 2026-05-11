from __future__ import annotations

import argparse
import json
import mimetypes
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from domain.services import (
    CanonicalService,
    _resolve_year_month,
)
from infra.sqlite.bootstrap import (
    AcceptanceGateError,
    bootstrap_health,
    bootstrap_init,
    build_config,
    ensure_acceptance_gate,
    get_feature_flags,
)
from infra.sqlite.repository import SQLiteRepository

FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"


@dataclass(frozen=True)
class UiContext:
    root: Path
    manifest_rel: str
    workflow: str
    template_version: str
    rule_version: str
    artifact_root: Path


def _read_recent_rows(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    cur = conn.execute(sql, params)
    cols = [str(c[0]) for c in cur.description]
    out: list[dict[str, Any]] = []
    for row in cur.fetchall():
        out.append({cols[idx]: row[idx] for idx in range(len(cols))})
    return out


def _build_service(root: Path, manifest_rel: str) -> CanonicalService:
    ensure_acceptance_gate(root, manifest_rel)
    cfg = build_config(root, manifest_rel)
    feature_flags = get_feature_flags(root, manifest_rel)
    repo = SQLiteRepository(cfg.db_path, project_root=root)
    return CanonicalService(repo, feature_flags=feature_flags)


def collect_runtime_status(ctx: UiContext) -> dict[str, Any]:
    health = bootstrap_health(ctx.root, ctx.manifest_rel)
    summary: dict[str, Any] = {
        "root": str(ctx.root),
        "manifest": ctx.manifest_rel,
        "canonical_source": "sqlite",
        "workflow": ctx.workflow,
        "template_version": ctx.template_version,
        "rule_version": ctx.rule_version,
        "artifact_root": str(ctx.artifact_root),
        "health": health,
        "recent": {
            "run_log": [],
            "audit_log": [],
            "publish_runs": [],
            "evidence_index": [],
        },
        "tab4_delivery": {
            "ready": False,
            "reason": "pending_delivery",
            "updated_at": "",
            "last_delivery_run_id": "",
            "last_change_run_id": "",
            "delivery_snapshot_token": "",
            "delivery_row_count": 0,
            "delivery_source_db_hash": "",
            "delivery_template_version": "",
            "delivery_rule_version": "",
        },
    }

    checks = health.get("checks") if isinstance(health, dict) else None
    db_path_text = ""
    if isinstance(checks, dict):
        db_path_text = str(checks.get("db_path") or "")
    if not db_path_text:
        return summary

    db_path = Path(db_path_text)
    if not db_path.exists():
        return summary

    repo = SQLiteRepository(db_path, project_root=ctx.root)
    conn = sqlite3.connect(str(db_path))
    try:
        summary["recent"]["run_log"] = _read_recent_rows(
            conn,
            """
            SELECT run_id, run_type, workflow, status, created_at
            FROM run_log
            ORDER BY created_at DESC
            LIMIT 8
            """,
        )
        summary["recent"]["audit_log"] = _read_recent_rows(
            conn,
            """
            SELECT event_type, scope, status, created_at
            FROM audit_log
            ORDER BY id DESC
            LIMIT 8
            """,
        )
        summary["recent"]["publish_runs"] = _read_recent_rows(
            conn,
            """
            SELECT run_id, template_id, template_version, output_path, status, created_at
            FROM publish_runs
            ORDER BY id DESC
            LIMIT 8
            """,
        )
        summary["recent"]["evidence_index"] = _read_recent_rows(
            conn,
            """
            SELECT run_id, scope, path, status, created_at
            FROM evidence_index
            ORDER BY id DESC
            LIMIT 8
            """,
        )
        if ctx.workflow == "dsp":
            # 讓前端可從 status 直接判斷 Tab4 是否已完成交付。
            summary["tab4_delivery"] = repo.get_tab4_delivery_state(conn, ctx.workflow)
    finally:
        conn.close()
    return summary


def collect_workflow_frame(ctx: UiContext) -> dict[str, Any]:
    health = bootstrap_health(ctx.root, ctx.manifest_rel)
    summary: dict[str, Any] = {
        "root": str(ctx.root),
        "manifest": ctx.manifest_rel,
        "canonical_source": "sqlite",
        "workflow": ctx.workflow,
        "template_version": ctx.template_version,
        "rule_version": ctx.rule_version,
        "artifact_root": str(ctx.artifact_root),
        "health": health,
        "columns": [],
        "rows": [],
        "row_count": 0,
        "pivot_preview": [],
        "tab4_preview_contract": {
            "kind": "template_preview",
            "note": "template layout rendered from canonical rows",
        },
    }

    checks = health.get("checks") if isinstance(health, dict) else None
    db_path_text = ""
    if isinstance(checks, dict):
        db_path_text = str(checks.get("db_path") or "")
    if not db_path_text:
        return summary

    db_path = Path(db_path_text)
    if not db_path.exists():
        return summary

    try:
        repo = SQLiteRepository(db_path, project_root=ctx.root)
        if ctx.workflow == "ssp":
            rows = repo.read_ssp_raw_rows()
            columns = ["row_order", *repo.workflow_columns(ctx.workflow), "updated_at"]
        else:
            rows = repo.read_canonical_rows(ctx.workflow)
            columns = ["row_order", *repo.canonical_columns, "updated_at"]
        summary["columns"] = columns
        summary["field_names"] = list(repo.workflow_columns(ctx.workflow)) if ctx.workflow == "ssp" else list(repo.canonical_columns)
        summary["manual_fields"] = [] if ctx.workflow == "ssp" else list(repo.modify_allowed_columns)
        summary["rows"] = rows
        summary["row_count"] = len(rows)
        summary["pivot_preview"] = [
            {"label": "row_count", "value": len(rows)},
            {"label": "workflow", "value": ctx.workflow},
            {"label": "template_version", "value": ctx.template_version},
            {"label": "rule_version", "value": ctx.rule_version},
        ]
        if ctx.workflow == "dsp":
            with repo.connect() as conn:
                # Tab4 解鎖狀態要跟最新 run_log 同步，供前端鎖定/解鎖顯示。
                tab4_delivery_state = repo.get_tab4_delivery_state(conn, ctx.workflow)
                summary["tab4_delivery"] = tab4_delivery_state
                summary["tab4_delivery_snapshot"] = {
                    "delivery_snapshot_token": str(tab4_delivery_state.get("delivery_snapshot_token") or ""),
                    "delivery_run_id": str(tab4_delivery_state.get("last_delivery_run_id") or ""),
                    "delivery_row_count": int(tab4_delivery_state.get("delivery_row_count") or 0),
                    "delivery_ready": bool(tab4_delivery_state.get("ready")),
                    "delivery_reason": str(tab4_delivery_state.get("reason") or ""),
                }
            service = CanonicalService(repo, feature_flags=get_feature_flags(ctx.root, ctx.manifest_rel))
            canonical_rows = repo.read_canonical_rows(ctx.workflow)
            fallback_year = max(
                (resolved[0] for row in canonical_rows if (resolved := _resolve_year_month(row)) is not None),
                default=date.today().year,
            )
            template_summary, template_detail = service.build_dsp_tab4_preview_payload(
                rows=canonical_rows,
                fallback_year=fallback_year,
            )
            summary["tab4_preview_template_summary"] = template_summary
            summary["tab4_preview_template_detail"] = template_detail
    except Exception as exc:
        summary["frame_error"] = str(exc)
    return summary


def dispatch_action(ctx: UiContext, payload: dict[str, Any]) -> dict[str, Any]:
    action = str(payload.get("action") or "").strip()
    if not action:
        raise ValueError("action required")

    workflow = str(payload.get("workflow") or ctx.workflow)
    template_version = str(payload.get("template_version") or ctx.template_version)
    rule_version = str(payload.get("rule_version") or ctx.rule_version)
    main_tab = str(payload.get("main_tab") or "")
    sub_tab = str(payload.get("sub_tab") or "")

    if action == "bootstrap":
        return bootstrap_init(ctx.root, ctx.manifest_rel)
    if action == "health":
        return bootstrap_health(ctx.root, ctx.manifest_rel)

    service = _build_service(ctx.root, ctx.manifest_rel)
    if action == "save":
        rows = payload.get("rows")
        if not isinstance(rows, list):
            raise ValueError("rows must be list")
        request_week_start = payload.get("period_week_start")
        request_week_end = payload.get("period_week_end")
        if not isinstance(request_week_start, str):
            request_week_start = payload.get("week_start")
        if not isinstance(request_week_end, str):
            request_week_end = payload.get("week_end")
        return service.save(
            workflow=workflow,
            rows=rows,
            template_version=template_version,
            rule_version=rule_version,
            week_start=request_week_start.strip() if isinstance(request_week_start, str) and request_week_start.strip() else None,
            week_end=request_week_end.strip() if isinstance(request_week_end, str) and request_week_end.strip() else None,
        )

    if action == "modify":
        updates = payload.get("updates")
        if not isinstance(updates, list):
            raise ValueError("updates must be list")
        return service.modify(
            workflow=workflow,
            updates=updates,
            template_version=template_version,
            rule_version=rule_version,
        )

    if action == "export":
        artifact_root = payload.get("artifact_root")
        resolved_artifact_root = ctx.artifact_root
        if isinstance(artifact_root, str) and artifact_root.strip():
            resolved_artifact_root = (ctx.root / artifact_root).resolve()
        request_week_start = payload.get("period_week_start")
        request_week_end = payload.get("period_week_end")
        if not isinstance(request_week_start, str):
            request_week_start = payload.get("week_start")
        if not isinstance(request_week_end, str):
            request_week_end = payload.get("week_end")
        if workflow == "dsp":
            if main_tab != "dsp_tab4":
                raise PermissionError("dsp export must be triggered from dsp_tab4")
            if sub_tab not in {"overview"}:
                raise PermissionError("dsp export sub_tab out of scope")
        return service.export(
            workflow=workflow,
            artifact_root=resolved_artifact_root,
            template_version=template_version,
            rule_version=rule_version,
            main_tab=main_tab or None,
            sub_tab=sub_tab or None,
            week_start=request_week_start.strip() if isinstance(request_week_start, str) and request_week_start.strip() else None,
            week_end=request_week_end.strip() if isinstance(request_week_end, str) and request_week_end.strip() else None,
        )

    if action == "tab4_delivery":
        return service.mark_tab4_delivery(
            workflow=workflow,
            main_tab=main_tab,
            sub_tab=sub_tab,
            template_version=template_version,
            rule_version=rule_version,
        )

    raise ValueError(f"unsupported action: {action}")


def _resolve_frontend_asset(path: str) -> Path | None:
    # 只允許 frontend/dist 內檔案，避免 path traversal。
    relative = "index.html" if path == "/" else path.lstrip("/")
    candidate = (FRONTEND_DIST_DIR / relative).resolve()
    if not str(candidate).startswith(str(FRONTEND_DIST_DIR.resolve())):
        return None
    if not candidate.exists() or not candidate.is_file():
        return None
    return candidate


def _frontend_unavailable_page() -> str:
    return """<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MDREP Frontend Unavailable</title>
    <style>
      body { margin: 24px; font-family: "Avenir Next", "Segoe UI", sans-serif; color: #1f2937; }
      code { background: #eef2ff; border-radius: 6px; padding: 2px 6px; }
    </style>
  </head>
  <body>
    <h1>React frontend artifact not found</h1>
    <p>請先在 <code>/Users/matt/MDREPROT2/frontend</code> 執行 <code>pnpm build</code>，再由本 UI shell 提供靜態前端入口。</p>
    <p>backend runtime API 仍可用：<code>/api/status</code>、<code>/api/frame</code>、<code>/api/action</code></p>
  </body>
</html>
"""


class UiRequestHandler(BaseHTTPRequestHandler):
    server_version = "MDREPUIShell/0.1"

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html_response(self, html: str, *, status: int = HTTPStatus.OK) -> None:
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file_response(self, path: Path, *, as_attachment: bool = False) -> None:
        body = path.read_bytes()
        content_type, _ = mimetypes.guess_type(str(path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        if as_attachment:
            safe_name = path.name.replace("\"", "")
            ascii_name = safe_name.encode("ascii", "ignore").decode("ascii") or "export.xlsx"
            self.send_header(
                "Content-Disposition",
                f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe_name)}",
            )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _resolve_download_artifact(self, *, ctx: UiContext, artifact_path_raw: str) -> Path:
        candidate = Path(artifact_path_raw)
        resolved = (ctx.root / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
        artifact_root_resolved = ctx.artifact_root.resolve()
        try:
            resolved.relative_to(artifact_root_resolved)
        except ValueError as exc:
            raise PermissionError("artifact_path out of artifact_root scope") from exc
        if not resolved.exists() or not resolved.is_file():
            raise FileNotFoundError(f"artifact not found: {resolved}")
        if resolved.suffix.lower() != ".xlsx":
            raise ValueError("download only supports .xlsx artifact")
        return resolved

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/export/download"):
            params = parse_qs(parsed.query)
            try:
                root = Path(str(params.get("root", ["."])[0])).resolve()
                artifact_root_rel = str(params.get("artifact_root", ["artifacts"])[0])
                ctx = UiContext(
                    root=root,
                    manifest_rel=str(params.get("manifest", ["bootstrap.manifest.json"])[0]),
                    workflow=str(params.get("workflow", ["dsp"])[0]),
                    template_version=str(params.get("template_version", ["v1"])[0]),
                    rule_version=str(params.get("rule_version", ["v1"])[0]),
                    artifact_root=(root / artifact_root_rel).resolve(),
                )
                artifact_path_raw = str(params.get("artifact_path", [""])[0]).strip()
                if not artifact_path_raw:
                    raise ValueError("artifact_path required")
                artifact_path = self._resolve_download_artifact(ctx=ctx, artifact_path_raw=artifact_path_raw)
                self._file_response(artifact_path, as_attachment=True)
            except Exception as exc:
                self._json(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "status": "error",
                        "error_code": "DOWNLOAD_FAILED",
                        "message": str(exc),
                    },
                )
            return
        if path.startswith("/api/status"):
            params = parse_qs(parsed.query)
            ctx = UiContext(
                root=Path(str(params.get("root", ["."])[0])).resolve(),
                manifest_rel=str(params.get("manifest", ["bootstrap.manifest.json"])[0]),
                workflow=str(params.get("workflow", ["dsp"])[0]),
                template_version=str(params.get("template_version", ["v1"])[0]),
                rule_version=str(params.get("rule_version", ["v1"])[0]),
                artifact_root=(Path(str(params.get("root", ["."])[0])).resolve() / str(params.get("artifact_root", ["artifacts"])[0])).resolve(),
            )
            payload = collect_runtime_status(ctx)
            self._json(HTTPStatus.OK, {"status": "ok", "result": payload})
            return
        if path.startswith("/api/frame"):
            params = parse_qs(parsed.query)
            ctx = UiContext(
                root=Path(str(params.get("root", ["."])[0])).resolve(),
                manifest_rel=str(params.get("manifest", ["bootstrap.manifest.json"])[0]),
                workflow=str(params.get("workflow", ["dsp"])[0]),
                template_version=str(params.get("template_version", ["v1"])[0]),
                rule_version=str(params.get("rule_version", ["v1"])[0]),
                artifact_root=(Path(str(params.get("root", ["."])[0])).resolve() / str(params.get("artifact_root", ["artifacts"])[0])).resolve(),
            )
            payload = collect_workflow_frame(ctx)
            self._json(HTTPStatus.OK, {"status": "ok", "result": payload})
            return
        if path.startswith("/api/"):
            self._json(HTTPStatus.NOT_FOUND, {"status": "error", "error": "NOT_FOUND"})
            return

        asset = _resolve_frontend_asset(path)
        if asset is not None:
            self._file_response(asset)
            return
        if path == "/":
            self._html_response(_frontend_unavailable_page(), status=HTTPStatus.SERVICE_UNAVAILABLE)
            return
        self._json(HTTPStatus.NOT_FOUND, {"status": "error", "error": "NOT_FOUND"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/action":
            self._json(HTTPStatus.NOT_FOUND, {"status": "error", "error": "NOT_FOUND"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("payload must be object")
            root = Path(str(payload.get("root") or ".")).resolve()
            manifest_rel = str(payload.get("manifest") or "bootstrap.manifest.json")
            artifact_root = (root / str(payload.get("artifact_root") or "artifacts")).resolve()
            ctx = UiContext(
                root=root,
                manifest_rel=manifest_rel,
                workflow=str(payload.get("workflow") or "dsp"),
                template_version=str(payload.get("template_version") or "v1"),
                rule_version=str(payload.get("rule_version") or "v1"),
                artifact_root=artifact_root,
            )
            result = dispatch_action(ctx, payload)
            self._json(HTTPStatus.OK, {"status": "ok", "result": result})
        except AcceptanceGateError as exc:
            self._json(
                HTTPStatus.BAD_REQUEST,
                {
                    "status": "error",
                    "error_code": "STRICT_ACCEPTANCE_GATE_FAILED",
                    "message": str(exc),
                    "details": {"reason_code": exc.reason_code, "checks": exc.checks},
                },
            )
        except Exception as exc:
            self._json(
                HTTPStatus.BAD_REQUEST,
                {
                    "status": "error",
                    "error_code": "UI_ACTION_FAILED",
                    "message": str(exc),
                },
            )


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MDREP runtime UI shell")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8510, type=int)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    server = ThreadingHTTPServer((args.host, args.port), UiRequestHandler)
    print(f"MDREP UI shell running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
