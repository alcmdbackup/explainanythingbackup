# Clean Up Pipeline Modes Research

## Problem Statement
Eliminate the 'minimal' and 'batch' pipeline types from the PipelineType union. 'batch' is only a metadata label never set at execution time, and 'minimal' is only used for local CLI default and integration tests — not in production. Remove these types and any dependent code that isn't useful elsewhere.

## Requirements (from GH Issue #NNN)
Eliminate these types and any code dependent on it that isn't useful elsewhere.

## High Level Summary

`PipelineType = 'full' | 'minimal' | 'batch' | 'single'` can be safely reduced to `'full' | 'single'`:

- **`batch`**: Never written to DB by any code path. The `batch_runs` table was already dropped (migration `20260303000001`). `pipeline_type: 'batch'` was a placeholder that was never implemented. `created_by: 'batch'` on strategies is completely independent and should be preserved.

- **`minimal`**: Only used by `executeMinimalPipeline()` which is called from (1) CLI default in `run-evolution-local.ts` and (2) integration tests. Not used in production. The function is ~113 LOC with significant overlap with `executeFullPipeline` but can't be trivially replaced — full pipeline would also run proximity agent and has supervisor/phase overhead.

- **`pipeline_type` field on strategies**: Purely decorative metadata — zero runtime impact. Execution mode is determined by which pipeline function is called, not by reading strategy.pipeline_type. Could be made nullable or kept as informational tag.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/data_model.md - PipelineType definition, core primitives
- evolution/docs/evolution/architecture.md - Three pipeline modes section
- evolution/docs/evolution/reference.md - Pipeline type refs, executeMinimalPipeline docs
- evolution/docs/evolution/cost_optimization.md - Strategy presets with pipeline_type
- evolution/docs/evolution/visualization.md - Pipeline type UI display
- evolution/docs/evolution/agents/overview.md - Agent interaction patterns

## Code Files Read

### Type Definitions
- `evolution/src/lib/types.ts:636-638` - PipelineType union + PIPELINE_TYPES constant
- `evolution/src/lib/core/strategyConfig.ts:39` - StrategyConfigRow.pipeline_type inline union

### Pipeline Implementation
- `evolution/src/lib/core/pipeline.ts:197-310` - executeMinimalPipeline (full implementation)
- `evolution/src/lib/core/pipeline.ts:336-640` - executeFullPipeline (for comparison)
- `evolution/src/lib/index.ts:69` - Public export of executeMinimalPipeline

### CLI & Scripts
- `evolution/scripts/run-evolution-local.ts:700-707` - CLI default uses executeMinimalPipeline
- `evolution/scripts/run-prompt-bank.ts:384,389` - mode field controls --full flag and timeout
- `evolution/src/config/promptBankConfig.ts:26` - mode: 'minimal' | 'full' type

### Server Actions & DB
- `evolution/src/services/strategyRegistryActions.ts:49,130,152,248,408` - Pipeline type filtering, presets
- `evolution/src/services/evolutionActions.ts:33` - EvolutionRun.pipeline_type field
- `supabase/migrations/20260207000003` - pipeline_type on strategy_configs
- `supabase/migrations/20260207000004` - pipeline_type on runs
- `supabase/migrations/20260213000001` - Added 'single' to CHECK constraints
- `supabase/migrations/20260303000001` - Dropped batch_runs table entirely

### UI
- `src/app/admin/evolution/strategies/page.tsx:69,89-96,462,713-724` - PIPELINE_OPTIONS, PipelineBadge, filter
- `src/app/admin/evolution/strategies/strategyFormUtils.ts` - Does NOT include pipelineType in form

### Tests
- `evolution/src/lib/core/arena.test.ts:282-303` - Tests executeMinimalPipeline sets pipeline_type
- `evolution/src/lib/core/strategyConfig.test.ts:342,384` - Type validation for all PipelineType values
- `src/__tests__/integration/evolution-pipeline.integration.test.ts` - 11 calls to executeMinimalPipeline
- `src/__tests__/integration/evolution-outline.integration.test.ts` - 4 calls to executeMinimalPipeline
- `src/app/admin/evolution/strategies/strategyFormUtils.test.ts:61` - Test fixture with pipeline_type: 'minimal'

## Key Findings

### 1. `pipeline_type: 'batch'` was never implemented
No code path ever writes `pipeline_type = 'batch'` to the database. The batch runner (`evolution-runner.ts`) calls `executeFullPipeline()` which sets `'full'`. The `'batch'` value was a placeholder from early architectural planning that was never hooked up. Zero rows in production should have this value.

### 2. `batch_runs` table already dropped
Migration `20260303000001` dropped `evolution_batch_runs` table and `batch_run_id` column from runs. The experiment model was flattened to Experiment → Run (via `experiment_id` FK). No active code references this table.

### 3. `created_by: 'batch'` is independent from `pipeline_type: 'batch'`
The `created_by` column on `evolution_strategy_configs` tracks origin (system/admin/experiment/batch). It's a separate CHECK constraint, separate column, and is actively used for strategy filtering. Removing `pipeline_type: 'batch'` does NOT affect `created_by: 'batch'`.

### 4. `executeMinimalPipeline` has 3 callers
- **CLI default** (`run-evolution-local.ts:705`) - when no --full/--single flag
- **Integration tests** (`evolution-pipeline.integration.test.ts`) - 11 call sites
- **Outline integration tests** (`evolution-outline.integration.test.ts`) - 4 call sites
- **Arena unit test** (`arena.test.ts:292`) - verifies pipeline_type setting

### 5. `executeMinimalPipeline` can't trivially map to `executeFullPipeline`
Key differences: no supervisor, no iteration loop, no phase transitions, no proximity agent, no continuation support, simpler checkpoint structure. Using executeFullPipeline with maxIterations:1 would also run proximity and have supervisor overhead.

### 6. Strategy pipeline_type is purely decorative
Zero runtime logic branches on strategy.pipeline_type. The actual execution mode is determined by which pipeline function is called. The field is only used for UI filtering and display in the admin strategy registry.

### 7. Economy preset uses pipelineType: 'minimal'
The "Economy" strategy preset in `strategyRegistryActions.ts:408` is the only preset with `pipelineType: 'minimal'`. But this is metadata — it doesn't affect execution. Economy preset should be updated to `'full'` (it already uses `iterations: 50`, `enabledAgents: []`).

### 8. promptBankConfig mode field
`evolution/src/config/promptBankConfig.ts` has `mode: 'minimal' | 'full'` on EvolutionMethod. Only used in `run-prompt-bank.ts` to decide whether to pass `--full` to CLI and set timeout. Can be renamed or replaced.

### 9. DB migration needed
Both `evolution_runs` and `evolution_strategy_configs` have CHECK constraints allowing 'minimal' and 'batch'. Need a migration to:
1. UPDATE existing rows with 'minimal' or 'batch' to 'full'
2. DROP and re-add CHECK constraints with only ('full', 'single')

### 10. Test impact is contained
Most test files referencing 'batch' or 'minimal' use these words in unrelated contexts (batch processing, minimal fixtures). Only 4 test files directly use executeMinimalPipeline or PIPELINE_TYPES validation:
- `arena.test.ts` - delete the minimal pipeline_type test
- `strategyConfig.test.ts` - update type validation tests
- `evolution-pipeline.integration.test.ts` - rewrite to use executeFullPipeline
- `evolution-outline.integration.test.ts` - rewrite to use executeFullPipeline
- `strategyFormUtils.test.ts` - update test fixture

## Open Questions

1. **CLI default behavior**: Should the CLI default (no --full/--single) switch to executeFullPipeline with 1 iteration? Or keep executeMinimalPipeline as an internal utility not exposed in PipelineType?
2. **Integration test migration**: Rewrite 15 test call sites to use executeFullPipeline with constrained config, or keep executeMinimalPipeline as internal test utility?
3. **strategy.pipeline_type field**: Keep as nullable metadata ('full' | 'single' | null) or remove entirely?
4. **promptBankConfig.mode**: Rename from 'minimal' | 'full' to something else, or just use boolean?
