# Simplify Evolution Research

## Problem Statement
The evolution pipeline has grown complex with many agents, abstractions, and data model layers. This project aims to comprehensively simplify both the evolution data model and pipeline code, removing unused abstractions, streamlining the schema, reducing code complexity, and removing unused agents or features to make the system more maintainable.

## Requirements (from GH Issue #635)
- Research the evolution codebase to identify simplification opportunities
- Identify unused or underutilized agents, features, and abstractions
- Identify data model simplifications (unused tables, columns, overly complex schemas)
- Identify code simplifications (dead code, unnecessary abstractions, over-engineering)
- Propose concrete deletions and simplifications with risk assessment
- Execute the simplification plan incrementally

## High Level Summary

The evolution pipeline is ~62,700 LOC (30,630 production + 32,061 test) with 13 agents, 233 files, 85 migrations, and 43+ exported types. Research across 5 rounds with 20 parallel agents identified significant simplification opportunities. No agents are fully unused in production, but the codebase has substantial consolidation opportunities. The primary complexity comes from:

1. **Duplicated agent boilerplate** (~460 LOC across 13 agents)
2. **Over-extracted pipeline orchestration** (~500 LOC recoverable in 5 core files)
3. **Fragmented agent selection logic** (3 files with overlapping definitions)
4. **Server action boilerplate** (~900 LOC across 69 actions)
5. **Component duplication** (~870 LOC across 77 components)
6. **Test mock duplication** (~5,400 LOC across 87 test files)
7. **Supabase query repetition** (~250 LOC across 14+ service files)

**Total estimated simplification: ~3,000-4,000 production LOC + ~5,000 test LOC**

## Key Findings

### Category 1: Confirmed Dead Code (Safe to Delete)

| Item | Location | Evidence | LOC Saved |
|------|----------|----------|-----------|
| `PoolDiversityTracker` class | `core/diversityTracker.ts` | Never instantiated in production | ~111 |
| `'batch'` pipeline type | `types.ts:598` | Type defined but never set | ~5 |
| Deprecated `plateau` config field | `types.ts:513` | Marked @deprecated, ignored at runtime | ~5 |
| Deprecated `budgetCaps` config field | `types.ts:524` | Marked @deprecated, ignored at runtime | ~5 |
| Duplicate script `run-bank-comparison.ts` | `evolution/scripts/` | 100% identical to `run-arena-comparison.ts` | ~271 |
| Duplicate script `add-to-bank.ts` | `evolution/scripts/` | 99% identical to `add-to-arena.ts` | ~176 |
| Over-exported internal helpers | `comparison.ts`, `diffComparison.ts` | Only used internally | cleanup |

### Category 2: Agent Boilerplate Consolidation (Rounds 4-5)

**10 consolidation opportunities identified across 13 agents (~460 LOC savings):**

| Opportunity | Frequency | LOC Saved | Complexity |
|-------------|-----------|-----------|------------|
| BudgetExceededError re-throw → shared helper | 7+ agents, 10 locations | ~50 | Low |
| Cost tracking in base class (`getAgentCost()`) | All 13 agents, 26 calls | ~26 | Low |
| Skip/early-exit result helper (`skipAgent()`) | 5+ agents | ~20 | Low |
| State validation helper (`validateState()`) | 7+ agents | ~28 | Low |
| AgentResult construction (`createAgentResult()`) | All 13 agents | ~40 | Low |
| Promise.allSettled + rethrow + process pattern | 6 agents | ~50 | Medium |
| Format validation + logging pattern | 7 locations | ~7 | Low |
| Add variant to pool lifecycle | 9 agents | ~72 | Medium |
| Rating update batch helper | 2+ agents | ~18 | Low |
| Result processing loop extraction | 5+ agents | ~40 | Medium |

**Implementation**: Add 4-5 helper methods to `AgentBase` class + 1 shared utility function.

### Category 3: Pipeline Orchestration Simplification (Round 4)

**5 core files analyzed, ~500 LOC savings (25% reduction):**

| File | Current | Projected | Savings | Key Changes |
|------|---------|-----------|---------|-------------|
| pipeline.ts | 809 | 630-670 | 140-175 | Flatten agent dispatch, unify checkpoints, reduce invocation ceremony |
| supervisor.ts | 232 | 187 | 45 | Single phase field, pre-compute agent lists, flatten stop conditions |
| index.ts | 258 | 138-173 | 85-120 | Consolidate pipeline prep, trim re-exports |
| persistence.ts | 261 | 191 | 70 | Merge checkpoint functions, remove retry wrapper, batch attribution |
| evolutionRunnerCore.ts | 258 | 181 | 77 | Consolidate resume/fresh paths, inline heartbeat |

**Top priorities:**
1. **Flatten agent dispatch** (50-60 LOC): Remove `runAgent()` wrapper, call `agent.execute()` directly
2. **Consolidate checkpoint logic** (60 LOC): Merge 3 checkpoint functions into 1, save once per iteration
3. **Unify pipeline prep** (40 LOC): Single `preparePipelineRun()` accepting optional checkpoint
4. **Simplify phase management** (20 LOC): Single phase field, inline detection

### Category 4: Agent Selection Consolidation (Round 4)

**3 files with overlapping agent selection logic → propose single `agentConfiguration.ts`:**

| Duplication | supervisor.ts | budgetRedistribution.ts | costEstimator.ts |
|-------------|--------------|------------------------|------------------|
| Required/optional lists | Imports | Defines | Imports |
| Single-article disabled | `SINGLE_ARTICLE_EXCLUDED` | `SINGLE_ARTICLE_DISABLED` | Imports |
| "Is agent active?" logic | `getActiveAgents()` | N/A | `isActive()` |
| Dependencies map | N/A | `AGENT_DEPENDENCIES` | N/A |

**Issues found:**
- Name inconsistency: `SINGLE_ARTICLE_EXCLUDED` vs `SINGLE_ARTICLE_DISABLED`
- Duplicated filtering logic with different ordering (edge case bugs possible)
- costEstimator missing phase gate (can overestimate EXPANSION costs)
- supervisor doesn't validate dependencies (relies on separate validation call)

**Proposal:** Create `agentConfiguration.ts` with single `isAgentActive()` function used by all 3 consumers.

### Category 5: Checkpoint/Resume Simplification (Round 4)

**~442 LOC total, 78-120 LOC removable:**

| Opportunity | LOC Saved | Risk |
|-------------|-----------|------|
| Merge persistCheckpoint / persistCheckpointWithSupervisor | 15 | Low |
| Skip ComparisonCache checkpoint (rebuild on resume, ~$0.01 cost) | 12 | Low |
| Simplify costTracker.restoreSpent() | 6 | Low |
| Eliminate checkpoint pruning OR mid-iteration saves | 35 | Medium |
| Audit ordinalHistory/diversityHistory serialization | 10 | Medium |

### Category 6: Server Action Consolidation (Round 5)

**69 exported actions across 10 files, ~6,465 LOC total:**

| Opportunity | LOC Saved | Priority |
|-------------|-----------|----------|
| Extract explorer query helpers to shared module | 110 | High |
| Generic `fetchEntityById<T>()` helper | 75 | High |
| Standardize eloBudgetActions.ts wrapper pattern | 50 | High |
| Merge 3 variant relationship actions → 1 parameterized | 43 | Medium |
| Shared data enrichment functions (prompt/strategy maps) | 60-80 | Medium |

**Boilerplate per action**: ~13 LOC (withLogging + serverReadRequestId + try/catch + requireAdmin + supabase init + error handling + return). **Total: ~900 LOC pure boilerplate across 69 actions.**

### Category 7: Component Consolidation (Round 5)

**77 component files, ~870 LOC consolidation opportunity:**

| Component Pattern | Files Affected | LOC Saved |
|-------------------|---------------|-----------|
| StatusBadge (duplicated in 4 files) | 4 | 120 |
| MetricCard / Summary Card (4 files) | 4 | 140 |
| SortableLeaderboard (2 similar implementations) | 2 | 140 |
| ProgressBar (3 files) | 3 | 90 |
| State color maps (6+ files) | 6 | 80 |
| RunsTable pattern (3 custom tables) | 3 | 100 |
| Agent cost chart variants | 2 | 60 |

### Category 8: Supabase Query Consolidation (Round 5)

**Top tables by query frequency:**

| Table | Query Sites | Consolidation Opportunity |
|-------|-------------|--------------------------|
| evolution_runs | 41 | Dashboard metrics → single RPC (9 queries → 1) |
| evolution_strategy_configs | 28 | Shared `getStrategyLabels()` helper |
| evolution_variants | 21 | Shared variant query builder with detail levels |
| evolution_arena_topics | 21 | Shared prompt query builder |
| evolution_agent_invocations | 7 | Unified `getAgentInvocations()` with detail levels |

**N+1 query pattern found**: Variant lineage traversal in `variantDetailActions.ts` — 1 query per level. Fix: recursive CTE or single RPC.

### Category 9: Test Infrastructure Consolidation (Round 5)

**87 test files, 30,190 LOC total, ~18% duplication:**

| Opportunity | LOC Saved | Priority |
|-------------|-----------|----------|
| Move agent mocks to shared evolution-test-helpers.ts (12 agent tests ignore existing shared helpers) | 300 | High |
| Extract Supabase chain mock factory (5 service tests) | 240 | High |
| Consolidate CostTracker mock (6-8 files) | 70 | Medium |
| Parametrize repetitive test cases (.each) | 4,500 | Medium |
| Split mega test files (pipeline.test.ts: 2,785 LOC) | 300 | Low |

### Validated Non-Issues

| Item | Status | Evidence |
|------|--------|---------|
| `cost_estimate_detail` column | ACTIVELY READ | costAnalyticsActions.ts:166 |
| `cost_prediction` column | ACTIVELY READ | costAnalyticsActions.ts:137 |
| `executeMinimalPipeline` | USED in local CLI | Sets pipeline_type='minimal' |
| All 13 agents | ALL USED | Instantiated in createDefaultAgents() |
| Backward compat views | ALREADY DROPPED | Migration 20260221000006 |
| All 4 RPC functions | ACTIVELY USED | claim, checkpoint_and_continue, update_strategy_aggregates, sync_to_arena |

## Codebase Metrics

| Metric | Value |
|--------|-------|
| Total production LOC | 30,630 |
| Total test LOC | 32,061 |
| Test/code ratio | 1.05x |
| Agent classes | 13 |
| Server actions | 69 (across 10 files) |
| Exported types | 43+ |
| DB migrations | 85 |
| TSX components | 77 |
| Total files (evolution/) | 233 |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/cost_optimization.md

## Code Files Read (via 20 parallel research agents across 5 rounds)

### Round 1-3 (12 agents): Dead code, unused features, DB cleanup
- evolution/src/lib/core/*.ts (all core modules)
- evolution/src/lib/agents/*.ts (all agent files)
- evolution/src/lib/types.ts, config.ts, index.ts, comparison.ts, diffComparison.ts
- evolution/src/lib/treeOfThought/*.ts, section/*.ts
- evolution/src/services/*.ts (all service files)
- evolution/scripts/*.ts (all scripts)
- evolution/src/components/evolution/ (component inventory)
- supabase/migrations/ (85 evolution-related migrations)

### Round 4 (4 agents): Pipeline and agent consolidation
- All 13 agent execute() methods (boilerplate analysis)
- pipeline.ts, supervisor.ts, index.ts, persistence.ts, evolutionRunnerCore.ts (dispatch loop analysis)
- supervisor.ts, budgetRedistribution.ts, costEstimator.ts, agentToggle.ts, configValidation.ts (agent selection)
- persistence.ts, state.ts, costTracker.ts, comparisonCache.ts (checkpoint/resume)

### Round 5 (4 agents): Service/UI/test consolidation
- All 10 service files (69 actions analyzed for patterns)
- All 77 component files (duplication analysis)
- All Supabase queries across evolution/ and src/ (query pattern analysis)
- All 87 test files (mock/helper duplication analysis)

## Open Questions
1. Should `executeMinimalPipeline` be kept for local CLI or replaced with full pipeline + limited agent config?
2. How aggressive should type simplification be? (12 ExecutionDetail types → 1 generic vs keeping discriminated union)
3. Should we tackle server action boilerplate reduction in this project or leave it as a separate effort?
4. Is the cost estimation system worth its ~700 LOC complexity given its limited accuracy?
5. Should we consolidate agent selection into a new `agentConfiguration.ts` or just fix the inconsistencies in place?
6. How much test refactoring should be in scope? (test duplication is ~5,400 LOC but lower risk)
