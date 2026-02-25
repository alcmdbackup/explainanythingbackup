# Small Evolution Fixes Research

## Problem Statement
Small fixes and improvements to the evolution pipeline dashboard. Focuses on evolution dashboard UX issues including experiment budget input handling, budget calculation refresh, and the ability to kill running pipeline runs from the admin UI.

## Requirements (from GH Issue #558)
- [ ] Ratings optimization > new experiment > budget should allow decimals. Should clearly label that it's per article. Should have a button that refreshes calculation when clicked.
- [ ] Rates optimization > new experiment > budget price not passed through correctly. Observed all runs start with budget of 5, rather than input number.
- [ ] Way to automatically kill a pipeline run from "start pipeline" tab - stop it and mark as failed

## Decisions
- Budget label: keep as total experiment budget (not per-article), label clearly as "Total Budget ($)"
- Per-run allocation: simple division (total / numRuns)

## High Level Summary

### Fix 1: Experiment budget UX (ExperimentForm)
The ExperimentForm budget input (`ExperimentForm.tsx:356-362`) uses `type="number"` with `min={1}` — **no `step` attribute**, so browsers default to step=1 (integer-only). Label says "Budget ($)" without specifying it's the total experiment budget. No manual refresh button for cost estimation — validation only runs on debounce when factors/prompts change, NOT when budget changes.

**Validation preview already shows run count and estimated cost** (line 423): `{validation.expandedRunCount} runs | Est. ${validation.estimatedCost.toFixed(2)}`. The run count shown is L8 rows (8), not total DB runs (8 × prompts). Refresh currently only triggers on factor/prompt changes via 500ms debounce.

### Fix 2: Budget not passed through to runs (ROOT CAUSE FOUND)
**Bug confirmed.** In `experimentActions.ts:213-220`, when building per-run overrides for `resolveConfig()`, `budgetCapUsd` is **never included** in the overrides object. The overrides only contain `generationModel`, `judgeModel`, `maxIterations`, and `enabledAgents`. Since `resolveConfig()` uses `deepMerge(DEFAULT_EVOLUTION_CONFIG, overrides)`, and `DEFAULT_EVOLUTION_CONFIG.budgetCapUsd = 5.00` (config.ts:9), every run gets the default $5 budget regardless of what the user entered.

Same bug exists in the experiment driver cron (`experiment-driver/route.ts:363-370`) for subsequent rounds.

The experiment's `total_budget_usd` is stored correctly in `evolution_experiments` (line 168), but this value is never divided/allocated to individual runs.

**Budget flow through pipeline:** `budgetCapUsd` flows to `CostTracker` constructor → used in `reserveBudget()` as `agentCap = proportion * budgetCapUsd`. The `budgetCaps` proportions (config.ts:21-34) are redistributed by `computeEffectiveBudgetCaps()` but do NOT need to change — they auto-scale via the multiplication at runtime.

**Fix formula:**
- Round 1: `budgetCapUsd = input.budget / (design.runs.length * resolvedPrompts.length)`
- Round N: `budgetCapUsd = remainingBudget / (ffDesign.runs.length * exp.prompts.length)`
- Minimum per-run: $0.01 (validated by evolutionActions.ts:87-90)

### Fix 3: Kill button on start pipeline tab
`killEvolutionRunAction` already exists in `evolutionActions.ts:549-587`. It's a fully functional server action that:
- Sets run status to `'failed'` with error_message `'Manually killed by admin'`
- Guards with `.in('status', ['pending', 'claimed', 'running', 'continuation_pending'])`
- Has integration tests and audit logging

**NO UI button exists anywhere** to call it. The runs table on the evolution page (`page.tsx:725-752`) only shows "Variants" and "Trigger" (pending only). Need to add a "Kill" button for running/claimed/pending/continuation_pending runs. The action is already exported and follows the same pattern as existing actions.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — doc structure overview
- docs/docs_overall/architecture.md — system design, action pattern, schema-first approach
- docs/docs_overall/project_workflow.md — workflow steps

### Relevant Docs
- evolution/docs/evolution/hall_of_fame.md — HoF system, actions, UI
- evolution/docs/evolution/data_model.md — core primitives, `budgetCapUsd` in config propagation
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill rating system
- evolution/docs/evolution/architecture.md — kill mechanism 3-checkpoint design, budget config

## Code Files Read

### Fix 1: Budget UX
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — full read
  - Budget input: line 94 (`useState(50)`), lines 356-362 (input field, no `step`)
  - Validation preview: lines 393-429, shows run count + estimated cost at line 423
  - Debounced validation: lines 148-173, triggers on factor/prompt changes
  - `runValidation` callback: line 149, can be called manually for refresh button
- `evolution/src/experiments/evolution/experimentValidation.ts` — full read
  - `validateExperimentConfig`: lines 69-175, generates L8 design, resolves configs, estimates cost
  - `estimateBatchCost`: lines 39-60, per-config cost × safety multiplier × prompt count
  - Returns `expandedConfigs.length` (always 8 for L8) and `estimatedTotalCost`

### Fix 2: Budget Passthrough
- `evolution/src/services/experimentActions.ts` — full read
  - `startExperimentAction`: lines 128-275
  - Bug at lines 213-220: overrides missing `budgetCapUsd`
  - Total runs: `design.runs.length * resolvedPrompts.length` (8 × prompts)
  - Total budget correctly stored at line 168: `total_budget_usd: input.budget`
- `src/app/api/cron/experiment-driver/route.ts` — full read
  - `handlePendingNextRound`: lines 287-503
  - Bug at lines 363-370: same missing `budgetCapUsd` in overrides
  - Remaining budget calculated at line 387: `exp.total_budget_usd - exp.spent_usd`
  - Per-round run count: `ffDesign.runs.length * exp.prompts.length`
- `evolution/src/lib/config.ts` — full read
  - Default: `budgetCapUsd: 5.00` (line 9)
  - `resolveConfig()`: lines 73-89, deepMerge with defaults
  - `budgetCaps` proportions: lines 21-34 (auto-scale, no change needed)
- `evolution/src/lib/core/budgetRedistribution.ts` — confirmed proportions-only redistribution
- `evolution/src/lib/core/costTracker.ts` — confirmed `agentCap = proportion * budgetCapUsd` at runtime
- `evolution/src/services/experimentActions.test.ts` — test patterns for budget validation

### Fix 3: Kill Button
- `src/app/admin/quality/evolution/page.tsx` — full read
  - RunsTable renderActions: lines 725-752
  - Trigger handler pattern: lines 641-655
  - `actionLoading` state: line 533, reusable for Kill button
  - Import block: lines 7-17, need to add `killEvolutionRunAction`
- `evolution/src/services/evolutionActions.ts` — read kill action
  - `killEvolutionRunAction`: lines 549-587, already exported at line 587
  - Signature: `(runId: string) => Promise<{success, data, error}>`
  - Status guard: `.in('status', ['pending', 'claimed', 'running', 'continuation_pending'])`
- `evolution/src/components/evolution/RunsTable.tsx` — renderActions signature
  - `renderActions?: (run: T) => React.ReactNode` at line 48
  - Actions cell stops propagation at line 228
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — checked for kill button (none exists)

## Key Findings

1. **Budget decimal input**: `ExperimentForm.tsx:356-362` — `min={1}` without `step`. Add `step="0.01"` and change `min` to `0.01` for decimals.

2. **Budget label**: Label at line 353-354 says "Budget ($)". Change to "Total Budget ($)" with helper text showing per-run allocation when validation preview is available.

3. **Budget passthrough bug — root cause**: `experimentActions.ts:213-220` — overrides missing `budgetCapUsd`. Fix: add `budgetCapUsd: input.budget / totalRunCount` to overrides before `resolveConfig()`.

4. **Same bug in experiment driver**: `experiment-driver/route.ts:363-370` — add `budgetCapUsd: remainingBudget / totalRunCount` to overrides.

5. **Budget proportions auto-scale**: `computeEffectiveBudgetCaps()` only redistributes proportions. The multiplication by `budgetCapUsd` happens in `costTracker.ts` at runtime. No changes needed to budget redistribution logic.

6. **Kill action exists, no UI**: `killEvolutionRunAction` (line 549-587) is production-ready with audit logging. Just add import + handler + button.

7. **StartRunCard budget works correctly**: The "Start Pipeline" card passes budget via `queueEvolutionRunAction({ budgetCapUsd: cap })`. The bug is experiment-path only.

8. **Validation already shows estimate**: Line 423 shows `{expandedRunCount} runs | Est. ${estimatedCost}`. Need refresh button to manually re-trigger `runValidation()`.

9. **Run count in preview**: `expandedRunCount` = L8 rows (8), NOT total DB runs (8 × prompts). Consider showing total runs too.

10. **Killable statuses**: `pending`, `claimed`, `running`, `continuation_pending` — all non-terminal, non-paused statuses.

## Open Questions
None — all questions resolved. Ready for planning.
