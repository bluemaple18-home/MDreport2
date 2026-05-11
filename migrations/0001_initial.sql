CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow TEXT NOT NULL DEFAULT '',
  row_order INTEGER NOT NULL DEFAULT 0,
  日期時間 TEXT NOT NULL DEFAULT '',
  經銷商 TEXT NOT NULL DEFAULT '',
  訂單 TEXT NOT NULL DEFAULT '',
  素材 TEXT NOT NULL DEFAULT '',
  廣告形式 TEXT NOT NULL DEFAULT '',
  尺寸 TEXT NOT NULL DEFAULT '',
  素材樣板 TEXT NOT NULL DEFAULT '',
  執行金額 REAL NOT NULL DEFAULT 0.0,
  系統營收 REAL NOT NULL DEFAULT 0.0,
  媒體費用 REAL NOT NULL DEFAULT 0.0,
  原始經銷商 TEXT NOT NULL DEFAULT '',
  原始廣告形式 TEXT NOT NULL DEFAULT '',
  最終經銷商 TEXT NOT NULL DEFAULT '',
  規則命中_經銷商 TEXT NOT NULL DEFAULT '',
  最終來源_經銷商 TEXT NOT NULL DEFAULT '',
  分類層級B TEXT NOT NULL DEFAULT '',
  分類層級C TEXT NOT NULL DEFAULT '',
  分類層級D TEXT NOT NULL DEFAULT '',
  最終廣告形式 TEXT NOT NULL DEFAULT '',
  規則命中_廣告形式 TEXT NOT NULL DEFAULT '',
  最終來源_廣告形式 TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_canonical_raw_workflow_row ON canonical_raw(workflow, row_order);

CREATE TABLE IF NOT EXISTS overrides_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_key TEXT NOT NULL DEFAULT '',
  override_value TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS template_registry (
  template_id TEXT PRIMARY KEY,
  template_version TEXT NOT NULL,
  workflow TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  meta_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ruleset_versions (
  rule_version TEXT PRIMARY KEY,
  rule_hash TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rule_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow TEXT NOT NULL,
  template_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  UNIQUE(workflow, template_id)
);

CREATE TABLE IF NOT EXISTS run_log (
  run_id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  workflow TEXT NOT NULL,
  status TEXT NOT NULL,
  source_db_hash TEXT NOT NULL DEFAULT '',
  canonical_token TEXT NOT NULL DEFAULT '',
  template_version TEXT NOT NULL DEFAULT '',
  rule_version TEXT NOT NULL DEFAULT '',
  artifact_checksum TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runlog_created ON run_log(created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  week_start TEXT NOT NULL DEFAULT '',
  week_end TEXT NOT NULL DEFAULT '',
  source_db_path TEXT NOT NULL DEFAULT '',
  template_id TEXT NOT NULL DEFAULT '',
  template_version TEXT NOT NULL DEFAULT '',
  output_path TEXT NOT NULL DEFAULT '',
  artifact_checksum TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  path TEXT NOT NULL,
  checksum TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence_index(run_id, created_at);
