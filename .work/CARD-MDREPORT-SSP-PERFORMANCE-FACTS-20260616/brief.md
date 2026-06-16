---
id: CARD-MDREPORT-SSP-PERFORMANCE-FACTS-20260616
status: in_progress
type: implementation
---

# SSP Performance Facts 整併

## Root Question
SSP 成效資料能否先把既有 raw/ad group 路徑整併到共用 fact 與 zone group membership 資料層，同時保留舊表相容，避免現有頁面爆掉？

## Scope
- 新增 SSP performance fact 儲存層，先承接既有 `ssp_raw` 與 `ssp_ad_group_daily_metrics` 資料。
- 新增 zone group membership 儲存層，支援 API 拉回的 zone group 清單與 dedupe。
- 既有 fetch 流程先雙寫新表與舊表。
- `country` 維度暫留 side source，不納入本 slice。

## Out Of Scope
- 不刪除 `ssp_raw`、`ssp_ad_group_daily_metrics`、`monthly_report_rows`。
- 不在 repo 寫入 HolmesMind Bearer token。
- 不把前端 UI 全面改吃 fact table。
- 不處理 country 維度整併。

## Acceptance
- repository 可建立新 schema，並能寫入/讀回 SSP facts。
- `save_ssp_raw_rows` 寫舊表時同步寫入 `placement_hourly` facts。
- `save_ssp_ad_group_report` 寫舊表時同步寫入 `ad_group_daily` facts。
- zone group membership 可從 payload/rows 寫入並 dedupe。
- 受影響測試通過，至少涵蓋 raw/ad group 雙寫與既有相容。

## Evidence
- `.work/CARD-MDREPORT-SSP-PERFORMANCE-FACTS-20260616/evidence/`
