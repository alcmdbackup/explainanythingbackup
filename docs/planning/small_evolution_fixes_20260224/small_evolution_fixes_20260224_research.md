# Small Evolution Fixes Research

## Problem Statement
Small fixes and improvements to the evolution pipeline dashboard. Focuses on evolution dashboard UX issues including experiment budget input handling, budget calculation refresh, and the ability to kill running pipeline runs from the admin UI.

## Requirements (from GH Issue #558)
- [ ] Ratings optimization > new experiment > budget should allow decimals. Should clearly label that it's per article. Should have a button that refreshes calculation when clicked.
- [ ] Rates optimization > new experiment > budget price not passed through correctly. Observed all runs start with budget of 5, rather than input number.
- [ ] Way to automatically kill a pipeline run from "start pipeline" tab - stop it and mark as failed

## High Level Summary

### Fix 1: Experiment budget UX (ExperimentForm)
The ExperimentForm budget input (`ExperimentForm.tsx:356-362`) uses `type="number"` with `min={1}` — **no `step` attribute**, so browsers default to step=1 (integer-only). Label says "Budget ($)" without specifying it's the total experiment budget. No manual refresh button for cost estimation — validation only runs on debounce when factors/prompts change, NOT when budget changes.

### Fix 2: Budget not passed through to runs (ROOT CAUSE FOUND)
**Bug confirmed.** In `experimentActions.ts:213-220`, when building per-run overrides for `resolveConfig()`, `budgetCapUsd` is **never included** in the overrides object. The overrides only contain `generationModel`, `judgeModel`, `maxIterations`, and `enabledAgents`. Since `resolveConfig()` uses `deepMerge(DEFAULT_EVOLUTION_CONFIG, overrides)`, and `DEFAULT_EVOLUTION_CONFIG.budgetCapUsd = 5.00` (config.ts:9), every run gets the default $5 budget regardless of what the user entered.

Same bug exists in the experiment driver cron (`experiment-driver/route.ts:363-370`) for subsequent rounds.

The experiment's `total_budget_usd` is stored correctly in `evolution_experiments` (line 168), but this value is never divided/allocated to individual runs.

### Fix 3: Kill button on start pipeline tab
`killEvolutionRunAction` already exists in `evolutionActions.ts:549-587`. It's a fully functional server action that:
- Sets run status to `'failed'` with error_message `'Manually killed by admin'`
- Guards with `.in('status', ['pending', 'claimed', 'running', 'continuation_pending'])`
- Has integration tests

**However, NO UI button exists anywhere** to call it. The runs table on the evolution page (`page.tsx:725-752`) only shows "Variants" button and "Trigger" button (for pending runs). Need to add a "Kill" button for running/claimed/pending/continuation_pending runs.

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

### Fix 1 & 2: Budget
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — experiment creation form, budget input (line 94: `useState(50)`, line 356-362: input field)
- `evolution/src/services/experimentActions.ts` — `startExperimentAction` (line 128-275), bug at line 213-220 where budgetCapUsd omitted from overrides
- `evolution/src/lib/config.ts` — `DEFAULT_EVOLUTION_CONFIG.budgetCapUsd = 5.00` (line 9), `resolveConfig()` (line 73-89), `deepMerge()` (line 45-69)
- `src/app/api/cron/experiment-driver/route.ts` — `handlePendingNextRound` (line 287-503), same budget bug at line 363-370

### Fix 3: Kill
- `src/app/admin/quality/evolution/page.tsx` — evolution admin page, `StartRunCard` (line 146-338), runs table actions (line 725-752), no kill button
- `evolution/src/services/evolutionActions.ts` — `killEvolutionRunAction` (line 549-587), fully functional

## Key Findings

1. **Budget decimal input**: `ExperimentForm.tsx:356-362` — `<input type="number" min={1}>` has no `step` attribute. Adding `step="0.01"` or `step="any"` will allow decimals.

2. **Budget label ambiguity**: Label at line 353-354 says "Budget ($)" — needs clarification that this is the total experiment budget (not per-run or per-article). The user wants it labeled "per article" which may mean per-run.

3. **Budget passthrough bug — root cause**: `experimentActions.ts:213-220` — the `overrides` object passed to `resolveConfig()` doesn't include `budgetCapUsd`. Fix: calculate per-run budget from experiment's `total_budget_usd` divided by number of runs, and include it in overrides.

4. **Same bug in experiment driver**: `experiment-driver/route.ts:363-370` — subsequent round run creation also omits `budgetCapUsd` from overrides. Fix: calculate remaining budget per run.

5. **Kill action exists, no UI**: `killEvolutionRunAction` (evolutionActions.ts:549-587) is production-ready. Just need a "Kill" button in the runs table for active runs (running/claimed/pending/continuation_pending statuses).

6. **StartRunCard budget works correctly**: The separate "Start Pipeline" card (`page.tsx:146-338`) does pass budget via `queueEvolutionRunAction({ budgetCapUsd: cap })` and it's handled correctly in `evolutionActions.ts:175` with proper fallback. This is NOT the bug — the bug is in the experiment path only.

7. **Validation calculation refresh**: The `ExperimentForm` validation (`line 148-173`) triggers on factor/prompt changes via debounce. Budget changes don't trigger re-validation. Need a manual refresh button.

## Open Questions

1. **Budget "per article" label**: User says "should clearly label that it's per article" — but the experiment budget is actually a total experiment budget (`total_budget_usd`), not per-article. Clarify: should the label say "Total Experiment Budget ($)" or should we restructure to accept per-run budget and calculate total?

2. **Per-run budget allocation**: When splitting `total_budget_usd` across runs, should it be simple division (total / num_runs) or should it match the strategy's budget? For subsequent rounds, should remaining budget be divided among new runs?
