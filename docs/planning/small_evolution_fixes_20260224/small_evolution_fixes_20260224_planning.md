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
   Before the run creation loop (line 209), compute per-run budget with zero-guard:
   ```typescript
   const totalRunCount = design.runs.length * resolvedPrompts.length;
   if (totalRunCount === 0) {
     throw new Error('Experiment produced 0 runs — cannot allocate budget');
   }
   const perRunBudget = input.budget / totalRunCount;
   ```
   Add `budgetCapUsd: perRunBudget` to the overrides object at line 213.
   **Important:** `budgetCapUsd` must appear AFTER the `...input.configDefaults` spread so it takes precedence:
   ```typescript
   const overrides: Partial<EvolutionRunConfig> = {
     ...input.configDefaults,
     budgetCapUsd: perRunBudget,  // ← NEW (after spread to ensure override)
     generationModel: pipelineArgs.model,
     judgeModel: pipelineArgs.judgeModel,
     maxIterations: pipelineArgs.iterations,
     enabledAgents: pipelineArgs.enabledAgents,
   };
   ```

2. **`experiment-driver/route.ts` — `handlePendingNextRound`**
   After computing `ffDesign` (line 374) and before `resolveRunConfig`, compute per-run budget:
   ```typescript
   const totalNextRoundRuns = ffDesign.runs.length * exp.prompts.length;
   if (totalNextRoundRuns === 0) {
     result.detail = 'Next round produced 0 runs';
     return result;
   }
   const perRunBudgetNextRound = remainingBudget / totalNextRoundRuns;
   ```
   Add `budgetCapUsd` to overrides inside the `resolveRunConfig` closure (line 363), AFTER the config_defaults spread:
   ```typescript
   const overrides: Partial<EvolutionRunConfig> = {
     ...exp.config_defaults ?? {},
     budgetCapUsd: perRunBudgetNextRound,  // ← NEW (after spread to ensure override)
     generationModel: pipelineArgs.model,
     judgeModel: pipelineArgs.judgeModel,
     maxIterations: pipelineArgs.iterations,
     enabledAgents: pipelineArgs.enabledAgents,
   };
   ```
   **Note:** The `resolveRunConfig` closure is called twice: once for cost estimation (line 376) and once for run creation (line 444). The per-run budget is identical in both — this is correct because `estimateBatchCost` ignores `budgetCapUsd` (it estimates cost from model/iteration config, not budget caps).

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

3. **Add refresh button** in the Validation Preview header (line 396, next to "Validation Preview" text) so it's always visible regardless of validation state:
   ```tsx
   <button
     onClick={() => runValidation()}
     disabled={validating || clientErrors.length > 0}
     className="text-xs text-[var(--accent-gold)] hover:underline ml-2"
   >
     {validating ? 'Refreshing...' : '↻ Refresh'}
   </button>
   ```
   This calls the existing `runValidation` callback directly, bypassing the debounce. Note: the refresh re-runs cost estimation based on factor/prompt config. Budget input changes don't affect the cost estimate (which is model-driven), but the refresh lets users re-estimate if baseline data has updated.

4. **Fix client validation** (line 137): Change `budget <= 0` to `budget < 0.01` to match server validation minimum.

**Verify:** Lint, tsc, build pass.

### Phase 3: Add kill button to pipeline runs table

**Files modified:**
- `src/app/admin/quality/evolution/page.tsx`

**Changes:**

1. **Add import** (line 8): Add `killEvolutionRunAction` to the import block from `@evolution/services/evolutionActions`.

2. **Add handler** (after `handleTrigger`, around line 656): Create `handleKill` with try/catch matching `handleTrigger` pattern:
   ```typescript
   const handleKill = async (runId: string): Promise<void> => {
     setActionLoading(true);
     try {
       const result = await killEvolutionRunAction(runId);
       if (result.success) {
         toast.success('Run killed');
         loadRuns();
       } else {
         toast.error(result.error?.message || 'Failed to kill run');
       }
     } catch (err) {
       toast.error(err instanceof Error ? err.message : 'Failed to kill run');
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

**Files modified:**
- `evolution/src/services/experimentActions.test.ts` — add budget passthrough test
- `src/app/api/cron/experiment-driver/route.test.ts` — update resolveConfig mock, add budget test

**Mock strategy considerations:**
- `experimentActions.test.ts` uses the **real** `resolveConfig` (no mock). Do NOT add a mock — instead, assert the output `budget_cap_usd` in the Supabase insert call. Since the real `deepMerge` runs, if `budgetCapUsd` is in overrides it will override the $5.00 default, and we can verify by checking the inserted row value.
- `route.test.ts` uses a **static mock** for `resolveConfig` (line 82-89, returns hardcoded `budgetCapUsd: 5.0`). Change this mock to a spy that passes arguments through to the real implementation, OR change it to an `jest.fn()` that captures args so the test can assert `budgetCapUsd` was passed. Preferred approach: use `jest.fn((overrides) => ({ ...staticDefaults, ...overrides }))` so the mock reflects the override.

**Tests to add:**

1. **experimentActions.test.ts** — `startExperimentAction passes per-run budget`:
   - Input: `budget: 12.50`, L8 design (8 rows), 1 prompt → totalRuns = 8
   - Assert: Supabase `.insert()` calls contain `budget_cap_usd: 1.5625` (12.50 / 8)
   - Verify decimal precision is preserved

2. **experimentActions.test.ts** — `startExperimentAction rejects zero runs`:
   - Mock `generateL8Design` to return 0 runs (edge case)
   - Assert: action returns error about 0 runs

3. **route.test.ts** — `handlePendingNextRound passes per-run budget`:
   - Update `resolveConfig` mock to reflect overrides: `jest.fn((overrides) => ({ ...defaults, ...overrides }))`
   - Experiment: `total_budget_usd: 50`, `spent_usd: 20`, remaining = 30
   - Full-factorial mock: 3 runs × 1 prompt = 3 total runs
   - Assert: inserted runs have `budget_cap_usd: 10.0` (30 / 3)

4. **route.test.ts** — `handlePendingNextRound handles zero runs gracefully`:
   - Mock `generateFullFactorialDesign` to return 0 runs
   - Assert: returns without creating runs, no division-by-zero

5. **Existing tests regression check**: Run all suites to confirm no breakage:
   - `npm run test -- evolution/src/services/experimentActions.test.ts`
   - `npm run test -- src/app/api/cron/experiment-driver/route.test.ts`
   - `npm run test -- evolution/src/experiments/evolution/experimentValidation.test.ts`
   - `npm run test -- evolution/src/services/evolutionActions.test.ts`
   - Note: `costTracker.test.ts` and `batchRunSchema.test.ts` hardcode `budgetCapUsd: 5.0` in fixtures but test unrelated code paths — these will NOT break.

**Verify:** All unit tests pass.

### Phase 5: Lint, build, full test suite

- Run `npm run lint` — fix any issues
- Run `npm run tsc` — fix any type errors
- Run `npm run build` — verify clean build
- Run full unit test suite: `npm run test`

## Testing

### Unit Tests
- Verify budget passthrough in experimentActions (per-run = total / numRuns) with decimal input
- Verify zero-run edge case throws error in experimentActions
- Verify budget passthrough in experiment-driver (per-run = remaining / numRuns)
- Verify zero-run edge case handled gracefully in experiment-driver
- Verify existing killEvolutionRunAction tests still pass
- Run full test suite for regressions (including costTracker, batchRunSchema — confirm no breakage)

### Manual Verification on Stage
- Create new experiment with budget $12.50 → verify runs get ~$1.56 each (12.50 / 8)
- Create new experiment with budget $0.50 → verify decimal accepted
- Create new experiment with budget $0.00 → verify rejected by client validation
- Verify "Refresh" button triggers cost re-estimation
- Verify "Total Budget ($)" label is clear
- Queue a pipeline run → verify "Kill" button appears for running/pending runs
- Click Kill → verify run transitions to failed with "Manually killed by admin"
- Verify Kill button disappears for completed/failed runs
- Verify Kill button disabled while action is loading

## Rollback Plan
All changes are additive and low-risk. If issues arise in production:
1. **Budget passthrough regression**: Revert the two lines adding `budgetCapUsd` to overrides. Runs will resume using the $5.00 default. No data migration needed — `budget_cap_usd` column already exists.
2. **Kill button issues**: Remove the kill button JSX and handler from `page.tsx`. The server action remains safe (it's already deployed and tested).
3. **Full rollback**: Revert the entire branch. No database migrations are included in this change.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` — update kill mechanism section to note UI button now exists on pipeline runs page
- `evolution/docs/evolution/data_model.md` — no changes needed (budget config propagation unchanged)
- `evolution/docs/evolution/hall_of_fame.md` — no changes needed
- `evolution/docs/evolution/rating_and_comparison.md` — no changes needed
