from __future__ import annotations

import os
import hashlib
import re
from datetime import date, timedelta
from dataclasses import replace
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter

from infra.sqlite.repository import SQLiteRepository

DSP_TEMPLATE_SHEET_NAMES = [
    "2025年_MF_合作績效統計總表",
    "2025_外部+行政_合作績效統計總表 ",
    "mF投資量_總表",
    "各經銷商明細",
    "北流進單追蹤",
]

MONTH_AMOUNT_COL_START = 5  # E
MONTH_COUNT = 12
DETAIL_YEAR_ROWS = (5, 24, 44, 63, 82)
DETAIL_INPUT_ROWS = (
    7, 8, 9, 10, 11, 12, 13,
    26, 27, 28, 29, 30, 31, 32,
    46, 47, 48, 49, 50, 51, 52,
    65, 66, 67, 68, 69, 70, 71,
    84, 85, 86, 87, 88, 89, 90,
)
DATE_PREFIX_RE = re.compile(r"^(\d{4})[-/](\d{1,2})")


def _pick_category(row: dict, keys: list[str]) -> str:
    for key in keys:
        text = str(row.get(key) or "").strip()
        if text:
            return text
    return ""


def _resolve_year_month(row: dict) -> tuple[int, int] | None:
    raw = str(row.get("日期時間") or "").strip()
    matched = DATE_PREFIX_RE.match(raw)
    if not matched:
        return None
    year = int(matched.group(1))
    month = int(matched.group(2))
    if month < 1 or month > 12:
        return None
    return year, month - 1


def _to_number(value: object) -> float:
    if isinstance(value, (int, float)):
        out = float(value)
        return out if out == out and out not in (float("inf"), float("-inf")) else 0.0
    raw = str(value or "").strip()
    if not raw:
        return 0.0
    negative_by_paren = raw.startswith("(") and raw.endswith(")")
    normalized = raw.replace(",", "").replace("$", "").replace("%", "").replace(" ", "").replace("(", "").replace(")", "")
    try:
        out = float(normalized)
    except Exception:
        return 0.0
    if negative_by_paren:
        return -abs(out)
    return out


def _is_formula(value: object) -> bool:
    return isinstance(value, str) and value.startswith("=")


def _same_cell_value(left: object, right: object, *, tol: float = 1e-6) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        lf = float(left)
        rf = float(right)
        scale = max(1.0, abs(lf), abs(rf))
        return abs(lf - rf) <= tol * scale
    return left == right


class CanonicalService:
    def __init__(self, repo: SQLiteRepository, *, feature_flags: dict[str, bool] | None = None) -> None:
        self.repo = repo
        self._field_contract = repo.field_contract
        self._feature_flags = feature_flags or {}

    def _trace_marker(self, *, workflow: str, run_type: str, run_id: str) -> str:
        if not self._feature_flags.get("enable_trace_markers", False):
            return ""
        return f"{workflow}:{run_type}:{run_id}"

    def _extra_debug_payload(self) -> dict[str, object]:
        if not self._feature_flags.get("enable_test_hooks", False):
            return {}
        return {"test_hooks_enabled": True}

    def _resolve_export_period(self, *, week_start: str | None, week_end: str | None) -> tuple[str, str]:
        has_start = bool(week_start)
        has_end = bool(week_end)
        if has_start != has_end:
            raise ValueError("week_start and week_end must be provided together")
        if not has_start and not has_end:
            today = date.today()
            this_week_start = today - timedelta(days=today.weekday())
            previous_week_start = this_week_start - timedelta(days=7)
            previous_week_end = this_week_start - timedelta(days=1)
            return previous_week_start.isoformat(), previous_week_end.isoformat()
        assert week_start is not None
        assert week_end is not None
        try:
            week_start_date = date.fromisoformat(week_start)
            week_end_date = date.fromisoformat(week_end)
        except ValueError as exc:
            raise ValueError("week_start and week_end must be YYYY-MM-DD") from exc
        if week_start_date > week_end_date:
            raise ValueError("week_start must be <= week_end")
        return week_start_date.isoformat(), week_end_date.isoformat()

    def _resolve_dsp_export_template_path(self) -> Path:
        candidates: list[Path] = []
        env_path = os.getenv("MDREP_DSP_TAB4_TEMPLATE_PATH", "").strip()
        if env_path:
            candidates.append(Path(env_path).expanduser())
        if self.repo.project_root is not None:
            candidates.append(self.repo.project_root / "templates" / "dsp_tab4_template.xlsx")
            candidates.append(self.repo.project_root / "templates" / "2026 DSP投資量報表_0101-0503.xlsx")
        candidates.append(Path("/Users/matt/Downloads/2026 DSP投資量報表_0101-0503.xlsx"))

        for candidate in candidates:
            resolved = candidate.resolve()
            if not (resolved.exists() and resolved.is_file()):
                continue
            try:
                wb = load_workbook(resolved, read_only=True, data_only=True)
                try:
                    if all(sheet_name in wb.sheetnames for sheet_name in DSP_TEMPLATE_SHEET_NAMES):
                        return resolved
                finally:
                    wb.close()
            except Exception:
                continue

        expected = "\n".join(f"- {c}" for c in candidates)
        raise FileNotFoundError(
            "找不到 DSP Tab4 匯出模板，請提供模板檔。\n"
            "可用方式：\n"
            "1) 設定 MDREP_DSP_TAB4_TEMPLATE_PATH\n"
            "2) 放在 <project_root>/templates/dsp_tab4_template.xlsx\n"
            "3) 放在 /Users/matt/Downloads/2026 DSP投資量報表_0101-0503.xlsx\n"
            f"已檢查路徑：\n{expected}"
        )

    def _build_dsp_export_filename(self, week_start: str, week_end: str) -> str:
        start = date.fromisoformat(week_start)
        end = date.fromisoformat(week_end)
        return f"{end.year} DSP投資量報表_{start:%m%d}-{end:%m%d}.xlsx"

    def _hydrate_dsp_template_workbook(
        self,
        *,
        template_path: Path,
        artifact_path: Path,
        rows: list[dict],
        week_start: str,
        week_end: str,
    ) -> None:
        wb = load_workbook(template_path)
        try:
            if wb.sheetnames != DSP_TEMPLATE_SHEET_NAMES:
                raise ValueError(
                    "DSP template 工作表結構不符，預期順序: "
                    + ", ".join(repr(name) for name in DSP_TEMPLATE_SHEET_NAMES)
                )

            ws_summary = wb["mF投資量_總表"]
            ws_detail = wb["各經銷商明細"]
            ws_tracking = wb["北流進單追蹤"]

            week_end_date = date.fromisoformat(week_end)
            for row_idx in DETAIL_YEAR_ROWS:
                ws_detail[f"A{row_idx}"] = week_end_date.year
            ws_tracking["A1"] = f"{week_end_date.year}年{week_end_date.month}月份_北流進單狀態"

            summary_year, detail_monthly_amounts = self._build_detail_matrix_values(
                rows=rows,
                fallback_year=week_end_date.year,
            )
            self._write_template_input_cells(
                ws_summary=ws_summary,
                ws_detail=ws_detail,
                year=summary_year,
                detail_monthly_amounts=detail_monthly_amounts,
            )

            wb.save(artifact_path)
        finally:
            wb.close()
        self._assert_dsp_export_matches_template(
            template_path=template_path,
            artifact_path=artifact_path,
        )

    def _dsp_template_mutable_cells(self) -> dict[str, set[str]]:
        mutable: dict[str, set[str]] = {
            "mF投資量_總表": {"A1"},
            "各經銷商明細": {f"A{row_idx}" for row_idx in DETAIL_YEAR_ROWS},
            "北流進單追蹤": {"A1"},
        }
        month_amount_cols = [MONTH_AMOUNT_COL_START + (idx * 2) for idx in range(MONTH_COUNT)]
        detail_cells = mutable["各經銷商明細"]
        for row_idx in DETAIL_INPUT_ROWS:
            for col_idx in month_amount_cols:
                detail_cells.add(f"{get_column_letter(col_idx)}{row_idx}")
        return mutable

    def _assert_dsp_export_matches_template(self, *, template_path: Path, artifact_path: Path) -> None:
        template_wb = load_workbook(template_path, data_only=False)
        export_wb = load_workbook(artifact_path, data_only=False)
        try:
            if template_wb.sheetnames != export_wb.sheetnames:
                raise ValueError("DSP export workbook sheetnames mismatch template")
            mutable_cells_by_sheet = self._dsp_template_mutable_cells()
            for sheet_name in template_wb.sheetnames:
                template_ws = template_wb[sheet_name]
                export_ws = export_wb[sheet_name]
                self._assert_dsp_sheet_layout_matches_template(
                    sheet_name=sheet_name,
                    template_ws=template_ws,
                    export_ws=export_ws,
                )
                self._assert_dsp_sheet_cells_match_template(
                    sheet_name=sheet_name,
                    template_ws=template_ws,
                    export_ws=export_ws,
                    mutable_cells=mutable_cells_by_sheet.get(sheet_name, set()),
                )
        finally:
            export_wb.close()
            template_wb.close()

    def _assert_dsp_sheet_layout_matches_template(self, *, sheet_name: str, template_ws, export_ws) -> None:
        if str(template_ws.sheet_state) != str(export_ws.sheet_state):
            raise ValueError(f"DSP export sheet_state mismatch: {sheet_name}")
        if str(template_ws.freeze_panes or "") != str(export_ws.freeze_panes or ""):
            raise ValueError(f"DSP export freeze_panes mismatch: {sheet_name}")
        template_merged = sorted(str(item) for item in template_ws.merged_cells.ranges)
        export_merged = sorted(str(item) for item in export_ws.merged_cells.ranges)
        if template_merged != export_merged:
            raise ValueError(f"DSP export merged ranges mismatch: {sheet_name}")
        if repr(template_ws.sheet_properties.tabColor) != repr(export_ws.sheet_properties.tabColor):
            raise ValueError(f"DSP export tab color mismatch: {sheet_name}")

        template_hidden_rows = sorted(idx for idx, dim in template_ws.row_dimensions.items() if bool(getattr(dim, "hidden", False)))
        export_hidden_rows = sorted(idx for idx, dim in export_ws.row_dimensions.items() if bool(getattr(dim, "hidden", False)))
        if template_hidden_rows != export_hidden_rows:
            raise ValueError(f"DSP export hidden rows mismatch: {sheet_name}")

        template_hidden_cols = sorted(name for name, dim in template_ws.column_dimensions.items() if bool(getattr(dim, "hidden", False)))
        export_hidden_cols = sorted(name for name, dim in export_ws.column_dimensions.items() if bool(getattr(dim, "hidden", False)))
        if template_hidden_cols != export_hidden_cols:
            raise ValueError(f"DSP export hidden columns mismatch: {sheet_name}")

        template_col_widths = {
            name: float(dim.width)
            for name, dim in template_ws.column_dimensions.items()
            if dim.width is not None
        }
        export_col_widths = {
            name: float(dim.width)
            for name, dim in export_ws.column_dimensions.items()
            if dim.width is not None
        }
        if template_col_widths != export_col_widths:
            raise ValueError(f"DSP export column widths mismatch: {sheet_name}")

    def _assert_dsp_sheet_cells_match_template(
        self,
        *,
        sheet_name: str,
        template_ws,
        export_ws,
        mutable_cells: set[str],
    ) -> None:
        template_cells = getattr(template_ws, "_cells", {})
        export_cells = getattr(export_ws, "_cells", {})
        all_coords = sorted(set(template_cells.keys()) | set(export_cells.keys()))
        for coord in all_coords:
            template_cell = template_ws.cell(row=coord[0], column=coord[1])
            export_cell = export_ws.cell(row=coord[0], column=coord[1])
            coordinate = template_cell.coordinate

            if (
                repr(template_cell.font) != repr(export_cell.font)
                or repr(template_cell.fill) != repr(export_cell.fill)
                or repr(template_cell.border) != repr(export_cell.border)
                or repr(template_cell.alignment) != repr(export_cell.alignment)
                or repr(template_cell.protection) != repr(export_cell.protection)
            ):
                raise ValueError(f"DSP export style mismatch: {sheet_name}!{coordinate}")
            if str(template_cell.number_format or "") != str(export_cell.number_format or ""):
                raise ValueError(f"DSP export number format mismatch: {sheet_name}!{coordinate}")

            template_formula = _is_formula(template_cell.value)
            export_formula = _is_formula(export_cell.value)
            if template_formula != export_formula:
                raise ValueError(f"DSP export formula marker mismatch: {sheet_name}!{coordinate}")
            if template_formula and str(template_cell.value) != str(export_cell.value):
                raise ValueError(f"DSP export formula text mismatch: {sheet_name}!{coordinate}")

            if coordinate in mutable_cells:
                continue
            if not _same_cell_value(template_cell.value, export_cell.value):
                raise ValueError(f"DSP export static cell mismatch: {sheet_name}!{coordinate}")

    def _build_detail_matrix_values(
        self,
        *,
        rows: list[dict],
        fallback_year: int,
    ) -> tuple[int, dict[int, list[float]]]:
        years: list[int] = []
        detail_monthly_amounts: dict[int, list[float]] = {
            row_idx: [0.0 for _ in range(MONTH_COUNT)]
            for row_idx in DETAIL_INPUT_ROWS
        }

        for row in rows:
            resolved = _resolve_year_month(row)
            if resolved is None:
                continue
            year, month_idx = resolved
            years.append(year)
            amount = _to_number(row.get("執行金額"))
            target_row = self._detail_input_row(row)
            detail_monthly_amounts[target_row][month_idx] += amount

        summary_year = max(years) if years else fallback_year
        return summary_year, detail_monthly_amounts

    def _detail_input_row(self, row: dict) -> int:
        block_base = self._detail_block_base_row(row)
        offset = self._detail_metric_offset(row)
        return block_base + offset

    def _detail_block_base_row(self, row: dict) -> int:
        b = _pick_category(row, ["分類層級B", "最終經銷商", "經銷商"])
        c = _pick_category(row, ["分類層級C", "最終廣告形式", "廣告形式"])
        distributor = _pick_category(row, ["最終經銷商", "經銷商", "原始經銷商"])
        haystack = f"{b} {c} {distributor}"

        if b == "內經銷商" and c == "策略部":
            return 26
        if b == "外經銷商" and c == "經銷推廣":
            return 46
        if b == "外經銷商" and c == "IO委刊":
            return 65
        if b == "HB串接":
            return 84
        if "策略" in haystack:
            return 26
        if "IO委刊" in haystack or "MOMO" in haystack.upper() or "DOOH委刊" in haystack:
            return 65
        if "外部" in haystack or "經銷推廣" in haystack:
            return 46
        if "HB" in haystack.upper() or "串接" in haystack:
            return 84
        return 7

    def _detail_metric_offset(self, row: dict) -> int:
        b = _pick_category(row, ["分類層級B", "最終廣告形式", "廣告形式"])
        c = _pick_category(row, ["分類層級C", "最終廣告形式", "廣告形式"])
        d = _pick_category(row, ["分類層級D", "素材樣板", "素材", "訂單"])
        ad_format = _pick_category(row, ["最終廣告形式", "廣告形式", "素材樣板"])
        order = _pick_category(row, ["訂單", "素材"])
        text = f"{b} {c} {d} {ad_format} {order}".lower()

        if "ctv" in text:
            return 6
        if "北流" in text:
            return 5
        if "dooh外部" in text or "presco" in text or "前線媒體" in text:
            return 4
        if "pre roll" in text or "preroll" in text or "instream" in text:
            return 3
        if "影音摩天" in text or "outstream" in text:
            return 2
        if "創意" in text or "蓋板" in text or "置底" in text or "文中" in text:
            return 1
        return 0

    def _write_template_input_cells(
        self,
        *,
        ws_summary,
        ws_detail,
        year: int,
        detail_monthly_amounts: dict[int, list[float]],
    ) -> None:
        ws_summary["A1"] = year
        month_amount_cols = [MONTH_AMOUNT_COL_START + (idx * 2) for idx in range(MONTH_COUNT)]

        for row_idx in DETAIL_INPUT_ROWS:
            monthly_amounts = detail_monthly_amounts.get(row_idx, [0.0 for _ in range(MONTH_COUNT)])
            for month_idx, col in enumerate(month_amount_cols):
                cell = ws_detail.cell(row=row_idx, column=col)
                if not _is_formula(cell.value):
                    cell.value = monthly_amounts[month_idx]

    def save(self, *, workflow: str, rows: list[dict], template_version: str, rule_version: str) -> dict:
        normalized_rows = self._field_contract.validate_and_normalize_save_rows(rows)
        with self.repo.connect() as conn:
            # fail-fast: 先驗證 template/rule binding 合法，再寫 canonical
            self.repo.resolve_trace_binding(conn, workflow, template_version, rule_version)
            written = self.repo.save_canonical_rows(conn, workflow, normalized_rows)
            trace = self.repo.build_trace_meta(conn, workflow, template_version, rule_version)
            run_id = self.repo.insert_run_log(
                conn,
                run_type="save",
                workflow=workflow,
                status="ok",
                trace=trace,
                detail={"row_count": written},
            )
            marker = self._trace_marker(workflow=workflow, run_type="save", run_id=run_id)
            audit_payload = {
                "workflow": workflow,
                "run_id": run_id,
                "template_version": template_version,
                "rule_version": rule_version,
                "canonical_token": trace.canonical_token,
                "row_count": written,
                **self._extra_debug_payload(),
            }
            if marker:
                audit_payload["trace_marker"] = marker
            self.repo.append_audit_event(
                conn,
                event_type="save",
                scope="service",
                status="ok",
                payload=audit_payload,
            )
        out = {"run_id": run_id, "row_count": written}
        if marker:
            out["trace_marker"] = marker
        if self._feature_flags.get("enable_test_hooks", False):
            out["test_hooks_enabled"] = True
        return out

    def modify(self, *, workflow: str, updates: list[dict], template_version: str, rule_version: str) -> dict:
        self._field_contract.validate_modify_updates(updates)
        with self.repo.connect() as conn:
            self.repo.resolve_trace_binding(conn, workflow, template_version, rule_version)
            changed = self.repo.apply_modifications(conn, workflow, updates)
            trace = self.repo.build_trace_meta(conn, workflow, template_version, rule_version)
            run_id = self.repo.insert_run_log(
                conn,
                run_type="modify",
                workflow=workflow,
                status="ok",
                trace=trace,
                detail={"changed_count": changed},
            )
            adjustment_count = self.repo.insert_override_adjustments(
                conn,
                workflow=workflow,
                updates=updates,
                template_version=template_version,
                rule_version=rule_version,
                run_id=run_id,
            )
            marker = self._trace_marker(workflow=workflow, run_type="modify", run_id=run_id)
            audit_payload = {
                "workflow": workflow,
                "run_id": run_id,
                "template_version": template_version,
                "rule_version": rule_version,
                "canonical_token": trace.canonical_token,
                "changed_count": changed,
                "adjustment_count": adjustment_count,
                **self._extra_debug_payload(),
            }
            if marker:
                audit_payload["trace_marker"] = marker
            self.repo.append_audit_event(
                conn,
                event_type="modify",
                scope="service",
                status="ok",
                payload=audit_payload,
            )
        out = {"run_id": run_id, "changed_count": changed, "adjustment_count": adjustment_count}
        if marker:
            out["trace_marker"] = marker
        if self._feature_flags.get("enable_test_hooks", False):
            out["test_hooks_enabled"] = True
        return out

    def mark_tab4_delivery(
        self,
        *,
        workflow: str,
        main_tab: str,
        sub_tab: str,
        template_version: str,
        rule_version: str,
    ) -> dict:
        if workflow != "dsp":
            raise ValueError("tab4_delivery only supports dsp workflow")
        if main_tab != "dsp_tab3" or sub_tab != "pivot":
            raise ValueError("tab4_delivery must be triggered from dsp_tab3/pivot")
        with self.repo.connect() as conn:
            self.repo.resolve_trace_binding(conn, workflow, template_version, rule_version)
            rows = self.repo.read_canonical_rows_in_tx(conn, workflow)
            trace = self.repo.build_trace_meta(conn, workflow, template_version, rule_version)
            run_id = self.repo.insert_run_log(
                conn,
                run_type="tab4_delivery",
                workflow=workflow,
                status="ok",
                trace=trace,
                detail={
                    "source": "pivot_handoff",
                    "main_tab": main_tab,
                    "sub_tab": sub_tab,
                    "row_count": len(rows),
                    "delivery_snapshot_token": trace.canonical_token,
                    "delivery_source_db_hash": trace.source_db_hash,
                },
            )
            self.repo.append_audit_event(
                conn,
                event_type="tab4_delivery",
                scope="service",
                status="ok",
                payload={
                    "workflow": workflow,
                    "run_id": run_id,
                    "template_version": template_version,
                    "rule_version": rule_version,
                    "canonical_token": trace.canonical_token,
                    "row_count": len(rows),
                    "main_tab": main_tab,
                    "sub_tab": sub_tab,
                },
            )
            state = self.repo.get_tab4_delivery_state(conn, workflow)
        out = {
            "run_id": run_id,
            "ready": bool(state.get("ready")),
            "reason": str(state.get("reason") or ""),
            "updated_at": str(state.get("updated_at") or ""),
            "delivery_snapshot_token": str(state.get("delivery_snapshot_token") or ""),
            "delivery_row_count": int(state.get("delivery_row_count") or 0),
        }
        if self._feature_flags.get("enable_test_hooks", False):
            out["test_hooks_enabled"] = True
        return out

    def export(
        self,
        *,
        workflow: str,
        artifact_root: Path,
        template_version: str,
        rule_version: str,
        main_tab: str | None = None,
        sub_tab: str | None = None,
        week_start: str | None = None,
        week_end: str | None = None,
    ) -> dict:
        artifact_root.mkdir(parents=True, exist_ok=True)
        resolved_week_start, resolved_week_end = self._resolve_export_period(
            week_start=week_start,
            week_end=week_end,
        )
        if workflow == "dsp":
            artifact_name = self._build_dsp_export_filename(resolved_week_start, resolved_week_end)
        else:
            artifact_name = f"{workflow}_export.xlsx"
        artifact_path = artifact_root / artifact_name
        with self.repo.connect() as conn:
            self.repo.resolve_trace_binding(conn, workflow, template_version, rule_version)
            delivery_state: dict[str, object] | None = None
            if workflow == "dsp":
                if main_tab != "dsp_tab4":
                    raise PermissionError("dsp export must be triggered from dsp_tab4")
                delivery_state = self.repo.assert_tab4_delivery_ready(conn, workflow)
                if sub_tab not in {"overview"}:
                    raise PermissionError("dsp export sub_tab out of scope")
            rows = self.repo.read_canonical_rows_in_tx(conn, workflow)
            trace = self.repo.build_trace_meta(conn, workflow, template_version, rule_version)
            delivery_snapshot_token = ""
            delivery_run_id = ""
            if delivery_state is not None:
                delivery_snapshot_token = str(delivery_state.get("delivery_snapshot_token") or "")
                delivery_run_id = str(delivery_state.get("last_delivery_run_id") or "")
                if not delivery_snapshot_token:
                    raise PermissionError("tab4 delivery snapshot token missing")
                if delivery_snapshot_token != trace.canonical_token:
                    raise PermissionError("tab4 delivery snapshot mismatch with canonical")
            try:
                if workflow == "dsp":
                    template_path = self._resolve_dsp_export_template_path()
                    self._hydrate_dsp_template_workbook(
                        template_path=template_path,
                        artifact_path=artifact_path,
                        rows=rows,
                        week_start=resolved_week_start,
                        week_end=resolved_week_end,
                    )
                else:
                    wb = Workbook()
                    try:
                        ws_data = wb.active
                        ws_data.title = "canonical_data"
                        data_columns = self.repo.canonical_columns
                        ws_data.append(data_columns)
                        for row in rows:
                            ws_data.append([row.get(col, "") for col in data_columns])

                        ws_meta = wb.create_sheet("metadata")
                        ws_meta.append(["key", "value"])
                        ws_meta.append(["workflow", workflow])
                        ws_meta.append(["template_version", template_version])
                        ws_meta.append(["rule_version", rule_version])
                        ws_meta.append(["source_db_hash", trace.source_db_hash])
                        ws_meta.append(["canonical_token", trace.canonical_token])
                        ws_meta.append(["week_start", resolved_week_start])
                        ws_meta.append(["week_end", resolved_week_end])
                        wb.save(artifact_path)
                    finally:
                        wb.close()
                # 讀回一次，確認檔案可開啟，避免留半壞檔案。
                verify_wb = load_workbook(artifact_path, read_only=True, data_only=True)
                verify_wb.close()
                checksum = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
                trace = replace(trace, artifact_checksum=checksum)
                run_id = self.repo.insert_run_log(
                    conn,
                    run_type="export",
                    workflow=workflow,
                    status="ok",
                    trace=trace,
                    detail={
                        "artifact_path": str(artifact_path),
                        "row_count": len(rows),
                        "week_start": resolved_week_start,
                        "week_end": resolved_week_end,
                        "delivery_snapshot_token": delivery_snapshot_token,
                        "delivery_run_id": delivery_run_id,
                    },
                )
                self.repo.insert_publish_run(
                    conn,
                    run_id,
                    workflow,
                    artifact_path,
                    trace,
                    status="ok",
                    week_start=resolved_week_start,
                    week_end=resolved_week_end,
                )
                self.repo.insert_evidence(conn, run_id, artifact_path, checksum, status="ok")
                marker = self._trace_marker(workflow=workflow, run_type="export", run_id=run_id)
                audit_payload = {
                    "workflow": workflow,
                    "run_id": run_id,
                    "template_version": template_version,
                    "rule_version": rule_version,
                    "canonical_token": trace.canonical_token,
                    "artifact_path": str(artifact_path),
                    "artifact_checksum": checksum,
                    "row_count": len(rows),
                    "week_start": resolved_week_start,
                    "week_end": resolved_week_end,
                    "delivery_snapshot_token": delivery_snapshot_token,
                    "delivery_run_id": delivery_run_id,
                    **self._extra_debug_payload(),
                }
                if marker:
                    audit_payload["trace_marker"] = marker
                self.repo.append_audit_event(
                    conn,
                    event_type="export",
                    scope="service",
                    status="ok",
                    payload=audit_payload,
                )
            except Exception:
                if artifact_path.exists():
                    artifact_path.unlink()
                raise

        out = {
            "run_id": run_id,
            "artifact_path": str(artifact_path),
            "artifact_checksum": checksum,
            "row_count": len(rows),
            "week_start": resolved_week_start,
            "week_end": resolved_week_end,
        }
        if workflow == "dsp":
            out["delivery_snapshot_token"] = delivery_snapshot_token
            out["delivery_run_id"] = delivery_run_id
        if marker:
            out["trace_marker"] = marker
        if self._feature_flags.get("enable_test_hooks", False):
            out["test_hooks_enabled"] = True
        return out
