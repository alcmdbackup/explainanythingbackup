# Design Elo Improvement Experiment Progress

<!-- Execution tracking for the single-seed agent-comparison experiment design. -->

## Phase 0: Initialization
### Work Done
- Created branch `feat/design_elo_improvement_experiment_20260626` off `origin/main`.
- Read all 7 core workflow/ops docs + all 27 evolution docs (via parallel Explore agents).
- Confirmed target arena on staging: `Federal Reserve 2` = `a546b7e9-f066-403d-9589-f5e0d2c9fa4f` (2675 synced variants, arena max Elo ~1442).
- Identified ~1325-Elo seed candidates: `da03b016…`, `538bfbc9…`, `93a9ac9d…` — all with only 3–6 arena matches (sigma 5–6 → noisy baseline).
- Wrote research doc (rating instrument, candidate arms, seeding, budget/ops, failure modes) and planning doc (Decisions A–E with recommended options + phased plan).

### Issues Encountered
- `evolution_variants` text column is `variant_content` (not `variant_text`); uncertainty is stored as `sigma`/`mu`, not an `uncertainty` column. Adjusted queries accordingly.

### User Clarifications
- (none yet)

### Key open question for next phase
- Decision A: how to insert the copied seed as a **fixed in-pool anchor** in a new arena (docs say the seed is excluded from the pool since 2026-04-15). This is the first /research-deep / Phase 0 code-level task.

## Phase 1: Finalize design + pre-registration
### Work Done
(pending)
