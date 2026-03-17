# Clean Up Pipeline Modes Plan

## Background
Eliminate the 'minimal' and 'batch' pipeline types from the PipelineType union. 'batch' is only a metadata label never set at execution time, and 'minimal' is only used for local CLI default and integration tests — not in production. Remove these types and any dependent code that isn't useful elsewhere.

## Requirements (from GH Issue #NNN)
Eliminate these types and any code dependent on it that isn't useful elsewhere.

## Problem
The `PipelineType` union (`'full' | 'minimal' | 'batch' | 'single'`) contains two dead values. `'batch'` was never written to the database by any code path — it was a placeholder from early design that was never implemented. `'minimal'` is only used by the local CLI runner default and integration tests, never in production. Both add unnecessary complexity to the type system, DB constraints, UI filters, and strategy presets. Removing them simplifies the codebase and eliminates confusion about what pipeline modes actually exist.

## Options Considered

### Option A: Remove types + delete executeMinimalPipeline entirely
- Remove 'minimal' and 'batch' from PipelineType
- Delete executeMinimalPipeline function
- CLI default switches to executeFullPipeline with maxIterations:1, enabledAgents:[]
- Rewrite all integration tests to use executeFullPipeline
- **Pros**: Cleanest result, single code path
- **Cons**: Full pipeline has supervisor/proximity overhead for simple runs; integration tests become more complex; CLI behavior changes (more agents run)

### Option B: Remove types but keep executeMinimalPipeline as internal utility ← CHOSEN
- Remove 'minimal' and 'batch' from PipelineType
- Keep executeMinimalPipeline as an internal function (not exported from public API barrel)
- It writes `pipeline_type: 'full'` to DB instead of `'minimal'`
- CLI and integration tests continue using it unchanged
- **Pros**: Minimal disruption to tests/CLI; clean public API; simple DB migration
- **Cons**: Two pipeline functions still exist internally

### Option C: Rename to test-only wrapper around executeFullPipeline
- Create lightweight wrapper that configures executeFullPipeline for minimal behavior
- **Pros**: Single execution path
- **Cons**: executeFullPipeline runs proximity agent, has supervisor overhead; wrapper adds complexity; tests would need updating for different behavior

## Important: Files NOT to modify
The following files reference 'batch' in the context of `created_by: 'batch'` (strategy origin tracking), which is an independent column and must NOT be changed:
- `evolution/src/services/strategyRegistryActions.test.ts` (lines 156, 161 — created_by filtering)
- `evolution/src/services/strategyResolution.test.ts` (lines 138, 179 — createdBy param)
- `src/__tests__/integration/strategy-resolution.integration.test.ts` (line 121 — createdBy: 'batch')
- `src/app/admin/evolution/strategies/page.tsx` — CreatedByFilter type includes 'batch' for Origin dropdown (independent from pipeline_type)

## Phased Execution Plan

### Phase 1: Type system + DB migration + test imports
**Goal**: Remove 'minimal' and 'batch' from PipelineType, update DB constraints, fix integration test imports so the build stays green.

1. **Update type definition** (`evolution/src/lib/types.ts:636-638`):
   ```typescript
   export type PipelineType = 'full' | 'single';
   export const PIPELINE_TYPES = ['full', 'single'] as const satisfies readonly PipelineType[];
   ```

2. **Update StrategyConfigRow** (`evolution/src/lib/core/strategyConfig.ts:39`):
   ```typescript
   pipeline_type: 'full' | 'single' | null;
   ```

3. **Create DB migration** (`supabase/migrations/20260314000001_remove_minimal_batch_pipeline_types.sql`):
   ```sql
   -- Remove 'minimal' and 'batch' pipeline types. These were never used in production:
   -- 'batch' was never written by any code path, 'minimal' was only for local CLI/tests.
   -- NOTE: created_by: 'batch' on evolution_strategy_configs is unrelated and is NOT affected.

   BEGIN;

   -- Update existing rows (if any) to 'full'
   UPDATE evolution_runs SET pipeline_type = 'full' WHERE pipeline_type IN ('minimal', 'batch');
   UPDATE evolution_strategy_configs SET pipeline_type = 'full' WHERE pipeline_type IN ('minimal', 'batch');

   -- Drop and re-add CHECK constraints
   -- Constraint names match existing naming from migrations 20260207000004 and 20260207000003
   ALTER TABLE evolution_runs
     DROP CONSTRAINT IF EXISTS evolution_runs_pipeline_type_check;
   ALTER TABLE evolution_runs
     ADD CONSTRAINT evolution_runs_pipeline_type_check
     CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'single'));

   ALTER TABLE evolution_strategy_configs
     DROP CONSTRAINT IF EXISTS strategy_configs_pipeline_type_check;
   ALTER TABLE evolution_strategy_configs
     ADD CONSTRAINT strategy_configs_pipeline_type_check
     CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'single'));

   COMMIT;
   ```

   **Rollback migration** (`supabase/migrations/20260314000001_remove_minimal_batch_pipeline_types_rollback.sql` — kept in docs/planning, not applied):
   ```sql
   -- Rollback: restore 'minimal' and 'batch' to CHECK constraints
   BEGIN;
   ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS evolution_runs_pipeline_type_check;
   ALTER TABLE evolution_runs ADD CONSTRAINT evolution_runs_pipeline_type_check
     CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch', 'single'));
   ALTER TABLE evolution_strategy_configs DROP CONSTRAINT IF EXISTS strategy_configs_pipeline_type_check;
   ALTER TABLE evolution_strategy_configs ADD CONSTRAINT strategy_configs_pipeline_type_check
     CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch', 'single'));
   COMMIT;
   ```

4. **Update executeMinimalPipeline** (`evolution/src/lib/core/pipeline.ts:215`):
   - Change `pipeline_type: 'minimal'` → `pipeline_type: 'full'`

5. **Remove from barrel export** (`evolution/src/lib/index.ts:69`):
   - Remove `executeMinimalPipeline` from barrel export

6. **Update integration test imports** to use direct path instead of barrel:
   - `src/__tests__/integration/evolution-pipeline.integration.test.ts:34` — extract `executeMinimalPipeline` into a separate import from `@evolution/lib/core/pipeline`. Keep other imports (`PipelineStateImpl`, `GenerationAgent`, etc.) on the existing `@evolution/lib` import.
   - `src/__tests__/integration/evolution-outline.integration.test.ts:35` — same pattern: extract `executeMinimalPipeline` to separate import from `@evolution/lib/core/pipeline`

7. **Update unit tests referencing removed types**:
   - `arena.test.ts:282` — update test description from 'sets pipeline_type = minimal' to 'sets pipeline_type = full'
   - `arena.test.ts:292` — assert `pipeline_type: 'full'` instead of `'minimal'`
   - `strategyConfig.test.ts:342` — update array to `['full', 'single', null]`, update expected length to 3
   - `strategyConfig.test.ts:384` — update array to `['full', 'single']`, update expected length to 2
   - `strategyFormUtils.test.ts:61` — change `pipeline_type: 'minimal'` → `pipeline_type: 'full'`

**Verify**: `npm run tsc`, `npm run lint`, `npm test` (includes unit + integration tests; confirms integration test import path changes compile and pass)

**Key regression test**: `arena.test.ts:282-299` — this is the primary test verifying that `executeMinimalPipeline` writes the correct `pipeline_type` value to the DB. The assertion change from `'minimal'` to `'full'` validates the pipeline.ts change.

**Confirmed safe**: `evolution/scripts/run-evolution-local.ts` imports `executeMinimalPipeline` directly from `../src/lib/core/pipeline` (not the barrel), so removing the barrel export does not affect it.

### Phase 2: Strategy presets + UI
**Goal**: Update Economy preset and admin UI to reflect reduced type set.

1. **Update Economy preset** (`evolution/src/services/strategyRegistryActions.ts:408`):
   - Change `pipelineType: 'minimal'` → `pipelineType: 'full'`

2. **Update PIPELINE_OPTIONS** (`src/app/admin/evolution/strategies/page.tsx:69`):
   ```typescript
   const PIPELINE_OPTIONS: PipelineType[] = ['full', 'single'];
   ```
   Note: CreatedByFilter type (line 37) includes 'batch' for the Origin dropdown — this is correct and must NOT be changed (it filters by `created_by`, not `pipeline_type`).

3. **PipelineBadge**: No changes needed (displays value as-is)

**Verify**: `npm run tsc`, `npm run lint`, `npm run build`, `npm test`

### Phase 3: promptBankConfig
**Goal**: Remove 'minimal' from prompt bank config.

The `evolution_deepseek` method (line 60) currently uses `mode: 'minimal'`. This controls whether `--full` is passed to `run-evolution-local.ts`. Since we're keeping executeMinimalPipeline as an internal function, the CLI still supports not passing `--full` (which triggers minimal mode). So we change the type but keep the field:

1. **Update EvolutionMethod type** (`evolution/src/config/promptBankConfig.ts:26`):
   ```typescript
   mode: 'default' | 'full';  // default = generation + ranking only, full = all agents
   ```

2. **Update method configs**:
   - Line 60: change `mode: 'minimal'` → `mode: 'default'`
   - Line 61-62: `mode: 'full'` — unchanged

3. **Update run-prompt-bank.ts** (`evolution/scripts/run-prompt-bank.ts:384,389`):
   - Line 384: `...(evoMethod.mode === 'full' ? ['--full'] : [])` — no code change needed (checks === 'full', works with 'default')
   - Line 389: `evoMethod.mode === 'full' ? 1_200_000 : 600_000` — no code change needed (same reason)
   - File compiles without edits since it only checks `=== 'full'`, but must be verified with `npm run tsc`

4. **Update CLI help text** (`evolution/scripts/run-evolution-local.ts:82`):
   - Change `'--full  Run full agent suite (default: minimal)'` → `'--full  Run full agent suite (default: generation + ranking only)'`

5. **Update promptBankConfig.test.ts** (`evolution/src/config/promptBankConfig.test.ts:107`):
   ```typescript
   expect(['default', 'full']).toContain(m.mode);
   ```

**Verify**: `npm run tsc`, `npm test`

### Phase 4: Documentation updates
**Goal**: Update all evolution docs referencing removed types.

1. `evolution/docs/evolution/data_model.md:56` — Update PipelineType to `'full' | 'single'`
2. `evolution/docs/evolution/architecture.md:52-56` — Update "Three Pipeline Modes" → "Two Pipeline Modes (+ internal minimal utility)"; describe minimal as internal-only, not a public pipeline type
3. `evolution/docs/evolution/reference.md` — Remove 'minimal' and 'batch' from pipeline type references, update key files section
4. `evolution/docs/evolution/cost_optimization.md` — Update Economy preset reference
5. `evolution/docs/evolution/visualization.md` — Update pipeline type display docs (PIPELINE_OPTIONS reduced)

**Verify**: Review docs for consistency

## Testing

### Unit tests to modify (Phase 1)
- `arena.test.ts` — Update test description and pipeline_type assertion from 'minimal' to 'full'
- `strategyConfig.test.ts:342` — Update array to `['full', 'single', null]`, length to 3
- `strategyConfig.test.ts:384` — Update array to `['full', 'single']`, length to 2
- `strategyFormUtils.test.ts:61` — Update test fixture pipeline_type
- `promptBankConfig.test.ts:107` — Update mode validation (Phase 3)

### Integration tests (Phase 1 — import path only)
- `evolution-pipeline.integration.test.ts` — Change import from `@evolution/lib` to `@evolution/lib/core/pipeline` for executeMinimalPipeline. All 11 call sites unchanged (function still exists internally).
- `evolution-outline.integration.test.ts` — Same import path change. All 4 call sites unchanged.

### Manual verification
- Check admin strategy registry page: pipeline filter should show only 'full' and 'single'
- Verify Economy preset displays correctly with pipeline_type 'full'
- Run CLI `run-evolution-local.ts` without flags — should still work via internal executeMinimalPipeline
- Verify `created_by: 'batch'` filtering still works in strategy registry Origin dropdown

## Rollback Plan
1. **TypeScript**: Revert the type changes (PipelineType, StrategyConfigRow, PIPELINE_TYPES)
2. **Database**: Apply rollback migration (documented above) to restore 'minimal'/'batch' to CHECK constraints
3. **Code**: Revert pipeline.ts, index.ts, preset, UI, and promptBankConfig changes
4. **Tests**: Revert test fixtures and assertions

The DB migration is wrapped in a transaction (BEGIN/COMMIT) so a partial failure will roll back automatically. The UPDATE statements are idempotent.

## Files Modified (complete list)

| File | Change |
|------|--------|
| `evolution/src/lib/types.ts` | PipelineType = 'full' \| 'single' |
| `evolution/src/lib/core/strategyConfig.ts` | StrategyConfigRow.pipeline_type updated |
| `evolution/src/lib/core/pipeline.ts` | executeMinimalPipeline writes 'full' |
| `evolution/src/lib/index.ts` | Remove executeMinimalPipeline export |
| `evolution/src/services/strategyRegistryActions.ts` | Economy preset → 'full' |
| `evolution/src/config/promptBankConfig.ts` | mode: 'minimal' → 'default' \| 'full' |
| `evolution/scripts/run-prompt-bank.ts` | Verify compiles (no code change needed) |
| `evolution/scripts/run-evolution-local.ts` | Update CLI help text |
| `src/app/admin/evolution/strategies/page.tsx` | PIPELINE_OPTIONS = ['full', 'single'] |
| `supabase/migrations/20260314000001_*.sql` | New migration with transaction |
| `evolution/src/lib/core/arena.test.ts` | Update assertion |
| `evolution/src/lib/core/strategyConfig.test.ts` | Update type arrays + lengths |
| `src/app/admin/evolution/strategies/strategyFormUtils.test.ts` | Update fixture |
| `evolution/src/config/promptBankConfig.test.ts` | Update mode validation |
| `src/__tests__/integration/evolution-pipeline.integration.test.ts` | Import path change |
| `src/__tests__/integration/evolution-outline.integration.test.ts` | Import path change |
| 5 evolution docs | Update pipeline type references |
