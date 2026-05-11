from __future__ import annotations

import json
import hashlib
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import parse_qs, urlencode, urlparse
from http.server import ThreadingHTTPServer
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter

import app.ui_shell as ui_shell_module
from app.ui_shell import UiContext, UiRequestHandler, collect_runtime_status, collect_workflow_frame, dispatch_action
from infra.sqlite.bootstrap import AcceptanceGateError


class UiShellTests(unittest.TestCase):
    @staticmethod
    def _same_cell_value(left: object, right: object, *, tol: float = 1e-6) -> bool:
        if isinstance(left, (int, float)) and isinstance(right, (int, float)):
            lf = float(left)
            rf = float(right)
            scale = max(1.0, abs(lf), abs(rf))
            return abs(lf - rf) <= tol * scale
        return left == right

    def _fmt_num(self, value: int | float) -> str:
        return f"{float(value):,.2f}"

    def _full_row(self, **overrides: object) -> dict:
        row = {
            "日期時間": "2026-05-01 00:00:00",
            "經銷商": "A",
            "訂單": "O1",
            "素材": "C1",
            "廣告形式": "Banner",
            "尺寸": "300x250",
            "素材樣板": "tplA",
            "執行金額": 10.0,
            "系統營收": 12.5,
            "媒體費用": 8.0,
            "原始經銷商": "A",
            "原始廣告形式": "Banner",
            "最終經銷商": "A1",
            "規則命中_經銷商": "r1",
            "最終來源_經銷商": "rule",
            "分類層級B": "B1",
            "分類層級C": "C1",
            "分類層級D": "D1",
            "最終廣告形式": "Banner",
            "規則命中_廣告形式": "r2",
            "最終來源_廣告形式": "rule",
        }
        row.update(overrides)
        return row

    def _dsp_mutable_cells(self) -> dict[str, set[str]]:
        mutable: dict[str, set[str]] = {
            "mF投資量_總表": {"A1"},
            "各經銷商明細": {f"A{row_idx}" for row_idx in (5, 24, 44, 63, 82)},
            "北流進單追蹤": {"A1"},
        }
        detail_cells = mutable["各經銷商明細"]
        month_cols = [5 + idx * 2 for idx in range(12)]
        for row_idx in (
            7, 8, 9, 10, 11, 12, 13,
            26, 27, 28, 29, 30, 31, 32,
            46, 47, 48, 49, 50, 51, 52,
            65, 66, 67, 68, 69, 70, 71,
            84, 85, 86, 87, 88, 89, 90,
        ):
            for col_idx in month_cols:
                detail_cells.add(f"{get_column_letter(col_idx)}{row_idx}")
        return mutable

    def _assert_dsp_export_template_parity(self, template_path: Path, export_path: Path) -> None:
        template_wb = load_workbook(template_path, data_only=False)
        export_wb = load_workbook(export_path, data_only=False)
        mutable_cells = self._dsp_mutable_cells()
        try:
            self.assertEqual(template_wb.sheetnames, export_wb.sheetnames)
            for sheet_name in template_wb.sheetnames:
                ws_t = template_wb[sheet_name]
                ws_e = export_wb[sheet_name]
                self.assertEqual(str(ws_t.sheet_state), str(ws_e.sheet_state), sheet_name)
                self.assertEqual(str(ws_t.freeze_panes or ""), str(ws_e.freeze_panes or ""), sheet_name)
                self.assertEqual(
                    sorted(str(item) for item in ws_t.merged_cells.ranges),
                    sorted(str(item) for item in ws_e.merged_cells.ranges),
                    sheet_name,
                )
                self.assertEqual(repr(ws_t.sheet_properties.tabColor), repr(ws_e.sheet_properties.tabColor), sheet_name)
                self.assertEqual(
                    sorted(idx for idx, dim in ws_t.row_dimensions.items() if bool(getattr(dim, "hidden", False))),
                    sorted(idx for idx, dim in ws_e.row_dimensions.items() if bool(getattr(dim, "hidden", False))),
                    sheet_name,
                )
                self.assertEqual(
                    sorted(name for name, dim in ws_t.column_dimensions.items() if bool(getattr(dim, "hidden", False))),
                    sorted(name for name, dim in ws_e.column_dimensions.items() if bool(getattr(dim, "hidden", False))),
                    sheet_name,
                )
                self.assertEqual(
                    {name: float(dim.width) for name, dim in ws_t.column_dimensions.items() if dim.width is not None},
                    {name: float(dim.width) for name, dim in ws_e.column_dimensions.items() if dim.width is not None},
                    sheet_name,
                )

                t_cells = getattr(ws_t, "_cells", {})
                e_cells = getattr(ws_e, "_cells", {})
                for coord in sorted(set(t_cells.keys()) | set(e_cells.keys())):
                    cell_t = ws_t.cell(row=coord[0], column=coord[1])
                    cell_e = ws_e.cell(row=coord[0], column=coord[1])
                    coord_name = cell_t.coordinate
                    self.assertEqual(repr(cell_t.font), repr(cell_e.font), f"{sheet_name}!{coord_name} font")
                    self.assertEqual(repr(cell_t.fill), repr(cell_e.fill), f"{sheet_name}!{coord_name} fill")
                    self.assertEqual(repr(cell_t.border), repr(cell_e.border), f"{sheet_name}!{coord_name} border")
                    self.assertEqual(repr(cell_t.alignment), repr(cell_e.alignment), f"{sheet_name}!{coord_name} alignment")
                    self.assertEqual(repr(cell_t.protection), repr(cell_e.protection), f"{sheet_name}!{coord_name} protection")
                    self.assertEqual(
                        str(cell_t.number_format or ""),
                        str(cell_e.number_format or ""),
                        f"{sheet_name}!{coord_name} number_format",
                    )
                    t_formula = isinstance(cell_t.value, str) and cell_t.value.startswith("=")
                    e_formula = isinstance(cell_e.value, str) and cell_e.value.startswith("=")
                    self.assertEqual(t_formula, e_formula, f"{sheet_name}!{coord_name} formula marker")
                    if t_formula:
                        self.assertEqual(str(cell_t.value), str(cell_e.value), f"{sheet_name}!{coord_name} formula text")
                    if coord_name in mutable_cells.get(sheet_name, set()):
                        continue
                    self.assertTrue(
                        self._same_cell_value(cell_t.value, cell_e.value),
                        f"{sheet_name}!{coord_name} static cell",
                    )
        finally:
            export_wb.close()
            template_wb.close()

    def _make_project(self, root: Path) -> None:
        src = Path(__file__).resolve().parents[1]
        (root / "migrations").mkdir(parents=True, exist_ok=True)
        (root / "templates").mkdir(parents=True, exist_ok=True)
        (root / "contracts").mkdir(parents=True, exist_ok=True)
        (root / "migrations" / "0001_initial.sql").write_text((src / "migrations" / "0001_initial.sql").read_text(encoding="utf-8"), encoding="utf-8")
        (root / "templates" / "template_registry.seed.json").write_text((src / "templates" / "template_registry.seed.json").read_text(encoding="utf-8"), encoding="utf-8")
        (root / "templates" / "ruleset.seed.json").write_text((src / "templates" / "ruleset.seed.json").read_text(encoding="utf-8"), encoding="utf-8")
        self._write_dsp_tab4_template(root / "templates" / "dsp_tab4_template.xlsx")
        (root / "contracts" / "fields_contract.json").write_text((src / "contracts" / "fields_contract.json").read_text(encoding="utf-8"), encoding="utf-8")
        (root / "bootstrap.manifest.json").write_text((src / "bootstrap.manifest.json").read_text(encoding="utf-8"), encoding="utf-8")

    def _write_dsp_tab4_template(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        wb = Workbook()
        try:
            ws_hidden_a = wb.active
            ws_hidden_a.title = "2025年_MF_合作績效統計總表"
            ws_hidden_a.sheet_state = "hidden"
            ws_hidden_a.freeze_panes = "C1"
            ws_hidden_a["A1"] = 2025

            ws_hidden_b = wb.create_sheet("2025_外部+行政_合作績效統計總表 ")
            ws_hidden_b.sheet_state = "hidden"
            ws_hidden_b.freeze_panes = "C1"
            ws_hidden_b["A1"] = "外部經銷商"

            ws_summary = wb.create_sheet("mF投資量_總表")
            ws_summary.freeze_panes = "M1"
            ws_summary.merge_cells("A1:D1")
            ws_summary["A1"] = 2026
            ws_summary["A2"] = "DSP投資額 總計"
            ws_summary["E2"] = "=SUM(E3:E8)"
            ws_summary["F2"] = "=SUM(F3:F8)"
            ws_summary["M2"] = "=SUM(M3:M8)"
            ws_summary["N2"] = "=SUM(N3:N8)"
            ws_summary["AC2"] = "=SUM(AC3:AC8)"
            ws_summary["AD2"] = "=SUM(AD3:AD8)"
            ws_summary["E3"] = "=各經銷商明細!E$6"
            ws_summary["F3"] = "=E3/E$2"
            ws_summary["M3"] = "=各經銷商明細!M$6"
            ws_summary["N3"] = "=M3/M$2"
            ws_summary["AC3"] = "=E3+G3+I3+K3+M3+O3+Q3+S3+U3+W3+Y3+AA3"
            ws_summary["AD3"] = "=AC3/AC$2"
            for idx in range(16, 24):
                ws_summary.row_dimensions[idx].hidden = True

            ws_detail = wb.create_sheet("各經銷商明細")
            ws_detail.freeze_panes = "U1"
            ws_detail.merge_cells("A2:D2")
            ws_detail["A2"] = "全體經銷 總投資量目標 & 達成率 (含北流)"
            ws_detail["A5"] = 2026
            for row_idx in (5, 24, 44, 63, 82):
                ws_detail[f"A{row_idx}"] = 2026
            for row_idx in (6, 25, 45, 64, 83):
                ws_detail[f"E{row_idx}"] = f"=SUM(E{row_idx + 1}:E{row_idx + 7})"
                ws_detail[f"F{row_idx}"] = f"=SUM(F{row_idx + 1}:F{row_idx + 7})"
                ws_detail[f"M{row_idx}"] = f"=SUM(M{row_idx + 1}:M{row_idx + 7})"
                ws_detail[f"N{row_idx}"] = f"=SUM(N{row_idx + 1}:N{row_idx + 7})"
                ws_detail[f"AC{row_idx}"] = f"=SUM(AC{row_idx + 1}:AC{row_idx + 7})"
                ws_detail[f"AD{row_idx}"] = f"=SUM(AD{row_idx + 1}:AD{row_idx + 7})"
            for row_idx in (7, 26, 46, 65, 84):
                ws_detail[f"F{row_idx}"] = f"=E{row_idx}/E$6"
                ws_detail[f"N{row_idx}"] = f"=M{row_idx}/M$6"
                ws_detail[f"AC{row_idx}"] = f"=E{row_idx}+G{row_idx}+I{row_idx}+K{row_idx}+M{row_idx}+O{row_idx}+Q{row_idx}+S{row_idx}+U{row_idx}+W{row_idx}+Y{row_idx}+AA{row_idx}"
                ws_detail[f"AD{row_idx}"] = f"=AC{row_idx}/AC$6"
            ws_detail["AB2"] = "=SUM(AA6,AA25,AA45,AA64)/AA2"
            ws_detail["AB3"] = "=AA6/AA3"

            ws_tracking = wb.create_sheet("北流進單追蹤")
            ws_tracking["A1"] = "2026年5月份_北流進單狀態"
            ws_tracking["K2"] = None
            ws_tracking.column_dimensions["I"].hidden = True
            ws_tracking.column_dimensions["J"].hidden = True

            wb.save(path)
        finally:
            wb.close()

    def _ctx(self, root: Path, workflow: str = "dsp") -> UiContext:
        return UiContext(
            root=root,
            manifest_rel="bootstrap.manifest.json",
            workflow=workflow,
            template_version="v1",
            rule_version="v1",
            artifact_root=(root / "artifacts").resolve(),
        )

    def test_ui_shell_runtime_actions_and_status(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root)

            before = collect_runtime_status(ctx)
            self.assertEqual(before["health"]["status"], "fail")

            boot = dispatch_action(ctx, {"action": "bootstrap"})
            self.assertEqual(boot["status"], "ok")

            health = dispatch_action(ctx, {"action": "health"})
            self.assertEqual(health["status"], "ok")

            save_out = dispatch_action(ctx, {"action": "save", "rows": [self._full_row()]})
            self.assertTrue(str(save_out["run_id"]).startswith("run-"))

            modify_out = dispatch_action(
                ctx,
                {
                    "action": "modify",
                    "updates": [{"row_order": 0, "column": "最終經銷商", "value": "A2"}],
                },
            )
            self.assertEqual(modify_out["changed_count"], 1)
            self.assertEqual(modify_out["adjustment_count"], 1)

            dispatch_action(
                ctx,
                {
                    "action": "tab4_delivery",
                    "main_tab": "dsp_tab3",
                    "sub_tab": "pivot",
                },
            )
            export_out = dispatch_action(
                ctx,
                {
                    "action": "export",
                    "main_tab": "dsp_tab4",
                    "sub_tab": "overview",
                },
            )
            self.assertTrue(Path(str(export_out["artifact_path"])).exists())

            after = collect_runtime_status(ctx)
            self.assertEqual(after["canonical_source"], "sqlite")
            self.assertEqual(after["health"]["status"], "ok")
            self.assertGreaterEqual(len(after["recent"]["run_log"]), 3)
            self.assertGreaterEqual(len(after["recent"]["audit_log"]), 1)

    def test_dsp_export_fills_template_inputs_without_overwriting_formulas(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root)
            dispatch_action(ctx, {"action": "bootstrap"})
            dispatch_action(
                ctx,
                {
                    "action": "save",
                    "rows": [
                        self._full_row(
                            日期時間="2026-05-01 00:00:00",
                            分類層級B="內經銷商",
                            分類層級C="營銷事業處",
                            分類層級D="一般廣告",
                            最終廣告形式="一般廣告",
                            執行金額=123.0,
                        ),
                        self._full_row(
                            日期時間="2026-05-02 00:00:00",
                            分類層級B="內經銷商",
                            分類層級C="策略部",
                            分類層級D="蓋板/置底(展開&不展)/文中",
                            最終廣告形式="創意",
                            執行金額=456.0,
                        ),
                    ],
                },
            )

            dispatch_action(
                ctx,
                {
                    "action": "tab4_delivery",
                    "main_tab": "dsp_tab3",
                    "sub_tab": "pivot",
                },
            )
            export_out = dispatch_action(
                ctx,
                {
                    "action": "export",
                    "main_tab": "dsp_tab4",
                    "sub_tab": "overview",
                },
            )
            export_path = Path(str(export_out["artifact_path"]))
            wb = load_workbook(export_path, data_only=False)
            try:
                ws_summary = wb["mF投資量_總表"]
                ws_detail = wb["各經銷商明細"]
                ws_tracking = wb["北流進單追蹤"]

                self.assertEqual(ws_summary["M2"].value, "=SUM(M3:M8)")
                self.assertEqual(ws_summary["N3"].value, "=M3/M$2")
                self.assertEqual(ws_summary["AC3"].value, "=E3+G3+I3+K3+M3+O3+Q3+S3+U3+W3+Y3+AA3")
                self.assertEqual(ws_detail["N7"].value, "=M7/M$6")
                self.assertEqual(ws_detail["AB2"].value, "=SUM(AA6,AA25,AA45,AA64)/AA2")
                self.assertIsNone(ws_tracking["K2"].value)

                self.assertEqual(ws_detail["M7"].value, 123.0)
                self.assertEqual(ws_detail["M27"].value, 456.0)
                self.assertEqual(ws_detail["M26"].value, 0.0)
                self.assertEqual(ws_detail["A24"].value, 2026)
            finally:
                wb.close()

            self._assert_dsp_export_template_parity(
                root / "templates" / "dsp_tab4_template.xlsx",
                export_path,
            )

    def test_dsp_export_download_endpoint_returns_artifact_attachment(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root)
            dispatch_action(ctx, {"action": "bootstrap"})
            dispatch_action(ctx, {"action": "save", "rows": [self._full_row()]})
            dispatch_action(
                ctx,
                {
                    "action": "tab4_delivery",
                    "main_tab": "dsp_tab3",
                    "sub_tab": "pivot",
                },
            )
            export_out = dispatch_action(
                ctx,
                {
                    "action": "export",
                    "main_tab": "dsp_tab4",
                    "sub_tab": "overview",
                },
            )
            artifact_path = Path(str(export_out.get("artifact_path") or ""))
            self.assertTrue(artifact_path.exists())

            try:
                server = ThreadingHTTPServer(("127.0.0.1", 0), UiRequestHandler)
            except PermissionError:
                self.skipTest("sandbox 禁止本地 socket bind，略過 download endpoint smoke")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                query = urlencode(
                    {
                        "root": str(root),
                        "manifest": "bootstrap.manifest.json",
                        "workflow": "dsp",
                        "template_version": "v1",
                        "rule_version": "v1",
                        "artifact_root": "artifacts",
                        "artifact_path": str(artifact_path),
                        "main_tab": "dsp_tab4",
                        "sub_tab": "overview",
                    }
                )
                with urlopen(Request(f"http://{host}:{port}/api/export/download?{query}")) as resp:
                    body = resp.read()
                    self.assertEqual(resp.status, 200)
                    self.assertIn("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resp.headers.get("Content-Type", ""))
                    disposition = resp.headers.get("Content-Disposition", "")
                    self.assertIn("attachment;", disposition)
                    self.assertIn("filename*=", disposition)
                    self.assertIn("2026%20DSP", disposition)
                    self.assertEqual(
                        hashlib.sha256(body).hexdigest(),
                        hashlib.sha256(artifact_path.read_bytes()).hexdigest(),
                    )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2.0)

    def test_ui_shell_strict_gate_respected(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root)
            dispatch_action(ctx, {"action": "bootstrap"})

            conn = sqlite3.connect(str(root / "data" / "mdrep.sqlite"))
            try:
                conn.execute("DELETE FROM rule_bindings WHERE workflow='ssp'")
                conn.commit()
            finally:
                conn.close()

            with self.assertRaises(AcceptanceGateError):
                dispatch_action(ctx, {"action": "save", "rows": [self._full_row()]})

    def test_ui_shell_status_has_machine_readable_summaries(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root)
            dispatch_action(ctx, {"action": "bootstrap"})
            status = collect_runtime_status(ctx)
            self.assertIn("health", status)
            self.assertIn("recent", status)
            self.assertIn("run_log", status["recent"])
            self.assertIn("audit_log", status["recent"])
            # JSON serializable snapshot for UI rendering.
            json.dumps(status, ensure_ascii=False)

    def test_tab4_delivery_state_relocks_after_rawdata_save(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root)
            dispatch_action(ctx, {"action": "bootstrap"})
            dispatch_action(ctx, {"action": "save", "rows": [self._full_row()]})

            delivered = dispatch_action(
                ctx,
                {
                    "action": "tab4_delivery",
                    "main_tab": "dsp_tab3",
                    "sub_tab": "pivot",
                },
            )
            self.assertTrue(bool(delivered.get("ready")))

            ready_status = collect_runtime_status(ctx)
            self.assertTrue(bool(ready_status.get("tab4_delivery", {}).get("ready")))
            self.assertEqual(
                str(ready_status.get("tab4_delivery", {}).get("reason") or ""),
                "pivot_handoff",
            )

            dispatch_action(ctx, {"action": "save", "rows": [self._full_row(最終經銷商="A2")]})
            relocked_status = collect_runtime_status(ctx)
            self.assertFalse(bool(relocked_status.get("tab4_delivery", {}).get("ready")))
            self.assertEqual(
                str(relocked_status.get("tab4_delivery", {}).get("reason") or ""),
                "rawdata_saved",
            )

    def test_dsp_export_requires_tab4_route_and_delivery_snapshot_identity(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root)
            dispatch_action(ctx, {"action": "bootstrap"})
            dispatch_action(ctx, {"action": "save", "rows": [self._full_row()]})

            with self.assertRaises(PermissionError):
                dispatch_action(
                    ctx,
                    {
                        "action": "export",
                        "main_tab": "dsp_tab3",
                        "sub_tab": "rawdata",
                    },
                )

            delivered = dispatch_action(
                ctx,
                {
                    "action": "tab4_delivery",
                    "main_tab": "dsp_tab3",
                    "sub_tab": "pivot",
                },
            )
            self.assertTrue(bool(delivered.get("ready")))
            delivery_token = str(delivered.get("delivery_snapshot_token") or "")
            self.assertTrue(delivery_token)

            status = collect_runtime_status(ctx)
            status_delivery = status.get("tab4_delivery", {})
            self.assertEqual(str(status_delivery.get("delivery_snapshot_token") or ""), delivery_token)
            self.assertEqual(str(status_delivery.get("last_delivery_run_id") or ""), str(delivered.get("run_id") or ""))

            frame = collect_workflow_frame(ctx)
            frame_snapshot = frame.get("tab4_delivery_snapshot", {})
            self.assertEqual(str(frame_snapshot.get("delivery_snapshot_token") or ""), delivery_token)
            self.assertEqual(str(frame_snapshot.get("delivery_run_id") or ""), str(delivered.get("run_id") or ""))
            preview_contract = frame.get("tab4_preview_contract", {})
            self.assertEqual(str(preview_contract.get("kind") or ""), "template_preview")
            summary_preview = frame.get("tab4_preview_template_summary", {})
            detail_preview = frame.get("tab4_preview_template_detail", {})
            self.assertIn("tab4_preview_template_summary", frame)
            self.assertIn("tab4_preview_template_detail", frame)
            self.assertGreater(float((summary_preview.get("monthTotals") or [0.0] * 12)[4]), 0.0)
            self.assertGreater(float((summary_preview.get("rows") or [{}])[0].get("monthlyAmounts", [0.0] * 12)[4]), 0.0)
            self.assertGreater(float((detail_preview.get("kpiRows") or [{}])[0].get("monthlyAmounts", [0.0] * 12)[4]), 0.0)
            first_section = (detail_preview.get("sections") or [{}])[0]
            self.assertGreater(float(((first_section.get("rows") or [{}])[0]).get("monthlyAmounts", [0.0] * 12)[4]), 0.0)
            self.assertNotIn("tab4_template_summary", frame)
            self.assertNotIn("tab4_template_detail", frame)

            with self.assertRaises(PermissionError):
                dispatch_action(
                    ctx,
                    {
                        "action": "export",
                        "main_tab": "dsp_tab4",
                        "sub_tab": "pivot",
                    },
                )

            conn = sqlite3.connect(str(root / "data" / "mdrep.sqlite"))
            try:
                conn.execute(
                    "UPDATE run_log SET canonical_token = '' WHERE run_id = ?",
                    (str(delivered.get("run_id") or ""),),
                )
                conn.commit()
            finally:
                conn.close()

            with self.assertRaises(PermissionError):
                dispatch_action(
                    ctx,
                    {
                        "action": "export",
                        "main_tab": "dsp_tab4",
                        "sub_tab": "overview",
                    },
                )
            status_after_token_removed = collect_runtime_status(ctx)
            self.assertFalse(bool(status_after_token_removed.get("tab4_delivery", {}).get("ready")))
            self.assertEqual(
                str(status_after_token_removed.get("tab4_delivery", {}).get("reason") or ""),
                "missing_snapshot_token",
            )

            delivered = dispatch_action(
                ctx,
                {
                    "action": "tab4_delivery",
                    "main_tab": "dsp_tab3",
                    "sub_tab": "pivot",
                },
            )
            delivery_token = str(delivered.get("delivery_snapshot_token") or "")
            self.assertTrue(delivery_token)

            export_out = dispatch_action(
                ctx,
                {
                    "action": "export",
                    "main_tab": "dsp_tab4",
                    "sub_tab": "overview",
                },
            )
            self.assertEqual(str(export_out.get("delivery_snapshot_token") or ""), delivery_token)
            self.assertEqual(str(export_out.get("delivery_run_id") or ""), str(delivered.get("run_id") or ""))

    def test_dsp_export_defaults_missing_route_for_compat(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root)
            dispatch_action(ctx, {"action": "bootstrap"})
            dispatch_action(ctx, {"action": "save", "rows": [self._full_row()]})
            dispatch_action(
                ctx,
                {
                    "action": "tab4_delivery",
                    "main_tab": "dsp_tab3",
                    "sub_tab": "pivot",
                },
            )
            # 相容舊前端：缺 main_tab/sub_tab 時，後端補成 dsp_tab4/overview。
            export_out = dispatch_action(
                ctx,
                {
                    "action": "export",
                },
            )
            self.assertTrue(Path(str(export_out.get("artifact_path") or "")).exists())
            self.assertRegex(
                Path(str(export_out.get("artifact_path") or "")).name,
                r"^2026 DSP投資量報表_\d{4}-\d{4}\.xlsx$",
            )

    def test_ui_shell_root_returns_503_when_frontend_dist_missing(self) -> None:
        try:
            server = ThreadingHTTPServer(("127.0.0.1", 0), UiRequestHandler)
        except PermissionError:
            self.skipTest("sandbox 禁止本地 socket bind，略過 root entry smoke")

        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as missing_dist:
                with patch.object(ui_shell_module, "FRONTEND_DIST_DIR", Path(missing_dist)):
                    host, port = server.server_address
                    req = Request(f"http://{host}:{port}/")
                    try:
                        with urlopen(req) as resp:
                            body = resp.read().decode("utf-8")
                            status_code = resp.status
                            content_type = resp.headers.get("Content-Type", "")
                    except HTTPError as exc:
                        body = exc.read().decode("utf-8")
                        status_code = exc.code
                        content_type = exc.headers.get("Content-Type", "")
                    self.assertEqual(status_code, 503)
                    self.assertIn("text/html", content_type)
                    self.assertIn("React frontend artifact not found", body)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2.0)

    def test_ui_shell_root_serves_frontend_entry_when_dist_exists(self) -> None:
        frontend_index = ui_shell_module.FRONTEND_DIST_DIR / "index.html"
        if not frontend_index.exists():
            self.skipTest("frontend dist 不存在，略過 frontend entry smoke（請先 pnpm build）")

        try:
            server = ThreadingHTTPServer(("127.0.0.1", 0), UiRequestHandler)
        except PermissionError:
            self.skipTest("sandbox 禁止本地 socket bind，略過 root entry smoke")

        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            with urlopen(Request(f"http://{host}:{port}/")) as resp:
                body = resp.read().decode("utf-8")
                self.assertEqual(resp.status, 200)
                self.assertIn("text/html", resp.headers.get("Content-Type", ""))
                self.assertIn("<div id=\"root\"></div>", body)
                self.assertNotIn("React frontend artifact not found", body)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2.0)

    def test_ui_browser_acceptance_smoke(self) -> None:
        frontend_index = ui_shell_module.FRONTEND_DIST_DIR / "index.html"
        if not frontend_index.exists():
            self.skipTest("frontend dist 不存在，無法做真 browser acceptance（請先 pnpm build）")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root, workflow="dsp")
            dispatch_action(ctx, {"action": "bootstrap"})
            dispatch_action(
                ctx,
                {
                    "action": "save",
                    "rows": [
                        self._full_row(),
                        self._full_row(
                            訂單="O2",
                            素材="C2",
                            廣告形式="Video",
                            最終廣告形式="Video",
                            執行金額=20.0,
                            媒體費用=16.0,
                        ),
                    ],
                },
            )

            try:
                server = ThreadingHTTPServer(("127.0.0.1", 0), UiRequestHandler)
            except PermissionError:
                self.skipTest("sandbox 禁止本地 socket bind，略過 browser acceptance smoke")

            try:
                from playwright.sync_api import Error as PlaywrightError
                from playwright.sync_api import sync_playwright
            except Exception:
                self.skipTest("缺少 playwright 依賴，請先安裝 playwright 並執行 playwright install chromium")

            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                base_url = f"http://{host}:{port}"
                with sync_playwright() as p:
                    try:
                        browser = p.chromium.launch(headless=True)
                    except PlaywrightError as exc:
                        self.skipTest(f"playwright browser context 無法啟動，請先 playwright install chromium: {exc}")
                    context = browser.new_context(viewport={"width": 1680, "height": 1400}, accept_downloads=True)
                    page = context.new_page()
                    try:
                        query = urlencode(
                            {
                                "root": str(root),
                                "manifest": "bootstrap.manifest.json",
                                "workflow": "dsp",
                                "template_version": "v1",
                                "rule_version": "v1",
                                "artifact_root": "artifacts",
                            }
                        )
                        page.goto(f"{base_url}/?{query}", wait_until="domcontentloaded")
                        layout_box = page.locator(".layout").bounding_box()
                        self.assertIsNotNone(layout_box)
                        self.assertGreaterEqual(int(layout_box["width"] if layout_box else 0), 1660)
                        self.assertEqual(int(layout_box["x"] if layout_box else -1), 0)
                        self.assertFalse(page.is_visible("text=React frontend artifact not found"))
                        self.assertTrue(page.is_visible("text=MDREP Frontend Shell"))
                        self.assertTrue(page.is_visible("text=Use DSP"))
                        self.assertTrue(page.is_visible("text=Use SSP"))
                        self.assertTrue(page.is_visible("text=Runtime Context"))
                        self.assertTrue(page.is_visible("text=Service Input"))

                        # Main/Sub Tabs aria-selected：預設 DSP tab3 + rawdata。
                        main_tab3 = page.locator("[data-testid='main-tab-dsp-tab3']")
                        main_tab4 = page.locator("[data-testid='main-tab-dsp-tab4']")
                        sub_rawdata = page.locator("[data-testid='sub-tab-rawdata']")
                        sub_pivot = page.locator("[data-testid='sub-tab-pivot']")
                        sub_result = page.locator("[data-testid='sub-tab-result']")
                        main_tab3.click()
                        self.assertEqual(main_tab3.get_attribute("aria-selected"), "true")
                        self.assertEqual(main_tab4.get_attribute("aria-selected"), "false")
                        sub_rawdata.click()
                        self.assertEqual(sub_rawdata.get_attribute("aria-selected"), "true")
                        self.assertEqual(sub_result.get_attribute("aria-selected"), "false")
                        rawdata_workspace = page.locator("[data-testid='section-rawdata']")
                        self.assertTrue(rawdata_workspace.is_visible())
                        self.assertTrue(rawdata_workspace.get_by_text("編修工作量").first.is_visible())
                        self.assertTrue(rawdata_workspace.get_by_text("提交判定").first.is_visible())
                        self.assertEqual(rawdata_workspace.locator("[data-testid='action-export']").count(), 0)
                        self.assertEqual(rawdata_workspace.get_by_text("Keyword Filter").count(), 0)
                        self.assertEqual(page.locator("[data-testid='dsp-rawdata-view-mode']").count(), 1)
                        view_user = page.locator("[data-testid='dsp-rawdata-view-user']")
                        view_verify = page.locator("[data-testid='dsp-rawdata-view-verify']")
                        view_pm = page.locator("[data-testid='dsp-rawdata-view-pm']")
                        self.assertEqual(view_user.get_attribute("aria-selected"), "true")
                        self.assertEqual(view_verify.get_attribute("aria-selected"), "false")
                        self.assertEqual(view_pm.get_attribute("aria-selected"), "false")
                        self.assertTrue(page.locator("[data-testid='dsp-rawdata-date-bucket']").is_visible())
                        self.assertTrue(page.locator("[data-testid='dsp-rawdata-row-limit']").is_visible())
                        self.assertTrue(page.locator("[data-testid='dsp-rawdata-distributor']").is_visible())
                        self.assertTrue(page.locator("[data-testid='dsp-rawdata-ad-format']").is_visible())
                        self.assertTrue(page.locator("[data-testid='dsp-rawdata-size']").is_visible())
                        self.assertTrue(page.locator("[data-testid='dsp-rawdata-template']").is_visible())
                        self.assertEqual(page.locator("[data-testid='dsp-rawdata-date-bucket'] option").count(), 4)
                        main_rawdata_table = rawdata_workspace.locator("table", has=page.locator("thead tr th", has_text="最終經銷商")).first
                        rawdata_row_count = main_rawdata_table.locator("tbody tr").count()
                        expected_user_headers = [
                            "日期時間", "最終經銷商", "訂單", "素材", "最終廣告形式", "尺寸", "素材樣板", "執行金額", "媒體費用",
                        ]
                        user_headers = [
                            main_rawdata_table.locator("thead tr th").nth(i).inner_text().strip()
                            for i in range(main_rawdata_table.locator("thead tr th").count())
                        ]
                        self.assertEqual(user_headers, expected_user_headers)
                        rawdata_table_wrap = page.locator("[data-testid='rawdata-table-wrap']").first
                        user_wrap_metrics = rawdata_table_wrap.evaluate(
                            """el => ({
                              overflowX: window.getComputedStyle(el).overflowX,
                              scrollWidth: el.scrollWidth,
                              clientWidth: el.clientWidth
                            })"""
                        )
                        self.assertIn(str(user_wrap_metrics.get("overflowX", "")), {"hidden", "clip"})
                        self.assertLessEqual(
                            int(user_wrap_metrics.get("scrollWidth", 0)),
                            int(user_wrap_metrics.get("clientWidth", 0)) + 1,
                        )
                        first_header_cell = main_rawdata_table.locator("thead tr th").first
                        first_header_width_before = int(
                            first_header_cell.evaluate("el => Math.round(el.getBoundingClientRect().width)")
                        )
                        first_resizer = page.locator("[data-testid='rawdata-col-resizer-0']").first
                        first_resizer_box = first_resizer.bounding_box()
                        self.assertIsNotNone(first_resizer_box)
                        if first_resizer_box:
                            page.mouse.move(
                                first_resizer_box["x"] + (first_resizer_box["width"] / 2),
                                first_resizer_box["y"] + (first_resizer_box["height"] / 2),
                            )
                            page.mouse.down()
                            page.mouse.move(
                                first_resizer_box["x"] + (first_resizer_box["width"] / 2) - 80,
                                first_resizer_box["y"] + (first_resizer_box["height"] / 2),
                            )
                            page.mouse.up()
                        page.wait_for_timeout(80)
                        first_header_width_after_resize = int(
                            first_header_cell.evaluate("el => Math.round(el.getBoundingClientRect().width)")
                        )
                        self.assertGreaterEqual(first_header_width_after_resize, first_header_width_before)
                        view_verify.click()
                        self.assertEqual(view_verify.get_attribute("aria-selected"), "true")
                        self.assertEqual(main_rawdata_table.locator("tbody tr").count(), rawdata_row_count)
                        expected_verify_headers = [
                            "日期時間", "最終經銷商", "訂單", "素材", "最終廣告形式", "尺寸", "素材樣板", "執行金額", "媒體費用",
                            "原始經銷商", "原始廣告形式", "最終來源_經銷商", "規則命中_經銷商", "最終來源_廣告形式", "規則命中_廣告形式",
                        ]
                        verify_headers = [
                            main_rawdata_table.locator("thead tr th").nth(i).inner_text().strip()
                            for i in range(main_rawdata_table.locator("thead tr th").count())
                        ]
                        self.assertEqual(verify_headers, expected_verify_headers)
                        verify_wrap_metrics = rawdata_table_wrap.evaluate(
                            """el => ({
                              overflowX: window.getComputedStyle(el).overflowX,
                              scrollWidth: el.scrollWidth,
                              clientWidth: el.clientWidth
                            })"""
                        )
                        self.assertIn(str(verify_wrap_metrics.get("overflowX", "")), {"auto", "scroll"})
                        self.assertGreater(
                            int(verify_wrap_metrics.get("scrollWidth", 0)),
                            int(verify_wrap_metrics.get("clientWidth", 0)),
                        )
                        view_pm.click()
                        self.assertEqual(view_pm.get_attribute("aria-selected"), "true")
                        self.assertEqual(main_rawdata_table.locator("tbody tr").count(), rawdata_row_count)
                        expected_pm_headers = [
                            "日期時間", "最終經銷商", "訂單", "素材", "最終廣告形式", "尺寸", "素材樣板", "執行金額", "媒體費用",
                            "原始經銷商", "原始廣告形式", "最終來源_經銷商", "規則命中_經銷商", "最終來源_廣告形式", "規則命中_廣告形式",
                            "經銷商", "分類層級B", "分類層級C", "分類層級D", "廣告形式", "系統營收",
                        ]
                        pm_headers = [
                            main_rawdata_table.locator("thead tr th").nth(i).inner_text().strip()
                            for i in range(main_rawdata_table.locator("thead tr th").count())
                        ]
                        self.assertEqual(pm_headers, expected_pm_headers)
                        view_user.click()
                        self.assertEqual(view_user.get_attribute("aria-selected"), "true")
                        first_header_width_after_switch = int(
                            main_rawdata_table.locator("thead tr th").first.evaluate(
                                "el => Math.round(el.getBoundingClientRect().width)"
                            )
                        )
                        self.assertGreaterEqual(first_header_width_after_switch, first_header_width_after_resize - 4)
                        page.reload(wait_until="domcontentloaded")
                        page.locator("[data-testid='main-tab-dsp-tab3']").click()
                        page.locator("[data-testid='sub-tab-rawdata']").click()
                        page.locator("[data-testid='dsp-rawdata-view-user']").click()
                        reloaded_table = page.locator("[data-testid='section-rawdata']").locator(
                            "table", has=page.locator("thead tr th", has_text="最終經銷商")
                        ).first
                        first_header_width_after_reload = int(
                            reloaded_table.locator("thead tr th").first.evaluate(
                                "el => Math.round(el.getBoundingClientRect().width)"
                            )
                        )
                        self.assertGreaterEqual(first_header_width_after_reload, first_header_width_after_resize - 4)
                        self.assertEqual(main_rawdata_table.locator("thead tr th", has_text="變更狀態").count(), 0)
                        self.assertEqual(main_rawdata_table.locator("thead tr th", has_text="列操作").count(), 0)
                        rawdata_workspace = page.locator("[data-testid='section-rawdata']")
                        self.assertEqual(rawdata_workspace.get_by_role("button", name="Revert").count(), 0)
                        main_rawdata_table = rawdata_workspace.locator(
                            "table", has=page.locator("thead tr th", has_text="最終經銷商")
                        ).first
                        header_cells = main_rawdata_table.locator("thead tr th")
                        distributor_col_index = -1
                        for i in range(header_cells.count()):
                            if header_cells.nth(i).inner_text().strip() == "最終經銷商":
                                distributor_col_index = i
                                break
                        self.assertGreaterEqual(distributor_col_index, 0)
                        target_input = main_rawdata_table.locator("tbody tr").first.locator("td").nth(distributor_col_index).locator("input")
                        self.assertEqual(target_input.count(), 1)
                        before_value = target_input.input_value()
                        after_value = f"{before_value}_mdrep"
                        target_input.fill(after_value)
                        with page.expect_response(lambda resp: resp.request.method == "POST" and "/api/action" in resp.url) as modify_resp:
                            page.locator("[data-testid='action-modify']").click()
                        modify_payload = modify_resp.value.request.post_data_json
                        if callable(modify_payload):
                            modify_payload = modify_payload()
                        self.assertIsInstance(modify_payload, dict)
                        self.assertEqual(modify_payload.get("action"), "modify")
                        updates = modify_payload.get("updates") or []
                        self.assertGreaterEqual(len(updates), 1)
                        modify_result = modify_resp.value.json()
                        self.assertEqual(modify_result.get("status"), "ok")
                        modify_result_payload = modify_result.get("result") if isinstance(modify_result, dict) else {}
                        self.assertIsInstance(modify_result_payload, dict)
                        modify_run_id = str((modify_result_payload or {}).get("run_id") or "")
                        self.assertTrue(modify_run_id)
                        first_update = updates[0]
                        expected_row_order = str(first_update.get("row_order"))
                        expected_column = str(first_update.get("column"))
                        expected_value = str(first_update.get("value"))
                        frame_payload = page.evaluate(
                            """async ({root, manifest}) => {
                              const q = new URLSearchParams({
                                root, manifest, workflow: "dsp", template_version: "v1", rule_version: "v1", artifact_root: "artifacts"
                              });
                              const resp = await fetch(`/api/frame?${q.toString()}`);
                              return await resp.json();
                            }""",
                            {"root": str(root), "manifest": "bootstrap.manifest.json"},
                        )
                        self.assertEqual(frame_payload.get("status"), "ok")
                        frame_rows = ((frame_payload.get("result") or {}).get("rows") or [])
                        self.assertGreaterEqual(len(frame_rows), 1)
                        self.assertTrue(
                            any(
                                str(row.get("row_order")) == expected_row_order
                                and str(row.get(expected_column, "")) == expected_value
                                for row in frame_rows
                            ),
                            f"frame 未回讀到更新值: row_order={expected_row_order}, column={expected_column}, value={expected_value}",
                        )
                        page.locator("[data-testid='sub-tab-result']").click()
                        result_workspace = page.locator("[data-testid='section-result']")
                        self.assertTrue(result_workspace.is_visible())
                        self.assertIn("last_action: modify", result_workspace.inner_text())
                        self.assertIn("result_status: ok", result_workspace.inner_text())
                        self.assertIn(f"run_id: {modify_run_id}", result_workspace.inner_text())
                        self.assertIn(f"rows: {self._fmt_num(len(frame_rows))}", result_workspace.inner_text())
                        modify_status_payload = page.evaluate(
                            """async ({root, manifest}) => {
                              const q = new URLSearchParams({
                                root, manifest, workflow: "dsp", template_version: "v1", rule_version: "v1", artifact_root: "artifacts"
                              });
                              const resp = await fetch(`/api/status?${q.toString()}`);
                              return await resp.json();
                            }""",
                            {"root": str(root), "manifest": "bootstrap.manifest.json"},
                        )
                        self.assertEqual(modify_status_payload.get("status"), "ok")
                        modify_run_log = (((modify_status_payload.get("result") or {}).get("recent") or {}).get("run_log") or [])
                        self.assertGreaterEqual(len(modify_run_log), 1)
                        self.assertEqual(str(modify_run_log[0].get("run_type", "")).lower(), "modify")
                        self.assertEqual(str(modify_run_log[0].get("run_id", "")), modify_run_id)

                        # Runtime strip 預設收合，只顯示單行摘要。
                        self.assertFalse(page.is_visible("text=Runtime Actions"))
                        page.get_by_role("button", name="展開詳細").click()
                        self.assertTrue(page.is_visible("text=Runtime Actions"))
                        with page.expect_response(lambda resp: resp.request.method == "GET" and "/api/status?" in resp.url) as refresh_status_resp:
                            page.get_by_role("button", name="Refresh Status").click()
                        refresh_status_payload = refresh_status_resp.value.json()
                        self.assertEqual(refresh_status_payload.get("status"), "ok")
                        self.assertIn("result", refresh_status_payload)
                        self.assertIn("recent", refresh_status_payload["result"])
                        with page.expect_response(lambda resp: resp.request.method == "GET" and "/api/frame?" in resp.url) as refresh_frame_resp:
                            page.get_by_role("button", name="Refresh Frame").click()
                        refresh_frame_payload = refresh_frame_resp.value.json()
                        self.assertEqual(refresh_frame_payload.get("status"), "ok")
                        self.assertIn("result", refresh_frame_payload)
                        self.assertIn("row_count", refresh_frame_payload["result"])
                        self.assertGreaterEqual(int(refresh_frame_payload["result"]["row_count"]), 1)
                        page.get_by_role("button", name="收合詳細").click()
                        self.assertFalse(page.is_visible("text=Runtime Actions"))

                        # Tab4 交付卡控：未交付前先鎖住。
                        page.locator("[data-testid='main-tab-dsp-tab4']").click()
                        self.assertEqual(main_tab4.get_attribute("aria-selected"), "true")
                        self.assertEqual(main_tab3.get_attribute("aria-selected"), "false")
                        page.locator("[data-testid='sub-tab-overview']").click()
                        tab4_workspace = page.locator("section.panel", has_text="DSP Tab4 Workspace").first
                        tab4_workspace.wait_for(state="visible")
                        self.assertTrue(tab4_workspace.is_visible())
                        self.assertTrue(page.locator("[data-testid='tab4-delivery-locked']").is_visible())
                        self.assertTrue(page.locator("[data-testid='action-return-pivot']").is_visible())
                        self.assertTrue(page.locator("[data-testid='action-export']").is_disabled())
                        locked_export_result = page.evaluate(
                            """async ({root, manifest}) => {
                              const body = {
                                root,
                                manifest,
                                workflow: "dsp",
                                template_version: "v1",
                                rule_version: "v1",
                                artifact_root: "artifacts",
                                main_tab: "dsp_tab4",
                                sub_tab: "overview",
                                action: "export"
                              };
                              const resp = await fetch('/api/action', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(body),
                              });
                              return { status: resp.status, payload: await resp.json() };
                            }""",
                            {"root": str(root), "manifest": "bootstrap.manifest.json"},
                        )
                        self.assertEqual(locked_export_result["status"], 400)
                        self.assertEqual(locked_export_result["payload"].get("status"), "error")
                        self.assertIn("tab4 delivery required", locked_export_result["payload"].get("message", ""))
                        page.locator("[data-testid='action-return-pivot']").click()
                        self.assertEqual(main_tab3.get_attribute("aria-selected"), "true")
                        self.assertEqual(page.locator("[data-testid='sub-tab-pivot']").get_attribute("aria-selected"), "true")

                        # 樞紐 workspace：insight panel 與樞紐內容需共存。
                        sub_pivot.click()
                        self.assertEqual(sub_pivot.get_attribute("aria-selected"), "true")
                        pivot_workspace = page.locator("[data-testid='section-pivot']")
                        self.assertTrue(pivot_workspace.is_visible())
                        self.assertTrue(pivot_workspace.get_by_text("樞紐核對資訊").first.is_visible())
                        self.assertFalse(pivot_workspace.get_by_text("Latest Publish").first.is_visible())
                        self.assertFalse(pivot_workspace.get_by_text("Latest Evidence").first.is_visible())
                        self.assertFalse(pivot_workspace.get_by_text("樞紐只做核對").first.is_visible())
                        self.assertFalse(pivot_workspace.get_by_text("樞紐節奏").first.is_visible())
                        self.assertFalse(pivot_workspace.get_by_text("當前焦點").first.is_visible())
                        pivot_matrix_table = pivot_workspace.locator(".table-wrap table").first
                        pivot_headers = [
                            pivot_matrix_table.locator("thead tr th").nth(i).inner_text().strip()
                            for i in range(pivot_matrix_table.locator("thead tr th").count())
                        ]
                        self.assertEqual(pivot_headers[0], "經銷商")
                        self.assertIn("Banner", pivot_headers)
                        self.assertIn("Video", pivot_headers)
                        self.assertEqual(pivot_headers[-1], "總計")
                        self.assertGreaterEqual(pivot_matrix_table.locator("tbody tr").count(), 1)
                        first_pivot_row_distributor = pivot_matrix_table.locator("tbody tr").first.locator("td").first.inner_text().strip()
                        self.assertTrue(first_pivot_row_distributor)
                        with page.expect_response(lambda resp: resp.request.method == "POST" and "/api/action" in resp.url) as delivery_resp:
                            page.locator("[data-testid='action-send-tab4']").click()
                        delivery_payload = delivery_resp.value.request.post_data_json
                        if callable(delivery_payload):
                            delivery_payload = delivery_payload()
                        self.assertIsInstance(delivery_payload, dict)
                        self.assertEqual(delivery_payload.get("action"), "tab4_delivery")
                        delivery_result = delivery_resp.value.json()
                        self.assertEqual(delivery_result.get("status"), "ok")
                        self.assertTrue(bool(delivery_result.get("result", {}).get("ready")))
                        delivery_snapshot_token = str(delivery_result.get("result", {}).get("delivery_snapshot_token") or "")
                        self.assertTrue(delivery_snapshot_token)
                        delivery_run_id = str(delivery_result.get("result", {}).get("run_id") or "")
                        self.assertTrue(delivery_run_id)
                        delivery_status_payload = page.evaluate(
                            """async ({root, manifest}) => {
                              const params = new URLSearchParams({
                                root,
                                manifest,
                                workflow: "dsp",
                                template_version: "v1",
                                rule_version: "v1",
                                artifact_root: "artifacts",
                              });
                              const resp = await fetch(`/api/status?${params.toString()}`);
                              return await resp.json();
                            }""",
                            {"root": str(root), "manifest": "bootstrap.manifest.json"},
                        )
                        self.assertEqual(delivery_status_payload.get("status"), "ok")
                        self.assertTrue(bool(delivery_status_payload.get("result", {}).get("tab4_delivery", {}).get("ready")))
                        self.assertEqual(
                            str(delivery_status_payload.get("result", {}).get("tab4_delivery", {}).get("delivery_snapshot_token") or ""),
                            delivery_snapshot_token,
                        )
                        delivery_frame_payload = page.evaluate(
                            """async ({root, manifest}) => {
                              const params = new URLSearchParams({
                                root,
                                manifest,
                                workflow: "dsp",
                                template_version: "v1",
                                rule_version: "v1",
                                artifact_root: "artifacts",
                              });
                              const resp = await fetch(`/api/frame?${params.toString()}`);
                              return await resp.json();
                            }""",
                            {"root": str(root), "manifest": "bootstrap.manifest.json"},
                        )
                        self.assertEqual(delivery_frame_payload.get("status"), "ok")
                        self.assertEqual(
                            str((delivery_frame_payload.get("result", {}).get("tab4_delivery_snapshot") or {}).get("delivery_snapshot_token") or ""),
                            delivery_snapshot_token,
                        )
                        frame_summary = delivery_frame_payload.get("result", {}).get("tab4_preview_template_summary") or {}
                        self.assertGreater(float((frame_summary.get("monthTotals") or [0.0] * 12)[4]), 0.0)
                        page.wait_for_function(
                            """() => {
                              const tab4 = document.querySelector("[data-testid='main-tab-dsp-tab4']");
                              return tab4 && tab4.getAttribute("aria-selected") === "true";
                            }"""
                        )
                        page.locator("[data-testid='tab4-delivery-locked']").wait_for(state="detached")
                        self.assertEqual(main_tab4.get_attribute("aria-selected"), "true")
                        self.assertEqual(main_tab3.get_attribute("aria-selected"), "false")
                        tab4_workspace = page.locator("section.panel", has_text="DSP Tab4 Workspace").first
                        self.assertTrue(tab4_workspace.is_visible())
                        self.assertEqual(page.locator("[data-testid='tab4-delivery-locked']").count(), 0)
                        self.assertIn("交付身份：", tab4_workspace.inner_text())
                        self.assertIn(delivery_snapshot_token, tab4_workspace.inner_text())
                        sub_overview = page.locator("[data-testid='sub-tab-overview']")
                        self.assertEqual(sub_overview.get_attribute("aria-selected"), "true")

                        # DSP Tab4 workspace tabs：summary/detail/tracking 切換不應回退成大表堆疊。
                        page.locator("[data-testid='sub-tab-overview']").click()
                        self.assertEqual(sub_overview.get_attribute("aria-selected"), "true")
                        mf_matrix = page.locator("[data-testid='tab4-mf-summary-matrix']")
                        self.assertTrue(mf_matrix.is_visible())
                        self.assertIn("DSP投資額 總計", mf_matrix.inner_text())
                        self.assertIn("1月", mf_matrix.inner_text())
                        self.assertIn("年度(總)", mf_matrix.inner_text())
                        self.assertIn("全體經銷商", mf_matrix.inner_text())
                        self.assertEqual(mf_matrix.locator("tbody tr").count(), 13)
                        tab4_detail = page.locator("[data-testid='tab4-detail']")
                        tab4_tracking = page.locator("[data-testid='tab4-tracking']")
                        tab4_detail.click()
                        self.assertIn("btn-primary", tab4_detail.get_attribute("class") or "")
                        self.assertEqual(tab4_detail.get_attribute("aria-selected"), "true")
                        detail_matrix = page.locator("[data-testid='tab4-mf-detail-matrix']")
                        self.assertTrue(detail_matrix.is_visible())
                        self.assertIn("各經銷商明細", detail_matrix.inner_text())
                        self.assertIn("各經銷商明細分區", detail_matrix.inner_text())
                        self.assertIn("全體經銷 總投資量目標", detail_matrix.inner_text())
                        self.assertIn("年度(總)", detail_matrix.inner_text())
                        tab4_tracking.click()
                        self.assertIn("btn-primary", tab4_tracking.get_attribute("class") or "")
                        self.assertEqual(tab4_tracking.get_attribute("aria-selected"), "true")
                        self.assertEqual(tab4_detail.get_attribute("aria-selected"), "false")
                        self.assertTrue(page.is_visible("text=北流進單追蹤"))
                        self.assertTrue(tab4_workspace.is_visible())
                        self.assertTrue(tab4_workspace.locator("[data-testid='action-export']").is_visible())
                        with page.expect_download() as download_info:
                            with page.expect_response(lambda resp: resp.request.method == "POST" and "/api/action" in resp.url) as export_resp:
                                tab4_workspace.locator("[data-testid='action-export']").click()
                        export_payload = export_resp.value.request.post_data_json
                        if callable(export_payload):
                            export_payload = export_payload()
                        self.assertIsInstance(export_payload, dict)
                        self.assertEqual(export_payload.get("action"), "export")
                        self.assertEqual(export_payload.get("main_tab"), "dsp_tab4")
                        self.assertEqual(export_payload.get("sub_tab"), "overview")
                        export_result = export_resp.value.json()
                        self.assertEqual(export_result.get("status"), "ok")
                        export_result_payload = export_result.get("result") if isinstance(export_result, dict) else {}
                        self.assertIsInstance(export_result_payload, dict)
                        export_run_id = str((export_result_payload or {}).get("run_id") or "")
                        export_artifact_checksum = str((export_result_payload or {}).get("artifact_checksum") or "")
                        export_artifact_path = ""
                        if isinstance(export_result_payload, dict):
                            export_artifact_path = str(export_result_payload.get("artifact_path") or "")
                        self.assertEqual(str(export_result_payload.get("delivery_snapshot_token") or ""), delivery_snapshot_token)
                        self.assertEqual(str(export_result_payload.get("delivery_run_id") or ""), delivery_run_id)
                        self.assertTrue(export_run_id)
                        self.assertTrue(export_artifact_checksum)
                        self.assertTrue(export_artifact_path)
                        self.assertTrue(Path(export_artifact_path).exists(), f"export artifact not found: {export_artifact_path}")
                        self.assertRegex(Path(export_artifact_path).name, r"^2026 DSP投資量報表_\d{4}-\d{4}\.xlsx$")
                        export_actual_checksum = hashlib.sha256(Path(export_artifact_path).read_bytes()).hexdigest()
                        self.assertEqual(export_artifact_checksum, export_actual_checksum)
                        download = download_info.value
                        self.assertRegex(download.suggested_filename, r"^2026 DSP投資量報表_\d{4}-\d{4}\.xlsx$")
                        download_query = parse_qs(urlparse(download.url).query)
                        self.assertEqual(download_query.get("main_tab", [""])[0], "dsp_tab4")
                        self.assertEqual(download_query.get("sub_tab", [""])[0], "overview")
                        download_temp_path = download.path()
                        self.assertIsNotNone(download_temp_path)
                        if download_temp_path is not None:
                            self.assertEqual(
                                hashlib.sha256(Path(download_temp_path).read_bytes()).hexdigest(),
                                export_artifact_checksum,
                            )
                        export_wb = load_workbook(Path(export_artifact_path), data_only=True)
                        try:
                            self.assertEqual(
                                export_wb.sheetnames,
                                [
                                    "2025年_MF_合作績效統計總表",
                                    "2025_外部+行政_合作績效統計總表 ",
                                    "mF投資量_總表",
                                    "各經銷商明細",
                                    "北流進單追蹤",
                                ],
                            )
                            self.assertEqual(export_wb["2025年_MF_合作績效統計總表"].sheet_state, "hidden")
                            self.assertEqual(export_wb["2025_外部+行政_合作績效統計總表 "].sheet_state, "hidden")
                            self.assertEqual(export_wb["mF投資量_總表"].freeze_panes, "M1")
                            self.assertEqual(export_wb["各經銷商明細"].freeze_panes, "U1")
                        finally:
                            export_wb.close()
                        page.locator("[data-testid='sub-tab-result']").click()
                        export_result_workspace = page.locator("[data-testid='section-result']")
                        self.assertTrue(export_result_workspace.is_visible())
                        self.assertIn("last_action: export", export_result_workspace.inner_text())
                        self.assertIn("result_status: ok", export_result_workspace.inner_text())
                        self.assertIn(f"run_id: {export_run_id}", export_result_workspace.inner_text())
                        export_frame_payload = page.evaluate(
                            """async ({root, manifest}) => {
                              const q = new URLSearchParams({
                                root, manifest, workflow: "dsp", template_version: "v1", rule_version: "v1", artifact_root: "artifacts"
                              });
                              const resp = await fetch(`/api/frame?${q.toString()}`);
                              return await resp.json();
                            }""",
                            {"root": str(root), "manifest": "bootstrap.manifest.json"},
                        )
                        self.assertEqual(export_frame_payload.get("status"), "ok")
                        export_row_count = int(((export_frame_payload.get("result") or {}).get("row_count") or 0))
                        self.assertGreaterEqual(export_row_count, 1)
                        self.assertIn(f"rows: {self._fmt_num(export_row_count)}", export_result_workspace.inner_text())
                        page.locator("[data-testid='result-segment-action']").click()
                        self.assertIn(export_artifact_path, page.locator("pre.json-view").inner_text())
                        page.locator("[data-testid='result-segment-state']").click()
                        self.assertIn('"lastAction": "export"', page.locator("pre.json-view").inner_text())
                        page.locator("[data-testid='sub-tab-overview']").click()
                        export_blocked_requests: list[dict] = []

                        def _capture_export_blocked_request(req: object) -> None:
                            request_method = getattr(req, "method", "")
                            if callable(request_method):
                                request_method = request_method()
                            request_url = getattr(req, "url", "")
                            if callable(request_url):
                                request_url = request_url()
                            if request_method == "POST" and "/api/action" in request_url:
                                body = getattr(req, "post_data_json", None)
                                if callable(body):
                                    body = body()
                                if isinstance(body, dict):
                                    export_blocked_requests.append(body)

                        page.on("request", _capture_export_blocked_request)
                        pre_publish_count = len(export_blocked_requests)
                        tab4_workspace.locator("[data-testid='action-publish']").evaluate("el => el.click()")
                        page.wait_for_timeout(250)
                        post_publish_count = len(export_blocked_requests)
                        self.assertEqual(post_publish_count, pre_publish_count)
                        page.remove_listener("request", _capture_export_blocked_request)

                        # Rawdata save 後，前一次 Tab4 交付必須失效（重新鎖住）。
                        page.locator("[data-testid='main-tab-dsp-tab3']").click()
                        page.locator("[data-testid='sub-tab-rawdata']").click()
                        with page.expect_response(lambda resp: resp.request.method == "POST" and "/api/action" in resp.url) as save_resp:
                            page.locator("[data-testid='action-save']").click()
                        save_payload = save_resp.value.request.post_data_json
                        if callable(save_payload):
                            save_payload = save_payload()
                        self.assertIsInstance(save_payload, dict)
                        self.assertEqual(save_payload.get("action"), "save")
                        save_result = save_resp.value.json()
                        if str(save_result.get("status")) != "ok":
                            save_retry = page.evaluate(
                                """async ({root, manifest}) => {
                                  const params = new URLSearchParams({
                                    root,
                                    manifest,
                                    workflow: "dsp",
                                    template_version: "v1",
                                    rule_version: "v1",
                                    artifact_root: "artifacts",
                                  });
                                  const frameResp = await fetch(`/api/frame?${params.toString()}`);
                                  const framePayload = await frameResp.json();
                                  const result = framePayload.result || {};
                                  const fieldNames = Array.isArray(result.field_names) ? result.field_names : [];
                                  const rows = Array.isArray(result.rows)
                                    ? result.rows.map((row) => {
                                        const out = {};
                                        for (const key of fieldNames) {
                                          out[key] = row?.[key];
                                        }
                                        return out;
                                      })
                                    : [];
                                  const saveResp = await fetch('/api/action', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      root,
                                      manifest,
                                      workflow: "dsp",
                                      template_version: "v1",
                                      rule_version: "v1",
                                      artifact_root: "artifacts",
                                      action: "save",
                                      rows,
                                    }),
                                  });
                                  return await saveResp.json();
                                }""",
                                {"root": str(root), "manifest": "bootstrap.manifest.json"},
                            )
                            self.assertEqual(str(save_retry.get("status")), "ok")
                        page.locator("[data-testid='main-tab-dsp-tab4']").click()
                        page.wait_for_function(
                            """() => {
                              const tab4 = document.querySelector("[data-testid='main-tab-dsp-tab4']");
                              return tab4 && tab4.getAttribute("aria-selected") === "true";
                            }"""
                        )
                        page.locator("[data-testid='sub-tab-overview']").wait_for(state="visible")
                        relocked_status_payload = page.evaluate(
                            """async ({root, manifest}) => {
                              const params = new URLSearchParams({
                                root,
                                manifest,
                                workflow: "dsp",
                                template_version: "v1",
                                rule_version: "v1",
                                artifact_root: "artifacts",
                              });
                              const resp = await fetch(`/api/status?${params.toString()}`);
                              return await resp.json();
                            }""",
                            {"root": str(root), "manifest": "bootstrap.manifest.json"},
                        )
                        self.assertEqual(relocked_status_payload.get("status"), "ok")
                        self.assertFalse(bool(relocked_status_payload.get("result", {}).get("tab4_delivery", {}).get("ready")))
                        self.assertEqual(
                            str(relocked_status_payload.get("result", {}).get("tab4_delivery", {}).get("reason") or ""),
                            "rawdata_saved",
                        )

                        # SSP parity：只保留 anomaly 主視圖，不再提供 volume 與 sub tabs。
                        page.get_by_role("button", name="Use SSP").click()
                        main_ssp_anomaly = page.locator("[data-testid='main-tab-ssp-anomaly']")
                        main_ssp_anomaly.click()
                        self.assertEqual(main_ssp_anomaly.get_attribute("aria-selected"), "true")
                        self.assertEqual(page.locator("[data-testid='main-tab-ssp-volume']").count(), 0)
                        ssp_anomaly_workspace = page.locator("section.panel", has_text="SSP 成效異常 Workspace").first
                        self.assertTrue(ssp_anomaly_workspace.is_visible())
                        self.assertTrue(ssp_anomaly_workspace.get_by_text("控制列").first.is_visible())
                        self.assertTrue(ssp_anomaly_workspace.get_by_text("每日總表").first.is_visible())
                        self.assertTrue(ssp_anomaly_workspace.get_by_text("異常供應商收合區").first.is_visible())
                        self.assertTrue(page.locator("[data-testid='ssp-anomaly-visibility-mode']").is_visible())
                        self.assertTrue(page.locator("[data-testid='ssp-anomaly-dod-threshold']").is_visible())
                        self.assertEqual(page.locator("[data-testid='ssp-anomaly-supplier-filter']").count(), 0)
                        self.assertEqual(page.locator("[data-testid='ssp-anomaly-only-toggle']").count(), 0)
                        self.assertEqual(page.locator("[data-testid='ssp-anomaly-min-request']").count(), 0)
                        daily_summary = page.locator("[data-testid='ssp-anomaly-daily-summary']")
                        self.assertEqual(daily_summary.locator("thead tr").count(), 2)
                        self.assertLessEqual(daily_summary.locator("tbody tr").count(), 13)
                        self.assertEqual(daily_summary.locator("thead tr:first-child th", has_text="DoD 變動(萬)").count(), 0)
                        self.assertEqual(daily_summary.locator("thead tr:first-child th", has_text="網站異常數").count(), 0)
                        self.assertTrue(
                            page.locator("[data-testid='ssp-anomaly-suppliers-accordion']").is_visible()
                            or ssp_anomaly_workspace.get_by_text("目前沒有異常供應商").first.is_visible()
                        )
                        if page.locator("[data-testid='ssp-anomaly-suppliers-accordion']").is_visible():
                            suppliers_head = page.locator("[data-testid='ssp-anomaly-suppliers-head']")
                            self.assertTrue(suppliers_head.is_visible())
                            self.assertIn("供應商", suppliers_head.inner_text())
                            self.assertIn("DoD 變動(萬)", suppliers_head.inner_text())
                            self.assertIn("網站異常數", suppliers_head.inner_text())
                            first_supplier_detail = page.locator("[data-testid='ssp-anomaly-suppliers-accordion'] details").first
                            if first_supplier_detail.count() > 0:
                                self.assertFalse(first_supplier_detail.evaluate("el => el.hasAttribute('open')"))
                        self.assertEqual(page.locator("[data-testid='sub-tabs']").count(), 0)
                        self.assertEqual(page.locator("[data-testid='sub-tab-overview']").count(), 0)
                        self.assertEqual(page.locator("[data-testid='sub-tab-rawdata']").count(), 0)
                        self.assertEqual(page.locator("[data-testid='sub-tab-pivot']").count(), 0)
                        self.assertEqual(page.locator("[data-testid='sub-tab-result']").count(), 0)
                        page.wait_for_timeout(100)
                        self.assertNotIn("sub_tab=", page.url)
                        runtime_strip_text = page.locator(".workbench-runtime-strip").inner_text()
                        self.assertNotIn("sub_tab:", runtime_strip_text)
                        self.assertNotIn("rawdata", runtime_strip_text.lower())

                        # 最小 happy path：SSP 自訂 period 後觸發 action，確認 payload 帶最新週期。
                        captured_actions: list[dict] = []

                        def _capture_action_request(req: object) -> None:
                            request_method = getattr(req, "method", "")
                            if callable(request_method):
                                request_method = request_method()
                            request_url = getattr(req, "url", "")
                            if callable(request_url):
                                request_url = request_url()
                            if request_method == "POST" and "/api/action" in request_url:
                                body = getattr(req, "post_data_json", None)
                                if callable(body):
                                    body = body()
                                if isinstance(body, dict):
                                    captured_actions.append(body)

                        page.on("request", _capture_action_request)
                        page.locator("[data-testid='period-preset']").select_option("custom")
                        page.locator("[data-testid='period-week-start']").fill("2026-05-05")
                        page.locator("[data-testid='period-week-end']").fill("2026-05-11")
                        page.get_by_role("button", name="展開詳細").click()
                        with page.expect_response(lambda resp: resp.request.method == "POST" and "/api/action" in resp.url):
                            page.get_by_role("button", name="Health").click()
                        self.assertGreaterEqual(len(captured_actions), 1)
                        last_action_payload = captured_actions[-1]
                        self.assertEqual(last_action_payload.get("action"), "health")
                        self.assertEqual(last_action_payload.get("workflow"), "ssp")
                        self.assertEqual(last_action_payload.get("period_preset"), "custom")
                        self.assertEqual(last_action_payload.get("period_week_start"), "2026-05-05")
                        self.assertEqual(last_action_payload.get("period_week_end"), "2026-05-11")
                        page.get_by_role("button", name="收合詳細").click()

                        # 切回 DSP Result，驗證 Result segmented view 仍是摘要優先。
                        page.get_by_role("button", name="Use DSP").click()
                        page.locator("[data-testid='main-tab-dsp-tab3']").click()
                        page.locator("[data-testid='sub-tab-result']").click()
                        self.assertTrue(page.is_visible("text=Execution Summary"))
                        self.assertFalse(page.is_visible("text=Action Payload JSON"))
                        self.assertFalse(page.is_visible("text=Result State JSON"))
                        self.assertEqual(page.locator("[data-testid='result-segment-summary']").get_attribute("aria-selected"), "true")

                        page.locator("[data-testid='result-segment-action']").click()
                        self.assertTrue(page.is_visible("text=Action Payload JSON"))
                        self.assertFalse(page.is_visible("text=Execution Summary"))
                        self.assertEqual(page.locator("[data-testid='result-segment-action']").get_attribute("aria-selected"), "true")

                        page.locator("[data-testid='result-segment-state']").click()
                        self.assertTrue(page.is_visible("text=Result State JSON"))
                        self.assertFalse(page.is_visible("text=Action Payload JSON"))
                        self.assertEqual(page.locator("[data-testid='result-segment-state']").get_attribute("aria-selected"), "true")

                        status_payload = page.evaluate(
                            """async ({root, manifest}) => {
                              const q = new URLSearchParams({
                                root, manifest, workflow: "dsp", template_version: "v1", rule_version: "v1", artifact_root: "artifacts"
                              });
                              const resp = await fetch(`/api/status?${q.toString()}`);
                              return await resp.json();
                            }""",
                            {"root": str(root), "manifest": "bootstrap.manifest.json"},
                        )
                        self.assertEqual(status_payload["status"], "ok")
                        self.assertIn("result", status_payload)
                        run_log = status_payload["result"]["recent"]["run_log"]
                        self.assertGreaterEqual(len(run_log), 3)
                        export_entries = [item for item in run_log if str(item.get("run_type", "")).lower() == "export"]
                        modify_entries = [item for item in run_log if str(item.get("run_type", "")).lower() == "modify"]
                        self.assertGreaterEqual(len(export_entries), 1)
                        self.assertGreaterEqual(len(modify_entries), 1)
                        self.assertEqual(str(export_entries[0].get("run_id", "")), export_run_id)
                        self.assertEqual(str(modify_entries[0].get("run_id", "")), modify_run_id)
                        publish_runs = status_payload["result"]["recent"]["publish_runs"]
                        self.assertGreaterEqual(len(publish_runs), 1)
                        self.assertEqual(str(publish_runs[0].get("run_id", "")), export_run_id)
                    finally:
                        context.close()
                        browser.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2.0)

    def test_ui_browser_modify_failure_keeps_local_edits(self) -> None:
        frontend_index = ui_shell_module.FRONTEND_DIST_DIR / "index.html"
        if not frontend_index.exists():
            self.skipTest("frontend dist 不存在，無法做真 browser mutation smoke（請先 pnpm build）")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            ctx = self._ctx(root, workflow="dsp")
            dispatch_action(ctx, {"action": "bootstrap"})
            dispatch_action(ctx, {"action": "save", "rows": [self._full_row()]})

            try:
                server = ThreadingHTTPServer(("127.0.0.1", 0), UiRequestHandler)
            except PermissionError:
                self.skipTest("sandbox 禁止本地 socket bind，略過 browser mutation smoke")

            try:
                from playwright.sync_api import Error as PlaywrightError
                from playwright.sync_api import sync_playwright
            except Exception:
                self.skipTest("缺少 playwright 依賴，請先安裝 playwright 並執行 playwright install chromium")

            original_dispatch_action = ui_shell_module.dispatch_action

            def _failing_dispatch_action(local_ctx: UiContext, payload: dict[str, object]) -> dict[str, object]:
                if str(payload.get("action") or "").strip() == "modify":
                    raise ValueError("simulated modify failure")
                return original_dispatch_action(local_ctx, payload)

            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                base_url = f"http://{host}:{port}"
                with patch.object(ui_shell_module, "dispatch_action", side_effect=_failing_dispatch_action):
                    with sync_playwright() as p:
                        try:
                            browser = p.chromium.launch(headless=True)
                        except PlaywrightError as exc:
                            self.skipTest(f"playwright browser context 無法啟動，請先 playwright install chromium: {exc}")
                        page = browser.new_page()
                        try:
                            query = urlencode(
                                {
                                    "root": str(root),
                                    "manifest": "bootstrap.manifest.json",
                                    "workflow": "dsp",
                                    "template_version": "v1",
                                    "rule_version": "v1",
                                    "artifact_root": "artifacts",
                                }
                            )
                            page.goto(f"{base_url}/?{query}", wait_until="domcontentloaded")
                            page.locator("[data-testid='main-tab-dsp-tab3']").click()
                            page.locator("[data-testid='sub-tab-rawdata']").click()
                            rawdata_workspace = page.locator("[data-testid='section-rawdata']")
                            editable_inputs = rawdata_workspace.locator("tbody tr input")
                            self.assertGreaterEqual(editable_inputs.count(), 1)
                            target_input = editable_inputs.first
                            before_value = target_input.input_value()
                            after_value = f"{before_value}_failcase"
                            target_input.fill(after_value)
                            with page.expect_response(lambda resp: resp.request.method == "POST" and "/api/action" in resp.url) as modify_resp:
                                page.locator("[data-testid='action-modify']").click()
                            modify_payload = modify_resp.value.request.post_data_json
                            if callable(modify_payload):
                                modify_payload = modify_payload()
                            self.assertIsInstance(modify_payload, dict)
                            self.assertEqual(modify_payload.get("action"), "modify")
                            self.assertGreaterEqual(len(modify_payload.get("updates") or []), 1)
                            modify_result = modify_resp.value.json()
                            self.assertEqual(modify_result.get("status"), "error")
                            self.assertEqual(modify_result.get("error_code"), "UI_ACTION_FAILED")
                            page.wait_for_timeout(120)
                            self.assertEqual(target_input.input_value(), after_value)
                            self.assertIn(f"dirty_rows: {self._fmt_num(1)}", rawdata_workspace.inner_text())
                        finally:
                            browser.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2.0)


if __name__ == "__main__":
    unittest.main()
