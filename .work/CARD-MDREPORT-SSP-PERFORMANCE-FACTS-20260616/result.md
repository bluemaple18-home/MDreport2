---
id: CARD-MDREPORT-SSP-PERFORMANCE-FACTS-20260616
status: verification_partial
type: result
---

# Result

## Completed
- Added `ssp_performance_facts` as the shared SSP fact table.
- Added `ssp_zone_group_memberships` for zone group API payloads and deduped zone id storage.
- Double-wrote existing `save_ssp_raw_rows` into `placement_hourly / hourly / including_padding / pb=0`.
- Updated regular `fetch_ssp_api` to call SSP API twice: `pb=0` for `including_padding`, and `pb=1` for `excluding_padding`.
- Kept legacy `ssp_raw` on `pb=0`; `pb=1` writes only into `ssp_performance_facts`.
- Double-wrote existing `save_ssp_ad_group_report` into `ad_group_daily / daily / excluding_padding / pb=1`.
- Added read helpers for facts and zone group membership.
- Added focused regression tests for both double-write paths and group `117` membership dedupe behavior.

## Verification
- Pass: `.venv/bin/python -m pytest tests/test_ui_shell.py -k "fetch_ssp_api_writes_ssp_raw or fetch_ssp_ad_group_api_cli_uses_runtime_command_contract or zone_group_membership"`
- Pass: `.venv/bin/python -m pytest tests/test_ui_shell.py -k "fetch_ssp_api_writes_ssp_raw or fetch_ssp_api_preserves_other_days or fetch_ssp_api_cli_uses_runtime_command_contract or fetch_ssp_ad_group_api_cli_uses_runtime_command_contract or zone_group_membership or fetch_ssp_api_cli_multi_day_sum_row_is_aggregated or camelcase_auth_contract"`
- Pass: `.venv/bin/python -m pytest tests/test_ssp_api.py tests/test_phase2_services.py -k "ssp or monthly_report or ad_group"`
- Pass: `git diff --check`
- Partial: `.venv/bin/python -m pytest tests/test_ui_shell.py` has one existing/non-SSP DSP browser acceptance failure where `monthTotals[4]` is `0.0`.

## Remaining
- UI/monthly report queries are not yet migrated to the new facts table.
- The country report path remains separate.
- Group `117` API fetch is not yet wired as a runtime action; only the repository persistence layer is ready.
