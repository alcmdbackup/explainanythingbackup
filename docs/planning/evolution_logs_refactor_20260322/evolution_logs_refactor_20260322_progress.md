# Evolution Logs Refactor Progress

## Phase 1: Schema Migration
### Work Done
- Created migration `20260323000001_generalize_evolution_logs.sql` — renames table, adds entity_type/entity_id/experiment_id/strategy_id columns, backfills, creates indexes, recreates RLS
- Updated table name references in `createRunLogger.ts`, `evolutionActions.ts`, `runIterationLoop.test.ts`
### Issues Encountered
None

## Phase 2: Generalized Logger Factory + Invocation Wiring
### Work Done
- Created `createEntityLogger.ts` with `EntityLogger` interface and `createEntityLogger()` factory
- Deleted `createRunLogger.ts` and `createRunLogger.test.ts`
- Updated `buildRunContext.ts` to use createEntityLogger with full ancestor context
- Updated `runIterationLoop.ts`: import EntityLogger, create invocation loggers for generate+rank phases
- Updated `generateVariants.ts`: added optional logger param with internal logging
- Updated `rankVariants.ts`: added optional logger param with triage/convergence logging
- Updated `persistRunResults.ts`, `index.ts`, `claimAndExecuteRun.ts`, `run-evolution-local.ts`
- Created comprehensive test suite: `createEntityLogger.test.ts` (21 tests)

## Phase 2b: All Entities Produce Logs
### Work Done
- Experiment logging: `experimentActionsV2.ts` (create + cancel)
- Strategy logging: `strategyRegistryActionsV2.ts` (create + archive), `persistRunResults.ts` (aggregate update)
- Run logging: `evolutionActions.ts` (admin kill)

## Phase 3: Server Actions for Multi-Entity Log Queries
### Work Done
- Created `logActions.ts` with `getEntityLogsAction` — queries by ancestor column per entity type
- Created `logActions.test.ts` (7 tests covering all 4 entity types, UUID validation, filtering, pagination)
- Kept `getEvolutionRunLogsAction` as-is for backward compatibility

## Phase 4: Shared LogsTab Component
### Work Done
- Created `LogsTab.tsx` — filter bar (level, entity type, agent name), pagination, entity-type badges, JSON context viewer
- Replaced inline `LogsPanel` on run detail page with `<LogsTab entityType="run" entityId={runId} />`
- Created `LogsTab.test.tsx` (5 tests)

## Phase 5: Logs Tabs on All 4 Detail Pages
### Work Done
- **Experiment detail**: Added 'logs' tab to ExperimentDetailContent.tsx
- **Strategy detail**: Refactored to use EntityDetailTabs + useTabState with overview + logs tabs
- **Invocation detail**: Split server component into server wrapper (page.tsx) + InvocationDetailContent.tsx client component with tabs
- **Run detail**: Already done in Phase 4
