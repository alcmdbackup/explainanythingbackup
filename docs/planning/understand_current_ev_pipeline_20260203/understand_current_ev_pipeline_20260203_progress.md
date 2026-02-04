# Understand Current Evolution Pipeline Progress

## Phase 1: Research
### Work Done
- Spawned 4 parallel explore agents covering: core infrastructure, agents, visualization layer, scripts/DB/CI
- All 12 core files, 10 agents, 11 visualization components, 9 scripts, 11 migrations audited
- Cross-referenced codebase against `evolution_pipeline.md` and `evolution_pipeline_visualization.md`
- Identified 10 discrepancies in evolution_pipeline.md and 6 in evolution_pipeline_visualization.md
- Populated research document with full findings

### Issues Encountered
- Planning folder redirected to a different path (old project structure) — used progress doc from correct location
- No blockers

### User Clarifications
- User confirmed this is a chore branch for documentation updates
- User confirmed no new feature deep dive needed
- User confirmed evolution pipeline visualization docs will be affected

## Phase 2: Doc Updates
### Work Done
- Fixed all 10 discrepancies in `evolution_pipeline.md`:
  1. Fixed `rollbackEvolutionAction` signature (uses `{explanationId, historyId}` not positional args)
  2. Added `comparison.ts`, `config.ts`, `types.ts`, `index.ts` as Shared Modules table
  3. Updated server action count from 8 to 9 (added `getEvolutionRunSummaryAction`)
  4. Added 7 missing scripts + `promptBankConfig.ts` to Integration Points table
  5. Added `run_summary` column, article bank tables, variants nullable migration to DB Tables
  6. Updated migration range to `20260131000010` + `20260201000001`
  7. Added `--bank-checkpoints` CLI flag with usage example
  8. Added full `EvolutionRunSummary` section documenting all fields
  9. Added 7 missing test files to Testing section (including new test helpers)
  10. Added `--bank-checkpoints` explanation to Prompt-Based Seeding section

- Fixed all 6 discrepancies in `evolution_pipeline_visualization.md`:
  1. Updated `parent_variant_id` architecture decision ("checkpoint-first" not "checkpoint-only")
  2. Added "Add to Bank" dialog and Compare button to run detail page docs
  3. Added `getEvolutionRunSummaryAction` reference and `ComparisonData.generationDepth`
  4. Added full Testing section with component (21 tests), integration (8), and E2E (5) counts
  5. Added `diff` package to Dependencies table
  6. All test file references added

### Issues Encountered
- None

### Verification
- `git diff --stat`: 3 files changed, 83 insertions, 14 deletions (all markdown)
