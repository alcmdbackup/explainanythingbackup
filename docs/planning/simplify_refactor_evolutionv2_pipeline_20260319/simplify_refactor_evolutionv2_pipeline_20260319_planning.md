# Simplify Refactor Evolutionv2 Pipeline Plan

## Background
The evolution V2 pipeline is the sole production pipeline (~2,507 LOC). V1's pipeline.ts, PoolSupervisor, and AgentBase were fully deleted, but significant V1 remnants linger: 12 dead files (1,600 LOC), a runner that double-wraps V1/V2 cost tracking, duplicated services, and a confusing `core/` vs `v2/` directory split that no longer reflects reality. This project cleans it all up.

## Requirements (from GH Issue #740)
Look for ways to streamline and simplify our evolution V2 pipeline.

## Problem
The evolution module has accumulated technical debt from the V1→V2 transition. Dead V1 files (1,600 LOC) remain alongside live code, the runner creates V1 costTracker/llmClient/logger objects that V2 silently discards and re-creates internally, two service files CRUD the same database table, and the directory structure (`core/` for V1 remnants, `v2/` for production code) implies a separation that no longer exists. This makes the codebase harder to navigate, increases maintenance burden, and creates confusion about which code is authoritative.

## Options Considered

### Option A: Delete dead code only (minimal)
- Delete 12 dead files + 11 dead barrel exports
- Pros: Lowest risk, immediate clarity
- Cons: Doesn't fix runner double-wrapping or directory confusion

### Option B: Delete dead code + fix runner + merge directories (recommended)
- Delete dead code, migrate runner to raw provider, flatten `core/` + `v2/` into unified structure
- Pros: Fully eliminates V1/V2 confusion, makes V2 self-contained
- Cons: More import path changes (mechanical but noisy diffs)

### Option C: Option B + V2 code simplification + service consolidation (full cleanup)
- Everything in B plus extracting phase executor, merging prompt templates, consolidating duplicated services
- Pros: Maximum improvement in one pass
- Cons: Larger scope, more testing

**Decision: Option C** — Do the full cleanup. Each phase is independently testable, and the risk is low throughout.

## Phased Execution Plan

### Phase 1: Delete Dead V1 Files (1,600 LOC)
Delete 12 confirmed-dead files and their tests. Remove 11 dead exports from barrel.

**Files to delete:**
- `evolution/src/lib/core/configValidation.ts` (65 LOC) + test (70 LOC)
- `evolution/src/lib/core/costEstimator.ts` (301 LOC) + test (601 LOC)
- `evolution/src/lib/core/agentToggle.ts` (37 LOC)
- `evolution/src/lib/core/budgetRedistribution.ts` (75 LOC) + test (95 LOC)
- `evolution/src/lib/core/jsonParser.ts` (54 LOC) + test (77 LOC)
- `evolution/src/lib/config.ts` (91 LOC)
- `evolution/src/services/evolutionRunClient.ts` (57 LOC) + test (135 LOC)
- `src/app/admin/evolution/strategies/strategyFormUtils.ts` (33 LOC)

**Barrel cleanup (`evolution/src/lib/index.ts`) — remove 11 dead exports:**
- `toggleAgent`, `computeCostPrediction`, `refreshAgentCostBaselines`
- `RunCostEstimateSchema`, `CostPredictionSchema`
- `MAX_EXPERIMENT_BUDGET_USD`
- `PipelinePhase`, `GenerationStep`, `GenerationStepName`, `DiffMetrics`, `EloAttribution`, `AgentAttribution`

**Verify:** `npm run build && npm test` — no imports should break since nothing consumed these.

### Phase 2: Migrate Runner to Raw Provider (eliminate double-wrapping)
Replace V1 imports in `evolutionRunnerCore.ts` with a simple raw LLM provider, making V2 fully self-contained.

**Current flow (lines 75-98):**
```
V1 costTracker → V1 logger → V1 llmClient → thin provider wrapper → executeV2Run()
  Inside V2: creates V2 costTracker + V2 llmClient (V1 tracker is dead weight)
```

**New flow:**
```
raw provider (calls callLLM directly) → executeV2Run()
  Inside V2: creates V2 costTracker + V2 llmClient (unchanged)
```

**Changes:**
1. Remove V1 imports from `evolutionRunnerCore.ts` (lines 75-77)
2. Replace cost tracker + logger + LLM client creation (lines 79-87) with simple raw provider
3. Delete now-unused V1 files:
   - `evolution/src/lib/core/costTracker.ts` (154 LOC) + test
   - `evolution/src/lib/core/llmClient.ts` (163 LOC) + test
   - `evolution/src/lib/core/logger.ts` (127 LOC) + test
4. Remove their exports from `evolution/src/lib/index.ts`

**Verify:** Run evolution pipeline locally or via test to confirm runs still execute correctly.

### Phase 3: Types Cleanup (~50 LOC)
Remove dead types from `evolution/src/lib/types.ts`:

1. Remove `CalibrationExecutionDetail` (lines 170-187)
2. Remove `TournamentExecutionDetail` (lines 189-204)
3. Remove `'calibration'` and `'tournament'` from `AgentName` union
4. Remove these from the `AgentExecutionDetail` discriminated union
5. Update `evolution/src/testing/executionDetailFixtures.ts` to remove corresponding fixtures

**Verify:** `npm run build && npm test`

### Phase 4: Merge Directory Structure
Eliminate the `core/` vs `v2/` split. After phases 1-2, `core/` contains only shared utilities — no "V1 pipeline" remains.

**New structure:**
```
evolution/src/lib/
├── pipeline/              # ← v2/ contents (the production pipeline)
│   ├── evolve-article.ts
│   ├── rank.ts
│   ├── generate.ts
│   ├── evolve.ts
│   ├── runner.ts
│   ├── finalize.ts
│   ├── arena.ts
│   ├── experiments.ts
│   ├── cost-tracker.ts
│   ├── llm-client.ts
│   ├── run-logger.ts
│   ├── seed-article.ts
│   ├── strategy.ts
│   ├── invocations.ts
│   ├── types.ts
│   ├── errors.ts
│   └── index.ts
├── utils/                 # ← shared core/ + agents/ utilities
│   ├── rating.ts
│   ├── comparison.ts
│   ├── reversalComparison.ts
│   ├── comparisonCache.ts
│   ├── formatValidator.ts
│   ├── formatRules.ts
│   ├── formatValidationRules.ts
│   ├── textVariationFactory.ts
│   └── errorClassification.ts
├── types.ts               # Shared types (stays at lib root)
├── index.ts               # Barrel (simplified after dead export removal)
└── (core/ and agents/ directories deleted)
```

**Remaining files to handle:**
- `core/strategyConfig.ts` → keep `labelStrategyConfig()` in `utils/strategyConfig.ts`; delete dead `StrategyConfig`/`StrategyConfigRow` types
- `core/seedArticle.ts` → move to `utils/seedArticle.ts` (used by CLI scripts)

**Import path updates (~30 files):**
- V2 files: `../core/rating` → `../utils/rating`, `../comparison` → `../utils/comparison`, etc.
- V2 files: `../agents/formatValidator` → `../utils/formatValidator`
- External files: `@evolution/lib/v2/*` → `@evolution/lib/pipeline/*` (3 files)
- External files: `@evolution/lib/core/*` → `@evolution/lib/utils/*`
- Test files: same pattern

**Verify:** `npm run build && npm test` — purely mechanical refactor, no logic changes.

### Phase 5: V2 Code Simplification (~120-140 LOC savings)

**5a. Extract phase executor in evolve-article.ts (320 → ~280 LOC)**
- Extract the 9-line BudgetExceededError handling block repeated 3x into `executePhase()` helper
- Converts 3 try-catch blocks into 3 `executePhase()` calls

**5b. Share prompt templates across generate.ts + evolve.ts (~30 LOC savings)**
- Extract shared prompt structure to `pipeline/prompts.ts`
- Template function takes strategy-specific instructions, returns full prompt
- Replaces 7 inline prompt builders with data-driven template calls

**5c. Merge cost functions in llm-client.ts (~10 LOC savings)**
- Merge `estimateCost()` and `computeActualCost()` into single `calculateCost()` function

**5d. Single-pass strategy aggregation in finalize.ts (~10 LOC savings)**
- Replace double-loop grouping with single reduce pass

**Verify:** Run existing V2 test suite — all tests should pass unchanged.

### Phase 6: Service Consolidation (~250 LOC savings)

**6a. Merge arenaActions.ts + promptRegistryActionsV2.ts**
Both CRUD `evolution_arena_topics`. Merge into single `arenaActions.ts`:
- Keep arena-specific sub-resource actions (entries, comparisons)
- Add prompt-specific actions (update, delete)
- Update admin UI imports: `prompts/page.tsx` and `arena/page.tsx`

**6b. Extract shared service helpers**
- `queryHelpers.ts`: batch enrichment helper (used 8+ times), pagination builder (used 6+ times)
- Reduces boilerplate in `evolutionActions.ts`, `evolutionVisualizationActions.ts`, `variantDetailActions.ts`

**6c. Fix variant lineage N+1 query**
- Replace `getVariantLineageChainAction`'s while-loop with recursive SQL CTE

**Verify:** Admin UI manual testing — all evolution pages load and function correctly.

### Phase 7: Admin UI Component Dedup (~100 LOC savings)

**7a. Adopt existing shared StatusBadge**
- `StatusBadge.tsx` already exists in `evolution/src/components/evolution/`
- Replace 3 inline `STATE_BADGES` definitions in experiment components with shared import

**7b. Adopt existing shared MetricGrid**
- `MetricGrid.tsx` already exists
- Replace 3 inline MetricCard/InfoCard/SummaryCard implementations

**7c. Consolidate error boundaries**
- Extract shared `EvolutionErrorBoundary` component
- Replace 13 identical `error.tsx` files with re-exports

**Verify:** Visual check of experiment, variant, invocation detail pages.

## Testing

### Automated
- `npm run build` — TypeScript compilation (catches broken imports)
- `npm run lint` — Lint checks
- `npm test` — All unit tests (2,665 V2 test LOC + shared utility tests)
- Existing V2 test suite covers all pipeline logic; no new tests needed for deletion/refactoring phases

### New tests
- Phase 2: Verify runner creates raw provider correctly (unit test for new provider function)
- Phase 5a: Test `executePhase()` helper with mock phase function + BudgetExceededError
- Phase 5b: Test prompt template function produces correct output for each strategy

### Manual verification
- After Phase 2: Trigger a test evolution run via admin UI or CLI to confirm pipeline executes end-to-end
- After Phase 6: Navigate all admin evolution pages, verify data loads correctly
- After Phase 7: Visual check experiment/variant/invocation detail pages render correctly

## Documentation Updates
Research verified which docs are already V2-accurate vs outdated:

- `evolution/docs/evolution/architecture.md` — **Already V2-accurate** ✓ No changes needed
- `evolution/docs/evolution/visualization.md` — **Already V2-accurate** ✓ No changes needed
- `evolution/docs/evolution/data_model.md` — **Partially outdated**: references removed 'minimal'/'batch' pipeline types; update after Phase 3
- `evolution/docs/evolution/cost_optimization.md` — **Partially outdated**: references ExecutionContext, claims 11 agents; update after Phase 2
- `evolution/docs/evolution/reference.md` — Update key file paths after Phase 4 (directory restructure)
- `evolution/docs/evolution/README.md` — Update directory map after Phase 4
- `evolution/docs/evolution/rating_and_comparison.md` — No changes needed (rating system unchanged)
- `evolution/docs/evolution/experimental_framework.md` — No changes needed
