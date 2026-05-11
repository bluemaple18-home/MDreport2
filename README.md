# MDREP Bootstrap Runtime（目前狀態）

本專案已不只 Phase 1 骨架，現況是「可執行的最小 runtime」：
- `bootstrap` / `health` / `save` / `modify` / `export` 可用
- SQLite 為唯一真相來源（canonical source of truth）
- `export` 產出 Excel workbook artifact（非真相來源）
- DSP / SSP workflow 走同一套契約與流程
- `audit_log`、`run_log`、`publish_runs`、`evidence_index` 已串接
- `feature_flags` 與 `strict_acceptance_gate` 已正式接入 runtime

## 範圍（已完成）
- Bootstrap manifest（檔案式契約）
- SQLite 單一來源 + migration (`0001_initial` + `schema_migrations`)
- Template / rule seed 與 binding
- Canonical save / modify / export 服務層
- CLI/app shell 公開入口：`app/main.py`
- Workbook artifact 匯出（`.xlsx`）
- Audit trail 與追溯欄位
- Strict acceptance gate（可由 manifest 控制）

## 非範圍（目前仍不做）
- 完整業務流程擴充（超出 bootstrap/runtime 最小能力）
- 舊專案資料隱式搬運或自動導入
- 以 workbook 反寫 canonical（明確禁止）

## 核心邊界
- SQLite 是唯一真相：`canonical_raw` / `run_log` / `audit_log` / `publish_runs` / `evidence_index`
- Artifact 只存輸出與證據（例如 `.xlsx`），刪除 artifact 不應改變 canonical
- `audit_log` 是追溯補強，不是主流程 blocker
  - service audit：soft-fail
  - bootstrap audit：soft-fail（回傳 `audit_log_status`）

## Bootstrap Manifest
預設檔案：`bootstrap.manifest.json`

環境分流：
- 正式：`bootstrap.manifest.json`
- 測試：`bootstrap.test.manifest.json`
- CLI / UI 若帶 `env=test`，且未額外指定 `manifest`，會自動切到測試 manifest。

關鍵欄位：
- `db.path`
- `data_seed.root`
- `schema.target_version`
- `template_registry.seed`
- `rule_registry.seed`
- `feature_flags`
- `artifact_root`

目前支援的 `feature_flags`：
- `enable_test_hooks`：`save/modify/export` 回傳與 audit payload 附加 `test_hooks_enabled`
- `enable_trace_markers`：`save/modify/export` 回傳與 audit payload 附加 `trace_marker`
- `strict_acceptance_gate`：控制 gate 是否阻擋主流程（見下節）

目前範例 manifest（`bootstrap.manifest.json`）預設為：
- `strict_acceptance_gate: true`

## Strict Acceptance Gate 行為
- `strict_acceptance_gate=true`
  - service 入口（`save/modify/export`）先跑 gate
  - 若驗收失敗，CLI 回 `STRICT_ACCEPTANCE_GATE_FAILED`
- `strict_acceptance_gate=false`
  - gate 不作為額外 blocker（health 會以 `checks.acceptance_gate.status=warning` 呈現）

注意：
- gate 只是「額外驗收閘門」；service 本身仍會做 template/rule binding 驗證。
- 因此即使 `strict_acceptance_gate=false`，若你操作的 workflow 缺少有效 binding，仍可能在 service 階段失敗（例如 `LOOKUP_ERROR`）。

`health` 也會回傳 machine-readable gate 狀態於 `checks.acceptance_gate`。

## CLI 使用方式
主入口：`app/main.py`

```bash
python3 app/main.py --root /path/to/project bootstrap
python3 app/main.py --root /path/to/project --env test bootstrap
python3 app/main.py --root /path/to/project health
python3 app/main.py --root /path/to/project --env test health
python3 app/main.py --root /path/to/project save \
  --workflow dsp --template-version v1 --rule-version v1 \
  --rows-json /path/to/rows.json
python3 app/main.py --root /path/to/project modify \
  --workflow dsp --template-version v1 --rule-version v1 \
  --updates-json /path/to/updates.json
python3 app/main.py --root /path/to/project export \
  --workflow dsp --template-version v1 --rule-version v1 \
  --main-tab dsp_tab4 --sub-tab overview
python3 app/main.py --root /path/to/project seed-bootstrap \
  --raw-source raw-inbox
python3 app/main.py --root /path/to/project seed-import-mdreport \
  --mdreport-root /path/to/MDreport
python3 app/main.py --root /path/to/project seed-promote-live \
  --workflow dsp --source-db-rel canonical/mdreport_dsp.sqlite
python3 app/main.py --root /path/to/project seed-rebuild \
  --workflow dsp --template-version v1 --rule-version v1
python3 app/main.py --root /path/to/project fetch-dsp-api \
  --date 2026-05-10
python3 app/main.py --root /path/to/project fetch-ssp-api \
  --date 2026-05-11
```

相容 wrapper：`app/bootstrap_init.py`
- 未指定 command 時會自動補 `bootstrap`
- `export --workflow dsp` 若未提供 `--main-tab/--sub-tab`，CLI 會預設補 `dsp_tab4/overview` 以符合 DSP export 守門。
- `POST /api/action` 的 DSP `export` 不會補 route；需由前端/呼叫端明確帶 `main_tab=dsp_tab4`、`sub_tab=overview`。
- `POST /api/action` 目前也支援 `seed_rebuild`、`seed_promote_live`，可沿用 `workflow / template_version / rule_version / seed_root / source_db_rel` 這組 runtime 契約走 API 重建。
- `POST /api/action` 目前也支援 `fetch_dsp_api`，正式 auth 走 `scope-check -> service_id=10 -> reports -> view-job`。
- `POST /api/action` 目前也支援 `fetch_ssp_api`，正式 auth 走 `scope-check -> service_id=14 -> get-login -> report-conditions -> report`。
- 若只帶 `--env test` 而未指定 `--manifest`，CLI 會自動改用 `bootstrap.test.manifest.json`。

## CLI 輸出契約（JSON）
成功：
```json
{
  "status": "ok",
  "result": {}
}
```

失敗：
```json
{
  "status": "error",
  "error_code": "...",
  "message": "...",
  "details": {}
}
```

常見錯誤碼：
- `CLI_USAGE_ERROR`
- `INVALID_ROWS_JSON` / `INVALID_UPDATES_JSON`
- `FILE_NOT_FOUND`
- `LOOKUP_ERROR`
- `VALIDATION_ERROR`
- `STRICT_ACCEPTANCE_GATE_FAILED`
- `MANIFEST_JSON_INVALID`（health）
- `RULE_BINDING_INCOMPLETE`（health strict gate）
- `HEALTH_CHECK_EXCEPTION`（例如 `rule_bindings` 全空等基礎健康檢查失敗）

## 舊資料搬家 Seed 骨架（MDREP-DATA-001）
- 命令：`seed-bootstrap`
- 目標：建立「可重建」的最小資料骨架，不碰前端 workbench，不改既有 runtime API。
- 會產生：
  - `data_seed/raw_seed/`：raw seed 檔（排除 debug/probe/rerun/workbook-first 噪音）
  - `data_seed/canonical/mdrep.sqlite`：canonical DB snapshot
  - `data_seed/logs/*.json`：`run_log` / `audit_log` / `publish_runs` / `evidence_index`
  - `data_seed/templates_rules_mapping/`：manifest、template/rule seed、fields contract
  - `data_seed/manifests/seed_manifest.json`：raw 檔索引（workflow、source_date、checksum、import_run_id/latest_run_id）
- 重建命令：`seed-rebuild`
  - 來源：`data_seed/manifests/seed_manifest.json`
  - 行為：讀取 raw seed，走既有 `save` 契約重建 canonical（仍寫入 run_log/audit_log）
- 匯入既有 MDreport：`seed-import-mdreport`
  - 來源：`<mdreport-root>/artifacts`、`<mdreport-root>/data`
  - 行為：把 raw seed 與 canonical seed 分層複製到 `data_seed/`，並生成可重建 manifest
- 升級 seed canonical 成 live DB：`seed-promote-live`
  - 預設來源：
    - `workflow=dsp` -> `data_seed/canonical/mdreport_dsp.sqlite`
    - `workflow=ssp` -> `data_seed/canonical/mdreport.sqlite`（SSP 單一真相）
  - 可用 `--source-db-rel` 覆寫來源 DB。
  - 行為：將 seed canonical 轉寫進 live `canonical_raw`（SQLite 單一真相不變）
  - 若走測試環境，對應 seed 根目錄會改用 `data_seed_test/`。
- SSP 正規 API 抓數：`fetch-ssp-api`
  - 正式鏈：`POST cua3/api/login/scope-check` → 解密 services payload → 選 `service_id=14` → `GET ssp3-api/get-login` → `POST admin/report-conditions` → `POST admin/report/{id}`
  - 預設會把資料寫入 live `ssp_raw`，並清空 `canonical_raw WHERE workflow='ssp'`，避免非 API 舊污染繼續混入。
  - 若指定日期區間，client 會自動改成「逐日查詢 + 節流 + 最後一次性寫回」；這是因為 SSP3 multi-day hourly job 會回空資料，不能直接信。
  - 帳密解析順序：
    - `--email / --password`
    - `MDREP_SSP_EMAIL / MDREP_SSP_PASSWORD`
    - `MDREPORT_API_EMAIL / MDREPORT_API_PASSWORD`
  - 常用例子：
```bash
python3 app/main.py --root /path/to/project fetch-ssp-api --date 2026-05-11
python3 app/main.py --root /path/to/project --env test fetch-ssp-api --date 2026-05-11
```
- DSP 正規 API 抓數：`fetch-dsp-api`
  - 正式鏈：`POST cua3/api/login/scope-check` → 解密 services payload → 選 `service_id=10` → `POST dsp3-api/reports` → `GET reports/view-job`
  - 預設會把資料寫入 live `canonical_raw WHERE workflow='dsp'`，並同步更新 Tab4 delivery 快照，讓後續 `export --workflow dsp` 能直接接續。
  - 若指定日期區間，client 會自動改成「逐日查詢 + 節流 + 最後一次性寫回」；這是因為 DSP3 multi-day job 會被 server-side 截斷，`page=2/3` 也只會重複同一批資料。
  - 帳密解析順序：
    - `--email / --password`
    - `MDREP_DSP_EMAIL / MDREP_DSP_PASSWORD`
    - `MDREPORT_API_EMAIL / MDREPORT_API_PASSWORD`
  - 常用例子：
```bash
python3 app/main.py --root /path/to/project fetch-dsp-api --date 2026-05-10
python3 app/main.py --root /path/to/project --env test fetch-dsp-api --date 2026-05-10
```
- 注意：
  - 這張卡只做 seed 骨架，不做舊資料隱式搬運。
  - 若要索引 raw 檔，請透過 `bootstrap.manifest.json.data_seed.raw_sources` 或 CLI `--raw-source` 提供來源目錄。

## Save / Modify / Export 行為
- `save`：整批覆蓋指定 workflow canonical rows，寫 `run_log` + `audit_log`
- `modify`：只允許 manual fields（受欄位契約限制），寫 `run_log` + `audit_log`
- `export`：從 canonical 產生 workbook，並寫 `run_log` + `publish_runs` + `evidence_index` + `audit_log`

`export` 產出：
- DSP：`<artifact_root>/<YYYY> DSP投資量報表_<MMDD>-<MMDD>.xlsx`（Tab4 template workbook）
- SSP：`<artifact_root>/ssp_export.xlsx`（Sheet：`canonical_data`、`metadata`）

DSP Tab4 template 週期 sidecar（period-bound 規則）：
- 正式模板可在同目錄放 `dsp_tab4_template.xlsx.period.json`。
- JSON 最小欄位：`week_start`、`week_end`（格式 `YYYY-MM-DD`）。
- 範例：
```json
{
  "week_start": "2026-01-01",
  "week_end": "2026-12-31"
}
```
- 判定優先序：`sidecar` > 檔名區間（例如 `_0101-0503`）> generic（無週期資訊）。
- 若同一候選群已有 period-bound template，但請求週期不在其窗口內，`save/export` 會直接擋下，不會退回 generic。

## 開發與驗證
建議環境：Python `uv + .venv`

常用驗證：
```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
./scripts/smoke_bootstrap.sh
```

## Frontend（React + TypeScript + Vite）
- 新前端骨架位置：`frontend`
- 僅串接既有 runtime API：
  - `GET /api/status`
  - `GET /api/frame`
  - `POST /api/action`
- 不改 SQLite canonical / save / modify / export 主幹。
- `app/ui_shell.py` 已收斂為 API + frontend static host；不再維護舊 Python HTML/inline-JS 互動頁主線。

啟動方式（建議先啟 UI runtime）：
```bash
# terminal A：啟動既有 python UI runtime（API 提供者）
python3 app/ui_shell.py --host 127.0.0.1 --port 8510

# terminal B：啟動 React frontend
cd frontend
pnpm install
pnpm dev
```

預設 Vite 會把 `/api/*` proxy 到 `http://127.0.0.1:8510`。  
若 runtime 不在預設 port，請用環境變數覆寫：
```bash
cd frontend
VITE_RUNTIME_PROXY_TARGET=http://127.0.0.1:9000 pnpm dev
```

## 新接手者快速路徑
1. 先看 `bootstrap.manifest.json` 的 `feature_flags` 與 seed 路徑
2. 跑 `bootstrap` 再跑 `health`
3. 用 `save -> modify -> export` 跑一次最小流程
4. 檢查 SQLite 與 artifact 邊界是否符合預期
