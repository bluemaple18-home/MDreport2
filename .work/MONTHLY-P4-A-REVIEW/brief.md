# MONTHLY-P4-A-REVIEW

## root question
第三個大頁籤「月報」的 A 主線是否可以進入 review：只做 P4(J) 營收績效表，不混入外部經銷商簡報或 SSP 海外/TW 流量簡報。

## current state
- 新增 `monthly` workflow 與 `monthly_p4` main tab。
- 後端新增 P4(J) target/manual input lazy tables。
- 後端新增 `monthly_p4` frame payload 與 `monthly_p4_save` action。
- 前端新增 P4(J) 手 key 編輯區、大表即時重算、存檔/重載、下載 PNG/複製圖片。
- P4(J) 目標以 `績效追蹤 p4 5 (j)` 固定目標初始化。

## review scope
- `infra/sqlite/repository.py`
- `domain/services.py`
- `app/ui_shell.py`
- `frontend/src/components/workspaces/monthlyP4.tsx`
- `frontend/src/state/runtimeContract.ts`
- `frontend/src/shell/WorkbenchCommandDeck.tsx`
- `tests/test_monthly_p4.py`

## evidence
- `pnpm --dir frontend typecheck` passes.
- `pnpm --dir frontend build` passes.
- `uv run pytest tests/test_monthly_p4.py` passes.
- Review fix pass:
  - Fixed P1: monthly P4 computed rows are now bucketed by exact `YYYY-MM`, so `2025-04` and `2026-04` cannot merge into the same April column.
  - Fixed P2: monthly period parsing normalizes `YYYY/MM/DD` into `YYYY-MM-DD` before month-window shifting.
  - Added regression coverage for cross-year same-month rows and slash-date period input.
- `pnpm --dir frontend test:controller-guard` passes.
- Browser acceptance script passed:
  - URL: `http://127.0.0.1:8512/?workflow=monthly&main_tab=monthly_p4&root=/Users/matt/MDREPROT2&manifest=bootstrap.manifest.json&template_version=v1&rule_version=v1&artifact_root=artifacts&period_week_start=2026-04-01&period_week_end=2026-04-30&period_preset=custom`
  - Screenshot: `/private/tmp/monthly-p4-acceptance.png`
  - Console errors: none
  - Save/reload check: `external_io_momo=135000` persisted during test, then live test manual input rows were cleaned.
- Post-review browser acceptance also passed with slash date params:
  - URL: `http://127.0.0.1:8512/?workflow=monthly&main_tab=monthly_p4&root=/Users/matt/MDREPROT2&manifest=bootstrap.manifest.json&template_version=v1&rule_version=v1&artifact_root=artifacts&period_week_start=2026/04/01&period_week_end=2026/04/30&period_preset=custom`
  - Screenshot: `/private/tmp/monthly-p4-acceptance.png`
  - Console errors: none
  - Save/reload check: `external_io_momo=135000` persisted during test, then live test manual input rows were cleaned.

## known issue / review point
- Existing DSP Tab4 browser export test still fails after build because export button remains disabled in that test path. This is outside the new monthly path, but should be reviewed separately before claiming full-suite browser acceptance.
- Current P4(J) computed values use existing Tab4 summary rows where available, but business口徑 still needs review against Matt's actual Tab3/Tab4 pivot source. Manual input fields are implemented for known hand-key values.

## waiting condition
另一個 AI review should verify the monthly data contract, formula mapping, and UI behavior before expanding to B/C branches.
