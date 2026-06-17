---
id: CARD-MDREPORT-SSP-PERFORMANCE-FACTS-20260616
status: completed
type: context_manifest
---

# Context Manifest

## Required Code
- `infra/sqlite/repository.py`: SSP raw/ad group/monthly storage and new fact schema.
- `domain/services.py`: SSP fetch/ad group fetch flows.
- `infra/ssp_api.py`: SSP API dimensions and normalizers.
- `tests/test_ui_shell.py`: UI shell API compatibility tests.
- `tests/test_phase2_services.py`: service-level SSP/monthly tests.

## Evidence Sources
- `.work/CARD-MDREPORT-SSP-PERFORMANCE-FACTS-20260616/evidence/`

## Notes
- CodeGraph is unavailable in this worktree; use `rg` and direct source reads.
- `country` remains a side source unless API support is later confirmed.
