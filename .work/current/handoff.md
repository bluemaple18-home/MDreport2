---
id: current
status: in_progress
type: handoff
source_workspace: .work/CARD-MDREPORT-SSP-PERFORMANCE-FACTS-20260616
---

# Handoff

## Root Question
Can existing SSP raw/ad group data paths be integrated into a common fact/membership layer while keeping legacy tables working?

## Current Status
- Current workspace is on branch `codex/mdreport-new-card-mdreport-ssp-performance-facts-20260616-175241`.
- Main branch dirty files were saved in stash `pre-ssp-performance-facts-main-dirty-20260616`.
- First slice is implemented in `infra/sqlite/repository.py` and covered by focused tests in `tests/test_ui_shell.py`.
- Existing SSP raw and ad group flows now double-write to the common facts layer while preserving legacy tables.
- Regular SSP fetch now directly pulls `pb=0` and `pb=1`; `pb=1` is written to `ssp_performance_facts` as `excluding_padding`.

## Next Step
Open the next card for UI/monthly query migration to `ssp_performance_facts`, and separately wire the zone group API fetch action for group `117`.

## Blocker
None for SSP first slice. `.venv/bin/python -m pytest tests/test_ui_shell.py tests/test_ssp_api.py tests/test_phase2_services.py` now passes with `98 passed`.

## Do Not Touch
- DSP pipeline.
- Main worktree dirty changes.
