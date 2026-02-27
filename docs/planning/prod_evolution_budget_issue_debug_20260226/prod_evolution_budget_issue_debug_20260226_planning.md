# Prod Evolution Budget Issue Debug Plan

## Background
Production evolution experiment runs are hitting budget exceeded errors because the total experiment budget ($0.50) is evenly split across all runs ($0.0625/run), which is too small for even a single iteration. Need to add a run preview to the experiment UI showing per-run budget, factor combinations, and strategy details before starting.

## Requirements (from GH Issue #585)
1. Add a run preview table/panel to ExperimentForm showing each L8 row with its factor values, strategy label, estimated cost, and per-run budget
2. Show the per-run budget calculation (totalBudget / numRuns) prominently with a warning when it's below a minimum threshold
3. Show redistributed per-agent budget caps for each run config (accounting for enabledAgents)
4. Surface which agents are active vs disabled per run
5. Leverage existing validateExperimentConfig() which already returns expandedConfigs

## Problem

The ExperimentForm validates configs via `validateExperimentConfigAction` which internally computes 8 full `ExpandedRunConfig` objects (factor values, pipeline args, resolved configs) and a per-row cost estimate — but discards all of this, returning only `expandedRunCount` and `estimatedCost` as scalars. The user sees "8 runs | Est. $4.50" with no visibility into per-run budget allocation (`totalBudget / 8`), individual factor combinations, which agents are active per row, or whether the per-run budget is sufficient. There is also no budget sufficiency check — the system happily creates runs with $0.0625 budgets that immediately fail.

## Options Considered

### Option A: Pass expandedConfigs through validation action (Selected)
- Modify `ValidateExperimentOutput` to include per-row preview data
- Refactor `estimateBatchCost` to return per-row costs
- Compute budget redistribution per row server-side
- Render preview table in ExperimentForm

**Pros:** All computation server-side, single validation call, leverages existing data flow
**Cons:** Larger response payload (~2-3KB for 8 rows)

### Option B: Separate preview action
- Create new `getExperimentPreviewAction` that returns row-level data
- Keep validation action unchanged

**Pros:** Separation of concerns
**Cons:** Duplicates validation work, two server round-trips, must keep in sync

### Option C: Client-side computation
- Ship factor registry, L8 design, and budget redistribution logic to client
- Compute preview entirely client-side

**Pros:** No server calls for preview
**Cons:** Duplicates server logic, cost estimation requires DB (server-only), large client bundle

**Decision:** Option A — minimal new code, single data flow, all existing logic reused.

## Phased Execution Plan

### Phase 1: Server-side — Return per-row preview data

**Goal:** Make `validateExperimentConfigAction` return row-level preview data alongside existing validation results.

#### 1.1 Refactor `estimateBatchCost` to return per-row costs
**File:** `evolution/src/experiments/evolution/experimentValidation.ts`

- Add new type `RowCostEstimate`:
  ```typescript
  export interface RowCostEstimate {
    row: number;
    costPerPrompt: number;      // cost for one prompt on this row
    totalCost: number;           // costPerPrompt * promptCount
    confidence: 'high' | 'medium' | 'low';
  }
  ```
- Add new function `estimateBatchCostDetailed` that returns `{ total: number; perRow: RowCostEstimate[] }` — same loop as `estimateBatchCost` but collects per-row results
- Keep existing `estimateBatchCost` as a thin wrapper calling `estimateBatchCostDetailed().total` for backward compatibility
- Update `ExperimentValidationResult` to include `perRowCosts: RowCostEstimate[]`
- Update `validateExperimentConfig` to call `estimateBatchCostDetailed` and populate `perRowCosts`

#### 1.2 Add budget field to validation input and compute per-row preview
**File:** `evolution/src/services/experimentActions.ts`

- Add `budget?: number` to `ValidateExperimentInput`
- Add new type for row preview data:
  ```typescript
  export interface RunPreviewRow {
    row: number;
    factors: Record<string, string | number>;
    enabledAgents: string[];
    estimatedCost: number;
    confidence: 'high' | 'medium' | 'low';
  }
  ```
- Expand `ValidateExperimentOutput` with:
  ```typescript
  runPreview?: RunPreviewRow[];
  perRunBudget?: number;           // budget / expandedRunCount
  budgetWarning?: string;          // warning if per-run budget too low
  ```
- In `_validateExperimentConfigAction`, when valid:
  - Pass through `result.expandedConfigs` mapped to `RunPreviewRow[]` (extract `factors` + `pipelineArgs.enabledAgents` from each row's L8 config, plus `perRowCosts`)
  - Compute `perRunBudget = budget / expandedRunCount` when budget provided
  - Add `budgetWarning` if `perRunBudget < estimatedCost / expandedRunCount * 0.5` (budget covers less than half estimated need) or if `perRunBudget < 1.00` (minimum viable budget)

#### 1.3 Update existing tests
**Files:**
- `evolution/src/experiments/evolution/experimentValidation.test.ts` — add tests for `estimateBatchCostDetailed`, verify `perRowCosts` populated
- `evolution/src/services/experimentActions.test.ts` — verify `runPreview` and `perRunBudget` in output, test budget warning thresholds

**Milestone check:** Run `npx jest experimentValidation.test && npx jest experimentActions.test` — all pass. Run `npx tsc --noEmit` — no type errors.

---

### Phase 2: Client-side — Run preview table in ExperimentForm

**Goal:** Render the per-row preview data as a table in ExperimentForm, with budget warning.

#### 2.1 Pass budget to validation call
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

- Update the debounced `runValidation` call to include `budget` in the action input
- Add `budget` to the useCallback dependency array so validation re-runs when budget changes

#### 2.2 Add budget summary banner
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

- Below the existing "Validation Preview" section, add a budget summary when `validation.perRunBudget` is present:
  - Per-run budget: `$X.XX` (totalBudget / numRuns)
  - Estimated total cost: `$X.XX`
  - Warning banner (red bg) when `validation.budgetWarning` is non-null
- Use `--status-error` for warning, `--status-success` when budget looks sufficient

#### 2.3 Add run preview table
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

- New collapsible section "Run Preview" (collapsed by default, auto-expands when budgetWarning present)
- Table with columns: Row #, Factor values (one sub-column per enabled factor), Active Agents, Est. Cost, Confidence
- Each factor column shows the resolved value for that row
- Active agents shown as compact pills/dots (green = active, grey = disabled) — reuse pattern from `StrategyConfigDisplay.tsx`
- Estimated cost per row shown with confidence indicator (color-coded: high=green, medium=amber, low=red)
- Row with highest cost highlighted subtly

#### 2.4 Add per-agent budget caps expandable detail
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

- Clicking a row expands to show redistributed per-agent budget caps
- Compute client-side: `perRunBudget * budgetCapPercentage` for each agent (the percentage data comes from DEFAULT_EVOLUTION_CONFIG.budgetCaps which is constant)
- Show as horizontal bars similar to StartRunCard pattern, with dollar amounts
- Highlight agents whose cap is below $0.01 (too small to do anything)

**Milestone check:** Run `npx tsc --noEmit` — no type errors. Manual verification: open ExperimentForm, enable 2+ factors, select prompts, verify preview table appears.

---

### Phase 3: Tests

#### 3.1 ExperimentForm component tests
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.test.tsx` (new)

Tests:
- Renders run preview table when validation returns `runPreview`
- Shows budget warning banner when `budgetWarning` present
- Preview table has correct number of rows (matching `runPreview.length`)
- Factor columns match enabled factors
- Collapsible behavior: collapsed by default, expanded when warning
- Budget re-triggers validation (budget in dependency array)
- Agent pills render correct active/disabled states
- Expandable row shows per-agent budget bars

Mock pattern: `jest.mock` for `validateExperimentConfigAction`, `getFactorMetadataAction`, `getPromptsAction`, `startExperimentAction` — follow pattern from `CostAccuracyPanel.test.tsx`.

#### 3.2 Update existing tests for new fields
- `experimentValidation.test.ts` — assert `perRowCosts` array length matches expanded configs
- `experimentActions.test.ts` — assert `runPreview`, `perRunBudget`, `budgetWarning` in output

**Milestone check:** `npx jest ExperimentForm.test && npx jest experimentValidation.test && npx jest experimentActions.test` — all pass.

---

### Phase 4: Lint, build, final verification

- `npx eslint --fix` on all changed files
- `npx tsc --noEmit` — clean
- `npm run build` — clean
- Manual smoke test: create experiment with low budget ($0.50) and verify warning appears with clear per-run breakdown

## Testing

### Unit Tests (new/modified)
| File | Status | Tests |
|------|--------|-------|
| `ExperimentForm.test.tsx` | NEW | ~10 tests: preview table rendering, budget warning, collapsible, agent pills, expandable detail |
| `experimentValidation.test.ts` | MODIFY | +2 tests: `estimateBatchCostDetailed` returns per-row array, `perRowCosts` populated in result |
| `experimentActions.test.ts` | MODIFY | +3 tests: `runPreview` in output, `perRunBudget` calculation, `budgetWarning` threshold |

### Manual Verification
1. Open ExperimentForm, enable 2 factors, select 1 prompt, set budget $50 → preview shows 8 rows, no warning
2. Set budget to $0.50 → warning appears, per-run budget shows $0.0625, preview auto-expands
3. Enable 5 factors → still 8 rows (L8), factor columns update
4. Expand a row → per-agent budget bars visible, tiny caps highlighted
5. Change budget → validation re-runs, preview updates

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/strategy_experiments.md` - Add run preview UI section
- `evolution/docs/evolution/cost_optimization.md` - Note budget warning feature and per-run budget visibility
- `evolution/docs/evolution/visualization.md` - Document new ExperimentForm preview component
- `evolution/docs/evolution/reference.md` - Update key files section with new types

## Key Files Changed

| File | Change |
|------|--------|
| `evolution/src/experiments/evolution/experimentValidation.ts` | Add `RowCostEstimate`, `estimateBatchCostDetailed`, `perRowCosts` field |
| `evolution/src/services/experimentActions.ts` | Add `RunPreviewRow`, expand `ValidateExperimentOutput`, budget warning logic |
| `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` | Budget in validation, preview table, warning banner, expandable agent detail |
| `src/app/admin/quality/optimization/_components/ExperimentForm.test.tsx` | NEW — component tests |
| `evolution/src/experiments/evolution/experimentValidation.test.ts` | Add per-row cost tests |
| `evolution/src/services/experimentActions.test.ts` | Add preview/warning tests |
