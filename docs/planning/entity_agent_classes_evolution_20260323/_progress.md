# Entity Agent Classes Evolution — Progress

## Phase 0: DB Migration ✅
- Created migration `20260324000001_entity_evolution_phase0.sql`
- Renamed `evolution_prompts.title` → `name` in Zod schemas, server actions, UI pages, tests
- Removed `arena_topic` from ENTITY_TYPES, METRIC_REGISTRY, CHECK constraint
- Added FK RESTRICT on `evolution_runs.strategy_id`
- Updated 15+ test files

## Phase 1: Core Abstract Classes ✅
- Created `evolution/src/lib/core/types.ts` — EntityType, relationships, actions, metrics, agent context
- Created `evolution/src/lib/core/metricCatalog.ts` — 25 metric definitions + METRIC_FORMATTERS
- Created `evolution/src/lib/core/Entity.ts` — abstract base with CRUD, propagation, logging
- Created `evolution/src/lib/core/Agent.ts` — template method with run()/execute()
- Created `evolution/src/lib/core/entityRegistry.ts` — lazy-init registry with validation + helpers
- 27 new tests

## Phase 2: Entity Subclasses ✅
- Created 6 entities in `evolution/src/lib/core/entities/`
- RunEntity, StrategyEntity, ExperimentEntity, VariantEntity, InvocationEntity, PromptEntity
- 34 new tests

## Phase 3: Agent Subclasses ✅
- Created GenerationAgent, RankingAgent in `evolution/src/lib/core/agents/`
- Refactored `runIterationLoop.ts` to use `agent.run()` instead of `executePhase()`
- Removed `executePhase()` function, deleted `executePhase.test.ts`
- All 23 loop tests pass unchanged

## Phase 4: Wire UI to Entity Registry ✅
- `EntityMetricsTab` uses `getEntityMetricDef()` from entity registry + `METRIC_FORMATTERS`
- `LogsTab` uses `EntityType` from `core/types`
- `metricColumns.tsx` uses `getEntityListViewMetrics()` + `METRIC_FORMATTERS`
- Arena detail page uses `entityType="prompt"` (not `arena_topic`)

## Phase 5: Wire Metrics and Logs ✅
- `writeMetrics.ts` validateTiming reads from `getEntity()` instead of METRIC_REGISTRY
- `recomputeMetrics.ts` uses `getEntity()` for finalization + propagation
- `persistRunResults.ts` uses `getEntity()` for all metric writes
- `runIterationLoop.ts` uses `getEntity('run').metrics.duringExecution`
- `logActions.ts` uses `entity.logQueryColumn` instead of hardcoded switch
- `LogsTab.tsx` imports EntityType from `core/types`
- Updated `recomputeMetrics.test.ts` to mock entity registry
- Rewrote `registry.test.ts` to test entity registry helpers
- Old `METRIC_REGISTRY` kept for backward compat (unused by active code paths)

## Phase 6: Cleanup ✅
- Updated barrel exports: `lib/index.ts`, `pipeline/index.ts`, `metrics/index.ts`
- Deleted empty scaffold dirs: `agents/`, `v2/`
- Updated 4 evolution docs: architecture.md, data_model.md, agents/overview.md, arena.md
- Fixed missed test assertions (experimentActions.test.ts, EntityMetricsTab.test.tsx)

## Final Stats
- **118/119 test suites pass** (1 pre-existing failure: types.test.ts needs expect-type)
- **1316 tests pass**, 5 skipped
- Build, lint, tsc all pass
- 18 new files created, 25+ files modified, 3 files deleted
