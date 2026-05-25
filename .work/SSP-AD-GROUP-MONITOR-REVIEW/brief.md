# SSP-AD-GROUP-MONITOR-REVIEW

任務ID: SSP-AD-GROUP-MONITOR-REVIEW
卡片類型｜派工對象: review｜其他 AI reviewer
請讀:
- `/Users/matt/MDREPROT2/infra/ssp_api.py`
- `/Users/matt/MDREPROT2/infra/sqlite/repository.py`
- `/Users/matt/MDREPROT2/domain/services.py`
- `/Users/matt/MDREPROT2/app/ui_shell.py`
- `/Users/matt/MDREPROT2/frontend/src/components/workspaces/sspAdGroupMonitor.tsx`
- `/Users/matt/MDREPROT2/frontend/src/styles/workspace.css`
- `/Users/matt/MDREPROT2/frontend/src/types.ts`
- `/Users/matt/MDREPROT2/frontend/src/api/runtimeApi.ts`
- `/Users/matt/MDREPROT2/frontend/src/state/useRuntimeStore.ts`

任務目的:
Review SSP 廣告群組監控新頁。此頁用 SSP report-conditions / report data 的既有抓取方式，監控 18 個 `zone_group`，彙總成 6 個廣告形式與高中低群組，讓 PM 能看出群組是否異常，以及往下展開版位找原因。

目前功能摘要:
- 新增 SSP 廣告群組 catalog：18 個 `zone_group`，分為 6 個廣告形式與高中低三種價位。
- 新增 SQLite 儲存：
  - `ssp_ad_group_report_runs`
  - `ssp_ad_group_daily_metrics`
- 新增 SSP ad group API 抓取流程：
  - 一次抓一個 `zone_group`、一天資料。
  - filter 使用 `zone_group`。
  - dimension 使用 `data_time`、`zone_id`。
- 新增 `ssp_ad_group` main tab 與 dashboard snapshot。
- 總表：
  - 6 個廣告形式依 `request` 請求數由高到低排序。
  - 可展開成 18 個高中低群組。
  - 點群組後下方展開版位多日成效。
- 各廣告形式頁籤：
  - 顯示該形式高中低群組多日成效。
  - 可點群組展開版位。
- 指標：
  - 預設 CPC，可多選請求、曝光、點擊、CTR、CPM、CPC、執行金額。
  - CTR = `click / impress`
  - CPC = `advertiser_mu / click`
  - CPM = `advertiser_mu / impress * 1000`
  - 執行金額 = `advertiser_mu`
  - 所有金額相關口徑都使用 DSP 執行金額 `advertiser_mu`。
- 異常規則：
  - CPC / CPM 越低越好；高於近 7 天平均 5% 以上為異常。
  - CTR 越高越好；低於近 7 天平均 5% 以上為異常。
  - 表格用亮燈/底色；最新天異常才亮底色。
  - 線圖異常節點以「同線色空心點」表示；正常與優良維持同線色實心點。
- Review 修正：
  - Fixed P1: 近 7 天平均只除實際有資料日期數，不再把缺資料日期混成 0 值稀釋平均。
  - Fixed P2: 表格欄名與節點明細已從 `DOD` 改成 `vs 近 7 天`，避免誤解成最新日 vs 前一日。
- 線圖：
  - 總表才顯示折線圖。
  - 點選哪個指標就顯示哪個指標。
  - X 軸顯示每日日期，Y 軸顯示數值刻度。
  - 近 7 天平均灰虛線數值顯示在 Y 軸。
  - 展示型/離群線不參與 Y 軸尺度，避免其他線擠在底部。
  - 點節點可看廣告形式、日期、值、近 7 天平均、vs 近 7 天與狀態。
- Rawdata scroll 另有獨立 review 卡，不屬本卡主題。

Reviewer 請重點檢查:
- SSP API filter payload 是否與既有 SSP 報表抓取契約一致，尤其 `zone_group` filter shape 是否穩定。
- 新 SQLite table 與 repository read/write 是否會破壞既有 migration / seed / canonical DB 流程。
- `domain/services.py` 的 snapshot 彙總是否正確：
  - format summary
  - group rows
  - placement rows
  - daily metrics
  - avg metrics
- 金額口徑是否完全走 `advertiser_mu`，避免混用 `profit`。
- CPC/CPM/CTR 是否全部用 raw sums 重算，而不是拿 API 回傳比例。
- 近 7 天平均與 `vs 近 7 天` 的定義是否符合 PM 監控用途。
- 線圖目前「近 7 天平均」仍是目前可用 recent window 的 benchmark；若 PM 要每一天各自往前 7 天移動平均，需另開 follow-up。
- 離群線不參與 Y 軸尺度是否會造成解讀誤會；目前用虛線與「離群」標記提示。
- 總表 request 排序是否和表格/legend/線條順序一致。
- Sticky table header 前兩列是否在總表、形式頁籤、版位拆解都正常。
- UI 是否仍符合既有專案字體與密度，不要過粗、過花或像 landing page。

驗證方式:
- 執行 `cd /Users/matt/MDREPROT2 && uv run python -m py_compile domain/services.py infra/ssp_api.py infra/sqlite/repository.py app/ui_shell.py`。
- 執行 `cd /Users/matt/MDREPROT2 && pnpm --dir frontend exec tsc --noEmit`。
- 執行 `cd /Users/matt/MDREPROT2 && pnpm --dir frontend build`。
- 開啟本機頁面：
  `http://127.0.0.1:8511/?workflow=ssp&main_tab=ssp_ad_group&root=%2FUsers%2Fmatt%2FMDREPROT2&manifest=bootstrap.manifest.json&template_version=v1&rule_version=v1&artifact_root=artifacts&period_preset=custom&period_week_start=2026-05-10&period_week_end=2026-05-24&env=prod&row_filter=&row_limit=10`
- 檢查總表：
  - 6 個大群組依 request 排序。
  - 點 `+` 可展開 18 組。
  - 點群組後下方版位拆解有資料。
- 檢查線圖：
  - 勾選不同指標，圖跟著切換。
  - X/Y 軸與近 7 天平均值清楚。
  - 異常節點是同線色空心點。
  - 點節點明細正確。
- 檢查表格：
  - 近 7 天平均、vs 近 7 天、每日值存在。
  - 前兩列表頭 sticky。
  - 版位拆解表也可橫向/縱向讀。

已知狀態:
- `pnpm --dir frontend exec tsc --noEmit` 通過。
- `pnpm --dir frontend build` 通過。
- Review findings 已處理：
  - P1 avg_metrics divisor。
  - P2 DOD label。
- Browser 截圖證據曾產出於 `/private/tmp/ssp_ad_group_chart_*` 系列檔案。
- Host 目前使用 `0.0.0.0:8511`。

限制:
- Worktree 有大量既有或平行修改，不要 revert 非本卡相關檔案。
- 不要把 Rawdata scroll review 混進本卡。
- 不要把 line chart 改成單一尺度硬塞所有離群線，PM 已要求展示型作特例以保留可讀性。
- 不要再加大量文字說明到 UI；若需要提示，優先用軸、legend、節點狀態。

輸出期望:
- 請列出 findings，依嚴重度排序。
- 每個 finding 附檔案與行號。
- 若沒有 blocker，請明確說明是否可進下一輪 PM acceptance。
