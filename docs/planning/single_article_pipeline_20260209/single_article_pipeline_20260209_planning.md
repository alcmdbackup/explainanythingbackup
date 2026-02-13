# Single Article Pipeline Plan

## Background
Create a single-article pipeline mode that produces one article variant and iterates on it sequentially through agent passes. Unlike the existing evolution pipeline which maintains a population pool with competitive selection and tournament ranking, this mode operates on a single article — no population search, no pool diversification, just focused sequential improvement (e.g., generation -> reflection -> editing -> polishing).

## Requirements (from GH Issue #385)
I want to be able to run a pipeline that produces only a single article variant, and has agents operate on it sequentially. No population search, just iterating on a single article.

## Problem
The existing evolution pipeline is population-based: it grows a pool of 15+ variants, ranks them via pairwise tournaments, and uses genetic evolution to breed new variants. This is powerful but expensive ($3-5/run) and slow (15 iterations x 12 agents). For many use cases — improving a single article in-place — you don't need a population. You need a focused sequential loop: critique the article, surgically edit weaknesses, re-critique, repeat. The existing agents (ReflectionAgent, IterativeEditingAgent, SectionDecompositionAgent) already operate on a single top variant, but there's no pipeline mode that strings them together without the population machinery.

## Options Considered

### Option A: Config-driven via PoolSupervisor modification (CHOSEN)
- Add `singleArticle?: boolean` to config, modify supervisor to disable generation/evolution agents via PhaseConfig
- Reuse `executeFullPipeline` unchanged — supervisor + existing `canExecute()` gates produce single-article behavior
- **Pros:** Zero code duplication, reuses iteration loop + checkpointing + resume + stopping conditions, ~25 lines changed, Tournament handles rating naturally
- **Cons:** Supervisor gains a new concern (gated by flag), requires relaxing one constructor validation

### Option B: New executeSingleArticlePipeline function
- New pipeline function with iteration loop, variant promotion, simple stopping conditions
- **Pros:** Clean separation, no risk to existing pipelines
- **Cons:** ~80 new lines duplicating existing pipeline infrastructure, needs custom `promoteLatestVariant()` helper, no checkpoint/resume support without additional work

### Option C: Reuse executeMinimalPipeline with custom agent array
- Pass `[reflection, iterativeEditing, sectionDecomposition]` to `executeMinimalPipeline`
- **Pros:** Zero new pipeline code
- **Cons:** No iteration loop (runs agents once), no variant promotion, no stopping conditions

**Decision: Option A** — config-driven via PoolSupervisor modification. Leverages the full existing infrastructure (iteration loop, checkpoint/resume, stopping conditions, OTel, finalization) with minimal changes. The key insight is that `executeFullPipeline` already does everything a single-article pipeline needs — we just need to tell the supervisor which agents to disable.

## Key Design Decisions

### D1: No Variant Promotion Needed — Tournament Handles Rating Naturally
With Option A, `executeFullPipeline`'s existing agent execution order places Tournament at step 9, AFTER editing agents at steps 4-6. When IterativeEditingAgent adds a variant (pool grows to 2+), Tournament's `canExecute: pool >= 2` becomes true and it rates the pair via pairwise comparison. One comparison costs ~$0.001 (negligible via ComparisonCache). After Tournament, `getTopByRating(1)` returns the correct top variant. No synthetic `promoteLatestVariant()` helper needed.

### D2: Agent Execution Order in COMPETITION Phase (Unchanged)
The existing COMPETITION agent order in `executeFullPipeline` (pipeline.ts L832-875):
```
1. generation              <- DISABLED by getPhaseConfig (runGeneration: false)
2. outlineGeneration       <- DISABLED by getPhaseConfig (runOutlineGeneration: false)
3. reflection              critiques current best
4. iterativeEditing        edit->judge loop on current best (max 3 cycles)
5. treeSearch              beam search on top variant
6. sectionDecomposition    H2-level parallel edits
7. debate                  canExecute self-disables (needs 2 non-baseline)
8. evolution               <- DISABLED by getPhaseConfig (runEvolution: false)
9. calibration/tournament  rates new variants when pool >= 2
10. proximity              diversity tracking when pool >= 2
11. metaReview             analysis feedback
```

ReflectionAgent runs first (provides critiques), editing agents run next (depend on critiques), Tournament runs after (rates new variants). This order is ideal for single-article without modification.

### D3: Stopping Conditions — Reuse Existing + Add Quality Threshold
`executeFullPipeline` already has three stopping conditions via `supervisor.shouldStop()`:
1. **Quality plateau** — ordinal improvement over window < threshold
2. **Budget exhausted** — available < $0.01
3. **Max iterations** — reached limit (default 3 for single)

Add one new check in the iteration loop (gated by `config.singleArticle`):
4. **Quality threshold** — all critique dimensions >= 8 after reflection

### D4: Config Overrides for Single-Article Mode
`--single` CLI flag maps to these config overrides:
```typescript
{
  singleArticle: true,
  expansion: { maxIterations: 0, minPool: 1 },  // skip EXPANSION entirely
  plateau: { window: 2, threshold: 0.02 },        // window=2 prevents premature stop (window=1 triggers plateau after 1 data point)
  maxIterations: 3,                               // fewer than full's 15
  budgetCapUsd: 1.00,                             // cheaper than full's $5.00
}
```

With `expansion.maxIterations: 0`, the supervisor's `detectPhase()` immediately transitions to COMPETITION (iteration 0 >= 0). EXPANSION is never entered.

### D5: Input Mode
`--single` flag on CLI. Works with `--file` (primary) or `--prompt` (generates seed article first via existing `generateSeedArticle()`, then improves it). `--single` is mutually exclusive with `--full`.

### D6: DB Migration for 'single' Pipeline Type
Both `content_evolution_runs` and `strategy_configs` tables have `pipeline_type` CHECK constraints allowing only `('full', 'minimal', 'batch')`. A new migration adds `'single'` to both. The TypeScript `PipelineType` union, `PIPELINE_TYPES` array, and `StrategyConfigRow.pipeline_type` all need updating.

### D7: Supervisor PhaseConfig Controls Agent Gating
GenerationAgent runs outside the `flagGatedAgents` array — it's gated only by `PhaseConfig.runGeneration` (pipeline.ts L832-834). Feature flags cannot disable it. The supervisor's `getPhaseConfig()` is the only control point. When `singleArticle`, COMPETITION phase returns:
- `runGeneration: false` (disables GenerationAgent)
- `runOutlineGeneration: false` (disables OutlineGenerationAgent)
- `runEvolution: false` (disables EvolutionAgent)
- All other flags stay `true` — agents self-gate via `canExecute()`

### D8: Feature Flags Interaction — No Changes Needed
The `flagGatedAgents` loop checks PhaseConfig FIRST (`if (!config[configKey]) continue`), then feature flags. Since supervisor returns `runGeneration: false` etc., the PhaseConfig gate short-circuits before feature flags are checked. The CLI doesn't pass feature flags to `executeFullPipeline` — this is fine because all agent control flows through supervisor PhaseConfig.

### D9: Checkpoint/Resume Support — Free
`executeFullPipeline` already checkpoints after every agent and supports resuming from checkpoints. With Option A, single-article runs get checkpoint/resume for free. If a run is interrupted, it resumes from the last checkpoint with full pool, ratings, critiques, and supervisor state preserved.

### D10: No Chicken-and-Egg Problem — Baseline Gets Default Rating
`insertBaselineVariant()` calls `state.addToPool()`, which calls `state.ratings.set(id, createRating())` — giving the baseline a default OpenSkill rating (mu=25, sigma=8.33). So `state.ratings.size > 0` is true from the start. On iteration 0 in single-article mode:
1. Reflection runs (needs `pool.length >= 1`) → populates `allCritiques`
2. IterativeEditingAgent runs (needs `ratings.size > 0` ✓ AND `allCritiques.length > 0` ✓) → creates edited variant, pool grows to 2
3. Tournament runs (needs `pool.length >= 2` ✓) → rates variants via pairwise comparison
No seeding mechanism needed.

### D11: Plateau Window Must Be >= 2
With `plateauWindow: 1`, `shouldStop()` triggers plateau after a single rated iteration (improvement = 0 from 1 data point < threshold). This would kill the pipeline after 1 iteration. Setting `plateauWindow: 2` ensures at least 2 iterations of rating data before plateau detection can trigger. Constructor guard `maxIterations < expansionMaxIterations + plateauWindow + 1` must also be relaxed when expansion is disabled, or `--iterations 1` would throw.

## Phased Execution Plan

### Phase 1: DB Migration + Type Updates
**Files modified:**
- `supabase/migrations/YYYYMMDDNNNNNN_add_single_pipeline_type.sql` — new migration
- `src/lib/evolution/types.ts` — update `PipelineType` union and `PIPELINE_TYPES` array
- `src/lib/evolution/core/strategyConfig.ts` — update `StrategyConfigRow.pipeline_type`

**Implementation:**
```sql
-- Migration: add 'single' to pipeline_type CHECK constraints on both tables
ALTER TABLE content_evolution_runs
  DROP CONSTRAINT IF EXISTS evolution_runs_pipeline_type_check;
ALTER TABLE content_evolution_runs
  ADD CONSTRAINT evolution_runs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch', 'single'));

ALTER TABLE strategy_configs
  DROP CONSTRAINT IF EXISTS strategy_configs_pipeline_type_check;
ALTER TABLE strategy_configs
  ADD CONSTRAINT strategy_configs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch', 'single'));
```

```typescript
// types.ts L301-303
export type PipelineType = 'full' | 'minimal' | 'batch' | 'single';
export const PIPELINE_TYPES = ['full', 'minimal', 'batch', 'single'] as const satisfies readonly PipelineType[];
```

```typescript
// strategyConfig.ts L31
pipeline_type: 'full' | 'minimal' | 'batch' | 'single' | null;
```

**Tests:** Existing type tests continue to pass; migration runs cleanly.

### Phase 2: Config + Supervisor Modifications
**Files modified:**
- `src/lib/evolution/types.ts` — add `singleArticle?: boolean` to `EvolutionRunConfig`
- `src/lib/evolution/core/supervisor.ts` — add `singleArticle` to `SupervisorConfig`, modify constructor and `getPhaseConfig()`
- `src/lib/evolution/core/pipeline.ts` — conditional `pipeline_type` in `executeFullPipeline`

**Implementation — types.ts:**
Add to `EvolutionRunConfig` interface (~L255):
```typescript
singleArticle?: boolean;
```

**Implementation — supervisor.ts:**

1. Add to `SupervisorConfig` interface (~L42-50):
```typescript
singleArticle: boolean;
```

2. Add to `supervisorConfigFromRunConfig()` mapping (~L52-62):
```typescript
singleArticle: cfg.singleArticle ?? false,
```

3. Relax constructor validation (~L79-88) — skip `expansionMinPool` AND `minViable` checks when expansion is disabled:
```typescript
// Before:
if (expansionMinPool < 5) {
  throw new Error(`expansionMinPool must be >= 5, got ${expansionMinPool}`);
}
// ... (L82-88: maxIterations > expansionMaxIterations, minViable check)

// After: guard both checks with expansionMaxIterations > 0
if (expansionMaxIterations > 0 && expansionMinPool < 5) {
  throw new Error(`expansionMinPool must be >= 5, got ${expansionMinPool}`);
}
// Also guard the minViable check:
if (expansionMaxIterations > 0) {
  if (maxIterations <= expansionMaxIterations) { ... }
  const minViable = expansionMaxIterations + plateauWindow + 1;
  if (maxIterations < minViable) { ... }
}
```
**Rationale:** The `minViable` formula (`expansionMaxIterations + plateauWindow + 1`) ensures enough iterations for expansion + plateau detection. When expansion is disabled (`maxIterations: 0`), this formula produces incorrect minimums (e.g., `0 + 2 + 1 = 3`), blocking `--iterations 1` or `--iterations 2`. Skipping when expansion disabled is safe.

4. Modify `getPhaseConfig()` COMPETITION return (~L179-199):
```typescript
// Before:
runGeneration: true,
runOutlineGeneration: true,
runEvolution: true,

// After:
runGeneration: !this.cfg.singleArticle,
runOutlineGeneration: !this.cfg.singleArticle,
runEvolution: !this.cfg.singleArticle,
```

**Implementation — pipeline.ts:**

Change `executeFullPipeline` pipeline_type (~L764):
```typescript
// Before:
pipeline_type: 'full',

// After:
pipeline_type: ctx.payload.config.singleArticle ? 'single' : 'full',
```

Add `qualityThresholdMet()` helper and check in the iteration loop (~L822-829):
```typescript
// After the existing shouldStop() check:
if (ctx.payload.config.singleArticle && qualityThresholdMet(ctx.state, 8)) {
  stopReason = 'quality_threshold';
  break;
}
```

```typescript
function qualityThresholdMet(state: PipelineState, threshold: number): boolean {
  if (!state.allCritiques || state.allCritiques.length === 0) return false;
  const topVariant = state.getTopByRating(1)[0];
  if (!topVariant) return false;
  const critique = [...state.allCritiques].reverse().find(c => c.variationId === topVariant.id);
  if (!critique) return false;
  return Object.values(critique.dimensionScores).every(s => s >= threshold);
}
```

**Tests:**
- `supervisor.test.ts` — add tests for `singleArticle` mode:
  - Constructor accepts `expansionMinPool < 5` when `expansionMaxIterations: 0`
  - `detectPhase()` returns COMPETITION immediately with `expansionMaxIterations: 0`
  - `getPhaseConfig()` returns `runGeneration: false`, `runOutlineGeneration: false`, `runEvolution: false` when `singleArticle`
  - All other COMPETITION flags remain `true`
  - Existing full-pipeline supervisor tests still pass (singleArticle defaults to false)
- `pipeline.test.ts` — add tests for single-article via `executeFullPipeline`:
  - Happy path: 3 iterations with `singleArticle: true` config, generation/evolution agents skipped
  - Pipeline type set to `'single'` in DB
  - Quality threshold stops loop when all dimensions >= 8
  - `qualityThresholdMet()` unit tests: null critiques, missing top variant, uses latest critique, partial threshold

### Phase 3: CLI Integration
**Files modified:**
- `scripts/run-evolution-local.ts` — add `--single` flag

**Implementation:**
- Add `single: boolean` to CLIArgs interface
- Add `--single` to parseArgs() via `getFlag('single')`
- Add help text
- Validate: `--single` mutually exclusive with `--full` (throw if both set)
- Config overrides when `args.single`:
  ```typescript
  if (args.single) {
    configOverrides.singleArticle = true;
    configOverrides.expansion = { maxIterations: 0, minPool: 1, minIterations: 0, diversityThreshold: 0 };
    configOverrides.plateau = { window: 2, threshold: 0.02 };
    configOverrides.maxIterations = args.iterations;  // default 3
    configOverrides.budgetCapUsd = args.budget;       // default 1.00
  }
  ```
- Pipeline branching — `--single` uses `executeFullPipeline` (NOT a new function):
  ```typescript
  if (args.single || args.full) {
    const result = await executeFullPipeline(runId, agents, ctx, logger, { startMs });
    stopReason = result.stopReason;
  } else {
    await executeMinimalPipeline(runId, [agents.generation, agents.calibration], ctx, logger, { startMs });
    stopReason = 'completed';
  }
  ```
- Default iterations for `--single`: 3 (vs 15 for full)
- Default budget for `--single`: $1.00 (vs $5.00 for full)

**Tests:**
- `--single` sets `args.single = true`
- `--single --full` throws validation error
- `--single` produces correct config overrides (singleArticle, expansion, plateau, maxIterations, budget)
- `--single` routes to `executeFullPipeline` (same as `--full`)

### Phase 4: Cron/Admin Visibility
**Files modified:**
- No changes needed to cron runner — `executeFullPipeline` handles single-article transparently via config
- `src/lib/services/evolutionActions.ts` — ensure 'single' is included in any pipeline_type filters

**Implementation:**
The cron runner (route.ts) already passes `pendingRun.config` as `configOverrides` to `preparePipelineRun()`, then calls `executeFullPipeline`. If a run is created with `config: { singleArticle: true, ... }`, the pipeline handles it automatically. No dispatch branching needed.

Admin dashboard already displays all runs — single-article runs show up with `pipeline_type: 'single'`, fewer variants, and iterations. No UI changes needed since queries aren't filtered by pipeline_type.

**Tests:** Integration test verifying DB records for single-article run have `pipeline_type: 'single'`

## Testing

### Unit Tests — Supervisor
- `src/lib/evolution/core/supervisor.test.ts` — add `describe('singleArticle mode')`:
  - Constructor: `expansionMinPool: 1` accepted when `expansionMaxIterations: 0` (minPool guard relaxed)
  - Constructor: `expansionMinPool: 3` still throws when `expansionMaxIterations: 5` (existing behavior preserved)
  - Constructor: `maxIterations: 1, expansionMaxIterations: 0` accepted (minViable guard skipped when expansion disabled)
  - Constructor: `maxIterations: 2, expansionMaxIterations: 3` still throws minViable (existing behavior preserved)
  - `detectPhase()`: returns `'COMPETITION'` on iteration 0 when `expansionMaxIterations: 0`
  - `getPhaseConfig()` with `singleArticle: true`:
    - `runGeneration: false`, `runOutlineGeneration: false`, `runEvolution: false`
    - `runReflection: true`, `runIterativeEditing: true`, `runTreeSearch: true`, `runSectionDecomposition: true`
    - `runCalibration: true`, `runDebate: true`, `runProximity: true`, `runMetaReview: true`
  - `getPhaseConfig()` with `singleArticle: false` (default): all COMPETITION flags `true` (existing behavior preserved)
  - `shouldStop()`: works with `plateauWindow: 2` and `maxIterations: 3`
  - `shouldStop()`: with `plateauWindow: 2`, does NOT plateau after 1 data point (needs 2)

### Unit Tests — Pipeline
- `src/lib/evolution/core/pipeline.test.ts` — add `describe('qualityThresholdMet')`:
  - Returns `false` when `allCritiques` is null or empty
  - Returns `false` when top variant has no critique
  - Returns `true` when all dimensions >= threshold
  - Uses latest critique (not first): push 2 critiques for same variant, second has higher scores -> uses second
  - Returns `false` when one dimension is below threshold
- `src/lib/evolution/core/pipeline.test.ts` — add `describe('single-article via executeFullPipeline')`:
  - Happy path: config with `singleArticle: true`, 3 iterations, generation/evolution agents NOT executed
  - Quality threshold: loop breaks with `'quality_threshold'` when all dimensions >= 8
  - Pipeline type: DB query returns `'single'`
  - Agent order: reflection -> iterativeEditing -> treeSearch -> sectionDecomposition -> tournament (generation/evolution skipped)
  - Budget stop: existing `shouldStop()` triggers `'budget_exhausted'`
  - Plateau stop: existing `shouldStop()` triggers plateau detection

### CLI Tests
- `scripts/run-evolution-local.test.ts` — add `describe('--single flag')`:
  - `--single` sets `args.single = true`
  - `--single --full` throws validation error (mutually exclusive)
  - `--single` default iterations = 3
  - `--single` default budget = $1.00
  - `--single` without `--file` or `--prompt` errors
  - `--single` config overrides: `singleArticle: true`, `expansion.maxIterations: 0`, `plateau.window: 2`

### Integration Tests
- `src/__tests__/integration/evolution-pipeline.integration.test.ts` — add `describe('single-article pipeline')`:
  - Setup: `createTestEvolutionRun()` with mock LLM, pass `singleArticle: true` in config
  - Call `executeFullPipeline` (same function as full mode)
  - Assert: pipeline completes without error
  - Assert: `state.getPoolSize() >= 1` (baseline at minimum)
  - Assert: DB query `SELECT pipeline_type FROM content_evolution_runs WHERE id = $runId` returns `'single'`
  - Assert: generation/evolution agents did NOT run (no variants with their strategies)
  - Teardown: `cleanupEvolutionData(runId)`

### Already Covered by Existing Tests (no new tests needed)
- `executeFullPipeline` iteration loop, checkpoint/resume — tested in pipeline.test.ts
- `runAgent()` error handling, OTel spans, checkpoint persistence — tested in pipeline.test.ts
- `finalizePipelineRun()` persistence (summary, variants, agent metrics) — tested in pipeline.test.ts
- Tournament with pool=2 — tested in tournament.test.ts
- Individual agent `canExecute()` gates — tested in agents/*.test.ts
- `insertBaselineVariant()` idempotency — tested in pipeline.test.ts

### DB Migration Rollback
Documented rollback procedure:
```sql
-- Rollback: restore original constraints
ALTER TABLE content_evolution_runs DROP CONSTRAINT IF EXISTS evolution_runs_pipeline_type_check;
ALTER TABLE content_evolution_runs
  ADD CONSTRAINT evolution_runs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch'));

ALTER TABLE strategy_configs DROP CONSTRAINT IF EXISTS strategy_configs_pipeline_type_check;
ALTER TABLE strategy_configs
  ADD CONSTRAINT strategy_configs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch'));
```

### Manual Verification
```bash
# Mock mode -- expect: 3 iterations, generation/evolution skipped, final pool has improved variants
npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --single --mock

# Real LLM mode -- expect: 2 iterations, real edits, cost < $1.00
npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --single --iterations 2
```

## Documentation Updates
The following docs need updates:
- `docs/feature_deep_dives/evolution_pipeline.md` — Add section documenting single-article pipeline mode: config flags, agent behavior, CLI usage, differences from population-based pipeline

## Summary of All Changes

| File | Change | Lines |
|------|--------|-------|
| `supabase/migrations/NNNN_add_single_pipeline_type.sql` | New migration: add 'single' to CHECK constraints | ~10 |
| `src/lib/evolution/types.ts` | Add 'single' to PipelineType, add `singleArticle?: boolean` to EvolutionRunConfig | ~3 |
| `src/lib/evolution/core/strategyConfig.ts` | Add 'single' to StrategyConfigRow.pipeline_type | ~1 |
| `src/lib/evolution/core/supervisor.ts` | Add singleArticle to SupervisorConfig + mapping, relax minPool guard, modify getPhaseConfig | ~6 |
| `src/lib/evolution/core/pipeline.ts` | Conditional pipeline_type, add qualityThresholdMet() + check in loop | ~12 |
| `scripts/run-evolution-local.ts` | --single flag, config overrides, pipeline branching | ~15 |
| **Total new/changed production code** | | **~47** |
| `src/lib/evolution/core/supervisor.test.ts` | singleArticle mode tests | ~60 |
| `src/lib/evolution/core/pipeline.test.ts` | qualityThresholdMet + single-article integration tests | ~80 |
| `scripts/run-evolution-local.test.ts` | --single flag tests | ~30 |
| `src/__tests__/integration/evolution-pipeline.integration.test.ts` | single-article integration test | ~30 |
| **Total test code** | | **~200** |
