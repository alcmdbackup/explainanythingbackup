# Simplify Refactor Evolutionv2 Pipeline Research

## Problem Statement
Look for opportunities to further simplify and refactor our evolution V2 pipeline, which is already very different from our old V1 pipeline.

## Requirements (from GH Issue #740)
Look for ways to streamline and simplify our evolution V2 pipeline.

## High Level Summary

**Verified via 4 rounds of 4 research agents (16 total) against current main.**

The V2 pipeline (~2,507 LOC in `evolution/src/lib/v2/`) is the **sole production pipeline**. V1 core/ retains dead files totaling **1,600 LOC** (source + tests) that can be safely deleted. The runner (`evolutionRunnerCore.ts`) creates V1 costTracker + llmClient + logger that are **dead weight** — V2 internally creates its own equivalents, resulting in double-wrapping. Eliminating this makes 3 more V1 files (444 LOC) deletable.

**Four categories of work identified:**
1. **Dead code removal** — Delete 12 dead files + tests (1,600 LOC), dead types, 11 dead barrel exports
2. **Runner V1→V2 migration** — Replace V1 costTracker/llmClient/logger in runner with raw provider, making V2 fully self-contained (444 LOC V1 → already covered by 263 LOC V2)
3. **Service consolidation** — Merge duplicated arena/prompt actions, extract shared query helpers (~335 LOC savings)
4. **V2 code simplification** — Extract phase executor, share prompt templates, merge cost functions (~120-140 LOC savings)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/architecture.md — **Already updated for V2** (describes flat loop, no V1 phases)
- evolution/docs/evolution/data_model.md — **Partially outdated** (references removed pipeline types)
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/cost_optimization.md — **Partially outdated** (references ExecutionContext, claims 11 agents)
- evolution/docs/evolution/visualization.md — **Already updated for V2** (describes new admin UI)

## Code Files Read (via 32 research agents, 8 rounds — 3 initial + 3 first verification + 4 final verification)

### V2 Pipeline Core (2,507 LOC — VERIFIED)
- `evolution/src/lib/v2/evolve-article.ts` (320 LOC) — Main orchestration loop
- `evolution/src/lib/v2/rank.ts` (609 LOC) — Triage + Swiss fine-ranking (largest module)
- `evolution/src/lib/v2/generate.ts` (117 LOC) — Variant generation
- `evolution/src/lib/v2/evolve.ts` (163 LOC) — Mutation/crossover
- `evolution/src/lib/v2/runner.ts` (196 LOC) — Run lifecycle
- `evolution/src/lib/v2/finalize.ts` (204 LOC) — DB persistence
- `evolution/src/lib/v2/experiments.ts` (118 LOC) — Experiment management
- `evolution/src/lib/v2/arena.ts` (114 LOC) — Arena integration
- `evolution/src/lib/v2/cost-tracker.ts` (71 LOC) — Budget tracking
- `evolution/src/lib/v2/llm-client.ts` (135 LOC) — LLM wrapper with retry
- `evolution/src/lib/v2/invocations.ts` (72 LOC) — Agent invocation tracking
- `evolution/src/lib/v2/run-logger.ts` (57 LOC) — Structured logging
- `evolution/src/lib/v2/seed-article.ts` (83 LOC) — Seed article generation
- `evolution/src/lib/v2/strategy.ts` (76 LOC) — Strategy config helpers
- `evolution/src/lib/v2/types.ts` (63 LOC) — V2-specific types
- `evolution/src/lib/v2/index.ts` (94 LOC) — Barrel exports
- `evolution/src/lib/v2/errors.ts` (15 LOC) — Error definitions

### V1 Core — Dead Code Audit (VERIFIED with exact LOC)

**DEAD files (12 files, 1,600 LOC total including tests):**

| File | LOC | Evidence |
|------|-----|---------|
| `core/configValidation.ts` | 65 | Only re-exported, never imported by production code |
| `core/configValidation.test.ts` | 70 | Test for dead file |
| `core/costEstimator.ts` | 301 | Only re-exported, never imported by production code |
| `core/costEstimator.test.ts` | 601 | Test for dead file |
| `core/agentToggle.ts` | 37 | Only re-exported, never imported |
| `core/budgetRedistribution.ts` | 75 | Only consumed by dead costEstimator + agentToggle |
| `core/budgetRedistribution.test.ts` | 95 | Test for dead file |
| `core/jsonParser.ts` | 54 | Zero imports anywhere |
| `core/jsonParser.test.ts` | 77 | Test for dead file |
| `services/evolutionRunClient.ts` | 57 | Never imported by UI or any production code |
| `services/evolutionRunClient.test.ts` | 135 | Test for dead file |
| `strategies/strategyFormUtils.ts` | 33 | Exports functions never called anywhere |

**LIVE V1 files used by runner (3 files, 444 LOC — consolidation candidates):**

| File | LOC | V2 Equivalent | Notes |
|------|-----|---------------|-------|
| `core/costTracker.ts` | 154 | `v2/cost-tracker.ts` (71 LOC) | Runner creates V1 tracker but V2 creates its own internally |
| `core/llmClient.ts` | 163 | `v2/llm-client.ts` (135 LOC) | Runner creates V1 client, wraps in provider, V2 re-wraps |
| `core/logger.ts` | 127 | `v2/run-logger.ts` (57 LOC) | Runner creates V1 logger but V2 creates its own internally |

**LIVE V1 files — shared utilities (VERIFIED V2-only consumers):**

| File | LOC | Used By |
|------|-----|---------|
| `core/rating.ts` | 69 | V2 rank, finalize, arena, evolve, experiments |
| `core/reversalComparison.ts` | 40 | comparison.ts |
| `core/comparisonCache.ts` | 96 | V2 index (re-export) |
| `core/textVariationFactory.ts` | 27 | V2 generate, evolve, evolve-article |
| `core/errorClassification.ts` | 44 | V2 llm-client |
| `core/formatValidationRules.ts` | 104 | agents/formatValidator.ts |
| `comparison.ts` | 146 | V2 rank, evolve-article; also contentQualityCompare service |
| `agents/formatValidator.ts` | 90 | V2 evolve, generate |
| `agents/formatRules.ts` | 9 | V2 evolve, generate, seed-article |

**LIVE V1 files — other:**

| File | LOC | Status |
|------|-----|--------|
| `core/strategyConfig.ts` | ~100 | PARTIALLY LIVE: `labelStrategyConfig()` used by V2 strategy.ts; types only used by dead strategyFormUtils.ts |
| `core/seedArticle.ts` | 66 | LIVE: `generateTitle()` used by `scripts/lib/oneshotGenerator.ts` |
| `config.ts` | 91 | **DEAD**: Only consumed by dead configValidation.ts; constants re-exported but never imported |

### Services (2,451 LOC — 7 NEW files from admin UI PR)
**New (all pure V2, zero V1 deps):**
- `evolutionActions.ts` (476 LOC) — Runs, variants, logs, cost breakdown, kill
- `strategyRegistryActionsV2.ts` (231 LOC) — Strategy CRUD
- `variantDetailActions.ts` (207 LOC) — Variant detail, lineage chain
- `arenaActions.ts` (202 LOC) — Arena topics, entries, comparisons
- `evolutionVisualizationActions.ts` (172 LOC) — Dashboard metrics
- `promptRegistryActionsV2.ts` (164 LOC) — Prompt CRUD (**duplicates arenaActions on same table**)
- `invocationActions.ts` (87 LOC) — Invocation listing

**Existing:**
- `evolutionRunnerCore.ts` (137 LOC) — CRITICAL, unchanged
- `experimentActionsV2.ts` (127 LOC) — Experiment CRUD
- `costAnalytics.ts` (501 LOC) — Cost analytics
- `adminAction.ts` (65 LOC) — Action factory
- `evolutionRunClient.ts` (57 LOC) — **DEAD**
- `shared.ts` (25 LOC) — Utilities

### Types & Config
- `types.ts` (835 LOC) — Mixed V1/V2 types
- `config.ts` (91 LOC) — **DEAD** (only consumer is dead configValidation.ts)
- Barrel `index.ts` — 11 dead exports identified

### Tests (VERIFIED)
- 17 V2 test files (2,665 LOC total)
- 13 error.tsx files under admin evolution (all identical)

## Key Findings (VERIFIED via 4 rounds, 16 agents)

### 1. V2 Is Sole Production Pipeline ✓ CONFIRMED
V1 pipeline fully deleted. All admin UI, API triggers, and batch runners use V2 exclusively.

### 2. Dead Code Cascade ✓ CONFIRMED
Complete dead cascade: `costEstimator` → `budgetRedistribution` → `agentToggle` → `configValidation` → `config.ts`. All have zero production consumers. **12 files, 1,600 LOC safely deletable.**

### 3. Runner Double-Wrapping ✓ CONFIRMED (with exact line numbers)
`evolutionRunnerCore.ts` lines 75-82: Creates V1 costTracker (line 80), V1 logger (line 81), V1 llmClient (line 82). Wraps llmClient in thin provider (line 84-86), passes to `executeV2Run()` (line 98). Inside `evolveArticle()` lines 91-92: Creates V2 costTracker and V2 llmClient wrapping the same provider. **The V1 costTracker is never referenced by V2 — pure dead weight.**

**Fix:** Replace runner lines 75-87 with a simple raw LLM provider function. This eliminates all V1 imports and makes `core/costTracker.ts` (154 LOC), `core/llmClient.ts` (163 LOC), `core/logger.ts` (127 LOC) deletable.

### 4. Service Duplication ✓ CONFIRMED
`arenaActions.ts` and `promptRegistryActionsV2.ts` both CRUD `evolution_arena_topics`:
- **Overlapping**: List, Create, Archive (identical logic)
- **Arena-only**: getArenaEntries, getArenaEntryDetail, getArenaComparisons (sub-resources)
- **Prompt-only**: Update, Delete (more complete CRUD)
- Used by separate admin pages (arena/ vs prompts/) but same underlying table.

### 5. types.ts Dead Types ✓ CONFIRMED (with corrections)
**Removable:**
- `CalibrationExecutionDetail` — V1-dead (agent deleted)
- `TournamentExecutionDetail` — V1-dead (agent deleted)
- `'calibration'` and `'tournament'` in AgentName union — V1-dead

**CORRECTION: RankingExecutionDetail is ALIVE** — used by V2 ranking agent. Previous research doc incorrectly listed it as dead.

**CORRECTION: `plateau` and `budgetCaps` fields already removed** from EvolutionRunConfig. Previous research doc said they were deprecated but still present — they've been fully deleted.

### 6. Dead Features ✓ CONFIRMED
- **agentModels** — Never set in UI, never read at runtime, only in dead costEstimator
- **singleArticle mode** — Read only by dead costEstimator; V2 pipeline ignores it
- **TreeSearch agent** — In OPTIONAL_AGENTS but no implementation file exists

### 7. V2 Code Simplification ✓ CONFIRMED (all files UNCHANGED)
- `evolve-article.ts` (320 LOC): 3x identical 9-line BudgetExceededError blocks → extract `executePhase()` helper
- `rank.ts` (609 LOC): duplicated `updateRating()`/`updateDraw()` calls in triage (lines 353,359) and fine-ranking (lines 472,478)
- `generate.ts` (117 LOC): 3 inline prompt templates (lines 26-62) with 80% structural overlap
- `evolve.ts` (163 LOC): 3 mutation prompt builders with duplicated feedback sections
- `llm-client.ts` (135 LOC): `estimateCost()` and `computeActualCost()` near-duplicates
- `finalize.ts` (204 LOC): double-loop strategy aggregation → single reduce pass

### 8. Admin UI Component Duplication ✓ CONFIRMED
- `STATE_BADGES` defined 3 times: ExperimentStatusCard.tsx, ExperimentDetailContent.tsx, ExperimentOverviewCard.tsx
- MetricCard/InfoCard/SummaryCard: 3 similar implementations with minor style variations
- 13 identical `error.tsx` files across evolution admin routes
- **Note:** Shared `StatusBadge.tsx` and `MetricGrid.tsx` components already exist in `evolution/src/components/evolution/` but aren't fully adopted by experiment components

### 9. Barrel Export Cleanup ✓ CONFIRMED
Main `index.ts` has **11 dead exports** (verified never consumed):
- Functions: `toggleAgent`, `computeCostPrediction`, `refreshAgentCostBaselines`
- Schemas: `RunCostEstimateSchema`, `CostPredictionSchema`
- Constants: `MAX_EXPERIMENT_BUDGET_USD`
- Types: `PipelinePhase`, `GenerationStep`, `GenerationStepName`, `DiffMetrics`, `EloAttribution`, `AgentAttribution`

### 10. Documentation Status ✓ VERIFIED
- `architecture.md` — **Already updated for V2** ✓
- `visualization.md` — **Already updated for V2** ✓
- `data_model.md` — **Partially outdated**: references removed 'minimal'/'batch' pipeline types
- `cost_optimization.md` — **Partially outdated**: references ExecutionContext, claims 11 agents

## Open Questions (ALL RESOLVED)

1. **Runner V1 imports** — RESOLVED: Should be eliminated. V2 creates its own cost tracker/logger internally. Runner should pass a raw LLM provider.
2. **strategyConfig.ts** — RESOLVED: `strategyFormUtils.ts` is dead (functions never called). `labelStrategyConfig()` is still live (used by V2 strategy.ts). File can be pruned but not fully deleted.
3. **config.ts** — RESOLVED: **DEAD**. Only consumer is dead configValidation.ts. Constants re-exported but never imported.
4. **budgetRedistribution.ts** — RESOLVED: Complete dead cascade confirmed. All consumers are dead.
5. **Scope boundary** — Docs updates for data_model.md and cost_optimization.md should happen in this project where code changes directly impact them.

## Quantified Impact Summary

| Category | LOC Savings | Effort | Risk |
|----------|-------------|--------|------|
| Delete dead V1 files + tests (12 files) | 1,600 | Low | Zero |
| Runner V1→V2 migration (eliminate double-wrap) | ~444 (V1 files become deletable) | Medium | Low |
| Merge arena/prompt services | ~150 | Low | Low |
| Extract service query helpers | ~100 | Low | Low |
| V2 code simplification | ~120-140 | Medium | Low |
| Types cleanup (dead types + AgentName) | ~50 | Low | Low |
| Barrel export cleanup (11 dead exports) | ~15 | Trivial | Zero |
| Admin UI component dedup (adopt existing shared) | ~100 | Low | Low |
| Delete config.ts | ~91 | Trivial | Zero |
| **Total** | **~2,670-2,690** | **~4-6 days** | **Low** |
