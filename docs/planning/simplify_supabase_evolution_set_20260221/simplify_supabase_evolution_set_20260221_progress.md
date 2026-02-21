# Simplify Supabase Evolution Set Progress

## Phase 1: Safe Cleanup (Priority 1 + 2)
### Work Done
- **Priority 1 — Drop `runner_agents_completed`:**
  - Created migration `20260221000001_drop_runner_agents_completed.sql` (replaces RPC + drops column)
  - Removed writes from `persistCheckpoint()` in persistence.ts
  - Removed writes from `persistCheckpointWithSupervisor()` in pipeline.ts
  - Stopped passing `p_pool_length` to `checkpoint_and_continue` RPC
  - Updated `persistence.continuation.test.ts` to assert `p_pool_length` is no longer passed

- **Priority 2 — Merge `variants_generated` into `total_variants`:**
  - Created migration `20260221000002_drop_variants_generated.sql`
  - Removed `variants_generated` writes from pipeline.ts finalization (both minimal + full)
  - Removed `variants_generated` from `EvolutionRun` TS interface in evolutionActions.ts
  - Updated 5 UI consumers across 3 page files to use `total_variants`
  - Updated `runTriggerContract.test.ts` fixture

### Verification
- TSC: 0 errors
- Lint: Only pre-existing design-system warnings
- Build: Passed
- Unit tests: 149/149 passing across 6 suites
- Grep check: Only `evolution_run_agent_metrics` references remain (out of scope)

## Phase 2: Checkpoint Enrichment (Priority 3, Steps A-C)
### Work Done
- Added `DiffMetrics` type to types.ts (canonical shared type)
- Added `BeforeStateSnapshot`, `captureBeforeState()`, `computeDiffMetrics()` to pipelineUtilities.ts
- Updated `persistAgentInvocation()` to accept optional `diffMetrics` (merged AFTER truncation)
- Updated `executeMinimalPipeline()` with before-state capture + diff computation
- Updated `runAgent()` in `executeFullPipeline()` with same pattern
- Updated Timeline builder in `evolutionVisualizationActions.ts` to prefer `_diffMetrics` with checkpoint-diff fallback
- Created backfill script `evolution/scripts/backfill-diff-metrics.ts` (idempotent, batched, resumable, --dry-run)
- Added 10 new unit tests for captureBeforeState, computeDiffMetrics, and truncation survival

### Verification
- TSC: 0 errors
- Build: Passed
- Unit tests: 159/159 passing (10 new tests)

## Phase 3: Checkpoint Pruning (Priority 3, Steps D-E)
### Work Done
- Created migration `20260221000003_checkpoint_pruning_rpc.sql` (DISTINCT ON query)
- Added `pruneCheckpoints()` function to pipeline.ts (non-fatal, try/catch wrapped)
- Integrated pruning into `finalizePipelineRun()` post-completion
- Added 4 unit tests for pruning (happy path, RPC failure, delete failure, empty keepers)

### Verification
- TSC: 0 errors
- Unit tests: 163/163 passing (4 new pruning tests)

## Documentation Updates
- Updated architecture.md (checkpoint pruning, diff metrics)
- Updated visualization.md (Timeline data source change)
- Updated reference.md (schema + pipeline docs)
- Updated data_model.md (finalization steps, agent invocation description)
