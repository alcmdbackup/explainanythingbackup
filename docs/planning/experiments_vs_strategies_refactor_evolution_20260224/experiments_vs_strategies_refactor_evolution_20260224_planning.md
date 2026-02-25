# Experiments Vs Strategies Refactor Evolution Plan

## Background
Consolidate experiments as a higher-level orchestration layer over strategies, simplifying the data model. Currently, the evolution pipeline has two overlapping concepts — "experiments" (factorial design testing of configuration factors) and "strategies" (pipeline configuration configs). This project will merge experiment variations into the strategy system, making each experiment variation a strategy, and unifying the data models so strategies are the single source of truth for pipeline configuration.

## Requirements (from GH Issue #559)
Experiment variations should essentially be strategies. Make sure to unify the data models.

## Problem
The experiment and strategy systems share the same underlying config shape (`StrategyConfig`) but follow divergent paths to create evolution runs. Strategies go through `queueEvolutionRunAction()` which sets `strategy_config_id` upfront, while experiments generate configs via L8 factorial design and store them as inline JSONB in `evolution_runs.config` without a `strategy_config_id`. Strategies are only auto-created later during `finalizePipelineRun()` via `linkStrategyConfig()`. This means experiment runs don't appear in the strategy leaderboard until after completion, have opaque auto-generated names like "Strategy abc123", and have no traceability back to their source experiment. Additionally, the existing `linkStrategyConfig()` has a TOCTOU race condition that silently drops runs from strategy aggregates.

## Options Considered

### Option 1: Pre-register strategies at experiment run creation (CHOSEN)
- Each experiment variation calls `resolveOrCreateStrategy()` before inserting runs
- Sets `strategy_config_id` on runs at creation time
- Experiments become orchestration over strategies
- `_experimentRow` marker preserved alongside `strategy_config_id` for analysis
- **Pros**: Minimal changes, strategies visible immediately, fixes race condition
- **Cons**: Experiment-generated strategies may clutter strategy list (mitigated by `created_by` filter)

### Option 2: Merge experiments table into strategies
- Remove `evolution_experiments` entirely, model experiments as strategy groups
- **Rejected**: Experiments provide orchestration (multi-round, convergence, factor definitions) that strategies don't. Removing the table loses this.

### Option 3: Post-completion linking only (status quo + fixes)
- Keep current deferred linking, just fix the race condition and naming
- **Rejected**: Doesn't solve real-time visibility, traceability, or the "two parallel config systems" problem.

## Phased Execution Plan

### Phase 1: Database Migration + Type Updates
**Goal**: Allow `created_by = 'experiment'` and fix Welford bug.

#### 1a. New migration: extend `created_by` CHECK constraint
File: `supabase/migrations/20260225000001_strategy_experiment_created_by.sql`
```sql
BEGIN;
  ALTER TABLE evolution_strategy_configs
    DROP CONSTRAINT evolution_strategy_configs_created_by_check;
  ALTER TABLE evolution_strategy_configs
    ADD CONSTRAINT evolution_strategy_configs_created_by_check
    CHECK (created_by IN ('system', 'admin', 'experiment', 'batch'));
COMMIT;
```
Also add `'batch'` for future batch runner pre-linking.

#### 1b. Fix Welford mean initialization bug
File: `supabase/migrations/20260225000002_fix_welford_init.sql`

Fix line in `update_strategy_aggregates` RPC:
- Before: `v_new_mean := COALESCE(v_old.avg_final_elo, 0) + v_delta / v_new_count;`
- After: `v_new_mean := COALESCE(v_old.avg_final_elo, p_final_elo) + v_delta / v_new_count;`

Recreate the full RPC function with the fix.

#### 1c. Update TypeScript types
File: `evolution/src/lib/core/strategyConfig.ts` line 40
- Change: `created_by: 'system' | 'admin'` → `created_by: 'system' | 'admin' | 'experiment' | 'batch'`

**Verify**: Run `tsc`, `lint`, existing `strategyConfig.test.ts`

---

### Phase 2: `resolveOrCreateStrategy()` Helper
**Goal**: Atomic find-or-create strategy by config hash.

#### 2a. Create helper function
File: `evolution/src/lib/core/strategyConfig.ts` (add to existing file)

```typescript
export async function resolveOrCreateStrategy(
  supabase: SupabaseClient,
  config: StrategyConfig,
  options?: { createdBy?: 'system' | 'experiment' | 'batch'; name?: string }
): Promise<string> {
  const normalized = normalizeEnabledAgents(config);
  const configHash = hashStrategyConfig(normalized);
  const label = labelStrategyConfig(normalized);
  const name = options?.name ?? defaultStrategyName(normalized, configHash);
  const createdBy = options?.createdBy ?? 'system';

  const { data, error } = await supabase
    .from('evolution_strategy_configs')
    .upsert({
      config_hash: configHash,
      name,
      label,
      config: normalized,
      created_by: createdBy,
    }, { onConflict: 'config_hash', ignoreDuplicates: true })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Failed to resolve strategy: ${error?.message}`);
  return data.id;
}
```

Key details:
- Uses `.upsert()` with `ignoreDuplicates: true` — matches 12+ existing usages in codebase
- `ignoreDuplicates` means first writer wins (existing name/label preserved)
- Normalize `enabledAgents` before hashing (fix C11: `undefined` vs explicit list)
- Returns strategy UUID for FK linking

#### 2b. Add `enabledAgents` normalization
File: `evolution/src/lib/core/strategyConfig.ts`

Add helper to normalize `enabledAgents: undefined` → omit from config (or convert `[]` to `undefined`) before hashing. Ensures identical effective behavior produces identical hashes.

#### 2c. Write unit tests
File: `evolution/src/lib/core/strategyConfig.test.ts`
- Test: creates strategy on first call, returns existing ID on second call with same config
- Test: different configs produce different strategies
- Test: `enabledAgents` normalization (undefined vs [] vs explicit list)
- Test: `createdBy` propagated correctly
- Test: custom name used when provided

**Verify**: Run unit tests, tsc, lint

---

### Phase 3: Wire Experiments to Pre-Register Strategies
**Goal**: Experiment runs get `strategy_config_id` at creation time.

#### 3a. Update `startExperimentAction()`
File: `evolution/src/services/experimentActions.ts` (around lines 237-244)

Before inserting each run, call `resolveOrCreateStrategy()`:
```typescript
const strategyId = await resolveOrCreateStrategy(supabase, extractStrategyConfig(resolvedConfig), {
  createdBy: 'experiment',
  name: `${input.name} R1/#${run.row} (${labelStrategyConfig(stratConfig)})`,
});

runInserts.push({
  ...existingFields,
  strategy_config_id: strategyId,  // NEW
});
```

Note: L8 design generates 8 rows. Each row may share a config with an existing strategy (dedup via hash). Multiple prompts per row share the same strategy.

#### 3b. Update `handlePendingNextRound()` in experiment-driver
File: `src/app/api/cron/experiment-driver/route.ts` (around lines 459-467)

Same pattern as 3a for Round 2+ full-factorial runs:
```typescript
const strategyId = await resolveOrCreateStrategy(supabase, extractStrategyConfig(resolvedConfig), {
  createdBy: 'experiment',
  name: `${exp.name} R${round.round_number}/#${run.row} (${label})`,
});
```

#### 3c. Update `writeTerminalState()`
File: `src/app/api/cron/experiment-driver/route.ts` (around line 543)

Store `bestStrategyId` (FK) alongside raw `bestConfig` in `results_summary`:
- Find best run → get its `strategy_config_id` → include in results_summary JSONB
- Keep `bestConfig` for backward compat, add `bestStrategyId`

#### 3d. Update experiment-driver tests
File: `src/app/api/cron/experiment-driver/route.test.ts`

Changes needed:
1. Add `'upsert'` to `createChain()` method list (line ~132)
2. Add `evolution_strategy_configs` dispatch in `mockFrom` (returns `{ id: 'strategy-1' }`)
3. Update assertions for runs to verify `strategy_config_id` is set
4. Update `writeTerminalState` tests to verify `bestStrategyId` in results_summary

**Verify**: Run experiment-driver tests, experimentActions tests, integration test, tsc, lint, build

---

### Phase 4: Fix `linkStrategyConfig()` Race Condition
**Goal**: Fix the existing TOCTOU bug for ALL run types.

File: `evolution/src/lib/core/metricsWriter.ts` (lines 63-88)

Refactor `linkStrategyConfig()` to use `resolveOrCreateStrategy()`:
```typescript
// Replace SELECT-then-INSERT with:
const stratConfig = extractStrategyConfig(ctx.payload.config, ctx.payload.config.budgetCaps ?? {});
const strategyId = await resolveOrCreateStrategy(supabase, stratConfig);

await supabase.from('evolution_runs')
  .update({ strategy_config_id: strategyId })
  .eq('id', runId);
```

The early-return path (lines 55-58) when `strategy_config_id` is already set remains unchanged.

**Verify**: Run metricsWriter tests, tsc, lint

---

### Phase 5: Batch Runner Pre-Linking
**Goal**: Batch runs also get `strategy_config_id` at creation time.

File: `evolution/scripts/run-batch.ts` (around lines 131-141)

Before inserting each run, call `resolveOrCreateStrategy()`:
```typescript
const strategyId = await resolveOrCreateStrategy(supabase, extractStrategyConfig(runConfig), {
  createdBy: 'batch',
});
// Add strategy_config_id to insert row
```

**Verify**: Run batchRunSchema tests, tsc, lint

---

### Phase 6: UI Improvements (Prevent Strategy List Noise)
**Goal**: Experiment-generated strategies don't clutter the strategies page.

#### 6a. Add `created_by` filter to strategies page
File: `src/app/admin/quality/strategies/page.tsx`

Replace binary `predefinedOnly` checkbox with a `created_by` multi-select filter:
- Options: All, Admin, Experiment, System, Batch
- Default: Admin (shows only predefined strategies)
- When "All" selected, shows everything

This prevents the noise problem (C6) where 24+ experiment strategies flood the list.

#### 6b. Update `getStrategiesAction()` to accept `createdBy` filter
File: `evolution/src/services/strategyRegistryActions.ts`

Add optional `createdBy` parameter to the query filter.

**Verify**: Run strategies page tests, strategyRegistryActions tests, tsc, lint, build

---

### Phase 7: Backfill Existing Experiment Runs
**Goal**: Retroactively link existing experiment runs to strategies.

File: New `evolution/scripts/backfill-experiment-strategy-ids.ts`

Follow the pattern from `backfill-prompt-ids.ts:backfillStrategyConfigIds()`:
1. SELECT runs WHERE `source LIKE 'experiment:%' AND strategy_config_id IS NULL`
2. For each: extract config → hash → `resolveOrCreateStrategy()` with `createdBy: 'experiment'`
3. UPDATE run with `strategy_config_id`
4. Report `{ linked, created, unlinked }` counts

Include unit test following `backfill-prompt-ids.test.ts` pattern.

**Verify**: Run backfill test, tsc, lint

---

### Phase 8: Documentation Updates
**Goal**: Update docs to reflect unified model.

Files to update:
- `evolution/docs/evolution/strategy_experiments.md` — Major rewrite: experiments orchestrate strategies, pre-linking flow
- `evolution/docs/evolution/data_model.md` — Update "Prompt + Strategy = Run" to include experiment path
- `evolution/docs/evolution/architecture.md` — Update pipeline orchestration references
- `evolution/docs/evolution/cost_optimization.md` — Update batch experiment and strategy analysis sections

## Testing

### Unit Tests (New/Modified)
| Test File | Changes |
|-----------|---------|
| `strategyConfig.test.ts` | Add `resolveOrCreateStrategy()` tests, `enabledAgents` normalization |
| `experiment-driver/route.test.ts` | Add `evolution_strategy_configs` mocks, verify `strategy_config_id` on runs |
| `experimentActions.test.ts` | Verify `strategy_config_id` set on created runs (if test exists) |
| `strategyRegistryActions.test.ts` | Add `createdBy: 'experiment'` filter tests |
| `backfill-experiment-strategy-ids.test.ts` | New test file following backfill-prompt-ids pattern |

### Integration Tests
| Test File | Changes |
|-----------|---------|
| `strategy-experiment.integration.test.ts` | Verify round-trip: L8 design → strategy creation → run with `strategy_config_id` |

### Manual Verification (on staging)
1. Start an experiment → verify strategies appear immediately in leaderboard
2. Verify experiment analysis still works (uses `_experimentRow`, unaffected)
3. Verify strategies page filtering by `created_by`
4. Verify completed experiment stores `bestStrategyId` in results_summary
5. Verify batch runs also pre-link strategies
6. Run backfill script on staging data

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/strategy_experiments.md` - Core doc for experiment system; will need major rewrite to reflect unified model
- `evolution/docs/evolution/data_model.md` - Data model primitives will change as experiment variations become strategies
- `evolution/docs/evolution/architecture.md` - Pipeline architecture references to experiment system
- `evolution/docs/evolution/cost_optimization.md` - Batch experiment and strategy analysis sections may need updates

## Risk Assessment

### Low Risk
- Phase 1-2: Type changes and helper function — no runtime behavior change
- Phase 4: `linkStrategyConfig()` fix — improves existing behavior, no new paths
- Phase 7: Backfill — idempotent, read-heavy, can be run incrementally

### Medium Risk
- Phase 3: Experiment pre-linking — core behavior change, well-tested paths
- Phase 5: Batch runner — inline execution, less test coverage
- Phase 6: UI changes — user-facing, needs visual verification

### Mitigations
- Each phase is independently deployable and testable
- `_experimentRow` preserved throughout — analysis engine unaffected
- Pre-linked `strategy_config_id` + existing `linkStrategyConfig()` early-return = no double-processing
- Killed/failed runs with pre-set `strategy_config_id` are acceptable (strategy exists, aggregates only update on completion)
