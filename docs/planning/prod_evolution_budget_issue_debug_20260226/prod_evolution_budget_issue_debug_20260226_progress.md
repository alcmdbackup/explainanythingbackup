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

## Phase 1: [Research]
...

## Phase 2: [Implementation]
...
