# MDreport

MDreport 是一套給 DSP、SSP 與月報營運使用的報表 runtime。它把資料抓取、canonical 儲存、手動修正、驗收閘門、Excel artifact 匯出與前端工作台收斂在同一套 SQLite 契約上，讓日常補數、核對、交付與追溯都能用同一個系統完成。

## 現有能力

- DSP workflow：DSP API 抓數、rawdata 編修、pivot 預覽、Tab4 交付快照、period-bound template 驗證、Excel 報表匯出與已關帳月份封存。
- SSP workflow：SSP API 抓數、含 padding / 排除 padding 指標核對、ad group demand 抓取與監控、media demand slot 編修、read-only rawdata 檢視與匯出。
- Monthly workflow：SSP 月報資料抓取、media cost analysis、dimension summary、zone group 匯入、P4(J) 手 key 欄位、測試模板比對、月結與圖表 snapshot。
- Runtime foundation：manifest 設定、feature flags、strict acceptance gate、template/rule binding、SQLite schema versioning、service 層 save/modify/export。
- 追溯與證據：`run_log`、`audit_log`、`publish_runs`、`evidence_index` 會記錄流程結果、artifact 與驗收狀態。
- Sandbox：前端與 API 可使用 sandbox DB / artifact root 進行隔離操作，支援 baseline 準備與 reset。
- 前端工作台：React + TypeScript + Vite，透過 runtime API 操作 DSP / SSP / monthly 工作流。

## 架構邊界

- SQLite 是唯一 canonical source of truth；workbook 只作輸出 artifact，不反寫 canonical。
- `canonical_raw`、workflow 專用表、`run_log`、`audit_log`、`publish_runs`、`evidence_index` 是 runtime 追溯核心。
- `artifact_root` 只放輸出與證據；刪除 artifact 不應改變 canonical 資料。
- DSP rawdata 目前可編修；SSP rawdata 目前以 read-only 檢視、篩選與核對為主。
- `strict_acceptance_gate` 是額外驗收閘門；service 本身仍會做 template/rule binding 驗證。

## 主要入口

- CLI：`app/main.py`
- 相容 wrapper：`app/bootstrap_init.py`
- API + frontend static host：`app/ui_shell.py`
- 前端：`frontend/`
- 預設 manifest：`bootstrap.manifest.json`
- 測試 manifest：`bootstrap.test.manifest.json`

Runtime API：

- `GET /api/status`
- `GET /api/frame`
- `GET /api/ssp/media-demand`
- `GET /api/export/download`
- `POST /api/action`

## Bootstrap 與健康檢查

```bash
uv run python app/main.py --root <repo-root> bootstrap
uv run python app/main.py --root <repo-root> health
uv run python app/main.py --root <repo-root> --env test bootstrap
uv run python app/main.py --root <repo-root> --env test health
```

`--env test` 且未指定 `--manifest` 時，CLI / UI 會自動使用 `bootstrap.test.manifest.json`。

## Canonical 操作

```bash
uv run python app/main.py --root <repo-root> save \
  --workflow dsp --template-version v1 --rule-version v1 \
  --rows-json <rows.json>

uv run python app/main.py --root <repo-root> modify \
  --workflow dsp --template-version v1 --rule-version v1 \
  --updates-json <updates.json>

uv run python app/main.py --root <repo-root> export \
  --workflow dsp --template-version v1 --rule-version v1 \
  --main-tab dsp_tab4 --sub-tab overview
```

`save` 會整批覆蓋指定 workflow 的 canonical rows；`modify` 只允許修改欄位契約中標示的 manual fields；`export` 會從 canonical 產生 artifact，並寫入 publish / evidence / audit 追溯紀錄。

DSP export 會使用 Tab4 delivery 契約。CLI 入口若未提供 `--main-tab` / `--sub-tab`，會預設補 `dsp_tab4` / `overview`；`POST /api/action` 不會自動補 route，前端或呼叫端需明確帶入。

## DSP 功能

```bash
uv run python app/main.py --root <repo-root> fetch-dsp-api --date 2026-05-10
uv run python app/main.py --root <repo-root> fetch-dsp-api --start-day 2026-05-01 --end-day 2026-05-10
uv run python app/main.py --root <repo-root> archive-dsp-month --month 2026-05
```

- 正式 API flow：`scope-check -> service_id=10 -> dsp3-api/reports -> reports/view-job`。
- 單日 refresh 只替換請求日期範圍內的 rows，保留其他日期資料。
- 多日查詢會逐日 fetch、節流，最後一次性寫回，避免 server-side 截斷造成缺頁。
- export 會產出 DSP Tab4 workbook，例如 `<artifact_root>/<YYYY> DSP投資量報表_<MMDD>-<MMDD>.xlsx`。
- Tab4 template 可搭配 `.period.json` sidecar 設定 `week_start` / `week_end`，讓 template 與交付週期綁定。

帳密解析順序：

- `--email / --password`
- `MDREP_DSP_EMAIL / MDREP_DSP_PASSWORD`
- `MDREPORT_API_EMAIL / MDREPORT_API_PASSWORD`

## SSP 功能

```bash
uv run python app/main.py --root <repo-root> fetch-ssp-api --date 2026-05-11
uv run python app/main.py --root <repo-root> fetch-ssp-excluding-padding-api --date 2026-05-11
uv run python app/main.py --root <repo-root> fetch-ssp-ad-group-api --date 2026-05-11
```

- 正式 API flow：`scope-check -> service_id=14 -> ssp3-api/get-login -> admin/report-conditions -> admin/report/{id}`。
- `fetch-ssp-api` 寫入 live SSP 資料。
- `fetch-ssp-excluding-padding-api` 以 `pb=1` 抓取排除 padding 的 performance facts。
- `fetch-ssp-ad-group-api` 可抓單一或全部 zone group 的 ad group demand。
- 多日查詢會逐日 fetch、節流，最後一次性寫回，避免 SSP3 multi-day hourly job 回空資料。
- SSP export 會產出 `<artifact_root>/ssp_export.xlsx`，包含 `canonical_data` 與 `metadata`。

帳密解析順序：

- `--email / --password`
- `MDREP_SSP_EMAIL / MDREP_SSP_PASSWORD`
- `MDREPORT_API_EMAIL / MDREPORT_API_PASSWORD`

## Monthly 功能

```bash
uv run python app/main.py --root <repo-root> fetch-monthly-ssp-api --start-day 2026-05-01 --end-day 2026-05-31
uv run python app/main.py --root <repo-root> monthly-media-cost-analysis --month 2026-05
uv run python app/main.py --root <repo-root> monthly-dimension-summary --month 2026-05 --limit 20
uv run python app/main.py --root <repo-root> import-monthly-zone-group \
  --csv <zone_group.csv> --group-id 1 --group-name <group-name>
```

Monthly workflow 使用 `data/monthly_report.sqlite` 建立月報 snapshot，支援 P4(J) 手 key 欄位、測試模板上傳比對、月結與月報圖表。相關操作也可透過前端 monthly 工作台執行。

## 資料初始化與同步工具

```bash
uv run python app/main.py --root <repo-root> seed-bootstrap --raw-source <raw-source-dir>
uv run python app/main.py --root <repo-root> seed-rebuild --workflow dsp --template-version v1 --rule-version v1
uv run python app/main.py --root <repo-root> seed-promote-live --workflow dsp --source-db-rel canonical/mdreport_dsp.sqlite
uv run python app/main.py --root <repo-root> seed-import-mdreport --mdreport-root <mdreport-root>
```

- `seed-bootstrap` 建立可重建的 raw seed、canonical snapshot、log snapshot、template/rule mapping 與 manifest。
- `seed-rebuild` 讀取 seed manifest，透過既有 `save` 契約重建 canonical。
- `seed-promote-live` 將 seed canonical 轉寫進 live runtime DB。
- `seed-import-mdreport` 可從指定的 MDreport 資料來源匯入 seed 結構。

## 前端工作台

前端位於 `frontend/`，使用 React + TypeScript + Vite，預設 proxy 到 `http://127.0.0.1:8510`。

```bash
# terminal A：啟動 runtime API / static host
uv run python app/ui_shell.py --host 127.0.0.1 --port 8510

# terminal B：啟動 Vite frontend
cd frontend
pnpm install
pnpm dev
```

若 runtime 不在預設 port：

```bash
cd frontend
VITE_RUNTIME_PROXY_TARGET=http://127.0.0.1:9000 pnpm dev
```

前端主要區塊：

- Workflow / main tab / sub tab / period 控制列。
- Overview、Rawdata、Pivot、Result 共用工作區。
- DSP Tab4 預覽與 delivery/export 控制。
- SSP media demand、ad group monitor、padding parity 工作區。
- Monthly P4、monthly charts 工作區。
- Runtime utility strip：bootstrap、health、sandbox prepare/reset、status/frame refresh、recent logs。

## CLI 輸出契約

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
- `MANIFEST_JSON_INVALID`
- `RULE_BINDING_INCOMPLETE`
- `HEALTH_CHECK_EXCEPTION`

## 開發與驗證

建議環境：Python `uv + .venv`，前端使用 `pnpm`。

```bash
uv run python -m unittest discover -s tests -p 'test_*.py' -v

cd frontend
pnpm typecheck
pnpm build
```

常用 smoke script：

```bash
./scripts/smoke_bootstrap.sh
```

## 新接手快速路徑

1. 讀 `bootstrap.manifest.json`，確認 `db.path`、`data_seed.root`、`artifact_root`、`feature_flags`。
2. 執行 `bootstrap` 與 `health`，確認 schema、registry、binding 與 acceptance gate。
3. 用 sandbox 或 test env 跑一次 `fetch -> save/modify -> export` 的最小流程。
4. 檢查 SQLite canonical、artifact、`run_log`、`publish_runs`、`evidence_index` 是否符合預期。
