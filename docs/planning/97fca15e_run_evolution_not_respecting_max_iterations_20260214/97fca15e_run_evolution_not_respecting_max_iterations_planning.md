# Run Evolution Not Respecting Max Iterations Plan

## Background
A production evolution run (97fca15e) exceeded its configured maxIterations limit instead of terminating. The strategy "Light" specified `iterations: 3`, but the run executed 12 iterations with default models before hitting a per-agent budget cap. Root cause: `queueEvolutionRunAction` drops 5 of 7 strategy config fields when writing the run's config JSONB. A secondary off-by-one bug means `maxIterations=N` only executes N-1 agent iterations.

## Requirements (from GH Issue #429)
1. Investigate production run 97fca15e to determine configured maxIterations
2. Check if run exceeded its maxIterations limit
3. Identify root cause in stopping condition logic if exceeded
4. Fix the bug so max_iterations is properly respected
5. Add tests to verify enforcement

## Problem
`queueEvolutionRunAction` (evolutionActions.ts:225-248) only copies `enabledAgents` and `singleArticle` from the strategy config to the run's config JSONB column. Five fields are silently dropped: `iterations` (→ maxIterations), `generationModel`, `judgeModel`, `agentModels`, and `budgetCaps`. When the pipeline starts, `resolveConfig()` merges the sparse run config with `DEFAULT_EVOLUTION_CONFIG`, so all dropped fields revert to defaults (maxIterations: 15, generationModel: gpt-4.1-mini, judgeModel: gpt-4.1-nano). Additionally, the pipeline's for-loop calls `startNewIteration()` before `shouldStop()`, causing an off-by-one where maxIterations=N runs only N-1 agent iterations.

## Options Considered

### Option A: Copy all strategy fields to run config at queue time (Chosen)
Copy `iterations` → `maxIterations`, `generationModel`, `judgeModel`, `budgetCaps` from strategy config into the run's config JSONB in `queueEvolutionRunAction`. This is the minimal fix that addresses the root cause.

**Pros:** Single-file change, all execution paths immediately work correctly, run config becomes self-contained
**Cons:** Duplicates data (strategy_config_id already links to the full strategy)

### Option B: Read strategy config at execution time
Modify `triggerEvolutionRunAction`, cron runner, and batch runner to fetch the linked `evolution_strategy_configs.config` and merge it into configOverrides.

**Pros:** No data duplication
**Cons:** Changes 3-4 files, adds DB query at execution time, breaks if strategy is edited between queue and execute

### Option C: Move config resolution into preparePipelineRun
Have `preparePipelineRun` accept a `strategyConfigId` and fetch/merge the strategy config itself.

**Pros:** Single source of truth for config resolution
**Cons:** Adds DB dependency to a currently pure function, changes function signature for all callers

**Decision:** Option A — it's the simplest fix with the smallest blast radius. The run config JSONB should be a self-contained snapshot of execution parameters at queue time.

**Data duplication justification:** Snapshot-at-queue-time is intentional. If a strategy is edited after a run is queued, the run should execute with the config it was queued with — not the updated strategy. The `strategy_config_id` FK remains for audit/traceability, but execution reads from the run's own config JSONB. This matches how `enabledAgents` and `singleArticle` already work.

**Other config consumers:** Verified that only `evolutionActions.ts` (admin UI) and the pipeline read `run.config` JSONB. Visualization actions read checkpoint state, not config directly. New fields in config JSONB are harmless to all consumers since `resolveConfig()` handles unknown fields gracefully via spread merge.

**agentModels exclusion:** Verified unused in pipeline execution. Only consumed by `costEstimator.ts` for admin UI cost estimation. No pipeline code references `agentModels`. Will skip to avoid persisting unused data; can be added later without migration since `resolveConfig()` provides defaults.

### Off-by-one fix
Change the for-loop to use `<=` or adjust `shouldStop()` to check `state.iteration > maxIterations`. The simpler approach is to change shouldStop from `>=` to `>`, which makes maxIterations=N run exactly N iterations.

## Phased Execution Plan

### Phase 1: Fix config propagation in queueEvolutionRunAction
**File:** `src/lib/services/evolutionActions.ts`

After the existing `enabledAgents` and `singleArticle` copying (line 241), add:

```typescript
// Copy iteration count (strategy uses 'iterations', runtime uses 'maxIterations')
// Validate: must be a positive integer if present
if (strategyConfig?.iterations != null) {
  const iterations = Math.max(1, Math.floor(strategyConfig.iterations));
  runConfig.maxIterations = iterations;
}
// Copy model selections (strings, validated at execution time by LLM provider)
if (strategyConfig?.generationModel) {
  runConfig.generationModel = strategyConfig.generationModel;
}
if (strategyConfig?.judgeModel) {
  runConfig.judgeModel = strategyConfig.judgeModel;
}
// Copy per-agent budget caps (spread to avoid reference sharing, guard against arrays)
if (strategyConfig?.budgetCaps != null && typeof strategyConfig.budgetCaps === 'object' && !Array.isArray(strategyConfig.budgetCaps) && Object.keys(strategyConfig.budgetCaps).length > 0) {
  runConfig.budgetCaps = { ...strategyConfig.budgetCaps };
}
```

**Note:** `agentModels` is not yet consumed by the pipeline (verified: only used in `costEstimator.ts` for admin UI), so we skip it to avoid persisting unused data.

**Transaction safety:** `queueEvolutionRunAction` uses a single Supabase INSERT, so config fields are written atomically — no partial-write risk.

**Verify:** Run lint, tsc, build. Run existing unit tests for evolutionActions.

### Phase 2: Fix off-by-one iteration counting
**File:** `src/lib/evolution/core/supervisor.ts`

Change shouldStop() line 251 from:
```typescript
if (state.iteration >= this.cfg.maxIterations) {
```
to:
```typescript
if (state.iteration > this.cfg.maxIterations) {
```

This makes maxIterations=N run exactly N iterations (state.iteration goes 1..N, shouldStop fires at N+1).

**Checkpoint resume impact analysis:** When a run resumes from checkpoint, `state.iteration` is restored from the checkpoint snapshot and the for-loop starts at `i = state.iteration`. With the `>=` → `>` change:
- **Before fix:** Resume at iteration=2 with maxIterations=3 → `startNewIteration()` sets iteration=3, `shouldStop(3>=3)=true` → breaks immediately, no agents run. This is the off-by-one manifesting on resume.
- **After fix:** Resume at iteration=2 with maxIterations=3 → `startNewIteration()` sets iteration=3, `shouldStop(3>3)=false` → agents run for one more iteration. Loop condition `3<3` then exits. Correct behavior.

**Other shouldStop callers:** `shouldStop()` also checks budget exhaustion and plateau detection independently. These checks are unaffected by the `>=` → `>` change since they don't reference `maxIterations`.

**Also update** the supervisor constructor validation (line 91-96) to account for the new boundary:
- `maxIterations > expansionMaxIterations` stays the same (no change needed)
- `maxIterations < minViable` stays the same

**Verify:** Run supervisor.test.ts, pipeline.test.ts. Check that existing tests still pass with the new boundary.

### Phase 3: Add/update unit tests

#### 3a: Test config propagation
**File:** `src/lib/services/evolutionActions.test.ts` (verified: exists)

Test that `queueEvolutionRunAction` copies strategy config fields:
- When strategy has `iterations: 5`, run config should have `maxIterations: 5`
- When strategy has `generationModel: 'deepseek-chat'`, run config should have it
- When strategy has `judgeModel: 'deepseek-chat'`, run config should have it
- When strategy has `budgetCaps`, run config should have them (and be a separate object, not same reference)
- When no strategy is linked, run config should omit these fields (defaults apply)

**Edge case tests:**
- `iterations: 0` → should be clamped to `maxIterations: 1` (minimum viable)
- `iterations: -5` → should be clamped to `maxIterations: 1`
- `iterations: 1` → should produce `maxIterations: 1` (boundary case)
- `budgetCaps: null` → should not copy (null-safe check)
- `budgetCaps: {}` → should not copy (empty object check)
- Partial config: `generationModel` present but `judgeModel` absent → only copies what exists

#### 3b: Test off-by-one fix
**File:** `src/lib/evolution/core/supervisor.test.ts` (verified: exists)

Add/update tests:
- `maxIterations=3` with `state.iteration=3` → shouldStop returns false (agents should run)
- `maxIterations=3` with `state.iteration=4` → shouldStop returns true
- `maxIterations=1` with `state.iteration=1` → shouldStop returns false (single iteration runs)
- `maxIterations=1` with `state.iteration=2` → shouldStop returns true
- Verify iteration count in a pipeline test: maxIterations=3 should produce exactly 3 iterations of agent execution

**Checkpoint resume test:**
- Create a `PipelineStateImpl` with `iteration=2`, serialize to checkpoint snapshot, then resume pipeline with `maxIterations=3`. Assert that `startNewIteration()` is called exactly once more (iteration goes 2→3) and agents execute for that iteration.

**Pipeline iteration count assertion:**
- Spy on `state.startNewIteration()` — for maxIterations=3, expect exactly 3 calls (state.iteration goes 1→2→3). The for-loop's `i < maxIterations` condition exits the loop naturally after the 3rd iteration; `shouldStop()` does NOT fire for maxIterations in this case. The shouldStop maxIterations check acts as a safety net for resume scenarios where state.iteration may exceed the for-loop index.

#### 3c: Integration test for config round-trip
**File:** `src/__tests__/integration/evolution-actions.integration.test.ts` (verified: exists)

Test the full queue→trigger→resolve path:
1. Create a strategy config with `iterations: 3, generationModel: 'deepseek-chat', judgeModel: 'deepseek-chat', budgetCaps: { generation: 0.2, pairwise: 0.3 }`
2. Call `queueEvolutionRunAction` with that strategy
3. Read back the inserted run's config JSONB
4. Verify it contains `maxIterations: 3, generationModel: 'deepseek-chat', judgeModel: 'deepseek-chat', budgetCaps: { generation: 0.2, pairwise: 0.3 }`
5. Call `resolveConfig()` on the run's config and verify the resolved config has strategy values, not defaults

### Phase 4: Verify and commit
- Run full lint, tsc, build
- Run all evolution unit tests: `npm test -- --testPathPatterns="evolution"`
- Run evolution integration tests: `npm test -- --testPathPatterns="integration/evolution"`
- CI: Tests run in the existing GitHub Actions workflow (`ci.yml`) — no CI changes needed. Evolution tests are part of the standard test suite.
- Commit with descriptive message

## Testing

### Unit Tests
- `src/lib/services/evolutionActions.test.ts` — config propagation from strategy to run
- `src/lib/evolution/core/supervisor.test.ts` — iteration boundary (shouldStop at N vs N+1)
- `src/lib/evolution/core/pipeline.test.ts` — iteration count verification

### Manual Verification
- Query production run 97fca15e to confirm the config gap matches expectations (DONE in research)
- After deploying to staging: queue a run with a strategy that has `iterations: 3`, verify it stops after 3 iterations
- Verify cost estimate matches actual execution (same models, same iteration count)

## Backward Compatibility & In-Flight Runs

**Existing runs:** Runs queued before this deploy have sparse config JSONB (only `enabledAgents`/`singleArticle`). These runs are unaffected — `resolveConfig()` will continue to fill defaults as before. No migration or backfill is needed.

**In-flight runs with checkpoint resume:** The off-by-one fix (`>=` → `>`) changes behavior for runs that resume. A run paused at iteration=N-1 with maxIterations=N will now correctly execute one more iteration instead of terminating immediately. This is the *desired* fix — the old behavior was the bug.

**No feature flag needed:** Both fixes are pure bug corrections with no new behavior to toggle. Rollback is a simple revert of the commit. After rollback, new runs would revert to sparse config (defaults apply) and the off-by-one would return. No data corruption risk in either direction.

## Rollback Plan

If issues are discovered post-deploy:
1. Revert the commit (single commit, no migration)
2. New runs will use defaults again (old buggy behavior but safe)
3. Runs already queued with full config will continue to work — `resolveConfig()` handles extra fields gracefully
4. No database cleanup needed

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/reference.md` - Update config documentation to note that strategy fields are now persisted to run config JSONB; clarify that maxIterations=N means N iterations (not N-1)
- `docs/evolution/architecture.md` - Update stopping conditions section to reflect the corrected iteration counting
- `docs/evolution/data_model.md` - Note that run config JSONB now includes maxIterations, generationModel, judgeModel, budgetCaps from linked strategy
