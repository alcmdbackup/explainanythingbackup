# Experiment Structure Change Evolution Plan

## Background
The current experiment system uses factor ranges (L8 orthogonal arrays) to auto-generate all 8 runs at once, which is inflexible for iterative exploration. Iterations as a factor adds complexity to analysis since runs with different iteration counts are hard to compare fairly. Additionally, experiment results (ratings, arena entries) only sync after the entire experiment completes, preventing real-time monitoring and early insights.

## Requirements (from GH Issue #616)
1. I want to be able to add experiment groups/runs 1 by 1 rather than by choosing factor range. Please create UI that allows me to do this.
2. I want to remove iterations as a factor. I want each run/experiment group to stop when I hit the budget limit for it, since this will make analysis much easier. I want the budget limit for each run to be clearly labeled at experiment setup.
3. I want ratings and other details to sync to the arena mid-experiment, rather than waiting until the very end.

## Problem
The experiment system is tightly coupled to L8 factorial design — factor Low/High selection auto-generates 8 runs with no ability to customize individual run configs. The `iterations` factor forces variable-length runs that are hard to compare. Arena sync only happens when a run fully completes, so experiment results are invisible until the entire experiment finishes. These constraints make the system rigid and slow for iterative strategy exploration.

## Decisions

1. **Fully replace L8 factorial mode** — No dual mode. Remove L8 entirely, `design='manual'` for all new experiments.
2. **Simple elo/cost comparison for analysis** — No main effects computation; direct per-run comparison table.
3. **Mid-run arena sync every iteration** — Watermark approach (`lastSyncedMatchIndex`) to avoid comparison duplication.
4. **Per-run budget** — Each run has its own `budget_cap_usd`, displayed everywhere the run appears.
5. **Budget exhaustion → completed** — Catch `BudgetExceededError` in agent dispatch loop, convert to graceful stop with finalization.

## Options Considered

### Manual Run UI
- **A. Rewrite ExperimentForm with inline run builder** — Single form for experiment metadata + run list. Reuses StrategyDialog patterns (model dropdowns, agent toggles, budget input). ✅ Chosen.
- **B. Separate "Add Run" dialog** — Experiment creation is minimal, runs added via modal. More clicks, less context.
- **C. Import from strategy leaderboard** — Pick existing strategies + budget. Limits experimentation with new configs.

### Analysis Approach
- **A. Simple per-run comparison table** — Elo, cost, elo/$ columns per run. ✅ Chosen.
- **B. Keep main effects with manual grouping** — User labels runs as "low"/"high" post-hoc. Over-engineered.

### Mid-Run Sync Strategy
- **A. Watermark index on PipelineState** — `lastSyncedMatchIndex`, send only new matches. ✅ Chosen.
- **B. ON CONFLICT on comparisons table** — Requires schema change + composite key. Heavier.
- **C. Separate incremental RPC** — New DB function. More surface area.
- **D. Delete + reinsert** — Destructive, elo history lost.

### Budget Exhaustion Behavior
- **A. Catch BudgetExceededError in agent dispatch loop** — Convert to graceful stop, existing post-loop code handles finalization. ✅ Chosen.
- **B. Modify runAgent to not throw** — Changes shared code, risk of masking real errors.
- **C. Add resume-from-paused path** — Unnecessary complexity when we just want "completed".

## Phased Execution Plan

### Phase 1: DB Migration & Backend Foundation
**Goal**: Add `'manual'` design type.

**Files to modify:**
- `supabase/migrations/20260304000001_manual_experiment_design.sql` (NEW) — Add `'manual'` to design CHECK constraint

**Changes:**
1. Create migration: DROP existing design CHECK, ADD new CHECK including `'manual'`
2. No `factor_definitions` change needed — store `{}` for manual experiments (column is JSONB NOT NULL)

**Rollback plan:** Migration is additive (adds `'manual'` to CHECK). Rollback: DROP constraint, re-ADD without `'manual'`. Safe as long as no rows with `design='manual'` exist — if they do, DELETE them first (they'd be test data from a failed deploy). Include a DOWN migration in the file.

**Verify:** Migration applies cleanly, existing L8 experiments unaffected. Verify no NULL design rows exist (column has DEFAULT 'L8', but guard with `UPDATE evolution_experiments SET design='L8' WHERE design IS NULL` in migration).

---

### Phase 1b: Fix budget_cap_usd JSONB Gap + Hard Caps
**Goal**: Ensure the runner's `CostTracker` uses the user-specified budget cap, not the $5.00 default. Add hard failsafe caps.

**The bug**: `queueEvolutionRunAction` writes `budget_cap_usd` to the DB column (for display) but `buildRunConfig` omits `budgetCapUsd` from the JSONB `config` column. The runner only reads from `config` JSONB → `resolveConfig()` falls back to `DEFAULT_EVOLUTION_CONFIG.budgetCapUsd = $5.00`. Custom budget caps are silently ignored at execution time.

**Note**: The experiment path (`experimentActions.ts`) is NOT affected — it spreads the full `resolvedConfig` (which includes `budgetCapUsd`) into the JSONB. Only the standalone `queueEvolutionRunAction` → `buildRunConfig` path has this bug.

**Files to modify:**
- `evolution/src/services/evolutionActions.ts` — Pass `budgetCap` to `buildRunConfig`, write it into JSONB; tighten validation range
- `evolution/src/services/experimentActions.ts` — Add experiment-level budget cap validation
- `evolution/src/lib/config.ts` — Add exported constants for hard caps

**Changes:**
1. Add `budgetCapUsd` parameter to `buildRunConfig` signature
2. In `buildRunConfig` body: `if (budgetCapUsd != null) runConfig.budgetCapUsd = budgetCapUsd;`
3. In `queueEvolutionRunAction`: pass the resolved `budgetCap` value to `buildRunConfig(strategyConfig, input.strategyId, budgetCap)`
4. **Hard cap constants** in `config.ts`:
   ```ts
   export const MAX_RUN_BUDGET_USD = 1.00;
   export const MAX_EXPERIMENT_BUDGET_USD = 10.00;
   ```
5. **Per-run cap** — tighten existing validation in `queueEvolutionRunAction` (line 90): change `budgetCapUsd > 100` to `budgetCapUsd > MAX_RUN_BUDGET_USD`. Same validation in `addRunToExperimentAction`.
6. **Per-experiment cap** — in `addRunToExperimentAction`: after computing new total (`current total_budget_usd + budgetCapUsd * promptCount`), reject if total exceeds `MAX_EXPERIMENT_BUDGET_USD`. In `createManualExperimentAction`: no check needed (experiment starts at $0).
7. **Runner-level failsafe** — in `resolveConfig` (`config.ts`): clamp `budgetCapUsd` to `Math.min(resolved.budgetCapUsd, MAX_RUN_BUDGET_USD)`. This is the last line of defense — even if validation is bypassed (e.g., direct DB insert, old JSONB without cap), the runner never exceeds $1/run.

**Verify:**
- Unit test: queue a run with `budgetCapUsd: 25` → rejected with error
- Unit test: queue a run with `budgetCapUsd: 0.50` → accepted, `config` JSONB includes `budgetCapUsd: 0.50`
- Unit test: addRun that would push experiment total over $10 → rejected
- Unit test: `resolveConfig({ budgetCapUsd: 50 })` → clamped to $1.00
- Existing runs with no `budgetCapUsd` in JSONB still default to $5.00 via `resolveConfig` → clamped to $1.00 by failsafe
- Update existing test in `evolutionActions.test.ts` (line 743) that tests the $100 range → change to $1.00

---

### Phase 2: Mid-Run Arena Sync (Watermark)
**Goal**: Enable incremental arena sync every iteration without duplicating comparisons.

**Files to modify:**
- `evolution/src/lib/types.ts` — Add `lastSyncedMatchIndex?: number` to `SerializedPipelineState` and `PipelineState`
- `evolution/src/lib/core/state.ts` — Deserialize `lastSyncedMatchIndex` with `?? 0` default
- `evolution/src/lib/core/arenaIntegration.ts` — Add `startIndex` parameter to existing `syncToArena`, default 0 for backward compat. Slice `matchHistory.slice(startIndex)` internally.
- `evolution/src/lib/core/pipeline.ts` — Call `syncToArena` with watermark after each iteration, update watermark on state BEFORE checkpoint

**Changes:**
1. Add `lastSyncedMatchIndex` to type interfaces
2. Handle in `deserializeState` with `?? 0`
3. Modify `syncToArena` signature to accept optional `startIndex: number = 0`. Internally slice `matchHistory.slice(startIndex)` for comparisons. Entries and elo are already idempotent so always send all.
4. In `executeFullPipeline`, BEFORE `persistCheckpointWithSupervisor` (~line 504):
   - Compute `newWatermark = state.matchHistory.length`
   - Call `syncToArena(supabase, runId, topicId, state, logger, state.lastSyncedMatchIndex)` in try/catch (non-fatal)
   - On success: set `state.lastSyncedMatchIndex = newWatermark` (this gets serialized in the immediately-following checkpoint)
   - On failure: leave watermark unchanged — next iteration retries the same slice
   - **Key**: watermark is updated on state BEFORE checkpoint, so checkpoint serializes the new value
5. In `finalizePipelineRun`: call `syncToArena` with `state.lastSyncedMatchIndex` to send only remaining unsent matches
6. Guard: if `ctx.arenaTopicId` is null (no topic resolved), skip mid-run sync silently (topic created at finalization via `autoLinkPrompt`)

**Watermark failure safety:**
- If sync succeeds → watermark advances → checkpoint captures it
- If sync fails → watermark stays → next iteration retries from same point (no data loss, no duplication)
- If sync partially succeeds (some matches inserted before DB timeout) → watermark NOT advanced → retry will re-send those matches. Since comparisons table has NO dedup (plain INSERT), this creates duplicate comparison rows. **Clarification**: Elo rows use `ON CONFLICT (topic_id, entry_id) DO UPDATE` so elo is always correct regardless of comparison duplicates. Duplicate comparison rows are noise in the comparisons table but do NOT corrupt elo calculation — elo is computed from the latest rating state, not summed from comparisons. **Mitigation**: Accept as rare edge case. The duplicate rows waste storage but are functionally harmless. Document as known limitation.

**Verify:** Unit tests: watermark advances on success, stays on failure, finalize sends only remainder. Test that checkpoint serializes updated watermark.

---

### Phase 3: Budget Exhaustion → Completed
**Goal**: Runs that hit budget mid-agent get `completed` status with full finalization instead of `paused`.

**Critical implementation detail**: `runAgent()` (pipeline.ts ~line 628) currently catches `BudgetExceededError`, calls `markRunPaused()`, then re-throws. The fix must happen INSIDE `runAgent()` itself — catching at the outer loop level would see an already-paused run. Similarly, `flowCritique` handler (~line 480) and `executeMinimalPipeline` (~line 241) both call `markRunPaused` before re-throwing/returning.

**Files to modify:**
- `evolution/src/lib/core/pipeline.ts` — Modify `BudgetExceededError` handling in 3 locations

**Changes:**
1. **`runAgent()` (~line 628)**: Remove `markRunPaused()` call. Instead, re-throw `BudgetExceededError` WITHOUT calling markRunPaused — let it propagate to the caller's agent dispatch loop.
2. **`executeFullPipeline` agent dispatch loop (~line 460)**: Add try/catch around each `runAgent` call. On `BudgetExceededError`: set `stopReason = 'budget_exhausted'`, break. The existing post-loop code (`else if (stopReason !== 'killed')`) calls `finalizePipelineRun` with `status='completed'`.
3. **`flowCritique` inline handler (~line 480)**: Remove `markRunPaused()` call. Re-throw to be caught by the same outer loop catch added in step 2.
4. **`executeMinimalPipeline` (~line 241)**: Remove `markRunPaused()` call and early return. Instead, set `stopReason = 'budget_exhausted'` and fall through to the existing post-loop finalization code. **Note**: `executeMinimalPipeline` already calls `finalizePipelineRun` at line 263 for the normal completion path, and populates all required state fields (`insertBaselineVariant` ensures baseline in pool, agents run normally populating ratings/matchHistory). The budget_exhausted case should break out of the agent loop and reach this same `finalizePipelineRun` call — no new finalization code needed, just ensure the break target reaches the existing finalize.
5. Set `error_message = 'budget_exhausted'` to distinguish from clean completion

**Verify:**
- **Update existing pipeline.test.ts** (~line 1374): Current test is named `'does not retry BudgetExceededError (pauses instead)'` and only asserts call count. Must:
  1. Rename to `'BudgetExceededError triggers graceful completion (not pause)'`
  2. Assert `status='completed'` (not paused)
  3. Assert `finalizePipelineRun` was called
  4. Assert `error_message='budget_exhausted'`
  5. Assert `markRunPaused` was NOT called
- **Add per-site tests** for all 3 catch locations:
  - `executeFullPipeline` agent dispatch: mock runAgent to throw BudgetExceededError, verify completed + finalized
  - `flowCritique` handler: mock flowCritique agent to throw BudgetExceededError, verify completed + finalized
  - `executeMinimalPipeline`: mock agent to throw BudgetExceededError, verify completed + finalized (explicit finalizePipelineRun call)
- Each test must verify: status=completed, finalizePipelineRun called, markRunPaused NOT called

---

### Phase 4: Manual Experiment Server Actions
**Goal**: New server actions for creating manual experiments and adding runs one-by-one.

**Files to modify:**
- `evolution/src/services/experimentActions.ts` — Add `createManualExperimentAction`, `addRunToExperimentAction`, `startManualExperimentAction`
- `evolution/src/services/experimentActions.ts` — Update `getExperimentRunsAction` to include `budget_cap_usd`, update `ExperimentRun` interface

**Changes:**
1. `createManualExperimentAction({ name, promptIds, target })`:
   - INSERT `evolution_experiments` with `design='manual'`, `factor_definitions='{}'`, `status='pending'`
   - Return experiment ID

2. `addRunToExperimentAction({ experimentId, config: { model, judgeModel, enabledAgents, budgetCapUsd } })`:
   - Verify experiment is `pending` or `running`
   - Call `resolveConfig()` to merge defaults and compute derived fields (budgetCaps, etc.) — same pattern as existing `startExperimentAction`
   - `resolveOrCreateStrategyFromRunConfig` → `strategy_config_id` (already idempotent via INSERT-first pattern with ON CONFLICT in `strategyResolution.ts`)
   - For each prompt: create explanation + `evolution_runs` row with `budget_cap_usd`
   - Validate `budgetCapUsd <= MAX_RUN_BUDGET_USD` ($1.00)
   - Validate new experiment total (`current + budgetCapUsd * promptCount`) does not exceed `MAX_EXPERIMENT_BUDGET_USD` ($10.00)
   - **Atomic budget update**: `UPDATE evolution_experiments SET total_budget_usd = total_budget_usd + $1 WHERE id = $2` (single SQL statement, not read-modify-write). This prevents race conditions from concurrent addRun calls.
   - Wrap entire operation in a DB transaction: if any run INSERT fails, all run INSERTs and the budget update roll back together. No orphaned partial state.

3. `startManualExperimentAction({ experimentId })`:
   - Verify ≥1 run exists
   - Set `status='running'`

4a. `deleteExperimentAction({ experimentId })`:
   - Only allowed for `pending` experiments (safety guard)
   - **No ON DELETE CASCADE** on `evolution_runs.experiment_id` FK (bare REFERENCES, default RESTRICT). Must delete in order: evolution_runs first (their explanation_id FK DOES have CASCADE so explanations auto-delete), then evolution_experiments row.
   - Used by UI for cleanup of abandoned partial experiments

5. Update `getExperimentRunsAction`:
   - Add `budget_cap_usd` to SELECT query
   - Update `ExperimentRun` interface to include `budgetCapUsd?: number` — must be done in same phase to avoid TypeScript errors in RunsTab

**Verify:**
- Unit tests for each action including: create, addRun, addRun with concurrent calls, startManual with 0 runs (rejected), addRun to non-pending/running experiment (rejected)
- Integration: create experiment, add 2 runs, start, verify DB state and budget sum

---

### Phase 5: Cron Driver Manual Mode Support
**Goal**: Cron handles `design='manual'` experiments — skips L8 analysis, uses simple per-run comparison.

**Files to modify:**
- `src/app/api/cron/experiment-driver/route.ts` — Branch on `design === 'manual'` in `handleAnalyzing`, bypass `mapRunsForAnalysis` and `writeTerminalState` L8-specific logic
- `evolution/src/experiments/evolution/analysis.ts` — Add `computeManualAnalysis(runs)` returning per-run elo/cost comparison

**Changes:**
1. In `handleAnalyzing`: if `design === 'manual'`:
   - Skip `mapRunsForAnalysis` entirely (it groups by `_experimentRow` which manual runs don't have)
   - Call `computeManualAnalysis(completedRuns)` directly with raw run rows from DB
   - Skip `writeTerminalState` L8-specific logic (factorRanking extraction, recommendations). Instead write `results_summary` with `{ type: 'manual', factorRanking: [], recommendations: [] }` to satisfy the existing JSONB shape
   - Store `analysis_results = { type: 'manual', runs: [...] }`
2. `computeManualAnalysis`: define a new `ManualRunResult` interface: `{ runId: string, configLabel: string, elo: number | null, cost: number, eloPer$: number | null }`. Do NOT reuse the `ExperimentRun` type from analysis.ts (which has a required `row: number` field for L8). Note: the `ExperimentRun` in analysis.ts is a DIFFERENT type than `ExperimentRun` in experimentActions.ts — disambiguate by using `AnalysisExperimentRun` for the analysis.ts type if renaming is needed during implementation.
3. **Report generation for manual experiments**: `writeTerminalState` also calls `callLLM` for report generation which IS desired for manual experiments. Instead of bypassing `writeTerminalState` entirely, refactor it to accept the analysis result shape-agnostically: pass `{ type: 'manual', runs: [...] }` as `analysis_results` and `{ factorRanking: [], recommendations: [] }` as the L8-specific fields. `writeTerminalState` generates a report via `buildExperimentReportPrompt` which needs these specific changes:
   - Line 23: change fallback `'L8'` to `exp.design` (already available)
   - Lines 31-38: guard `factor_definitions` block with `if (Object.keys(factors).length > 0)` — manual experiments pass `{}`
   - Lines 41-58: guard `mainEffects`/`factorRanking` blocks with `if (analysis.type !== 'manual')` — for manual, instead emit per-run comparison table from `analysis.runs`
   - Line 113: change "effect sizes" to "performance metrics" (generic wording)
   - Run results section (lines 61-88) is already experiment-type-agnostic, no changes needed
4. Add safety guard: if `design` is not `'L8'`, `'full-factorial'`, or `'manual'`, log warning and mark experiment `failed` with descriptive error

**Verify:**
- Unit test `computeManualAnalysis` with mock run data
- **Automated** cron route test (HIGH priority, not MEDIUM) for manual experiment path: pending → running → analyzing → completed
- Verify old L8 experiments still analyze correctly (regression test)

---

### Phase 6: Experiment Form UI (Manual Run Creation)
**Goal**: Replace L8 factor form with manual run builder. Reuse StrategyDialog patterns.

**Files to modify:**
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — Full rewrite
- `src/app/admin/quality/optimization/_components/runFormUtils.ts` (NEW) — `RunFormState`, `runFormToConfig()`

**Changes:**
1. **Extract MODEL_OPTIONS** to shared config file (e.g., `evolution/src/config/modelOptions.ts`). Import from both `strategies/page.tsx` and new `runFormUtils.ts` to avoid maintenance divergence.

2. Create `runFormUtils.ts` with:
   - `RunFormState`: model, judgeModel, enabledAgents, budgetCapUsd
   - `runFormToConfig()`: validates and converts to API shape
   - `DEFAULT_RUN_STATE`: sensible defaults

3. Rewrite `ExperimentForm.tsx`:
   - **Step 1**: Experiment name + prompt selection (keep existing prompt picker)
   - **Step 2**: Run list with "Add Run" button. Each run shows:
     - Model dropdown (from shared MODEL_OPTIONS)
     - Judge model dropdown
     - Agent toggles (required/optional split, reuse `toggleAgent` + `validateAgentSelection`)
     - Budget input with `computeEffectiveBudgetCaps` preview
     - Remove button
   - **Step 3**: Review + Start button
   - Submit flow: `createManualExperimentAction` → `addRunToExperimentAction` per run → `startManualExperimentAction`
   - **Error handling**: If addRun fails mid-way, show error to user with option to retry remaining runs or abandon. The pending experiment with partial runs is visible in ExperimentHistory and can be deleted (add `deleteExperimentAction` for cleanup of pending experiments with 0 or partial runs).

**Verify:** Component renders, add/remove runs works, validation prevents empty experiments. ExperimentForm.test rewritten (HIGH priority — full rewrite requires full test rewrite per CLAUDE.md rules).

---

### Phase 7: Experiment Detail Page Updates
**Goal**: Update detail page for manual experiments — per-run comparison analysis, budget display, remove L8 columns.

**Files to modify:**
- `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.tsx` — Add budget_cap_usd column, remove L8 Row column
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.tsx` — Show per-run config summary instead of factor definitions table
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentAnalysisCard.tsx` — Render per-run comparison table for manual experiments

**Changes:**
1. `RunsTab`: Add Budget column showing `budget_cap_usd` with cost/budget progress. Remove L8 Row column. Guard with `design` field — for L8 experiments, keep showing L8 Row.
2. `ExperimentOverviewCard`: Guard `design==='manual'` before rendering factor definitions grid. For manual: show run count + total budget. For L8: keep existing factor definitions table. Passing `{}` to L8 rendering would render an empty table — must branch explicitly.
3. `ExperimentAnalysisCard`: For `analysis_results.type === 'manual'`, render simple comparison table: Run | Model | Elo | Cost | Elo/$. For L8 `analysis_results` shape, keep existing main effects rendering (backward compat for old experiments). Guard `factorRanking`/`recommendations` with `?? []` defaults for manual experiments where these are empty arrays.

**Verify:** Renders correctly for manual experiments. Old L8 experiments still display properly.

---

### Phase 8: Tests & Cleanup
**Goal**: Update/rewrite tests, remove dead L8 code paths where safe.

**Test changes:**
| Priority | Test File | Change |
|----------|-----------|--------|
| HIGH | experimentActions.test | Add tests for new manual actions; keep L8 action tests for backward compat. Note: existing chainMock() pattern doesn't support transaction rollback simulation — for concurrent addRun tests, use the atomic SQL UPDATE assertion (verify the UPDATE statement uses `total_budget_usd = total_budget_usd + $1` pattern) rather than trying to simulate concurrent DB access in unit tests. Concurrent safety is validated in manual stage testing. |
| HIGH | pipeline.test | **Update** existing test (~line 1374) that asserts BudgetExceededError → paused; change to assert → completed. Add tests for all 3 catch sites. |
| HIGH | arenaIntegration.test | Test watermark: advances on success, stays on failure, finalize sends only remainder |
| HIGH | cron route.test | **Promoted from MEDIUM**: automated test for manual experiment lifecycle (pending → running → analyzing → completed). Requires: new `baseManualExperiment()` helper (design='manual', factor_definitions={}), mock `computeManualAnalysis` (not `analyzeExperiment`), assert `results_summary` shape has `type:'manual'`. Keep existing L8 tests as regression. |
| HIGH | ExperimentForm.test | Full rewrite required (CLAUDE.md: write tests for every code block) |
| MEDIUM | analysis.test | Test `computeManualAnalysis`; keep existing L8 analysis tests |
| LOW | RunsTab.test | Update for budget column |
| LOW | ExperimentAnalysisCard.test | Update for manual analysis display |
| LOW | ExperimentOverviewCard.test | Add test for design='manual' guard (no empty factor table) |
| MEDIUM | runFormUtils.test (NEW) | Unit tests for runFormToConfig validation, DEFAULT_RUN_STATE |
| MEDIUM | state.test | lastSyncedMatchIndex serialization/deserialization with ?? 0 default |

**Cleanup:**
- Remove `iterations` from `factorRegistry.ts` FACTOR_REGISTRY — **only after** verifying no L8 experiments are in `running` or `analyzing` state (gate on all L8 experiments being terminal). **Must be in same PR** as updating `getFactorMetadataAction` test (line 554, asserts `iterations` is in keys). Add a pre-deploy check: `SELECT count(*) FROM evolution_experiments WHERE design IN ('L8','full-factorial') AND status IN ('running','analyzing')` — must return 0.
- Keep L8 code paths for backward compatibility with existing experiments (don't delete `factorial.ts`, `experimentValidation.ts` yet)
- Mark L8-only server actions as deprecated in comments

## Testing

### Unit Tests
- `arenaIntegration.test.ts` — watermark: advances on success, stays on failure, finalize sends only remainder
- `pipeline.test.ts` — BudgetExceededError → completed (not paused) across all 3 catch sites; **update existing paused assertion**
- `experimentActions.test.ts` — createManualExperiment, addRun (including concurrent), startManual (with 0 runs rejected), addRun to non-pending experiment (rejected), addRun exceeding $1/run cap (rejected), addRun pushing experiment total over $10 (rejected)
- `evolutionActions.test.ts` — update existing budget range test (line 743) from $100 to $1.00; test `resolveConfig` clamps budgetCapUsd to $1.00
- `config.test.ts` (or inline) — `resolveConfig({ budgetCapUsd: 50 })` → clamped to MAX_RUN_BUDGET_USD
- `analysis.test.ts` — computeManualAnalysis returns per-run comparison; keep L8 analysis tests
- `state.test.ts` — lastSyncedMatchIndex serialization/deserialization with `?? 0` default

### Automated Integration Tests
- **Cron route test** (HIGH priority): manual experiment lifecycle: pending → running → analyzing → completed, verifying `computeManualAnalysis` is called and `results_summary` shape is correct
- Budget exhaustion: pipeline with BudgetExceededError, verify run completes with arena sync + variants persisted

### Manual Verification (Stage)
- [ ] Create manual experiment via UI with 2+ runs
- [ ] Each run shows budget clearly
- [ ] Start experiment, observe mid-run arena entries appearing
- [ ] Run hits budget → status shows completed (not paused)
- [ ] Analysis tab shows per-run comparison table
- [ ] Old L8 experiments still display correctly
- [ ] Concurrent addRun calls don't produce incorrect total_budget_usd

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/strategy_experiments.md` - Major rewrite: manual run creation, remove iterations factor, mid-run arena sync
- `evolution/docs/evolution/data_model.md` - Experiment-run relationship changes, design field values
- `evolution/docs/evolution/reference.md` - Config changes, factor registry update, DB schema
- `evolution/docs/evolution/architecture.md` - Pipeline flow changes for mid-run arena sync
- `evolution/docs/evolution/cost_optimization.md` - Per-run budget labeling, cost estimation for manual configs
- `evolution/docs/evolution/rating_and_comparison.md` - Mid-run arena sync implications
- `evolution/docs/evolution/agents/overview.md` - Unlikely to need changes
