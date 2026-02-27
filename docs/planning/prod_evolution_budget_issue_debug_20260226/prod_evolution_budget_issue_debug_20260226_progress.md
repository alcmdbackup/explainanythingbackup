# Prod Evolution Budget Issue Debug Progress

## Phase 0: Investigation
### Work Done
- Queried production runs af3af872 and 0080d2d2 via query:prod
- Traced budget exceeded errors to experiment budget splitting ($0.50 / 8 runs = $0.0625/run)
- Confirmed budget redistribution logic is correct (computeEffectiveBudgetCaps works as designed)
- Identified the per-run budget is set in experimentActions.ts line 216

### Issues Encountered
- npm cache EROFS error — fixed with npm_config_cache=/tmp/claude-1000/npm-cache workaround
- Supabase DNS blocked by sandbox — needed whitelist approval

### User Clarifications
- User confirmed scope: add run preview to experiment UI, not just fix the budget floor

## Phase 1: Research
### Work Done
- Round 1 (4 agents): ExperimentForm UI deep dive, validation pipeline internals, L8 factorial design, existing UI patterns for reuse
- Round 2 (4 agents): handleStart() submission flow, experiment driver cron/round analysis, test patterns, edge cases/configDefaults
- Updated research doc with all findings

### Key Findings
- validateExperimentConfigAction discards expandedConfigs — needs to pass through row-level data
- estimateBatchCost can be refactored to return per-row cost array with minimal changes
- computeEffectiveBudgetCaps is a pure function — can compute redistributed caps for preview
- No budget sufficiency check exists (estimated cost vs budget) — needs warning
- ExperimentForm has no tests — need to add
- Multiple reusable UI patterns available (expandable rows, cost bars, config grids)
- 2-factor L8 still produces 8 rows (some duplicate factor combos)

### Issues Encountered
- None in research phase

### User Clarifications
- User requested 2 rounds of 4 agents each for research

## Phase 2: Implementation
...
