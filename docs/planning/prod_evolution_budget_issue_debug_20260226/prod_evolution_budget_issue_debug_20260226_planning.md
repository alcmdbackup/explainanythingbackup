# Prod Evolution Budget Issue Debug Plan

## Background
Production evolution experiment runs are hitting budget exceeded errors because the total experiment budget ($0.50) is evenly split across all runs ($0.0625/run), which is too small for even a single iteration. Need to add a run preview to the experiment UI showing per-run budget, factor combinations, and strategy details before starting.

## Requirements (from GH Issue #585)
1. Add a run preview table/panel to ExperimentForm showing each L8 row with its factor values, strategy label, estimated cost, and per-run budget
2. Show the per-run budget calculation (totalBudget / numRuns) prominently with a warning when it's below a minimum threshold
3. Show redistributed per-agent budget caps for each run config (accounting for enabledAgents)
4. Surface which agents are active vs disabled per run
5. Leverage existing validateExperimentConfig() which already returns expandedConfigs
6. **Block** experiment start when per-run budget is insufficient (not just warn)

## Problem

The ExperimentForm validates configs via `validateExperimentConfigAction` which internally computes 8 full `ExpandedRunConfig` objects (factor values, pipeline args, resolved configs) and a per-row cost estimate — but discards all of this, returning only `expandedRunCount` and `estimatedCost` as scalars. The user sees "8 runs | Est. $4.50" with no visibility into per-run budget allocation (`totalBudget / 8`), individual factor combinations, which agents are active per row, or whether the per-run budget is sufficient. There is also no budget sufficiency check — the system happily creates runs with $0.0625 budgets that immediately fail.

## Options Considered

### Option A: Pass expandedConfigs through validation action (Selected)
- Modify `ValidateExperimentOutput` to include per-row preview data
- Refactor `estimateBatchCost` to return per-row costs
- Compute budget redistribution per row server-side
- Render preview table in ExperimentForm

**Pros:** All computation server-side, single validation call, leverages existing data flow
**Cons:** Larger response payload (~8-12KB for 8 rows with full factor/agent/cap data)

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

## Important Type Distinctions

Two distinct config types exist and must not be confused:

1. **`ExperimentRunConfig`** (from `factorial.ts`): Output of L8 design generation. Has `{row, factors: Record<string, string|number>, pipelineArgs: {model, judgeModel, iterations, enabledAgents}}`. Only lives inside `validateExperimentConfig()` during the L8 generation loop.

2. **`ExpandedRunConfig`** (from `experimentValidation.ts`): Output of config resolution. Has `{row: number, config: EvolutionRunConfig}`. The resolved `EvolutionRunConfig` has `enabledAgents`, `budgetCaps`, etc. but does NOT have `factors` or `pipelineArgs`.

To surface factor values in `RunPreviewRow`, `validateExperimentConfig()` must capture per-row factor values from the L8 design loop (where `ExperimentRunConfig` is available) and attach them to the result alongside `ExpandedRunConfig`.

## Phased Execution Plan

### Phase 1: Server-side — Return per-row preview data

**Goal:** Make `validateExperimentConfigAction` return row-level preview data alongside existing validation results.

#### 1.1 Refactor `estimateBatchCost` to return per-row costs
**File:** `evolution/src/experiments/evolution/experimentValidation.ts`

- Add new type `RowCostEstimate`:
  ```typescript
  export interface RowCostEstimate {
    row: number;
    estimatedCostPerPrompt: number; // estimateRunCostWithAgentModels().totalUsd * safetyMultiplier
    totalCost: number;               // estimatedCostPerPrompt * promptCount
    confidence: 'high' | 'medium' | 'low'; // passthrough from RunCostEstimate.confidence
  }
  ```
  Note: `estimatedCostPerPrompt` maps directly to `estimateRunCostWithAgentModels().totalUsd * safetyMultiplier` (where safetyMultiplier = 1.5 for low confidence, 1.0 otherwise).

- Add new function `estimateBatchCostDetailed` that returns `{ total: number; perRow: RowCostEstimate[] }`:
  - **Parameter type: `ExpandedRunConfig[]`** (NOT `ExpandedRunConfigWithFactors[]`) — this ensures backward compatibility since `experiment-driver/route.ts` passes `{row, config}` objects without a `factors` field
  - Same loop as current `estimateBatchCost`
  - Uses same dynamic import pattern: `await import('@evolution/lib/core/costEstimator')`
  - Collects per-row results in array instead of only accumulating total
  - **Safety multiplier applied here ONLY** — safetyMultiplier (1.5x for low confidence) is baked into `estimatedCostPerPrompt`. No other code should re-apply it.

- **Backward compatibility:** Rewrite existing `estimateBatchCost` as thin wrapper:
  ```typescript
  export async function estimateBatchCost(...): Promise<number> {
    const { total } = await estimateBatchCostDetailed(expandedConfigs, prompts);
    return total;
  }
  ```
  This preserves the exact same return type and behavior for all existing callers including `experiment-driver/route.ts` (which imports `estimateBatchCost` for round-2+ cost estimation).

- Update `ExperimentValidationResult` to include `perRowCosts: RowCostEstimate[]`
- Update `validateExperimentConfig` to call `estimateBatchCostDetailed` and populate both `estimatedTotalCost` (from `.total`) and `perRowCosts` (from `.perRow`)

#### 1.2 Capture factor values in validation result
**File:** `evolution/src/experiments/evolution/experimentValidation.ts`

The existing loop in `validateExperimentConfig()` iterates over `design.runs` (which are `ExperimentRunConfig` with `factors` and `pipelineArgs`), but only stores the resolved `EvolutionRunConfig` in `expandedConfigs`. Modify the loop to ALSO capture per-row factor values:

- Add new type:
  ```typescript
  export interface ExpandedRunConfigWithFactors extends ExpandedRunConfig {
    factors: Record<string, string | number>;  // from ExperimentRunConfig.factors
  }
  ```
- Change `expandedConfigs` array type from `ExpandedRunConfig[]` to `ExpandedRunConfigWithFactors[]`
- In the loop body, capture `run.factors` alongside the resolved config:
  ```typescript
  expandedConfigs.push({ row: run.row, config: resolved, factors: run.factors });
  ```
- Update `ExperimentValidationResult.expandedConfigs` type to `ExpandedRunConfigWithFactors[]`
- This is backward-compatible since `ExpandedRunConfigWithFactors extends ExpandedRunConfig`

#### 1.3 Add budget field and compute preview in server action
**File:** `evolution/src/services/experimentActions.ts`

- Add `budget?: number` to `ValidateExperimentInput`
- Add new type for row preview data (all computed SERVER-SIDE):
  ```typescript
  export interface RunPreviewRow {
    row: number;
    factors: Record<string, string | number>;   // from ExpandedRunConfigWithFactors.factors
    enabledAgents: string[];                     // from config.enabledAgents (EvolutionRunConfig)
    effectiveBudgetCaps: Record<string, number>; // fractional proportions from computeEffectiveBudgetCaps()
    estimatedCostPerPrompt: number;              // from perRowCosts[].estimatedCostPerPrompt (per-prompt cost)
    confidence: 'high' | 'medium' | 'low';
  }
  ```

- **Budget unit convention — ALL values are per-prompt-run (a single prompt on a single L8 row):**
  - `perRunBudget`: dollars allocated per prompt-run pair = `totalBudget / totalRunCount`
  - `RunPreviewRow.estimatedCostPerPrompt`: estimated cost for one prompt on this row
  - This matches `startExperimentAction` line 216: `perRunBudget = input.budget / totalRunCount` where `totalRunCount = design.runs.length * resolvedPrompts.length`
  - The UI will display and compare these like-for-like

- Expand `ValidateExperimentOutput` with:
  ```typescript
  runPreview?: RunPreviewRow[];
  perRunBudget?: number;           // budget per prompt-run pair (matches startExperimentAction calculation)
  budgetSufficient?: boolean;      // false when any row's estimated cost per prompt > perRunBudget
  budgetWarning?: string;          // human-readable warning message
  ```
- In `_validateExperimentConfigAction`, when result is valid:
  - Import `computeEffectiveBudgetCaps` from `budgetRedistribution.ts`
  - Map `result.expandedConfigs` + `result.perRowCosts` to `RunPreviewRow[]`:
    - `factors` from `expandedConfig.factors` (the new field from 1.2)
    - `enabledAgents` from `expandedConfig.config.enabledAgents ?? []`
    - `effectiveBudgetCaps` from `computeEffectiveBudgetCaps(config.budgetCaps, config.enabledAgents, false)` — pure function, no DB calls. Returns fractional proportions (sum ~1.0), NOT dollar amounts. Note: enabledAgents from L8 design only lists optional agents; computeEffectiveBudgetCaps always includes REQUIRED agents regardless.
    - `estimatedCostPerPrompt` from matched `perRowCosts[].estimatedCostPerPrompt` (safety multiplier already applied in estimateBatchCostDetailed — do NOT re-apply)
    - `confidence` from matched `perRowCosts[].confidence`
  - When `budget` is provided:
    - `const promptCount = resolvedPrompts.length`
    - `const totalRunCount = result.expandedConfigs.length * promptCount`
    - `perRunBudget = budget / totalRunCount` (matches startExperimentAction exactly)
    - `const maxRowCostPerPrompt = Math.max(...result.perRowCosts.map(r => r.estimatedCostPerPrompt))`
    - `budgetSufficient = perRunBudget >= maxRowCostPerPrompt` (compare per-prompt budget vs per-prompt cost — same units)
    - `budgetWarning` if `!budgetSufficient`: `"Per-run budget $${perRunBudget.toFixed(4)} is below estimated cost $${maxRowCostPerPrompt.toFixed(4)} for the most expensive configuration. Runs will likely hit budget_exceeded errors."`

- **Also update `ValidateExperimentOutput`'s local mirror** — the `ValidationPreview` interface in `ExperimentForm.tsx` (lines 25-31) must be kept in sync. The plan will update this in Phase 2.1.

#### 1.4 Update existing tests + add backward compat tests
**Files:**
- `evolution/src/experiments/evolution/experimentValidation.test.ts`:
  - Add test: `estimateBatchCostDetailed` returns per-row array with correct length
  - Add test: `estimateBatchCost` (wrapper) still returns same scalar value as before
  - Add test: `perRowCosts` populated in `ExperimentValidationResult`
  - Add test: `expandedConfigs` entries now include `factors` field
- `evolution/src/services/experimentActions.test.ts`:
  - Add test: `runPreview` array in output when valid
  - Add test: `perRunBudget` calculation with budget provided
  - Add test: `budgetWarning` present when budget too low
  - Add test: `budgetSufficient: false` when per-run < estimated max row cost
  - Add test: `budgetWarning` absent when budget is sufficient
  - Add test: backward compat — output shape without budget still works (no runPreview budget fields)

**Downstream dependency:** Verify `experiment-driver/route.ts` still works — it calls `estimateBatchCost()` (the wrapper). Add a focused test or assertion confirming the wrapper returns the same numeric value.

**Milestone check:** Run `npx jest experimentValidation.test && npx jest experimentActions.test` — all pass. Run `npx tsc --noEmit` — no type errors.

---

### Phase 2: Client-side — Run preview table in ExperimentForm

**Goal:** Render the per-row preview data as a table in ExperimentForm, with budget warning and start-blocking.

#### 2.1 Update client types and pass budget to validation
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

- Update the local `ValidationPreview` interface (lines 25-31) to include new fields:
  ```typescript
  interface ValidationPreview {
    valid: boolean;
    errors: string[];
    warnings: string[];
    expandedRunCount: number;
    estimatedCost: number;
    runPreview?: RunPreviewRow[];     // NEW
    perRunBudget?: number;            // NEW
    budgetSufficient?: boolean;       // NEW
    budgetWarning?: string;           // NEW
  }
  ```
  Import `RunPreviewRow` type from `experimentActions.ts` or define inline.

- Update the debounced `runValidation` call to include `budget` in the action input
- Add `budget` to the useCallback dependency array. **Note:** The existing code has `// eslint-disable-next-line react-hooks/exhaustive-deps` — remove this suppression and list all deps explicitly (enabledFactors JSON, selectedPromptIds JSON, budget).
- Budget is a number primitive, so adding it as a dep is fine. Budget input changes will trigger a 500ms debounced re-validation. This is acceptable since budget changes are infrequent (user types a number and moves on).

#### 2.2 Add budget summary banner and block Start button
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

- Below the existing "Validation Preview" section, add a budget summary when `validation.perRunBudget` is present:
  - Per-run budget: `$X.XX` (totalBudget / numRuns)
  - Estimated total cost vs budget comparison
  - Warning banner (red bg with `--status-error`) when `validation.budgetWarning` is non-null
- **Block Start button** when `budgetSufficient === false`:
  ```typescript
  disabled={
    clientErrors.length > 0
    || starting
    || (validation !== null && !validation.valid)
    || (validation !== null && validation.budgetSufficient === false)  // NEW
  }
  ```
  This prevents users from launching experiments that will immediately fail with budget_exceeded errors — the core production bug.

#### 2.3 Add run preview table
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

- New collapsible section "Run Preview" (collapsed by default, auto-expands when `budgetWarning` present)
- Toggle state: `const [previewOpen, setPreviewOpen] = useState(false)` + `useEffect` to auto-open when budgetWarning changes
- Table with columns: Row #, Factor values (one sub-column per enabled factor), Active Agents, Est. Cost/Prompt, Confidence
- Each factor column shows the resolved value for that row
- Active agents shown as compact text list (e.g., "generation, calibration, reflection")
- Estimated cost per row with confidence indicator (color-coded: high=`--status-success`, medium=`--accent-gold`, low=`--status-error`)
- Row with highest cost highlighted with subtle background

#### 2.4 Add per-agent budget caps expandable detail (SERVER-COMPUTED)
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.tsx`

- Clicking a row expands to show redistributed per-agent budget caps
- **All budget cap data comes from server** via `RunPreviewRow.effectiveBudgetCaps` (computed by `computeEffectiveBudgetCaps()` in Phase 1.3) — NO client-side computation of redistributed caps
- `effectiveBudgetCaps` are fractional proportions (e.g., generation=0.35, calibration=0.26) that sum to ~1.0 after redistribution
- **Per-agent dollar amounts** = `effectiveBudgetCaps[agent] * perRunBudget` — this is correct because `perRunBudget` IS `budgetCapUsd` for each run (it's the total budget allocated to one prompt-run pair, and `budgetCaps` are proportional fractions of `budgetCapUsd` as used in `costTracker.ts` line 25: `agentCap = (budgetCaps[agentName] ?? 0.20) * budgetCapUsd`)
- Show as horizontal bars similar to StartRunCard pattern, with dollar amounts
- Highlight agents whose dollar cap is below $0.01 (too small to do anything) in `--status-error`
- Use `import type { RunPreviewRow }` (type-only import) when importing from the server action module to avoid pulling server runtime code into the client bundle

#### 2.5 Server-side budget enforcement (defense-in-depth)
**File:** `evolution/src/services/experimentActions.ts`

- In `_startExperimentAction`, after computing `perRunBudget` and before inserting runs, add a budget sufficiency check using per-row max (not average):
  ```typescript
  const { perRow } = await estimateBatchCostDetailed(validation.expandedConfigs, resolvedPrompts);
  const maxRowCostPerPrompt = Math.max(...perRow.map(r => r.estimatedCostPerPrompt));
  if (perRunBudget < maxRowCostPerPrompt) {
    return { success: false, data: null, error: { message: `Budget too low: per-run budget $${perRunBudget.toFixed(4)} is below estimated cost $${maxRowCostPerPrompt.toFixed(4)} for the most expensive configuration.` } };
  }
  ```
- Uses the same `maxRowCostPerPrompt` basis as the client-side `budgetSufficient` check (Phase 1.3) for consistency — both compare `perRunBudget >= maxRowCostPerPrompt`
- Threshold is 1.0x (not 0.5x) — budget must cover the full estimated cost of the most expensive row. Safety multiplier is already baked into `estimatedCostPerPrompt` (1.5x for low confidence).
- This prevents the core production bug (runs created with impossible budgets) even if the client-side check is bypassed via devtools.
- Note: `_startExperimentAction` already calls `validateExperimentConfig` internally, so we can use `estimateBatchCostDetailed` on its result. This is a second cost estimation pass (the first was in `validateExperimentConfigAction`), but experiment starts are infrequent so the extra computation is acceptable.

**Milestone check:** Run `npx tsc --noEmit` — no type errors. Manual verification: open ExperimentForm, enable 2+ factors, select prompts, verify preview table appears.

---

### Phase 3: Tests

#### 3.1 ExperimentForm component tests
**File:** `src/app/admin/quality/optimization/_components/ExperimentForm.test.tsx` (new)

**Mocks needed** (4 server actions from different modules):
- `jest.mock('@evolution/services/experimentActions')` — `validateExperimentConfigAction`, `startExperimentAction`
- `jest.mock('@evolution/services/experimentActions')` — `getFactorMetadataAction`
- `jest.mock('@evolution/services/promptRegistryActions')` — `getPromptsAction` (different module!)

Tests:
- Renders run preview table when validation returns `runPreview`
- Shows budget warning banner when `budgetWarning` present
- **Start button disabled when `budgetSufficient === false`** (core behavior test)
- Start button enabled when `budgetSufficient === true`
- Preview table has correct number of rows (matching `runPreview.length`)
- Factor columns match enabled factors (check column headers)
- Collapsible behavior: collapsed by default, expanded when budgetWarning present
- Budget change re-triggers validation
- Expandable row shows per-agent budget bars with correct dollar amounts
- Agent caps below $0.01 highlighted in error state
- Validation error state: shows error, hides preview

#### 3.2 Update existing tests for new fields
- `experimentValidation.test.ts`:
  - Assert `perRowCosts` array length matches expanded configs
  - Assert `estimateBatchCost` wrapper returns same value (backward compat)
  - Assert `expandedConfigs[].factors` populated
- `experimentActions.test.ts`:
  - Assert `runPreview` in output, `perRunBudget`, `budgetWarning`
  - Assert `budgetSufficient: false` when budget too low
  - Assert backward compat: no budget → no budget fields in output
  - Assert per-row `effectiveBudgetCaps` are redistributed (not raw defaults)

**Milestone check:** `npx jest ExperimentForm.test && npx jest experimentValidation.test && npx jest experimentActions.test` — all pass.

---

### Phase 4: Lint, build, final verification

- `npx eslint --fix` on all changed files
- `npx tsc --noEmit` — clean
- `npm run build` — clean
- Manual smoke test per verification checklist below

## Testing

### Unit Tests (new/modified)
| File | Status | Tests |
|------|--------|-------|
| `ExperimentForm.test.tsx` | NEW | ~12 tests: preview rendering, budget warning, start-blocking, collapsible, agent caps, edge cases |
| `experimentValidation.test.ts` | MODIFY | +4 tests: `estimateBatchCostDetailed`, backward compat wrapper, `perRowCosts`, `expandedConfigs.factors` |
| `experimentActions.test.ts` | MODIFY | +7 tests: validate action (`runPreview`, `perRunBudget`, `budgetWarning`, `budgetSufficient`, backward compat) + start action (server-side budget rejection, server-side budget pass) |

### Manual Verification
1. Open ExperimentForm, enable 2 factors, select 1 prompt, set budget $50 → preview shows 8 rows, no warning, Start enabled
2. Set budget to $0.50 → warning appears, per-run budget shows $0.0625, preview auto-expands, **Start button disabled**
3. Increase budget to $50 → warning clears, Start re-enabled
4. Enable 5 factors → still 8 rows (L8), all 5 factor columns shown in preview table
5. Expand a row → per-agent budget bars visible, tiny caps highlighted in red
6. Change budget → validation re-runs after 500ms debounce, preview updates

## Rollback Plan

All new fields in `ValidateExperimentOutput` are optional (`runPreview?`, `perRunBudget?`, `budgetSufficient?`, `budgetWarning?`). The UI gracefully degrades when these fields are absent — it simply doesn't show the preview section. Rolling back to the previous commit restores the original behavior with no migration or cleanup needed.

`estimateBatchCost` remains a thin wrapper returning the same `number` type, so `experiment-driver/route.ts` and all other callers are unaffected by rollback.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/strategy_experiments.md` - Add run preview UI section
- `evolution/docs/evolution/cost_optimization.md` - Note budget warning feature and per-run budget visibility
- `evolution/docs/evolution/visualization.md` - Document new ExperimentForm preview component
- `evolution/docs/evolution/reference.md` - Update key files section with new types

## Key Files Changed

| File | Change |
|------|--------|
| `evolution/src/experiments/evolution/experimentValidation.ts` | Add `RowCostEstimate`, `ExpandedRunConfigWithFactors`, `estimateBatchCostDetailed`, `perRowCosts` field |
| `evolution/src/services/experimentActions.ts` | Add `RunPreviewRow` with `effectiveBudgetCaps`, expand `ValidateExperimentOutput`, budget warning + sufficiency logic, server-side budget enforcement in `startExperimentAction` |
| `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` | Update `ValidationPreview` type, budget in validation, preview table, warning banner, start-blocking, expandable agent detail |
| `src/app/admin/quality/optimization/_components/ExperimentForm.test.tsx` | NEW — ~12 component tests including start-blocking |
| `evolution/src/experiments/evolution/experimentValidation.test.ts` | +4 tests: per-row costs, factors field, backward compat |
| `evolution/src/services/experimentActions.test.ts` | +5 tests: preview, budget warning, sufficiency, backward compat |

## Downstream Dependencies

| File | Dependency | Impact |
|------|-----------|--------|
| `src/app/api/cron/experiment-driver/route.ts` | Imports `estimateBatchCost` | No impact — wrapper preserves exact same signature and return type |
| `startExperimentAction` in same file | Calls `validateExperimentConfig` | No impact — `ExpandedRunConfigWithFactors extends ExpandedRunConfig`, all existing field access works |
