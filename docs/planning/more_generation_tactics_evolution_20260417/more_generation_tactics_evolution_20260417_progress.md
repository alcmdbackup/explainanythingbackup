# More Generation Tactics Evolution Progress

## Phase 0: Rename strategy → tactic ✅
### Work Done
- Renamed ~80 occurrences across 50 files
- Core types: Variant.strategy→.tactic, StrategyDef→TacticDef, createVariant({tactic})
- Schemas: variantSchema, run summary V3/V2/V1 with renameKeys preprocess, generationGuidance dual-accept
- Pipeline: persistRunResults, runIterationLoop, estimateCosts, buildRunContext, createSeedArticle
- UI: TACTIC_PALETTE, VariantCard/LineageGraph, MetricsTab, VariantsTab, strategies page
- All tests updated: 301 suites, 5412 tests pass

### Issues Encountered
- Zod `.strict()` on V3 run summary required careful renameKeys preprocess to accept both old and new field names
- Two separate `EntityType` definitions (core/types.ts and metrics/types.ts) — both needed updating in Phase 1
- Several test files had hardcoded Variant literals with `strategy:` — caught by tsc

## Phase 1: Tactic Code Registry + DB Entity ✅
### Work Done
- Created evolution/src/lib/core/tactics/ module:
  - types.ts: TacticDef interface
  - generateTactics.ts: 24 system tactics (3 core + 5 extended + 16 new) with full preamble+instructions
  - index.ts: barrel with getTacticDef(), isValidTactic(), TACTIC_PALETTE, TACTICS_BY_CATEGORY, DEFAULT_TACTICS
- DB migration: evolution_tactics table, tactic column on invocations, metrics CHECK constraint
- TacticEntity class registered in entityRegistry
- tacticActions.ts server actions (list, detail)
- syncSystemTactics.ts deploy-time upsert script
- Agent.run() writes tactic to invocation row
- buildRunContext.ts validates generationGuidance tactic names
- estimateCosts.ts: EMPIRICAL_OUTPUT_CHARS for all 24 tactics
- VariantCard/schemas.ts: import from registry (single source of truth)
- 302 suites, 5418 tests pass

### Issues Encountered
- TacticEntity needed insertSchema, detailLinks, and proper EntityAction typing to satisfy Entity base class
- METRIC_REGISTRY needed 'tactic' entry to satisfy entityRegistry test that iterates ALL_ENTITY_TYPES
- Agent.test.ts assertion needed updating for new createInvocation parameter count

## Phase 2: Tactic Admin UI ✅
### Work Done
- Created /admin/evolution/tactics list page (Name, Label, Agent Type, Category, System/Custom, Status)
- Created /admin/evolution/tactics/[tacticId] detail page with 5 tabs:
  - Overview: preamble + instructions from code registry (read-only for system tactics)
  - Metrics: EntityMetricsTab (populated by Phase 3)
  - Variants, Runs, By Prompt: placeholder tabs for future data views
- Loading skeleton
- Tactic list pages linked via URL and breadcrumbs

## Phase 3: Cross-Run Tactic Metrics ✅
### Work Done
- Created computeTacticMetrics() in metrics/computations/tacticMetrics.ts
  - Queries evolution_variants by agent_name from completed runs
  - Computes: avg_elo, best_elo, total_variants, total_cost, run_count, winner_count
  - Writes to evolution_metrics with entity_type='tactic'
- computeTacticMetricsForRun() called at finalization after strategy/experiment propagation
- recomputeStaleMetrics() handles entity_type='tactic'
- Stale trigger migration: mark_elo_metrics_stale() cascades to tactic metrics

## Phase 4: Wire Up generationGuidance Weighted Selection ✅
### Work Done
- Created selectTacticWeighted() with cumulative distribution + SeededRandom
- Updated runIterationLoop.ts: conditional weighted vs round-robin dispatch
- Logs selectionMode ('weighted' or 'round-robin') in dispatch context
- Unit tests: determinism, weight distribution, normalization, edge cases (6 tests)

## Phase 5: Update Cost Estimation ✅ (done inline in Phase 1)
### Work Done
- EMPIRICAL_OUTPUT_CHARS entries for all 24 tactics added in Phase 1
- TACTIC_PALETTE moved to tactics/index.ts in Phase 1

## Phase 6: Update Tests & Documentation
### Work Done
[Pending — Phase 0 handled rename tests; parametrized + collision + doc updates remain]
