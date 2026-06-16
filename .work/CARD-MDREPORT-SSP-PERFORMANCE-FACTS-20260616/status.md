---
id: CARD-MDREPORT-SSP-PERFORMANCE-FACTS-20260616
status: verification_partial
type: status
---

# Status

## Current
- Current workspace is on branch `codex/mdreport-new-card-mdreport-ssp-performance-facts-20260616-175241`.
- Main branch dirty files were saved in stash `pre-ssp-performance-facts-main-dirty-20260616` before switching branches.
- First slice implementation is complete: backend fact/membership compatibility layer.
- Existing SSP raw and ad group saves now double-write into `ssp_performance_facts`.
- Regular SSP fetch now directly pulls both `pb=0` and `pb=1`; the no-padding path is not inferred from old local data.
- Zone group membership storage exists for API payloads such as group `117`, with zone id dedupe.

## Next
1. Decide whether to migrate UI/monthly queries to `ssp_performance_facts` in the next card.
2. Add the actual zone-group API fetch action that persists group `117` through `replace_ssp_zone_group_memberships`.
3. Keep country report as an independent source until country dimensions can be reproduced from hourly facts.

## Blockers
- None for SSP first slice.
- Full `tests/test_ui_shell.py` currently has one DSP browser acceptance failure unrelated to this SSP storage layer: `monthTotals[4]` is `0.0`.

## Do Not Touch
- DSP canonical/report pipeline.
- Existing frontend public assets.
- Main worktree dirty files.
