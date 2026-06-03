from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from domain.contracts import FieldContract
from infra.sqlite.ssp_media_demand import (
    build_ssp_media_demand_view,
    normalize_ssp_media_slot,
    resolve_default_ssp_media_slots,
)


@dataclass(frozen=True)
class TraceMeta:
    source_db_hash: str
    canonical_token: str
    template_version: str
    rule_version: str
    artifact_checksum: str
    template_id: str
    mapping_version: str
    rule_hash: str


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


SSP_RAW_COLUMNS = [
    "source",
    "ts",
    "date",
    "hour",
    "placement_id",
    "placement_name",
    "request",
    "impression",
    "clicks",
    "revenue",
    "dsp_amount",
    "order_id",
    "order_name",
    "supplier_id",
    "supplier_name",
    "site_id",
    "site_name",
]

SSP_RAW_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ssp_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  hour INTEGER NOT NULL DEFAULT 0,
  placement_id INTEGER NOT NULL DEFAULT 0,
  placement_name TEXT NOT NULL DEFAULT '',
  request REAL NOT NULL DEFAULT 0.0,
  impression REAL NOT NULL DEFAULT 0.0,
  clicks REAL NOT NULL DEFAULT 0.0,
  revenue REAL NOT NULL DEFAULT 0.0,
  dsp_amount REAL NOT NULL DEFAULT 0.0,
  order_id TEXT NOT NULL DEFAULT '',
  order_name TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER NOT NULL DEFAULT 0,
  supplier_name TEXT NOT NULL DEFAULT '',
  site_id INTEGER NOT NULL DEFAULT 0,
  site_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ssp_raw_row ON ssp_raw(row_order);
"""

SSP_MEDIA_SLOT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ssp_media_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runtime_env TEXT NOT NULL DEFAULT 'prod',
  category TEXT NOT NULL DEFAULT '',
  slot_order INTEGER NOT NULL DEFAULT 0,
  placement_id TEXT NOT NULL DEFAULT '',
  placement_name TEXT NOT NULL DEFAULT '',
  media_quality TEXT NOT NULL DEFAULT '',
  need_call INTEGER NOT NULL DEFAULT 0,
  target_fr TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  media_target REAL NOT NULL DEFAULT 0.0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ssp_media_slots_env_category
ON ssp_media_slots(runtime_env, category, slot_order);
"""

SSP_AD_GROUP_MONITOR_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ssp_ad_group_report_runs (
  run_id TEXT PRIMARY KEY,
  zone_group_id INTEGER NOT NULL DEFAULT 0,
  start_day TEXT NOT NULL DEFAULT '',
  end_day TEXT NOT NULL DEFAULT '',
  report_id INTEGER NOT NULL DEFAULT 0,
  records_total INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  request_payload_json TEXT NOT NULL DEFAULT '{}',
  response_payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ssp_ad_group_report_runs_group_range
ON ssp_ad_group_report_runs(zone_group_id, start_day, end_day);

CREATE TABLE IF NOT EXISTS ssp_ad_group_daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  zone_group_id INTEGER NOT NULL DEFAULT 0,
  zone_group_name TEXT NOT NULL DEFAULT '',
  ad_format TEXT NOT NULL DEFAULT '',
  price_tier TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  zone_id INTEGER NOT NULL DEFAULT 0,
  zone_name TEXT NOT NULL DEFAULT '',
  request REAL NOT NULL DEFAULT 0.0,
  impress REAL NOT NULL DEFAULT 0.0,
  active_view REAL NOT NULL DEFAULT 0.0,
  active_view_rate REAL NOT NULL DEFAULT 0.0,
  click REAL NOT NULL DEFAULT 0.0,
  ctr REAL NOT NULL DEFAULT 0.0,
  ecpm REAL NOT NULL DEFAULT 0.0,
  ecpc REAL NOT NULL DEFAULT 0.0,
  invalid_impress REAL NOT NULL DEFAULT 0.0,
  invalid_click REAL NOT NULL DEFAULT 0.0,
  profit REAL NOT NULL DEFAULT 0.0,
  site_mu REAL NOT NULL DEFAULT 0.0,
  advertiser_mu REAL NOT NULL DEFAULT 0.0,
  dsp_ecpm REAL NOT NULL DEFAULT 0.0,
  dsp_ecpc REAL NOT NULL DEFAULT 0.0,
  updated_at TEXT NOT NULL DEFAULT '',
  UNIQUE(zone_group_id, date, zone_id)
);
CREATE INDEX IF NOT EXISTS idx_ssp_ad_group_metrics_group_date
ON ssp_ad_group_daily_metrics(zone_group_id, date);
CREATE INDEX IF NOT EXISTS idx_ssp_ad_group_metrics_format_tier
ON ssp_ad_group_daily_metrics(ad_format, price_tier, date);
"""

SSP_AD_GROUP_METRIC_COLUMNS = [
    "source",
    "zone_group_id",
    "zone_group_name",
    "ad_format",
    "price_tier",
    "date",
    "zone_id",
    "zone_name",
    "request",
    "impress",
    "active_view",
    "active_view_rate",
    "click",
    "ctr",
    "ecpm",
    "ecpc",
    "invalid_impress",
    "invalid_click",
    "profit",
    "site_mu",
    "advertiser_mu",
    "dsp_ecpm",
    "dsp_ecpc",
]

MONTHLY_P4_TARGET_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS monthly_p4_targets (
  target_year INTEGER NOT NULL DEFAULT 2026,
  item_key TEXT NOT NULL DEFAULT '',
  month_index INTEGER NOT NULL DEFAULT 1,
  target_value REAL NOT NULL DEFAULT 0.0,
  label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(target_year, item_key, month_index)
);
CREATE INDEX IF NOT EXISTS idx_monthly_p4_targets_year_item
ON monthly_p4_targets(target_year, item_key, sort_order);
"""

MONTHLY_P4_MANUAL_INPUT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS monthly_p4_manual_inputs (
  month TEXT NOT NULL DEFAULT '',
  input_key TEXT NOT NULL DEFAULT '',
  input_value REAL NOT NULL DEFAULT 0.0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(month, input_key)
);
CREATE INDEX IF NOT EXISTS idx_monthly_p4_manual_inputs_month
ON monthly_p4_manual_inputs(month);
"""

MONTHLY_P4_CLOSED_METRIC_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS monthly_p4_closed_metrics (
  month TEXT NOT NULL DEFAULT '',
  metric_key TEXT NOT NULL DEFAULT '',
  metric_value REAL NOT NULL DEFAULT 0.0,
  source TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  source_cell TEXT NOT NULL DEFAULT '',
  source_payload_json TEXT NOT NULL DEFAULT '{}',
  closed_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(month, metric_key)
);
CREATE INDEX IF NOT EXISTS idx_monthly_p4_closed_metrics_month
ON monthly_p4_closed_metrics(month);
"""

MONTHLY_P4_TEST_INPUT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS monthly_p4_test_inputs (
  test_id TEXT NOT NULL DEFAULT 'default',
  month TEXT NOT NULL DEFAULT '',
  input_key TEXT NOT NULL DEFAULT '',
  input_value REAL NOT NULL DEFAULT 0.0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(test_id, month, input_key)
);
CREATE INDEX IF NOT EXISTS idx_monthly_p4_test_inputs_case_month
ON monthly_p4_test_inputs(test_id, month);
"""

MONTHLY_P4_TEST_TEMPLATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS monthly_p4_test_templates (
  test_id TEXT NOT NULL DEFAULT 'default',
  template_kind TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL DEFAULT '',
  stored_path TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  sheet_names_json TEXT NOT NULL DEFAULT '[]',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(test_id, template_kind)
);
CREATE INDEX IF NOT EXISTS idx_monthly_p4_test_templates_case
ON monthly_p4_test_templates(test_id, template_kind);
"""

MONTHLY_DSP_ARCHIVE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS monthly_dsp_archives (
  month TEXT PRIMARY KEY,
  workflow TEXT NOT NULL DEFAULT 'dsp',
  marker TEXT NOT NULL DEFAULT '',
  source_row_count INTEGER NOT NULL DEFAULT 0,
  archive_row_count INTEGER NOT NULL DEFAULT 0,
  source_total REAL NOT NULL DEFAULT 0.0,
  archive_total REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '',
  archived_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_monthly_dsp_archives_workflow
ON monthly_dsp_archives(workflow, month);
"""

MONTHLY_REPORT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS monthly_report_runs (
  run_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT '',
  report_kind TEXT NOT NULL DEFAULT '',
  start_day TEXT NOT NULL DEFAULT '',
  end_day TEXT NOT NULL DEFAULT '',
  report_id INTEGER NOT NULL DEFAULT 0,
  records_total INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  pb INTEGER NOT NULL DEFAULT 1,
  request_payload_json TEXT NOT NULL DEFAULT '{}',
  response_payload_json TEXT NOT NULL DEFAULT '{}',
  sum_row_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_monthly_report_runs_kind_range
ON monthly_report_runs(report_kind, start_day, end_day);

CREATE TABLE IF NOT EXISTS monthly_report_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  month TEXT NOT NULL DEFAULT '',
  data_time TEXT NOT NULL DEFAULT '',
  zone_id INTEGER NOT NULL DEFAULT 0,
  zone_name TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL DEFAULT '',
  creative_size_id TEXT NOT NULL DEFAULT '',
  ad_format TEXT NOT NULL DEFAULT '',
  ad_format_rule TEXT NOT NULL DEFAULT '',
  request REAL NOT NULL DEFAULT 0.0,
  request_including_padding REAL NOT NULL DEFAULT 0.0,
  request_excluding_padding REAL NOT NULL DEFAULT 0.0,
  impress REAL NOT NULL DEFAULT 0.0,
  active_view REAL NOT NULL DEFAULT 0.0,
  active_view_rate REAL NOT NULL DEFAULT 0.0,
  click REAL NOT NULL DEFAULT 0.0,
  ctr REAL NOT NULL DEFAULT 0.0,
  ecpm REAL NOT NULL DEFAULT 0.0,
  ecpc REAL NOT NULL DEFAULT 0.0,
  invalid_impress REAL NOT NULL DEFAULT 0.0,
  invalid_click REAL NOT NULL DEFAULT 0.0,
  profit REAL NOT NULL DEFAULT 0.0,
  site_mu REAL NOT NULL DEFAULT 0.0,
  advertiser_mu REAL NOT NULL DEFAULT 0.0,
  dsp_ecpm REAL NOT NULL DEFAULT 0.0,
  dsp_ecpc REAL NOT NULL DEFAULT 0.0,
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_monthly_report_rows_month
ON monthly_report_rows(month);
CREATE INDEX IF NOT EXISTS idx_monthly_report_rows_zone
ON monthly_report_rows(month, zone_id);

CREATE TABLE IF NOT EXISTS monthly_country_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  month TEXT NOT NULL DEFAULT '',
  data_time TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  country_scope TEXT NOT NULL DEFAULT 'total',
  zone_group_id INTEGER NOT NULL DEFAULT 0,
  request REAL NOT NULL DEFAULT 0.0,
  impress REAL NOT NULL DEFAULT 0.0,
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_monthly_country_rows_month_country
ON monthly_country_rows(month, country);

CREATE TABLE IF NOT EXISTS monthly_chart_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  chart_key TEXT NOT NULL DEFAULT '',
  month TEXT NOT NULL DEFAULT '',
  start_day TEXT NOT NULL DEFAULT '',
  end_day TEXT NOT NULL DEFAULT '',
  source_run_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_monthly_chart_snapshots_key_month
ON monthly_chart_snapshots(chart_key, month, created_at);

CREATE TABLE IF NOT EXISTS monthly_zone_groups (
  group_id INTEGER NOT NULL DEFAULT 0,
  group_name TEXT NOT NULL DEFAULT '',
  zone_id INTEGER NOT NULL DEFAULT 0,
  zone_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(group_id, zone_id)
);
"""

MONTHLY_REPORT_ROW_COLUMNS = [
    "source",
    "month",
    "data_time",
    "zone_id",
    "zone_name",
    "campaign_id",
    "campaign_name",
    "creative_size_id",
    "ad_format",
    "ad_format_rule",
    "request",
    "request_including_padding",
    "request_excluding_padding",
    "impress",
    "impress_including_padding",
    "impress_excluding_padding",
    "active_view",
    "active_view_rate",
    "click",
    "ctr",
    "ecpm",
    "ecpc",
    "invalid_impress",
    "invalid_click",
    "profit",
    "site_mu",
    "advertiser_mu",
    "dsp_ecpm",
    "dsp_ecpc",
]

MONTHLY_P4_DEFAULT_TARGETS: list[dict[str, object]] = [
    {
        "item_key": "mf_marketing",
        "label": "內經銷商-營銷處",
        "sort_order": 10,
        "values": [7193000, 5273000, 4714000, 5012000, 5551000, 6115000, 7080000, 7030000, 7030000, 7055000, 7619000, 8584000],
    },
    {
        "item_key": "mf_strategy",
        "label": "內經銷商-策略部",
        "sort_order": 20,
        "values": [150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000],
    },
    {
        "item_key": "external_total",
        "label": "外_經銷商(自操)",
        "sort_order": 30,
        "values": [1175000, 1175000, 1345000, 1350000, 1295000, 1455000, 1300000, 1355000, 1640000, 1285000, 1385000, 1445000],
    },
    {
        "item_key": "hb_revenue",
        "label": "串接收入 (HB)",
        "sort_order": 40,
        "values": [110000, 110000, 110000, 110000, 150000, 150000, 150000, 150000, 170000, 170000, 170000, 170000],
    },
    {
        "item_key": "external_beiliu_io",
        "label": "外部經銷商北流委刊IO",
        "sort_order": 50,
        "values": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    {
        "item_key": "data_fee",
        "label": "數據費: 外經銷,自操額5%",
        "sort_order": 60,
        "values": [51250, 51250, 59750, 60000, 57250, 65250, 57500, 60250, 74000, 56750, 61250, 64250],
    },
    {
        "item_key": "remaining_traffic_revenue",
        "label": "剩餘流量變現(無成本)",
        "sort_order": 70,
        "values": [168000, 168000, 168000, 168000, 168000, 168000, 168000, 168000, 168000, 168000, 168000, 168000],
    },
]


class SQLiteRepository:
    def __init__(self, db_path: Path, *, project_root: Path | None = None, field_contract: FieldContract | None = None) -> None:
        self.db_path = db_path.resolve()
        if field_contract is None and project_root is None:
            raise ValueError("SQLiteRepository 需要明確 project_root 或 field_contract")
        self.project_root = project_root.resolve() if project_root is not None else None
        self.field_contract = field_contract or FieldContract.load(self.project_root / "contracts" / "fields_contract.json")
        self.canonical_columns = self.field_contract.field_names
        self.modify_allowed_columns = self.field_contract.manual_fields

    def connect(self) -> sqlite3.Connection:
        if not self.db_path.exists():
            raise FileNotFoundError(f"DB 不存在: {self.db_path}")
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    @property
    def monthly_report_db_path(self) -> Path:
        if self.project_root is not None:
            return (self.project_root / "data" / "monthly_report.sqlite").resolve()
        return (self.db_path.parent / "monthly_report.sqlite").resolve()

    def connect_monthly_report(self) -> sqlite3.Connection:
        db_path = self.monthly_report_db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path), timeout=30.0)
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    def _hash_payload(self, payload: object) -> str:
        data = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.sha256(data.encode("utf-8")).hexdigest()

    def _read_canonical_snapshot(self, conn: sqlite3.Connection, workflow: str) -> list[dict]:
        cur = conn.execute(
            "SELECT row_order, " + ", ".join(self.canonical_columns) + ", updated_at FROM canonical_raw WHERE workflow = ? ORDER BY row_order ASC",
            (workflow,),
        )
        rows: list[dict] = []
        for raw in cur.fetchall():
            row: dict[str, object] = {
                "row_order": int(raw[0]),
            }
            for idx, col in enumerate(self.canonical_columns, start=1):
                row[col] = raw[idx]
            row["updated_at"] = raw[len(self.canonical_columns) + 1]
            rows.append(row)
        return rows

    def _read_workflow_snapshot(self, conn: sqlite3.Connection, workflow: str) -> list[dict]:
        if workflow == "ssp":
            return self.read_ssp_raw_rows_in_tx(conn)
        return self._read_canonical_snapshot(conn, workflow)

    def workflow_columns(self, workflow: str) -> list[str]:
        if workflow == "ssp":
            return list(SSP_RAW_COLUMNS)
        return list(self.canonical_columns)

    def canonical_token(self, conn: sqlite3.Connection, workflow: str) -> str:
        rows = self._read_workflow_snapshot(conn, workflow)
        return self._hash_payload(rows)

    def _ensure_tables(self, conn: sqlite3.Connection) -> None:
        exists = conn.execute(
            "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='canonical_raw'"
        ).fetchone()
        if not exists or int(exists[0] or 0) <= 0:
            raise RuntimeError("缺少 canonical_raw，請先執行 bootstrap init")

    def _ensure_ssp_raw_table(self, conn: sqlite3.Connection) -> None:
        conn.executescript(SSP_RAW_TABLE_SQL)

    def _ensure_ssp_media_slots_table(self, conn: sqlite3.Connection) -> None:
        conn.executescript(SSP_MEDIA_SLOT_TABLE_SQL)
        existing_columns = {
            str(row[1] or "")
            for row in conn.execute("PRAGMA table_info(ssp_media_slots)").fetchall()
            if row
        }
        required_columns = {
            "media_quality": "TEXT NOT NULL DEFAULT ''",
            "need_call": "INTEGER NOT NULL DEFAULT 0",
            "target_fr": "TEXT NOT NULL DEFAULT ''",
        }
        for column_name, column_sql in required_columns.items():
            if column_name not in existing_columns:
                conn.execute(f"ALTER TABLE ssp_media_slots ADD COLUMN {column_name} {column_sql}")

    def _ensure_ssp_ad_group_monitor_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(SSP_AD_GROUP_MONITOR_TABLE_SQL)
        existing_columns = {
            str(row[1] or "")
            for row in conn.execute("PRAGMA table_info(ssp_ad_group_daily_metrics)").fetchall()
            if row
        }
        required_columns = {
            "zone_group_name": "TEXT NOT NULL DEFAULT ''",
            "ad_format": "TEXT NOT NULL DEFAULT ''",
            "price_tier": "TEXT NOT NULL DEFAULT ''",
        }
        for column_name, column_sql in required_columns.items():
            if column_name not in existing_columns:
                conn.execute(f"ALTER TABLE ssp_ad_group_daily_metrics ADD COLUMN {column_name} {column_sql}")

    def _ensure_monthly_p4_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(MONTHLY_P4_TARGET_TABLE_SQL)
        conn.executescript(MONTHLY_P4_MANUAL_INPUT_TABLE_SQL)
        conn.executescript(MONTHLY_P4_CLOSED_METRIC_TABLE_SQL)
        existing = conn.execute("SELECT COUNT(1) FROM monthly_p4_targets").fetchone()
        if existing and int(existing[0] or 0) > 0:
            return
        now = _now()
        for item in MONTHLY_P4_DEFAULT_TARGETS:
            values = list(item["values"])
            for idx, value in enumerate(values, start=1):
                conn.execute(
                    """
                    INSERT OR REPLACE INTO monthly_p4_targets(
                      target_year, item_key, month_index, target_value, label, sort_order, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        2026,
                        str(item["item_key"]),
                        idx,
                        float(value or 0.0),
                        str(item["label"]),
                        int(item["sort_order"]),
                        now,
                    ),
                )

    def _ensure_monthly_p4_test_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(MONTHLY_P4_TEST_INPUT_TABLE_SQL)
        conn.executescript(MONTHLY_P4_TEST_TEMPLATE_TABLE_SQL)
        existing_columns = {
            str(row[1] or "")
            for row in conn.execute("PRAGMA table_info(monthly_p4_test_templates)").fetchall()
            if row
        }
        if "snapshot_json" not in existing_columns:
            conn.execute("ALTER TABLE monthly_p4_test_templates ADD COLUMN snapshot_json TEXT NOT NULL DEFAULT '{}'")

    def _ensure_monthly_dsp_archive_table(self, conn: sqlite3.Connection) -> None:
        conn.executescript(MONTHLY_DSP_ARCHIVE_TABLE_SQL)

    def _ensure_monthly_report_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(MONTHLY_REPORT_TABLE_SQL)
        existing_columns = {
            str(row[1] or "")
            for row in conn.execute("PRAGMA table_info(monthly_report_rows)").fetchall()
            if row
        }
        required_columns = {
            "ad_format": "TEXT NOT NULL DEFAULT ''",
            "ad_format_rule": "TEXT NOT NULL DEFAULT ''",
            "request_including_padding": "REAL NOT NULL DEFAULT 0.0",
            "request_excluding_padding": "REAL NOT NULL DEFAULT 0.0",
            "impress_including_padding": "REAL NOT NULL DEFAULT 0.0",
            "impress_excluding_padding": "REAL NOT NULL DEFAULT 0.0",
        }
        for column_name, column_sql in required_columns.items():
            if column_name not in existing_columns:
                conn.execute(f"ALTER TABLE monthly_report_rows ADD COLUMN {column_name} {column_sql}")
        country_columns = {
            str(row[1] or "")
            for row in conn.execute("PRAGMA table_info(monthly_country_rows)").fetchall()
            if row
        }
        country_required_columns = {
            "country_scope": "TEXT NOT NULL DEFAULT 'total'",
            "zone_group_id": "INTEGER NOT NULL DEFAULT 0",
        }
        for column_name, column_sql in country_required_columns.items():
            if column_name not in country_columns:
                conn.execute(f"ALTER TABLE monthly_country_rows ADD COLUMN {column_name} {column_sql}")
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_monthly_country_rows_month_scope
            ON monthly_country_rows(month, country_scope, zone_group_id)
            """
        )

    def save_canonical_rows(self, conn: sqlite3.Connection, workflow: str, rows: list[dict]) -> int:
        self._ensure_tables(conn)
        conn.execute("DELETE FROM canonical_raw WHERE workflow = ?", (workflow,))
        now = _now()
        for idx, row in enumerate(rows):
            values = [row.get(col, self.field_contract.by_name[col].default) for col in self.canonical_columns]
            normalized = []
            for i, v in enumerate(values):
                col = self.canonical_columns[i]
                spec = self.field_contract.by_name[col]
                if spec.field_type == "real":
                    try:
                        normalized.append(float(v))
                    except Exception:
                        normalized.append(float(spec.default or 0.0))
                else:
                    normalized.append(str(v or ""))
            insert_columns = ["workflow", "row_order", *self.canonical_columns, "updated_at"]
            placeholders = ", ".join("?" for _ in insert_columns)
            columns_sql = ", ".join(insert_columns)
            conn.execute(
                f"INSERT INTO canonical_raw({columns_sql}) VALUES ({placeholders})",
                (workflow, idx, *normalized, now),
            )
        return len(rows)

    def replace_canonical_rows(self, workflow: str, rows: list[dict]) -> int:
        with self.connect() as conn:
            changed = self.save_canonical_rows(conn, workflow, rows)
            conn.commit()
            return changed

    def save_ssp_raw_rows(self, conn: sqlite3.Connection, rows: list[dict]) -> int:
        self._ensure_ssp_raw_table(conn)
        conn.execute("DELETE FROM ssp_raw")
        now = _now()
        for idx, row in enumerate(rows):
            values = [row.get(col, "") for col in SSP_RAW_COLUMNS]
            normalized: list[object] = []
            for col, value in zip(SSP_RAW_COLUMNS, values):
                if col in {"hour", "placement_id", "supplier_id", "site_id"}:
                    try:
                        normalized.append(int(value or 0))
                    except Exception:
                        normalized.append(0)
                elif col in {"request", "impression", "clicks", "revenue", "dsp_amount"}:
                    try:
                        normalized.append(float(value or 0.0))
                    except Exception:
                        normalized.append(0.0)
                else:
                    normalized.append(str(value or ""))
            columns_sql = ", ".join(["row_order", *SSP_RAW_COLUMNS, "updated_at"])
            placeholders = ", ".join("?" for _ in range(len(SSP_RAW_COLUMNS) + 2))
            conn.execute(
                f"INSERT INTO ssp_raw({columns_sql}) VALUES ({placeholders})",
                (idx, *normalized, now),
            )
        return len(rows)

    def replace_ssp_raw_rows(self, rows: list[dict]) -> int:
        with self.connect() as conn:
            changed = self.save_ssp_raw_rows(conn, rows)
            conn.commit()
            return changed

    def save_ssp_ad_group_report(
        self,
        conn: sqlite3.Connection,
        *,
        run_id: str,
        zone_group_id: int,
        start_day: str,
        end_day: str,
        report_id: int,
        records_total: int,
        source: str,
        request_payload: dict,
        response_payload: dict,
        rows: list[dict],
    ) -> int:
        self._ensure_ssp_ad_group_monitor_tables(conn)
        now = _now()
        conn.execute(
            """
            INSERT OR REPLACE INTO ssp_ad_group_report_runs(
              run_id, zone_group_id, start_day, end_day, report_id, records_total,
              row_count, source, request_payload_json, response_payload_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                int(zone_group_id),
                str(start_day),
                str(end_day),
                int(report_id),
                int(records_total),
                len(rows),
                str(source or ""),
                json.dumps(request_payload, ensure_ascii=False, sort_keys=True, default=str),
                json.dumps(response_payload, ensure_ascii=False, sort_keys=True, default=str),
                now,
            ),
        )
        conn.execute(
            """
            DELETE FROM ssp_ad_group_daily_metrics
            WHERE zone_group_id = ? AND date >= ? AND date <= ?
            """,
            (int(zone_group_id), str(start_day), str(end_day)),
        )
        for row in rows:
            normalized: list[object] = []
            for col in SSP_AD_GROUP_METRIC_COLUMNS:
                value = row.get(col, "")
                if col in {"zone_group_id", "zone_id"}:
                    try:
                        normalized.append(int(value or 0))
                    except Exception:
                        normalized.append(0)
                elif col in {
                    "request",
                    "request_including_padding",
                    "request_excluding_padding",
                    "impress",
                    "impress_including_padding",
                    "impress_excluding_padding",
                    "active_view",
                    "active_view_rate",
                    "click",
                    "ctr",
                    "ecpm",
                    "ecpc",
                    "invalid_impress",
                    "invalid_click",
                    "profit",
                    "site_mu",
                    "advertiser_mu",
                    "dsp_ecpm",
                    "dsp_ecpc",
                }:
                    try:
                        normalized.append(float(value or 0.0))
                    except Exception:
                        normalized.append(0.0)
                else:
                    normalized.append(str(value or ""))
            columns_sql = ", ".join(["run_id", *SSP_AD_GROUP_METRIC_COLUMNS, "updated_at"])
            placeholders = ", ".join("?" for _ in range(len(SSP_AD_GROUP_METRIC_COLUMNS) + 2))
            conn.execute(
                f"INSERT OR REPLACE INTO ssp_ad_group_daily_metrics({columns_sql}) VALUES ({placeholders})",
                (run_id, *normalized, now),
            )
        return len(rows)

    def save_monthly_report_rows(
        self,
        conn: sqlite3.Connection,
        *,
        run_id: str,
        report_kind: str,
        start_day: str,
        end_day: str,
        report_id: int,
        records_total: int,
        source: str,
        pb: int,
        request_payload: dict,
        response_payload: dict,
        sum_row: dict,
        rows: list[dict],
    ) -> int:
        self._ensure_monthly_report_tables(conn)
        now = _now()
        conn.execute(
            """
            INSERT OR REPLACE INTO monthly_report_runs(
              run_id, source, report_kind, start_day, end_day, report_id, records_total,
              row_count, pb, request_payload_json, response_payload_json, sum_row_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                str(source or ""),
                str(report_kind or ""),
                str(start_day),
                str(end_day),
                int(report_id),
                int(records_total),
                len(rows),
                int(pb),
                json.dumps(request_payload, ensure_ascii=False, sort_keys=True, default=str),
                json.dumps(response_payload, ensure_ascii=False, sort_keys=True, default=str),
                json.dumps(sum_row, ensure_ascii=False, sort_keys=True, default=str),
                now,
            ),
        )
        months = sorted({str(row.get("month") or "") for row in rows if str(row.get("month") or "").strip()})
        for month in months:
            conn.execute("DELETE FROM monthly_report_rows WHERE month = ?", (month,))
            conn.execute("DELETE FROM monthly_chart_snapshots WHERE month = ?", (month,))
        for row in rows:
            normalized: list[object] = []
            for col in MONTHLY_REPORT_ROW_COLUMNS:
                value = row.get(col, "")
                if col == "zone_id":
                    try:
                        normalized.append(int(value or 0))
                    except Exception:
                        normalized.append(0)
                elif col in {
                    "request",
                    "request_including_padding",
                    "request_excluding_padding",
                    "impress",
                    "impress_including_padding",
                    "impress_excluding_padding",
                    "active_view",
                    "active_view_rate",
                    "click",
                    "ctr",
                    "ecpm",
                    "ecpc",
                    "invalid_impress",
                    "invalid_click",
                    "profit",
                    "site_mu",
                    "advertiser_mu",
                    "dsp_ecpm",
                    "dsp_ecpc",
                }:
                    try:
                        normalized.append(float(value or 0.0))
                    except Exception:
                        normalized.append(0.0)
                else:
                    normalized.append(str(value or ""))
            columns_sql = ", ".join(["run_id", *MONTHLY_REPORT_ROW_COLUMNS, "updated_at"])
            placeholders = ", ".join("?" for _ in range(len(MONTHLY_REPORT_ROW_COLUMNS) + 2))
            conn.execute(
                f"INSERT INTO monthly_report_rows({columns_sql}) VALUES ({placeholders})",
                (run_id, *normalized, now),
            )
        return len(rows)

    def read_monthly_report_rows(self, *, month: str) -> list[dict[str, object]]:
        with self.connect_monthly_report() as conn:
            self._ensure_monthly_report_tables(conn)
            cur = conn.execute(
                """
                SELECT id, run_id, source, month, data_time, zone_id, zone_name, campaign_id,
                  campaign_name, creative_size_id, ad_format, ad_format_rule, request,
                  request_including_padding, request_excluding_padding, impress,
                  impress_including_padding, impress_excluding_padding, active_view, active_view_rate,
                  click, ctr, ecpm, ecpc, invalid_impress, invalid_click, profit, site_mu,
                  advertiser_mu, dsp_ecpm, dsp_ecpc, updated_at
                FROM monthly_report_rows
                WHERE month = ?
                ORDER BY zone_id ASC, campaign_id ASC, creative_size_id ASC, id ASC
                """,
                (str(month),),
            )
            keys = [
                "id",
                "run_id",
                "source",
                "month",
                "data_time",
                "zone_id",
                "zone_name",
                "campaign_id",
                "campaign_name",
                "creative_size_id",
                "ad_format",
                "ad_format_rule",
                "request",
                "request_including_padding",
                "request_excluding_padding",
                "impress",
                "impress_including_padding",
                "impress_excluding_padding",
                "active_view",
                "active_view_rate",
                "click",
                "ctr",
                "ecpm",
                "ecpc",
                "invalid_impress",
                "invalid_click",
                "profit",
                "site_mu",
                "advertiser_mu",
                "dsp_ecpm",
                "dsp_ecpc",
                "updated_at",
            ]
            return [dict(zip(keys, raw)) for raw in cur.fetchall()]

    def save_monthly_country_rows(self, conn: sqlite3.Connection, *, run_id: str, rows: list[dict]) -> int:
        self._ensure_monthly_report_tables(conn)
        months = sorted({str(row.get("month") or "") for row in rows if str(row.get("month") or "").strip()})
        for month in months:
            conn.execute("DELETE FROM monthly_country_rows WHERE month = ?", (month,))
            conn.execute("DELETE FROM monthly_chart_snapshots WHERE month = ?", (month,))
        now = _now()
        for row in rows:
            conn.execute(
                """
                INSERT INTO monthly_country_rows(
                  run_id, source, month, data_time, country, country_scope, zone_group_id, request, impress, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(run_id),
                    str(row.get("source") or ""),
                    str(row.get("month") or ""),
                    str(row.get("data_time") or ""),
                    str(row.get("country") or ""),
                    str(row.get("country_scope") or "total"),
                    int(row.get("zone_group_id") or 0),
                    float(row.get("request") or 0.0),
                    float(row.get("impress") or 0.0),
                    now,
                ),
            )
        return len(rows)

    def read_monthly_country_rows(self, *, month: str) -> list[dict[str, object]]:
        with self.connect_monthly_report() as conn:
            self._ensure_monthly_report_tables(conn)
            cur = conn.execute(
                """
                SELECT id, run_id, source, month, data_time, country, country_scope, zone_group_id, request, impress, updated_at
                FROM monthly_country_rows
                WHERE month = ?
                ORDER BY data_time ASC, country ASC, id ASC
                """,
                (str(month),),
            )
            keys = [
                "id",
                "run_id",
                "source",
                "month",
                "data_time",
                "country",
                "country_scope",
                "zone_group_id",
                "request",
                "impress",
                "updated_at",
            ]
            return [dict(zip(keys, raw)) for raw in cur.fetchall()]

    def read_latest_monthly_report_run(self, *, report_kind: str, month: str) -> dict[str, object] | None:
        with self.connect_monthly_report() as conn:
            self._ensure_monthly_report_tables(conn)
            raw = conn.execute(
                """
                SELECT run_id, source, report_kind, start_day, end_day, report_id, records_total, row_count, pb, created_at
                FROM monthly_report_runs
                WHERE report_kind = ? AND substr(start_day, 1, 7) <= ? AND substr(end_day, 1, 7) >= ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (str(report_kind), str(month), str(month)),
            ).fetchone()
        if not raw:
            return None
        return {
            "run_id": str(raw[0] or ""),
            "source": str(raw[1] or ""),
            "report_kind": str(raw[2] or ""),
            "start_day": str(raw[3] or ""),
            "end_day": str(raw[4] or ""),
            "report_id": int(raw[5] or 0),
            "records_total": int(raw[6] or 0),
            "row_count": int(raw[7] or 0),
            "pb": int(raw[8] or 0),
            "created_at": str(raw[9] or ""),
        }

    def replace_monthly_zone_group(self, *, group_id: int, group_name: str, zone_ids: list[int]) -> dict[str, object]:
        normalized_ids = sorted({int(zone_id) for zone_id in zone_ids if int(zone_id) > 0})
        now = _now()
        with self.connect_monthly_report() as conn:
            self._ensure_monthly_report_tables(conn)
            conn.execute("DELETE FROM monthly_zone_groups WHERE group_id = ?", (int(group_id),))
            matched_zone_count = 0
            for zone_id in normalized_ids:
                raw = conn.execute(
                    """
                    SELECT zone_name
                    FROM monthly_report_rows
                    WHERE zone_id = ? AND zone_name != ''
                    ORDER BY month DESC, id DESC
                    LIMIT 1
                    """,
                    (zone_id,),
                ).fetchone()
                zone_name = str(raw[0] or "") if raw else ""
                if zone_name:
                    matched_zone_count += 1
                conn.execute(
                    """
                    INSERT OR REPLACE INTO monthly_zone_groups(group_id, group_name, zone_id, zone_name, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (int(group_id), str(group_name or ""), zone_id, zone_name, now),
                )
            conn.commit()
        return {
            "group_id": int(group_id),
            "group_name": str(group_name or ""),
            "zone_count": len(normalized_ids),
            "matched_zone_count": matched_zone_count,
            "updated_at": now,
        }

    def read_monthly_zone_group(self, *, group_id: int) -> dict[str, object]:
        with self.connect_monthly_report() as conn:
            self._ensure_monthly_report_tables(conn)
            rows = conn.execute(
                """
                SELECT group_id, group_name, zone_id, zone_name, updated_at
                FROM monthly_zone_groups
                WHERE group_id = ?
                ORDER BY zone_id ASC
                """,
                (int(group_id),),
            ).fetchall()
        if not rows:
            return {
                "group_id": int(group_id),
                "group_name": "",
                "zone_ids": set(),
                "zones": [],
                "updated_at": "",
            }
        zones = [
            {
                "zone_id": int(row[2] or 0),
                "zone_name": str(row[3] or ""),
            }
            for row in rows
        ]
        return {
            "group_id": int(rows[0][0] or group_id),
            "group_name": str(rows[0][1] or ""),
            "zone_ids": {int(row["zone_id"]) for row in zones},
            "zones": zones,
            "updated_at": str(rows[0][4] or ""),
        }

    def save_monthly_chart_snapshot(
        self,
        *,
        snapshot_id: str,
        chart_key: str,
        month: str,
        start_day: str,
        end_day: str,
        source_run_id: str,
        payload: dict[str, object],
    ) -> None:
        with self.connect_monthly_report() as conn:
            self._ensure_monthly_report_tables(conn)
            conn.execute(
                """
                INSERT OR REPLACE INTO monthly_chart_snapshots(
                  snapshot_id, chart_key, month, start_day, end_day, source_run_id, payload_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot_id,
                    chart_key,
                    month,
                    start_day,
                    end_day,
                    source_run_id,
                    json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str),
                    _now(),
                ),
            )
            conn.commit()

    def read_ssp_ad_group_metrics(
        self,
        *,
        zone_group_id: int,
        start_day: str,
        end_day: str,
    ) -> list[dict[str, object]]:
        with self.connect() as conn:
            return self.read_ssp_ad_group_metrics_in_tx(
                conn,
                zone_group_id=zone_group_id,
                start_day=start_day,
                end_day=end_day,
            )

    def read_ssp_ad_group_metrics_for_groups(
        self,
        *,
        zone_group_ids: list[int],
        start_day: str,
        end_day: str,
    ) -> list[dict[str, object]]:
        with self.connect() as conn:
            self._ensure_ssp_ad_group_monitor_tables(conn)
            normalized_ids = [int(item) for item in zone_group_ids if int(item or 0) > 0]
            if not normalized_ids:
                return []
            placeholders = ", ".join("?" for _ in normalized_ids)
            cur = conn.execute(
                f"""
                SELECT id, run_id, source, zone_group_id, zone_group_name, ad_format, price_tier,
                  date, zone_id, zone_name, request, impress, active_view, active_view_rate,
                  click, ctr, ecpm, ecpc, invalid_impress, invalid_click, profit, site_mu,
                  advertiser_mu, dsp_ecpm, dsp_ecpc, updated_at
                FROM ssp_ad_group_daily_metrics
                WHERE zone_group_id IN ({placeholders}) AND date >= ? AND date <= ?
                ORDER BY date DESC, zone_group_id ASC, request DESC, zone_id ASC
                """,
                (*normalized_ids, str(start_day), str(end_day)),
            )
            keys = [
                "id",
                "run_id",
                "source",
                "zone_group_id",
                "zone_group_name",
                "ad_format",
                "price_tier",
                "date",
                "zone_id",
                "zone_name",
                "request",
                "impress",
                "active_view",
                "active_view_rate",
                "click",
                "ctr",
                "ecpm",
                "ecpc",
                "invalid_impress",
                "invalid_click",
                "profit",
                "site_mu",
                "advertiser_mu",
                "dsp_ecpm",
                "dsp_ecpc",
                "updated_at",
            ]
            return [dict(zip(keys, raw)) for raw in cur.fetchall()]

    def read_latest_ssp_ad_group_runs(
        self,
        *,
        zone_group_ids: list[int],
    ) -> list[dict[str, object]]:
        with self.connect() as conn:
            self._ensure_ssp_ad_group_monitor_tables(conn)
            normalized_ids = [int(item) for item in zone_group_ids if int(item or 0) > 0]
            if not normalized_ids:
                return []
            placeholders = ", ".join("?" for _ in normalized_ids)
            cur = conn.execute(
                f"""
                SELECT r.run_id, r.zone_group_id, r.start_day, r.end_day, r.report_id,
                  r.records_total, r.row_count, r.source, r.created_at
                FROM ssp_ad_group_report_runs r
                JOIN (
                  SELECT zone_group_id, MAX(created_at) AS latest_created_at
                  FROM ssp_ad_group_report_runs
                  WHERE zone_group_id IN ({placeholders})
                  GROUP BY zone_group_id
                ) latest
                  ON latest.zone_group_id = r.zone_group_id
                 AND latest.latest_created_at = r.created_at
                ORDER BY r.zone_group_id ASC
                """,
                tuple(normalized_ids),
            )
            return [
                {
                    "run_id": str(raw[0] or ""),
                    "zone_group_id": int(raw[1] or 0),
                    "start_day": str(raw[2] or ""),
                    "end_day": str(raw[3] or ""),
                    "report_id": int(raw[4] or 0),
                    "records_total": int(raw[5] or 0),
                    "row_count": int(raw[6] or 0),
                    "source": str(raw[7] or ""),
                    "created_at": str(raw[8] or ""),
                }
                for raw in cur.fetchall()
            ]

    def read_ssp_ad_group_metrics_in_tx(
        self,
        conn: sqlite3.Connection,
        *,
        zone_group_id: int,
        start_day: str,
        end_day: str,
    ) -> list[dict[str, object]]:
        self._ensure_ssp_ad_group_monitor_tables(conn)
        cur = conn.execute(
            """
            SELECT id, run_id, source, zone_group_id, zone_group_name, ad_format, price_tier,
              date, zone_id, zone_name, request, impress, active_view, active_view_rate,
              click, ctr, ecpm, ecpc, invalid_impress, invalid_click, profit, site_mu,
              advertiser_mu, dsp_ecpm, dsp_ecpc, updated_at
            FROM ssp_ad_group_daily_metrics
            WHERE zone_group_id = ? AND date >= ? AND date <= ?
            ORDER BY date DESC, request DESC, zone_id ASC
            """,
            (int(zone_group_id), str(start_day), str(end_day)),
        )
        keys = [
            "id",
            "run_id",
            "source",
            "zone_group_id",
            "zone_group_name",
            "ad_format",
            "price_tier",
            "date",
            "zone_id",
            "zone_name",
            "request",
            "impress",
            "active_view",
            "active_view_rate",
            "click",
            "ctr",
            "ecpm",
            "ecpc",
            "invalid_impress",
            "invalid_click",
            "profit",
            "site_mu",
            "advertiser_mu",
            "dsp_ecpm",
            "dsp_ecpc",
            "updated_at",
        ]
        return [dict(zip(keys, raw)) for raw in cur.fetchall()]

    def read_latest_ssp_ad_group_run(
        self,
        *,
        zone_group_id: int,
    ) -> dict[str, object] | None:
        with self.connect() as conn:
            self._ensure_ssp_ad_group_monitor_tables(conn)
            raw = conn.execute(
                """
                SELECT run_id, zone_group_id, start_day, end_day, report_id, records_total, row_count, source, created_at
                FROM ssp_ad_group_report_runs
                WHERE zone_group_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (int(zone_group_id),),
            ).fetchone()
        if not raw:
            return None
        return {
            "run_id": str(raw[0] or ""),
            "zone_group_id": int(raw[1] or 0),
            "start_day": str(raw[2] or ""),
            "end_day": str(raw[3] or ""),
            "report_id": int(raw[4] or 0),
            "records_total": int(raw[5] or 0),
            "row_count": int(raw[6] or 0),
            "source": str(raw[7] or ""),
            "created_at": str(raw[8] or ""),
        }

    def read_ssp_media_slots(self, runtime_env: str) -> list[dict]:
        with self.connect() as conn:
            return self.read_ssp_media_slots_in_tx(conn, runtime_env)

    def read_ssp_media_slots_in_tx(self, conn: sqlite3.Connection, runtime_env: str) -> list[dict]:
        self._ensure_ssp_media_slots_table(conn)
        cur = conn.execute(
            """
            SELECT
              id, runtime_env, category, slot_order, placement_id, placement_name,
              media_quality, need_call, target_fr, remark, media_target, is_active, created_at, updated_at
            FROM ssp_media_slots
            WHERE runtime_env = ?
            ORDER BY category ASC, slot_order ASC, id ASC
            """,
            (runtime_env,),
        )
        rows: list[dict] = []
        for raw in cur.fetchall():
            rows.append(
                {
                    "id": int(raw[0]),
                    "runtime_env": str(raw[1] or ""),
                    "category": str(raw[2] or ""),
                    "slot_order": int(raw[3] or 0),
                    "placement_id": str(raw[4] or ""),
                    "placement_name": str(raw[5] or ""),
                    "media_quality": str(raw[6] or ""),
                    "need_call": bool(int(raw[7] or 0)),
                    "target_fr": str(raw[8] or ""),
                    "remark": str(raw[9] or ""),
                    "media_target": float(raw[10] or 0.0),
                    "is_active": bool(int(raw[11] or 0)),
                    "created_at": str(raw[12] or ""),
                    "updated_at": str(raw[13] or ""),
                }
            )
        return rows

    def replace_ssp_media_slots(self, runtime_env: str, slots: list[dict]) -> int:
        with self.connect() as conn:
            written = self.replace_ssp_media_slots_in_tx(conn, runtime_env, slots)
            conn.commit()
            return written

    def replace_ssp_media_slots_in_tx(self, conn: sqlite3.Connection, runtime_env: str, slots: list[dict]) -> int:
        self._ensure_ssp_media_slots_table(conn)
        conn.execute("DELETE FROM ssp_media_slots WHERE runtime_env = ?", (runtime_env,))
        now = _now()
        written = 0
        by_category: dict[str, list[dict]] = {}
        for item in slots:
            if not isinstance(item, dict):
                continue
            category = str(item.get("category") or "").strip()
            by_category.setdefault(category, []).append(item)
        for category, raw_slots in by_category.items():
            for idx, raw_slot in enumerate(raw_slots):
                slot = normalize_ssp_media_slot(raw_slot, fallback_category=category, fallback_order=idx)
                if not str(slot.get("category") or "").strip():
                    continue
                conn.execute(
                    """
                    INSERT INTO ssp_media_slots(
                      runtime_env, category, slot_order, placement_id, placement_name,
                      media_quality, need_call, target_fr, remark,
                      media_target, is_active, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        runtime_env,
                        str(slot["category"]),
                        int(slot["slot_order"]),
                        str(slot["placement_id"]),
                        str(slot["placement_name"]),
                        str(slot.get("media_quality") or ""),
                        1 if bool(slot.get("need_call")) else 0,
                        str(slot.get("target_fr") or ""),
                        str(slot["remark"]),
                        float(slot["media_target"]),
                        1 if bool(slot["is_active"]) else 0,
                        now,
                        now,
                    ),
                )
                written += 1
        return written

    def resolve_ssp_media_demand_config(self, runtime_env: str, data_seed_root: Path) -> dict[str, object]:
        defaults = resolve_default_ssp_media_slots(self.project_root or Path("."), data_seed_root)
        db_slots = self.read_ssp_media_slots(runtime_env)
        if db_slots:
            default_slots = list(defaults["slots"])
            default_by_key = {
                (
                    str(item.get("category") or "").strip(),
                    str(item.get("placement_id") or "").strip(),
                ): item
                for item in default_slots
                if str(item.get("category") or "").strip() and str(item.get("placement_id") or "").strip()
            }
            default_by_order = {
                (
                    str(item.get("category") or "").strip(),
                    int(item.get("slot_order") or 0),
                ): item
                for item in default_slots
                if str(item.get("category") or "").strip()
            }
            slots = []
            for raw_slot in db_slots:
                default_slot = default_by_key.get(
                    (
                        str(raw_slot.get("category") or "").strip(),
                        str(raw_slot.get("placement_id") or "").strip(),
                    )
                ) or default_by_order.get(
                    (
                        str(raw_slot.get("category") or "").strip(),
                        int(raw_slot.get("slot_order") or 0),
                    )
                ) or {}
                slots.append(
                    normalize_ssp_media_slot(
                        {
                            **default_slot,
                            **raw_slot,
                            "media_quality": str(raw_slot.get("media_quality") or default_slot.get("media_quality") or ""),
                            "need_call": raw_slot.get("need_call", default_slot.get("need_call", False)),
                            "target_fr": str(raw_slot.get("target_fr") or default_slot.get("target_fr") or ""),
                            "remark": str(raw_slot.get("remark") or default_slot.get("remark") or ""),
                            "estimated_request_0722": raw_slot.get("media_target", default_slot.get("media_target", 0.0)),
                        },
                        fallback_category=str(raw_slot.get("category") or ""),
                        fallback_order=int(raw_slot.get("slot_order") or 0),
                    )
                )
        else:
            slots = list(defaults["slots"])
        return {
            "runtime_env": runtime_env,
            "categories": list(defaults["categories"]),
            "slots": slots,
            "defaults_source": str(defaults["defaults_source"]),
            "template_path": str(defaults["template_path"]),
            "group_overrides_path": str(defaults["group_overrides_path"]),
            "storage_source": "db" if db_slots else "defaults",
        }

    def list_ssp_sources_in_tx(self, conn: sqlite3.Connection) -> list[str]:
        self._ensure_ssp_raw_table(conn)
        cur = conn.execute(
            """
            SELECT DISTINCT source
            FROM ssp_raw
            WHERE source != ''
            ORDER BY source ASC
            """
        )
        return [str(raw[0] or "") for raw in cur.fetchall() if str(raw[0] or "").strip()]

    def query_ssp_media_matrix_in_tx(
        self,
        conn: sqlite3.Connection,
        *,
        placement_ids: list[str],
        sources: list[str] | None,
        start_date: str,
        end_date: str,
    ) -> list[dict[str, object]]:
        self._ensure_ssp_raw_table(conn)
        normalized_placement_ids = [int(pid) for pid in placement_ids if str(pid).strip().isdigit()]
        if not normalized_placement_ids or not start_date or not end_date:
            return []

        where_parts = [
            f"placement_id IN ({', '.join('?' for _ in normalized_placement_ids)})",
            "date >= ?",
            "date <= ?",
        ]
        params: list[object] = [*normalized_placement_ids, start_date, end_date]
        if sources:
            normalized_sources = [str(item).strip() for item in sources if str(item).strip()]
            if normalized_sources:
                where_parts.insert(0, f"source IN ({', '.join('?' for _ in normalized_sources)})")
                params = [*normalized_sources, *params]

        sql = f"""
        SELECT
          date,
          placement_id,
          SUM(request) AS request_all,
          SUM(impression) AS impression_all,
          SUM(clicks) AS clicks_all,
          SUM(revenue) AS revenue_all,
          SUM(dsp_amount) AS dsp_amount_all,
          SUM(CASE WHEN hour >= 7 AND hour <= 22 THEN request ELSE 0 END) AS request_0722,
          SUM(CASE WHEN hour >= 7 AND hour <= 22 THEN impression ELSE 0 END) AS impression_0722,
          SUM(CASE WHEN hour >= 7 AND hour <= 22 THEN clicks ELSE 0 END) AS clicks_0722,
          SUM(CASE WHEN hour >= 7 AND hour <= 22 THEN revenue ELSE 0 END) AS revenue_0722,
          SUM(CASE WHEN hour >= 7 AND hour <= 22 THEN dsp_amount ELSE 0 END) AS dsp_amount_0722
        FROM ssp_raw
        WHERE {" AND ".join(where_parts)}
        GROUP BY date, placement_id
        ORDER BY date DESC, placement_id ASC
        """
        cur = conn.execute(sql, tuple(params))
        rows: list[dict[str, object]] = []
        for raw in cur.fetchall():
            rows.append(
                {
                    "date": str(raw[0] or ""),
                    "placement_id": str(int(raw[1] or 0)),
                    "request_all": float(raw[2] or 0.0),
                    "impression_all": float(raw[3] or 0.0),
                    "clicks_all": float(raw[4] or 0.0),
                    "revenue_all": float(raw[5] or 0.0),
                    "dsp_amount_all": float(raw[6] or 0.0),
                    "request_0722": float(raw[7] or 0.0),
                    "impression_0722": float(raw[8] or 0.0),
                    "clicks_0722": float(raw[9] or 0.0),
                    "revenue_0722": float(raw[10] or 0.0),
                    "dsp_amount_0722": float(raw[11] or 0.0),
                }
            )
        return rows

    def resolve_ssp_media_demand_view(
        self,
        *,
        runtime_env: str,
        data_seed_root: Path,
        category: str,
        source: str,
        start_date: str,
        end_date: str,
        scope_mode: str,
        day_limit: int,
        threshold: float,
        only_unmet: bool,
    ) -> dict[str, object]:
        config = self.resolve_ssp_media_demand_config(runtime_env, data_seed_root)
        categories = [str(item or "").strip() for item in list(config.get("categories") or []) if str(item or "").strip()]
        effective_category = category if category in categories else (categories[0] if categories else "")
        effective_source = str(source or "").strip() or "__all__"
        with self.connect() as conn:
            source_options = self.list_ssp_sources_in_tx(conn)
            if effective_source != "__all__" and effective_source not in source_options:
                effective_source = "__all__"
            category_slots = [
                slot for slot in list(config.get("slots") or [])
                if str(slot.get("category") or "").strip() == effective_category
            ]
            placement_ids = [str(slot.get("placement_id") or "").strip() for slot in category_slots]
            matrix_rows = self.query_ssp_media_matrix_in_tx(
                conn,
                placement_ids=placement_ids,
                sources=[] if effective_source == "__all__" else [effective_source],
                start_date=start_date,
                end_date=end_date,
            )
        view = build_ssp_media_demand_view(
            categories=categories,
            slots=list(config.get("slots") or []),
            matrix_rows=matrix_rows,
            source_options=source_options,
            active_source=effective_source,
            active_category=effective_category,
            scope_mode=scope_mode,
            day_limit=day_limit,
            threshold=threshold,
            only_unmet=only_unmet,
        )
        return view

    def apply_modifications(self, conn: sqlite3.Connection, workflow: str, updates: list[dict]) -> int:
        self._ensure_tables(conn)
        changed = 0
        now = _now()
        for item in updates:
            row_order = int(item.get("row_order", -1))
            column = str(item.get("column", ""))
            value = str(item.get("value", ""))
            if row_order < 0:
                continue
            if column not in self.modify_allowed_columns:
                raise ValueError(f"不允許修改欄位: {column}")
            cursor = conn.execute(
                f"UPDATE canonical_raw SET {column} = ?, updated_at = ? WHERE workflow = ? AND row_order = ?",
                (value, now, workflow, row_order),
            )
            if int(cursor.rowcount or 0) <= 0:
                raise LookupError(f"找不到可修改的 canonical row: workflow={workflow}, row_order={row_order}")
            changed += int(cursor.rowcount or 0)
        return changed

    def insert_override_adjustments(
        self,
        conn: sqlite3.Connection,
        *,
        workflow: str,
        updates: list[dict],
        template_version: str,
        rule_version: str,
        run_id: str,
    ) -> int:
        now = _now()
        written = 0
        for item in updates:
            row_order = int(item.get("row_order", -1))
            column = str(item.get("column", ""))
            value = str(item.get("value", ""))
            if row_order < 0:
                continue
            detail_payload = {
                "source": "modify",
                "row_order": row_order,
                "column": column,
                "template_version": template_version,
                "rule_version": rule_version,
                "run_id": run_id,
            }
            conn.execute(
                """
                INSERT INTO overrides_adjustments(
                  workflow, target_type, target_key, override_value, detail_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    workflow,
                    "manual_field",
                    f"row:{row_order}:{column}",
                    value,
                    json.dumps(detail_payload, ensure_ascii=False),
                    now,
                ),
            )
            written += 1
        return written

    def read_canonical_rows(self, workflow: str) -> list[dict]:
        with self.connect() as conn:
            self._ensure_tables(conn)
            return self.read_canonical_rows_in_tx(conn, workflow)

    def read_monthly_p4_targets_in_tx(self, conn: sqlite3.Connection, target_year: int) -> list[dict]:
        self._ensure_monthly_p4_tables(conn)
        rows: list[dict] = []
        for row in conn.execute(
            """
            SELECT item_key, month_index, target_value, label, sort_order
            FROM monthly_p4_targets
            WHERE target_year = ?
            ORDER BY sort_order ASC, item_key ASC, month_index ASC
            """,
            (target_year,),
        ).fetchall():
            rows.append(
                {
                    "item_key": str(row[0] or ""),
                    "month_index": int(row[1] or 0),
                    "target_value": float(row[2] or 0.0),
                    "label": str(row[3] or ""),
                    "sort_order": int(row[4] or 0),
                }
            )
        return rows

    def read_monthly_p4_manual_inputs_in_tx(self, conn: sqlite3.Connection, months: list[str]) -> dict[str, dict[str, float]]:
        self._ensure_monthly_p4_tables(conn)
        if not months:
            return {}
        placeholders = ", ".join("?" for _ in months)
        out: dict[str, dict[str, float]] = {month: {} for month in months}
        for row in conn.execute(
            f"""
            SELECT month, input_key, input_value
            FROM monthly_p4_manual_inputs
            WHERE month IN ({placeholders})
            ORDER BY month ASC, input_key ASC
            """,
            tuple(months),
        ).fetchall():
            month = str(row[0] or "")
            key = str(row[1] or "")
            if month and key:
                out.setdefault(month, {})[key] = float(row[2] or 0.0)
        return out

    def read_monthly_p4_test_inputs_in_tx(self, conn: sqlite3.Connection, months: list[str], test_id: str = "default") -> dict[str, dict[str, float]]:
        self._ensure_monthly_p4_test_tables(conn)
        if not months:
            return {}
        placeholders = ", ".join("?" for _ in months)
        out: dict[str, dict[str, float]] = {month: {} for month in months}
        for row in conn.execute(
            f"""
            SELECT month, input_key, input_value
            FROM monthly_p4_test_inputs
            WHERE test_id = ? AND month IN ({placeholders})
            ORDER BY month ASC, input_key ASC
            """,
            (test_id, *tuple(months)),
        ).fetchall():
            month = str(row[0] or "")
            key = str(row[1] or "")
            if month and key:
                out.setdefault(month, {})[key] = float(row[2] or 0.0)
        return out

    def replace_monthly_p4_manual_inputs_in_tx(self, conn: sqlite3.Connection, month: str, inputs: dict[str, object]) -> int:
        self._ensure_monthly_p4_tables(conn)
        now = _now()
        written = 0
        for key, value in inputs.items():
            key_text = str(key or "").strip()
            if not key_text:
                continue
            try:
                number = float(value or 0.0)
            except Exception:
                number = 0.0
            conn.execute(
                """
                INSERT INTO monthly_p4_manual_inputs(month, input_key, input_value, note, updated_at)
                VALUES (?, ?, ?, '', ?)
                ON CONFLICT(month, input_key)
                DO UPDATE SET input_value=excluded.input_value, updated_at=excluded.updated_at
                """,
                (month, key_text, number, now),
            )
            written += 1
        return written

    def read_monthly_p4_closed_metrics_in_tx(
        self,
        conn: sqlite3.Connection,
        months: list[str],
        metric_keys: list[str] | None = None,
    ) -> dict[str, dict[str, dict[str, object]]]:
        self._ensure_monthly_p4_tables(conn)
        month_keys = [str(month or "").strip() for month in months if str(month or "").strip()]
        if not month_keys:
            return {}
        month_placeholders = ", ".join("?" for _ in month_keys)
        params: list[object] = list(month_keys)
        metric_filter = ""
        if metric_keys:
            clean_metric_keys = [str(key or "").strip() for key in metric_keys if str(key or "").strip()]
            if clean_metric_keys:
                metric_placeholders = ", ".join("?" for _ in clean_metric_keys)
                metric_filter = f" AND metric_key IN ({metric_placeholders})"
                params.extend(clean_metric_keys)
        out: dict[str, dict[str, dict[str, object]]] = {month: {} for month in month_keys}
        for row in conn.execute(
            f"""
            SELECT month, metric_key, metric_value, source, source_file, source_cell, source_payload_json, closed_at
            FROM monthly_p4_closed_metrics
            WHERE month IN ({month_placeholders}){metric_filter}
            ORDER BY month ASC, metric_key ASC
            """,
            tuple(params),
        ).fetchall():
            month = str(row[0] or "")
            metric_key = str(row[1] or "")
            payload: dict[str, object] = {}
            try:
                parsed = json.loads(str(row[6] or "{}"))
                if isinstance(parsed, dict):
                    payload = parsed
            except Exception:
                payload = {}
            out.setdefault(month, {})[metric_key] = {
                "month": month,
                "metricKey": metric_key,
                "value": float(row[2] or 0.0),
                "source": str(row[3] or ""),
                "sourceFile": str(row[4] or ""),
                "sourceCell": str(row[5] or ""),
                "payload": payload,
                "closedAt": str(row[7] or ""),
            }
        return out

    def replace_monthly_p4_closed_metrics_in_tx(
        self,
        conn: sqlite3.Connection,
        month: str,
        metrics: dict[str, dict[str, object]],
    ) -> int:
        self._ensure_monthly_p4_tables(conn)
        month_text = str(month or "").strip()
        now = _now()
        written = 0
        for metric_key, metric in metrics.items():
            key_text = str(metric_key or "").strip()
            if not month_text or not key_text:
                continue
            try:
                number = float(metric.get("value") or 0.0)
            except Exception:
                number = 0.0
            payload = metric.get("payload")
            payload_json = json.dumps(payload if isinstance(payload, dict) else {}, ensure_ascii=False, sort_keys=True)
            conn.execute(
                """
                INSERT INTO monthly_p4_closed_metrics(
                  month, metric_key, metric_value, source, source_file, source_cell, source_payload_json, closed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(month, metric_key)
                DO UPDATE SET
                  metric_value=excluded.metric_value,
                  source=excluded.source,
                  source_file=excluded.source_file,
                  source_cell=excluded.source_cell,
                  source_payload_json=excluded.source_payload_json,
                  closed_at=excluded.closed_at
                """,
                (
                    month_text,
                    key_text,
                    number,
                    str(metric.get("source") or ""),
                    str(metric.get("sourceFile") or metric.get("source_file") or ""),
                    str(metric.get("sourceCell") or metric.get("source_cell") or ""),
                    payload_json,
                    now,
                ),
            )
            written += 1
        return written

    def replace_monthly_p4_test_inputs_in_tx(self, conn: sqlite3.Connection, month: str, inputs: dict[str, object], test_id: str = "default") -> int:
        self._ensure_monthly_p4_test_tables(conn)
        now = _now()
        written = 0
        for key, value in inputs.items():
            key_text = str(key or "").strip()
            if not key_text:
                continue
            try:
                number = float(value or 0.0)
            except Exception:
                number = 0.0
            conn.execute(
                """
                INSERT INTO monthly_p4_test_inputs(test_id, month, input_key, input_value, note, updated_at)
                VALUES (?, ?, ?, ?, '', ?)
                ON CONFLICT(test_id, month, input_key)
                DO UPDATE SET input_value=excluded.input_value, updated_at=excluded.updated_at
                """,
                (test_id, month, key_text, number, now),
            )
            written += 1
        return written

    def read_monthly_p4_test_templates_in_tx(self, conn: sqlite3.Connection, test_id: str = "default") -> dict[str, dict[str, object]]:
        self._ensure_monthly_p4_test_tables(conn)
        out: dict[str, dict[str, object]] = {}
        rows = conn.execute(
            """
            SELECT template_kind, original_filename, stored_path, file_size, sheet_names_json, snapshot_json, updated_at
            FROM monthly_p4_test_templates
            WHERE test_id = ?
            ORDER BY template_kind ASC
            """,
            (test_id,),
        ).fetchall()
        for row in rows:
            try:
                sheet_names = json.loads(str(row[4] or "[]"))
            except json.JSONDecodeError:
                sheet_names = []
            try:
                snapshot = json.loads(str(row[5] or "{}"))
            except json.JSONDecodeError:
                snapshot = {}
            out[str(row[0] or "")] = {
                "kind": str(row[0] or ""),
                "filename": str(row[1] or ""),
                "storedPath": str(row[2] or ""),
                "fileSize": int(row[3] or 0),
                "sheetNames": sheet_names if isinstance(sheet_names, list) else [],
                "snapshot": snapshot if isinstance(snapshot, dict) else {},
                "updatedAt": str(row[6] or ""),
            }
        return out

    def replace_monthly_p4_test_template_in_tx(
        self,
        conn: sqlite3.Connection,
        *,
        test_id: str,
        template_kind: str,
        original_filename: str,
        stored_path: str,
        file_size: int,
        sheet_names: list[str],
        snapshot: dict[str, object] | None = None,
    ) -> None:
        self._ensure_monthly_p4_test_tables(conn)
        conn.execute(
            """
            INSERT INTO monthly_p4_test_templates(
              test_id, template_kind, original_filename, stored_path, file_size, sheet_names_json, snapshot_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(test_id, template_kind)
            DO UPDATE SET
              original_filename=excluded.original_filename,
              stored_path=excluded.stored_path,
              file_size=excluded.file_size,
              sheet_names_json=excluded.sheet_names_json,
              snapshot_json=excluded.snapshot_json,
              updated_at=excluded.updated_at
            """,
            (
                test_id,
                template_kind,
                original_filename,
                stored_path,
                int(file_size),
                json.dumps(sheet_names, ensure_ascii=False),
                json.dumps(snapshot or {}, ensure_ascii=False),
                _now(),
            ),
        )

    def read_ssp_raw_rows(self) -> list[dict]:
        with self.connect() as conn:
            return self.read_ssp_raw_rows_in_tx(conn)

    def read_ssp_raw_rows_in_tx(self, conn: sqlite3.Connection) -> list[dict]:
        self._ensure_ssp_raw_table(conn)
        cur = conn.execute(
            "SELECT row_order, " + ", ".join(SSP_RAW_COLUMNS) + ", updated_at FROM ssp_raw ORDER BY row_order ASC"
        )
        rows: list[dict] = []
        for raw in cur.fetchall():
            row: dict[str, object] = {"row_order": int(raw[0])}
            for idx, col in enumerate(SSP_RAW_COLUMNS, start=1):
                row[col] = raw[idx]
            row["updated_at"] = raw[len(SSP_RAW_COLUMNS) + 1]
            rows.append(row)
        return rows

    def read_canonical_rows_in_tx(self, conn: sqlite3.Connection, workflow: str) -> list[dict]:
        out = []
        for row in self._read_canonical_snapshot(conn, workflow):
            out.append(row)
        return out

    def resolve_trace_binding(self, conn: sqlite3.Connection, workflow: str, template_version: str, rule_version: str) -> dict[str, str]:
        self._ensure_tables(conn)
        template_row = conn.execute(
            """
            SELECT template_id, mapping_version
            FROM template_registry
            WHERE workflow = ? AND template_version = ? AND is_active = 1
            """,
            (workflow, template_version),
        ).fetchone()
        if not template_row:
            raise LookupError(
                f"找不到啟用中的 template registry: workflow={workflow}, template_version={template_version}"
            )
        rule_row = conn.execute(
            "SELECT rule_hash FROM ruleset_versions WHERE rule_version = ?",
            (rule_version,),
        ).fetchone()
        if not rule_row:
            raise LookupError(f"找不到 ruleset version: rule_version={rule_version}")
        binding_row = conn.execute(
            """
            SELECT id
            FROM rule_bindings
            WHERE workflow = ? AND template_id = ? AND rule_version = ?
            """,
            (workflow, str(template_row[0]), rule_version),
        ).fetchone()
        if not binding_row:
            raise LookupError(
                f"找不到 rule binding: workflow={workflow}, template_version={template_version}, rule_version={rule_version}"
            )
        return {
            "template_id": str(template_row[0]),
            "mapping_version": str(template_row[1]),
            "rule_hash": str(rule_row[0]),
        }

    def insert_run_log(self, conn: sqlite3.Connection, run_type: str, workflow: str, status: str, trace: TraceMeta, detail: dict) -> str:
        run_id = f"run-{uuid.uuid4().hex}"
        detail_payload = {
            **detail,
            "template_id": trace.template_id,
            "mapping_version": trace.mapping_version,
            "rule_hash": trace.rule_hash,
        }
        conn.execute(
            """
            INSERT INTO run_log(
              run_id, run_type, workflow, status,
              source_db_hash, canonical_token, template_version, rule_version,
              artifact_checksum, detail_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                run_type,
                workflow,
                status,
                trace.source_db_hash,
                trace.canonical_token,
                trace.template_version,
                trace.rule_version,
                trace.artifact_checksum,
                json.dumps(detail_payload, ensure_ascii=False),
                _now(),
            ),
        )
        return run_id

    def _fetch_latest_run_log(
        self,
        conn: sqlite3.Connection,
        *,
        workflow: str,
        run_types: tuple[str, ...],
    ) -> dict[str, object] | None:
        placeholders = ", ".join("?" for _ in run_types)
        cur = conn.execute(
            f"""
            SELECT
              run_id,
              run_type,
              created_at,
              rowid AS row_id,
              source_db_hash,
              canonical_token,
              template_version,
              rule_version,
              artifact_checksum,
              detail_json
            FROM run_log
            WHERE workflow = ? AND run_type IN ({placeholders})
            ORDER BY created_at DESC, rowid DESC
            LIMIT 1
            """,
            (workflow, *run_types),
        )
        row = cur.fetchone()
        if not row:
            return None
        detail: dict[str, object] = {}
        raw_detail = row[9]
        if isinstance(raw_detail, str) and raw_detail.strip():
            try:
                parsed = json.loads(raw_detail)
                if isinstance(parsed, dict):
                    detail = parsed
            except Exception:
                detail = {}
        return {
            "run_id": str(row[0]),
            "run_type": str(row[1]),
            "created_at": str(row[2]),
            "row_id": int(row[3]),
            "source_db_hash": str(row[4] or ""),
            "canonical_token": str(row[5] or ""),
            "template_version": str(row[6] or ""),
            "rule_version": str(row[7] or ""),
            "artifact_checksum": str(row[8] or ""),
            "detail": detail,
        }

    def get_tab4_delivery_state(self, conn: sqlite3.Connection, workflow: str) -> dict[str, object]:
        latest_delivery = self._fetch_latest_run_log(
            conn,
            workflow=workflow,
            run_types=("tab4_delivery",),
        )
        latest_change = self._fetch_latest_run_log(
            conn,
            workflow=workflow,
            run_types=("save", "modify"),
        )
        if latest_delivery is None:
            return {
                "ready": False,
                "reason": "pending_delivery",
                "updated_at": "",
                "last_delivery_run_id": "",
                "last_change_run_id": str((latest_change or {}).get("run_id", "")),
                "delivery_snapshot_token": "",
                "delivery_row_count": 0,
                "delivery_source_db_hash": "",
                "delivery_template_version": "",
                "delivery_rule_version": "",
                "delivery_week_start": "",
                "delivery_week_end": "",
            }
        delivery_detail = latest_delivery.get("detail")
        delivery_row_count = 0
        delivery_week_start = ""
        delivery_week_end = ""
        if isinstance(delivery_detail, dict):
            raw_row_count = delivery_detail.get("row_count")
            if isinstance(raw_row_count, (int, float)):
                delivery_row_count = int(raw_row_count)
            else:
                try:
                    delivery_row_count = int(str(raw_row_count or "0"))
                except Exception:
                    delivery_row_count = 0
            delivery_week_start = str(delivery_detail.get("week_start") or "")
            delivery_week_end = str(delivery_detail.get("week_end") or "")
        delivery_key = (
            str(latest_delivery["created_at"]),
            int(latest_delivery["row_id"]),
        )
        change_key = None
        if latest_change is not None:
            change_key = (
                str(latest_change["created_at"]),
                int(latest_change["row_id"]),
            )
        if change_key is not None and change_key > delivery_key:
            return {
                "ready": False,
                "reason": "rawdata_saved",
                "updated_at": str(latest_change["created_at"]),
                "last_delivery_run_id": str(latest_delivery["run_id"]),
                "last_change_run_id": str(latest_change["run_id"]),
                "delivery_snapshot_token": str(latest_delivery.get("canonical_token") or ""),
                "delivery_row_count": delivery_row_count,
                "delivery_source_db_hash": str(latest_delivery.get("source_db_hash") or ""),
                "delivery_template_version": str(latest_delivery.get("template_version") or ""),
                "delivery_rule_version": str(latest_delivery.get("rule_version") or ""),
                "delivery_week_start": delivery_week_start,
                "delivery_week_end": delivery_week_end,
            }
        delivery_snapshot_token = str(latest_delivery.get("canonical_token") or "")
        if not delivery_snapshot_token:
            return {
                "ready": False,
                "reason": "missing_snapshot_token",
                "updated_at": str(latest_delivery["created_at"]),
                "last_delivery_run_id": str(latest_delivery["run_id"]),
                "last_change_run_id": str((latest_change or {}).get("run_id", "")),
                "delivery_snapshot_token": "",
                "delivery_row_count": delivery_row_count,
                "delivery_source_db_hash": str(latest_delivery.get("source_db_hash") or ""),
                "delivery_template_version": str(latest_delivery.get("template_version") or ""),
                "delivery_rule_version": str(latest_delivery.get("rule_version") or ""),
                "delivery_week_start": delivery_week_start,
                "delivery_week_end": delivery_week_end,
            }
        return {
            "ready": True,
            "reason": "pivot_handoff",
            "updated_at": str(latest_delivery["created_at"]),
            "last_delivery_run_id": str(latest_delivery["run_id"]),
            "last_change_run_id": str((latest_change or {}).get("run_id", "")),
            "delivery_snapshot_token": delivery_snapshot_token,
            "delivery_row_count": delivery_row_count,
            "delivery_source_db_hash": str(latest_delivery.get("source_db_hash") or ""),
            "delivery_template_version": str(latest_delivery.get("template_version") or ""),
            "delivery_rule_version": str(latest_delivery.get("rule_version") or ""),
            "delivery_week_start": delivery_week_start,
            "delivery_week_end": delivery_week_end,
        }

    def assert_tab4_delivery_ready(self, conn: sqlite3.Connection, workflow: str) -> dict[str, object]:
        state = self.get_tab4_delivery_state(conn, workflow)
        if not bool(state.get("ready")):
            reason = str(state.get("reason") or "pending_delivery")
            raise PermissionError(f"tab4 delivery required: {reason}")
        snapshot_token = str(state.get("delivery_snapshot_token") or "")
        if not snapshot_token:
            raise PermissionError("tab4 delivery required: missing_snapshot_token")
        return state

    def insert_publish_run(
        self,
        conn: sqlite3.Connection,
        run_id: str,
        workflow: str,
        artifact_path: Path,
        trace: TraceMeta,
        status: str,
        week_start: str,
        week_end: str,
    ) -> None:
        detail_payload = {
            "workflow": workflow,
            "template_id": trace.template_id,
            "mapping_version": trace.mapping_version,
            "rule_hash": trace.rule_hash,
            "week_start": week_start,
            "week_end": week_end,
        }
        conn.execute(
            """
            INSERT INTO publish_runs(
              run_id, week_start, week_end, source_db_path, template_id,
              template_version, output_path, artifact_checksum, status,
              error_message, detail_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
            """,
            (
                run_id,
                week_start,
                week_end,
                str(self.db_path),
                trace.template_id,
                trace.template_version,
                str(artifact_path),
                trace.artifact_checksum,
                status,
                json.dumps(detail_payload, ensure_ascii=False),
                _now(),
            ),
        )

    def insert_evidence(self, conn: sqlite3.Connection, run_id: str, path: Path, checksum: str, status: str) -> None:
        conn.execute(
            """
            INSERT INTO evidence_index(run_id, scope, path, checksum, status, created_at)
            VALUES (?, 'export', ?, ?, ?, ?)
            """,
            (run_id, str(path), checksum, status, _now()),
        )

    def append_audit_event(
        self,
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
                (
                    event_type,
                    scope,
                    status,
                    json.dumps(payload, ensure_ascii=False),
                    _now(),
                ),
            )
            return True
        except Exception:
            if strict:
                raise
            return False

    def build_trace_meta(self, conn: sqlite3.Connection, workflow: str, template_version: str, rule_version: str, artifact_checksum: str = "") -> TraceMeta:
        binding = self.resolve_trace_binding(conn, workflow, template_version, rule_version)
        canonical_token = self.canonical_token(conn, workflow)
        return TraceMeta(
            source_db_hash=self._hash_payload({"workflow": workflow, "canonical_token": canonical_token}),
            canonical_token=canonical_token,
            template_version=template_version,
            rule_version=rule_version,
            artifact_checksum=artifact_checksum,
            template_id=binding["template_id"],
            mapping_version=binding["mapping_version"],
            rule_hash=binding["rule_hash"],
        )
