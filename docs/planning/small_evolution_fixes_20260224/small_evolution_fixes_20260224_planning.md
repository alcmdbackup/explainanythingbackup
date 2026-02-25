# Small Evolution Fixes Plan

## Background
Small fixes and improvements to the evolution pipeline dashboard. Focuses on evolution dashboard UX issues including experiment budget input handling, budget calculation refresh, and the ability to kill running pipeline runs from the admin UI.

## Requirements (from GH Issue #558)
- [ ] Ratings optimization > new experiment > budget should allow decimals. Should clearly label that it's per article. Should have a button that refreshes calculation when clicked.
- [ ] Rates optimization > new experiment > budget price not passed through correctly. Observed all runs start with budget of 5, rather than input number.
- [ ] Way to automatically kill a pipeline run from "start pipeline" tab - stop it and mark as failed

## Problem
The ExperimentForm budget input only accepts integers (no `step` attribute) and has an ambiguous label. More critically, the experiment budget is never propagated to individual evolution runs — `experimentActions.ts` and `experiment-driver/route.ts` both omit `budgetCapUsd` from the config overrides passed to `resolveConfig()`, causing every run to default to $5.00 regardless of user input. Additionally, the `killEvolutionRunAction` server action exists and is tested but has no UI button anywhere in the admin dashboard.

## Options Considered

### Budget passthrough fix
- **Option A: Add budgetCapUsd to overrides (chosen)** — Simple division: `total_budget / num_runs`. Surgical 1-line fix in each of the two callsites. Budget proportions auto-scale via costTracker multiplication.
- **Option B: Pass total budget and let resolveConfig handle allocation** — Would require changing resolveConfig signature and semantics. Over-engineered for this fix.

### Kill button placement
- **Option A: Runs table only (chosen)** — Add Kill button in the renderActions column for active runs. Minimal change, follows existing Trigger button pattern.
- **Option B: Both runs table and run detail page** — More complete but run detail page is less critical (users manage runs from the table). Can add to detail page in a follow-up.

### Refresh button
- **Option A: Manual refresh button (chosen)** — Add a "Refresh" button next to the validation preview that calls existing `runValidation()`. Simple, explicit UX.
- **Option B: Auto-refresh on budget change** — Would add budget to the debounce dependency. Risk of excessive API calls as user types.

## Phased Execution Plan

### Phase 1: Fix experiment budget passthrough (backend bug)

**Files modified:**
- `evolution/src/services/experimentActions.ts` (lines 209-220)
- `src/app/api/cron/experiment-driver/route.ts` (lines 357-370, 443-462)

**Changes:**

1. **`experimentActions.ts` — `_startExperimentAction`**
   Before the run creation loop (line 209), compute per-run budget:
   ```typescript
   const totalRunCount = design.runs.length * resolvedPrompts.length;
   const perRunBudget = input.budget / totalRunCount;
   ```
   Add `budgetCapUsd: perRunBudget` to the overrides object at line 213:
   ```typescript
   const overrides: Partial<EvolutionRunConfig> = {
     ...input.configDefaults,
     budgetCapUsd: perRunBudget,  // ← NEW
     generationModel: pipelineArgs.model,
     judgeModel: pipelineArgs.judgeModel,
     maxIterations: pipelineArgs.iterations,
     enabledAgents: pipelineArgs.enabledAgents,
   };
   ```

2. **`experiment-driver/route.ts` — `handlePendingNextRound`**
   In the `resolveRunConfig` closure (line 357), add budget:
   ```typescript
   // Before the resolveRunConfig function (around line 356)
   const totalNextRoundRuns = ffDesign.runs.length * exp.prompts.length;
   const perRunBudgetNextRound = remainingBudget / totalNextRoundRuns;
   ```
   Add to overrides at line 363:
   ```typescript
   const overrides: Partial<EvolutionRunConfig> = {
     ...exp.config_defaults ?? {},
     budgetCapUsd: perRunBudgetNextRound,  // ← NEW
     generationModel: pipelineArgs.model,
     ...
   };
   ```

**Verify:** Lint, tsc, build pass. Run existing unit tests for experimentActions and experiment-driver.

### Phase 2: Fix experiment budget UX (frontend)

**Files modified:**
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

**Changes:**

1. **Allow decimals** (line 356-362): Add `step="0.01"` and change `min` from `1` to `0.01`:
   ```tsx
   <input
     type="number"
     step="0.01"
     min={0.01}
     value={budget}
     onChange={(e) => setBudget(Number(e.target.value))}
     className="..."
   />
   ```

2. **Clarify label** (line 353-354): Change from "Budget ($)" to "Total Budget ($)".

3. **Add refresh button** (after line 423, inside validation preview area):
   ```tsx
   <button
     onClick={() => runValidation()}
     disabled={validating || clientErrors.length > 0}
     className="text-xs text-[var(--accent-gold)] hover:underline ml-2"
   >
     {validating ? 'Refreshing...' : '↻ Refresh'}
   </button>
   ```
   This calls the existing `runValidation` callback directly, bypassing the debounce.

4. **Fix client validation** (line 137): Change `budget <= 0` to `budget < 0.01` to match server validation minimum.

**Verify:** Lint, tsc, build pass.

### Phase 3: Add kill button to pipeline runs table

**Files modified:**
- `src/app/admin/quality/evolution/page.tsx`

**Changes:**

1. **Add import** (line 8): Add `killEvolutionRunAction` to the import block from `@evolution/services/evolutionActions`.

2. **Add handler** (after `handleTrigger`, around line 656): Create `handleKill` following the same pattern:
   ```typescript
   const handleKill = async (runId: string): Promise<void> => {
     setActionLoading(true);
     const result = await killEvolutionRunAction(runId);
     if (result.success) {
       toast.success('Run killed');
       loadRuns();
     } else {
       toast.error(result.error?.message || 'Failed to kill run');
     }
     setActionLoading(false);
   };
   ```

3. **Add Kill button in renderActions** (after line 743, inside the actions `<div>`):
   ```tsx
   {['pending', 'claimed', 'running', 'continuation_pending'].includes(run.status) && (
     <button
       onClick={() => handleKill(run.id)}
       disabled={actionLoading}
       data-testid={`kill-run-${run.id}`}
       className="text-[var(--status-error)] hover:underline text-xs disabled:opacity-50"
     >
       Kill
     </button>
   )}
   ```
   Uses `text-[var(--status-error)]` (red) to visually distinguish from other actions.

**Verify:** Lint, tsc, build pass.

### Phase 4: Unit tests

**Files modified/created:**
- `evolution/src/services/experimentActions.test.ts` — add test for budget passthrough
- `src/app/api/cron/experiment-driver/route.test.ts` — add test for budget passthrough (if test file exists; otherwise create)

**Tests to add:**

1. **experimentActions.test.ts**: Test that `startExperimentAction` passes per-run budget to resolveConfig:
   - Mock resolveConfig, assert it receives `budgetCapUsd` = `input.budget / totalRuns`
   - Test with decimal budget (e.g., 12.50)

2. **Experiment driver test**: Test that next-round runs receive `budgetCapUsd` = `remainingBudget / runsInRound`

3. **Existing tests**: Run all existing test suites to confirm no regressions:
   - `npm run test -- evolution/src/services/experimentActions.test.ts`
   - `npm run test -- evolution/src/experiments/evolution/experimentValidation.test.ts`
   - `npm run test -- evolution/src/services/evolutionActions.test.ts`

**Verify:** All unit tests pass.

### Phase 5: Lint, build, full test suite

- Run `npm run lint` — fix any issues
- Run `npm run tsc` — fix any type errors
- Run `npm run build` — verify clean build
- Run full unit test suite: `npm run test`

## Testing

### Unit Tests
- Verify budget passthrough in experimentActions (per-run = total / numRuns)
- Verify budget passthrough in experiment-driver (per-run = remaining / numRuns)
- Verify existing killEvolutionRunAction tests still pass
- Run full test suite for regressions

### Manual Verification on Stage
- Create new experiment with budget $12.50 → verify runs get ~$1.56 each (12.50 / 8)
- Create new experiment with budget $0.50 → verify decimal accepted
- Verify "Refresh" button triggers cost re-estimation
- Verify "Total Budget ($)" label is clear
- Queue a pipeline run → verify "Kill" button appears for running/pending runs
- Click Kill → verify run transitions to failed with "Manually killed by admin"
- Verify Kill button disappears for completed/failed runs

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` — update kill mechanism section to note UI button now exists on pipeline runs page
- `evolution/docs/evolution/data_model.md` — no changes needed (budget config propagation unchanged)
- `evolution/docs/evolution/hall_of_fame.md` — no changes needed
- `evolution/docs/evolution/rating_and_comparison.md` — no changes needed
