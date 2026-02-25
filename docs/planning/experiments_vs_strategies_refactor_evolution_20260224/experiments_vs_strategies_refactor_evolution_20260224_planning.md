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

**NOTE**: The constraint was originally created as `strategy_configs_created_by_check` in migration `20260207000007_strategy_lifecycle.sql`, BEFORE the table was renamed to `evolution_strategy_configs` in `20260221000002`. PostgreSQL does NOT auto-rename constraints on table rename. Must use the original constraint name.

```sql
-- Extend created_by to support experiment and batch strategy creation.
-- Rollback: DROP CONSTRAINT strategy_configs_created_by_check, re-ADD with ('system', 'admin') only.
BEGIN;
  ALTER TABLE evolution_strategy_configs
    DROP CONSTRAINT strategy_configs_created_by_check;
  ALTER TABLE evolution_strategy_configs
    ADD CONSTRAINT strategy_configs_created_by_check
    CHECK (created_by IN ('system', 'admin', 'experiment', 'batch'));
COMMIT;
```
Also add `'batch'` for future batch runner pre-linking.

#### 1b. Fix Welford mean initialization bug
File: `supabase/migrations/20260225000002_fix_welford_init.sql`

Fix line in `update_strategy_aggregates` RPC:
- Before: `v_new_mean := COALESCE(v_old.avg_final_elo, 0) + v_delta / v_new_count;`
- After: `v_new_mean := COALESCE(v_old.avg_final_elo, p_final_elo) + v_delta / v_new_count;`

Recreate the full RPC function with the fix. Include rollback comment at top per CI workflow convention.

#### 1c. Update TypeScript types
File: `evolution/src/lib/core/strategyConfig.ts` line 40
- Change: `created_by: 'system' | 'admin'` → `created_by: 'system' | 'admin' | 'experiment' | 'batch'`

**Verify**: Run `tsc`, `lint`, existing `strategyConfig.test.ts`

---

### Phase 2: `resolveOrCreateStrategy()` Helper
**Goal**: Atomic find-or-create strategy by config hash.

#### 2a. Create helper function
File: `evolution/src/services/strategyResolution.ts` (NEW service file)

**Why a new service file**: `strategyConfig.ts` is a pure utility (only imports `crypto` and `zod`, zero DB deps). Adding Supabase I/O there would break its abstraction level. A service-level file is the right home for DB-touching strategy resolution, consistent with `strategyRegistryActions.ts` and `evolutionActions.ts`.

**NOTE on Supabase `.upsert()` with `ignoreDuplicates: true`**: When a conflict occurs, `ON CONFLICT DO NOTHING` returns no row, so `.select('id').single()` will fail with PGRST116. The pattern must be: upsert (attempt insert, silently skip on conflict) → fallback SELECT by config_hash.

**NOTE on type distinction**: `extractStrategyConfig()` expects a run config shape (with `maxIterations`) and normalizes it into a `StrategyConfig` (with `iterations`). Callers that already have a `StrategyConfig` (e.g., `resolveStrategyConfigAction` from the admin UI) must NOT go through `extractStrategyConfig()` again — it would misread `iterations` as missing and default to 15. The function provides two signatures via overloads: one for raw run configs (calls `extractStrategyConfig`), one for pre-extracted `StrategyConfig` (skips extraction).

```typescript
// Atomic find-or-create strategy by config hash.
// Overload 1: From raw run config (experiment/batch callers)
export async function resolveOrCreateStrategy(
  supabase: SupabaseClient,
  runConfig: EvolutionRunConfig,
  defaultBudgetCaps: Record<string, number>,
  options?: { createdBy?: 'system' | 'experiment' | 'batch'; name?: string }
): Promise<string>;
// Overload 2: From pre-extracted StrategyConfig (admin/direct callers)
export async function resolveOrCreateStrategy(
  supabase: SupabaseClient,
  strategyConfig: StrategyConfig,
  options?: { createdBy?: 'system' | 'admin' | 'experiment' | 'batch'; name?: string }
): Promise<string>;
// Implementation:
export async function resolveOrCreateStrategy(
  supabase: SupabaseClient,
  config: EvolutionRunConfig | StrategyConfig,
  budgetCapsOrOptions?: Record<string, number> | { createdBy?: string; name?: string },
  maybeOptions?: { createdBy?: string; name?: string }
): Promise<string> {
  // Detect which overload via type discriminant:
  // - EvolutionRunConfig has `maxIterations` (overload 1)
  // - StrategyConfig has `iterations` but NOT `maxIterations` (overload 2)
  let stratConfig: StrategyConfig;
  let options: { createdBy?: string; name?: string } | undefined;
  const isRunConfig = 'maxIterations' in config;
  if (isRunConfig) {
    // Overload 1: config is a raw run config, extract it
    stratConfig = extractStrategyConfig(config as EvolutionRunConfig, (budgetCapsOrOptions as Record<string, number>) ?? {});
    options = maybeOptions;
  } else {
    // Overload 2: config is already a StrategyConfig
    stratConfig = config as StrategyConfig;
    options = budgetCapsOrOptions as { createdBy?: string; name?: string } | undefined;
  }

  const normalized = normalizeEnabledAgents(stratConfig);
  const configHash = hashStrategyConfig(normalized);
  const label = labelStrategyConfig(normalized);
  const name = (options?.name ?? defaultStrategyName(normalized, configHash)).slice(0, 200);
  const createdBy = options?.createdBy ?? 'system';

  // Step 1: Attempt insert (skip silently on conflict)
  const { error: upsertErr } = await supabase
    .from('evolution_strategy_configs')
    .upsert({
      config_hash: configHash,
      name,
      label,
      config: normalized,
      created_by: createdBy,
    }, { onConflict: 'config_hash', ignoreDuplicates: true });

  if (upsertErr) throw new Error(`Strategy upsert failed: ${upsertErr.message}`);

  // Step 2: Always SELECT to get the ID (handles both new + existing)
  const { data, error } = await supabase
    .from('evolution_strategy_configs')
    .select('id')
    .eq('config_hash', configHash)
    .single();

  if (error || !data) throw new Error(`Failed to resolve strategy: ${error?.message}`);
  return data.id;
}
```

Key details:
- Two overloads: raw run config (for experiment/batch callers) vs pre-extracted StrategyConfig (for admin/direct callers)
- Raw run config path calls `extractStrategyConfig()` (maps `maxIterations` → `iterations`)
- Pre-extracted StrategyConfig path skips extraction (avoids the `maxIterations` vs `iterations` mismatch)
- Two-step pattern: upsert (attempt insert, no-op on conflict) → SELECT by hash
- Handles race condition: if two concurrent calls insert same hash, one no-ops, both SELECT the same row
- `ignoreDuplicates: true` means first writer wins (existing name/label preserved)
- Checks upsert error (catches non-conflict failures like CHECK constraint violations)
- Strategy name truncated to 200 chars to prevent excessively long names from user input
- Normalize `enabledAgents` before hashing (fix C11: `undefined` vs explicit list)

#### 2b. Reconcile with existing `resolveStrategyConfigAction()`
File: `evolution/src/services/eloBudgetActions.ts` (lines 201-238)

An existing `resolveStrategyConfigAction()` in `eloBudgetActions.ts` does SELECT-then-INSERT with the same TOCTOU race. This function must be refactored to delegate to the new `resolveOrCreateStrategy()` helper to eliminate the duplicate code path and fix the race condition there too.

```typescript
// Refactored to delegate (uses overload 2 — pre-extracted StrategyConfig):
export async function resolveStrategyConfigAction(
  config: StrategyConfig,
  customName?: string
): Promise<ActionResult<{ id: string; isNew: boolean }>> {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    // Check if exists first (to determine isNew)
    const configHash = hashStrategyConfig(config);
    const { data: existing } = await supabase
      .from('evolution_strategy_configs')
      .select('id')
      .eq('config_hash', configHash)
      .single();
    // Overload 2: pass StrategyConfig directly (no extractStrategyConfig needed)
    const id = await resolveOrCreateStrategy(supabase, config, {
      createdBy: 'admin',
      name: customName,
    });
    return { success: true, data: { id, isNew: !existing }, error: null };
  } catch (err) {
    return { success: false, data: null, error: String(err) };
  }
}
```

#### 2c. Add `enabledAgents` normalization
File: `evolution/src/lib/core/strategyConfig.ts`

Add helper to normalize `enabledAgents`:
- `undefined` → omit (current default behavior, means "all agents")
- `[]` (empty array) → treat as `undefined` (same effective behavior)
- Non-empty array → sort and keep

This ensures identical effective behavior produces identical hashes.

#### 2d. Write unit tests
File: `evolution/src/services/strategyResolution.test.ts` (NEW)

Tests require Supabase mocking (async DB calls). Use the Proxy-based chain pattern from `strategyRegistryActions.test.ts`:
- Test: creates strategy on first call (upsert inserts), returns ID from SELECT
- Test: returns existing ID on second call with same config (upsert no-ops, SELECT returns existing)
- Test: different configs produce different strategies
- Test: `enabledAgents` normalization (undefined vs [] vs explicit list)
- Test: `createdBy` propagated correctly
- Test: custom name used when provided
- Test: concurrent calls with same hash both succeed (upsert + SELECT pattern)

Also add `enabledAgents` normalization tests to `strategyConfig.test.ts` (pure sync tests for the normalization helper itself).

**Verify**: Run unit tests, tsc, lint

---

### Phase 3: Wire Experiments to Pre-Register Strategies
**Goal**: Experiment runs get `strategy_config_id` at creation time.

#### 3a. Update `startExperimentAction()`
File: `evolution/src/services/experimentActions.ts` (around lines 237-244)

Before inserting each run, call `resolveOrCreateStrategy()` (overload 1 — raw run config):
```typescript
// Overload 1: pass raw run config + budgetCaps → extractStrategyConfig called internally
const strategyId = await resolveOrCreateStrategy(supabase, resolvedConfig, resolvedConfig.budgetCaps ?? {}, {
  createdBy: 'experiment',
  name: `${input.name} R1/#${run.row}`,
});

runInserts.push({
  ...existingFields,
  strategy_config_id: strategyId,  // NEW
});
```

Note: L8 design generates 8 rows. Each row may share a config with an existing strategy (dedup via hash). Multiple prompts per row share the same strategy. Strategy name auto-truncated to 200 chars inside the helper.

#### 3b. Update `handlePendingNextRound()` in experiment-driver
File: `src/app/api/cron/experiment-driver/route.ts` (around lines 459-467)

Same pattern as 3a for Round 2+ full-factorial runs:
```typescript
const strategyId = await resolveOrCreateStrategy(supabase, resolvedConfig, resolvedConfig.budgetCaps ?? {}, {
  createdBy: 'experiment',
  name: `${exp.name} R${round.round_number}/#${run.row}`,
});
```

Also update the `.select()` call at line ~527-531 to include `strategy_config_id` for `writeTerminalState` to access.

#### 3c. Update `writeTerminalState()`
File: `src/app/api/cron/experiment-driver/route.ts` (around line 543)

Store `bestStrategyId` (FK) alongside raw `bestConfig` in `results_summary`:
- Find best run → get its `strategy_config_id` from the query (added in 3b) → include in results_summary JSONB
- Keep `bestConfig` for backward compat, add `bestStrategyId`

#### 3d. Update experiment-driver tests
File: `src/app/api/cron/experiment-driver/route.test.ts`

Changes needed:
1. Add `'upsert'` to `createChain()` method list (line ~132)
2. Add `evolution_strategy_configs` dispatch in `mockFrom` (returns `{ id: 'strategy-1' }`)
3. Update assertions for runs to verify `strategy_config_id` is set
4. Update `writeTerminalState` tests to verify `bestStrategyId` in results_summary

#### 3e. Update experimentActions test mocks
File: `evolution/src/services/experimentActions.test.ts` (if exists, or relevant test file)

The mock chain builder must also support `upsert()` calls. Add `'upsert'` to the method list in the chain builder. Add `evolution_strategy_configs` to the mock dispatch table with a result queue for the upsert + follow-up SELECT pattern.

**Verify**: Run experiment-driver tests, experimentActions tests, tsc, lint, build

---

### Phase 4: Fix `linkStrategyConfig()` Race Condition
**Goal**: Fix the existing TOCTOU bug for ALL run types.

File: `evolution/src/lib/core/metricsWriter.ts` (lines 63-88)

Refactor `linkStrategyConfig()` to use `resolveOrCreateStrategy()`:
```typescript
// Replace SELECT-then-INSERT with (overload 1 — raw run config):
const strategyId = await resolveOrCreateStrategy(supabase, ctx.payload.config, ctx.payload.config.budgetCaps ?? {});

await supabase.from('evolution_runs')
  .update({ strategy_config_id: strategyId })
  .eq('id', runId);
```

The early-return path (lines 55-58) when `strategy_config_id` is already set remains unchanged.

#### 4a. Write `linkStrategyConfig()` tests
File: `evolution/src/lib/core/metricsWriter.test.ts` (NEW or extend existing)

**CRITICAL**: `metricsWriter.test.ts` currently has ZERO tests for `linkStrategyConfig()`. Must create tests:
- Test: run without `strategy_config_id` → calls `resolveOrCreateStrategy` → links run → calls `updateStrategyAggregates`
- Test: run with pre-set `strategy_config_id` → hits early-return → calls `updateStrategyAggregates` only
- Test: `resolveOrCreateStrategy` failure → logs warning, does not throw (preserves non-fatal behavior)
- Test: verify `extractStrategyConfig` called with correct `budgetCaps` argument

**Verify**: Run metricsWriter tests, tsc, lint

---

### Phase 5: Batch Runner Pre-Linking
**Goal**: Batch runs also get `strategy_config_id` at creation time.

File: `evolution/scripts/run-batch.ts` (around lines 131-141)

Before inserting each run, call `resolveOrCreateStrategy()`:
```typescript
const strategyId = await resolveOrCreateStrategy(supabase, runConfig, runConfig.budgetCaps ?? {}, {
  createdBy: 'batch',
});
// Add strategy_config_id to insert row
```

**Verify**: tsc, lint. Note: `batchRunSchema.test.ts` tests Zod schema expansion, not the `run-batch.ts` script itself. Manual verification needed for batch runner.

---

### Phase 5b: CLI Experiment Script (Out-of-Scope, Documented)

File: `scripts/run-strategy-experiment.ts`

This CLI script uses `execFileSync` to run local experiments via `run-evolution-local.ts`, storing state in a local JSON file. It does NOT insert runs into the DB directly — runs are executed inline. Strategy linking happens via `linkStrategyConfig()` during pipeline finalization, which will be fixed by Phase 4. **No changes needed in this project** — the script uses the normal pipeline path, and Phase 4's fix ensures strategies are correctly resolved.

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

**NOTE**: The current `getStrategiesAction()` filters on `isPredefined` (boolean), not `created_by`. The backend filter must change to use `created_by` column instead. The existing `is_predefined` boolean remains in the DB but is no longer the primary filter mechanism. Callers of `getStrategiesAction()` (including the explorer page at `explorer/page.tsx:429`) must be checked — the explorer uses `{ status: 'active' }` filter only, so it's unaffected.

#### 6b. Update `getStrategiesAction()` to accept `createdBy` filter
File: `evolution/src/services/strategyRegistryActions.ts`

Add optional `createdBy` parameter to the query filter. Keep backward compat with `isPredefined` for any other callers.

**Verify**: Run strategies page tests, strategyRegistryActions tests, tsc, lint, build

---

### Phase 7: Backfill Existing Experiment Runs
**Goal**: Retroactively link existing experiment runs to strategies.

File: Extend `evolution/scripts/backfill-prompt-ids.ts` (add new function)

**Why extend existing file**: The CI workflow (`.github/workflows/supabase-migrations.yml`) only triggers on changes to `supabase/migrations/**` and `evolution/scripts/backfill-prompt-ids.ts`. Adding a new script requires updating the workflow paths trigger. Simpler to add a `backfillExperimentStrategyIds()` function to the existing backfill script, which is already in the CI pipeline and follows the same pattern.

Follow the pattern from `backfillStrategyConfigIds()` (lines 202-295):
1. SELECT runs WHERE `source LIKE 'experiment:%' AND strategy_config_id IS NULL`
2. For each: extract config → `resolveOrCreateStrategy()` with `createdBy: 'experiment'`
3. UPDATE run with `strategy_config_id`
4. Report `{ linked, created, unlinked }` counts

Add tests to `evolution/scripts/backfill-prompt-ids.test.ts` following existing patterns in the file.

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
| `strategyResolution.test.ts` | **NEW**: `resolveOrCreateStrategy()` tests with Supabase mocking (Proxy chain pattern) |
| `strategyConfig.test.ts` | Add `enabledAgents` normalization tests (sync, pure utility) |
| `metricsWriter.test.ts` | **NEW tests for `linkStrategyConfig()`**: early-return path, resolve+link path, error handling |
| `experiment-driver/route.test.ts` | Add `upsert` to chain methods, `evolution_strategy_configs` mock dispatch, `strategy_config_id` assertions |
| `experimentActions.test.ts` | Add `upsert` to chain methods, `evolution_strategy_configs` mock dispatch, verify `strategy_config_id` on runs |
| `strategyRegistryActions.test.ts` | Add `createdBy` filter tests |
| `eloBudgetActions.test.ts` | Update `resolveStrategyConfigAction` tests to verify delegation to new helper |
| `backfill-prompt-ids.test.ts` | Add `backfillExperimentStrategyIds()` test cases |

### Integration Tests
| Test File | Changes |
|-----------|---------|
| `strategy-experiment.integration.test.ts` | This test has NO DB layer — it only tests L8 design generation + analysis (pure logic). The round-trip of L8 → strategy creation → run with `strategy_config_id` requires real Supabase or a mock DB. Since this is a unit-level concern (Supabase mock), the coverage is handled by the unit tests in `strategyResolution.test.ts` and `experimentActions.test.ts`. No changes needed to this integration test. |

### Manual Verification (on staging)
1. Start an experiment → verify strategies appear immediately in leaderboard
2. Verify experiment analysis still works (uses `_experimentRow`, unaffected)
3. Verify strategies page filtering by `created_by`
4. Verify completed experiment stores `bestStrategyId` in results_summary
5. Verify batch runs also pre-link strategies
6. Run backfill script on staging data
7. Verify `resolveStrategyConfigAction` (from optimization dashboard) still works after delegation change

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
- Killed/failed runs with pre-set `strategy_config_id` are acceptable (strategy exists, aggregates only update on completion — `run_count` accurately reflects completed runs only)
- Strategy name length: use short format `{expName} R{round}/#{row}` (no label in name), with `label` stored separately on the strategy row. Avoids exceeding reasonable lengths.

## Rollback Plan
- **Phase 1 migrations**: Rollback SQL included as comments in each migration file. Re-run DROP + ADD with original values.
- **Phase 2-5 code changes**: Revert the commits. Pre-linked `strategy_config_id` is nullable, so reverting to post-completion linking is backward-compatible. `linkStrategyConfig()` early-return path handles both pre-linked and unlinked runs.
- **Phase 6 UI changes**: Revert the commit. `is_predefined` filter still works as before.
- **Phase 7 backfill**: Idempotent — no rollback needed. Backfilled `strategy_config_id` values are correct and will be used by the pre-linked path if re-enabled.
