# MONTHLY-P4-TEST-REVIEW

## Root Question

月報 P4(J) 測試/驗收流程是否可進入 review：用測試 DB 模擬「做三月月報」的操作流程，而不是污染正式月報資料。

## Context

- 舊卡 `.work/MONTHLY-P4-A-REVIEW/brief.md` 已涵蓋初版 P4(J) 大表與先前 review 修正。
- 本卡只 review 後續新增的「月報測試頁籤」功能。
- 使用者要驗的流程：
  1. 選擇 `2026-03` 作為要產出的月報月份。
  2. 上傳二月基礎模板。
  3. 前台讀取二月基礎模板數值，加上系統內三月月報資料，產生候選 P4(J) 整張表。
  4. 在測試頁籤手 key 三月需要補的欄位。
  5. 存檔到測試資料庫。
  6. 上傳三月檢核模板。
  7. 系統逐格比對全部數字；只要顯示數字不一樣就列出差異。
- Excel 檔在這裡只當輸入來源；系統取出顯示/快取值後，放到專案自己的 snapshot 與計算流程，不操作原 Excel 公式。

## Implementation Scope

- `infra/sqlite/repository.py`
  - 新增 `monthly_p4_test_inputs`、`monthly_p4_test_templates`。
  - template table 支援 `snapshot_json` migration。
- `domain/services.py`
  - `monthly_test_repo`
  - `save_monthly_p4_test_inputs`
  - `save_monthly_p4_test_template`
  - `_parse_monthly_p4_workbook_snapshot`
  - `_monthly_p4_snapshot_from_payloads`
  - `_apply_monthly_p4_base_snapshot`
  - `_monthly_p4_diff`
- `app/ui_shell.py`
  - 測試 DB path。
  - `monthly_p4_test` frame。
  - actions: `monthly_p4_test_save`、`monthly_p4_test_template_upload`。
- Frontend
  - `frontend/src/components/workspaces/monthlyP4.tsx`
  - `frontend/src/types.ts`
  - `frontend/src/state/useRuntimeStore.ts`
  - `frontend/src/shell/useAppShellController.ts`
  - `frontend/src/shell/MainWorkspaceRenderer.tsx`
  - `frontend/src/App.tsx`
  - `frontend/src/styles/workspace.css`
- Tests
  - `tests/test_monthly_p4.py`

## Review Focus

- 測試模式是否完全使用 `monthly_p4_test.sqlite`，不寫入正式月報手 key 資料。
- 二月基礎模板 overlay 是否只覆蓋 anchor month 之前的月份，不蓋掉三月候選結果。
- 測試頁籤手 key 是否只影響測試候選 snapshot。
- P4(J) 整張表、Total、百分比與金額格式是否都有進入 snapshot/diff。
- Excel parser 是否足夠穩定對應目前 P4(J) 版型；如果正式模板固定，請評估是否應改為固定 cell mapping。
- 差異比對是否符合「全部數字都比、完全一樣才算過」。
- 前台是否有兩個清楚分開的上傳入口：基礎模板、檢核模板。
- 使用者先前回報「掛了」；review 時請實際打開月報頁籤與測試頁籤，看 console/network/frame error。

## Known Risks

- 尚未用使用者實際二月基礎模板、三月檢核模板做 browser acceptance。
- Parser 目前以表格語意/標籤抓取為主，不是完全固定座標。
- Diff table 前台顯示有數量上限，review 可確認是否需要下載完整差異。
- 目前 git worktree 另有 SSP/rawdata 旁支改動；請 reviewer 聚焦本卡列出的 monthly P4 test 範圍。

## Review Round 1 Fixes

- Fixed P1: diff status no longer returns `ok` when differences exist.
  - `missing_answer`: check template has not been uploaded.
  - `matched`: candidate and answer entries are fully identical.
  - `mismatch`: any value mismatch or missing key exists.
- Fixed P1: diff now compares the union of candidate keys and answer keys.
  - `value_mismatch`: both sides exist but values differ.
  - `missing_in_check_template`: candidate has a required entry that answer template did not expose.
  - `missing_in_candidate`: answer template has an entry missing from candidate.
- Frontend diff table now displays the diff reason column.
- Added regression test for semantic diff statuses and union-key comparison.

## Evidence To Recheck

請 reviewer 重跑以下最小驗證：

```bash
uv run python -m py_compile domain/services.py infra/sqlite/repository.py app/ui_shell.py
uv run pytest tests/test_monthly_p4.py
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

Current local evidence:

- `uv run python -m py_compile domain/services.py infra/sqlite/repository.py app/ui_shell.py` passed.
- `uv run pytest tests/test_monthly_p4.py` passed: 7 tests.
- `pnpm --dir frontend typecheck` passed.
- `pnpm --dir frontend build` passed.
- Browser check on `8511` passed:
  - HTTP status 200.
  - `HEALTH: OK`.
  - No console errors.
  - No page errors.
  - No failed requests.
  - Monthly test tab rendered P4(J) table.
  - Screenshot: `/private/tmp/monthly_p4_8511.png`.

建議 browser URL；目前本機服務在 `8511`，不是舊的 `8512`：

```text
http://127.0.0.1:8511/?workflow=monthly&main_tab=monthly_p4&sub_tab=pivot&root=%2FUsers%2Fmatt%2FMDREPROT2&manifest=bootstrap.manifest.json&template_version=v1&rule_version=v1&artifact_root=artifacts&period_week_start=2026-03-01&period_week_end=2026-03-31&period_preset=custom&env=prod&row_filter=&row_limit=10
```
