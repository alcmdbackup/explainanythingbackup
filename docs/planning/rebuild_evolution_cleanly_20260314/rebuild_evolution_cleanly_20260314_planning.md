# Rebuild Evolution Cleanly Plan

## Background
Rebuild the evolution pipeline into evolution V2. The goal is to do this incrementally using testable milestones, greatly simplifying the system and improving understanding of how it works.

## Requirements (from GH Issue #712)
Rebuild the evolution pipeline into evolution V2. Do this incrementally using testable milestones, so the system can be greatly simplified and better understood.

## Problem
The current evolution system is 123K LOC across 564 files with 14 agents (2 dead), 85 server actions, and 21 DB tables. The pipeline orchestrator alone is 904 LOC with 4-level nested try-catch. 56% of pipeline state fields are over-engineered (10/18 removable). The two-phase supervisor, hardcoded agent ordering, and dual in-place/immutable state API make the system hard to understand, debug, and extend. A V2 rebuild can reduce the core to ~1K LOC with a single function, local state, and helper functions.

## Key Design Decisions

### Decision 1: No Checkpointing (Short Runs)

V2 runs complete in one shot (<10 min). No checkpoint table, no serialization, no resume logic, no continuation_pending status. If a run crashes, re-run it — cost is <$1.

**What this eliminates:**
- `evolution_checkpoints` table writes
- `serializeState()` / `deserializeState()` (~150 LOC)
- `checkpoint_and_continue` RPC
- `continuation_pending` status + all continuation logic
- Watchdog checkpoint recovery path
- Resume logic in runner (~80 LOC)
- ComparisonCache persistence

**Constraint:** V2 runs must be fast enough to complete in one shot. Long runs (50 iterations) require the minicomputer runner (no timeout). Vercel cron (~13 min limit) works for V2's target of 3-10 iterations.

### Decision 2: One Function, Not Agent Classes
No AgentBase class, no ExecutionContext, no canExecute(), no estimateCost(), no PipelineAction union, no reducer. The pipeline is a single async function with helper functions for each phase (generate, rank, evolve). State is local variables in function scope.

**Cost tracking and timeline views are preserved** via labeled LLM calls and invocation rows:
```typescript
// Inside the evolve function body — no class needed:
const invId = await createInvocation(runId, iter, 'generation');
const variants = await generateVariants(topVariant, llm, 'generation');
await updateInvocation(invId, { cost: llm.lastCost, variantsAdded: variants.length });
```
The admin timeline tab reads from `evolution_agent_invocations` — it doesn't care whether a class or a function wrote those rows.

**What this eliminates:**
- `AgentBase` class, `canExecute()`, `estimateCost()`
- `ExecutionContext` type (14-field object passed to every agent)
- `PipelineAction` union (8 types), `reducer.ts`, `applyActions()`
- `PipelineStateImpl` class (18 fields, dual mutable/immutable API)
- Agent selection/toggling UI and budget redistribution
- `createDefaultAgents()` factory
- `AGENT_EXECUTION_ORDER` constant, `PoolSupervisor`

**What's preserved:**
- Per-phase cost tracking (via LLM call labels)
- Per-iteration timeline (via invocation rows with agent_name)
- Per-phase execution detail (via invocation execution_detail JSONB)
- Admin UI compatibility (same invocation table schema)

### Decision 3: Radically Simplify Services Layer
The current 79 server actions across 9 files (5,829 LOC) are ~70% boilerplate. Each action repeats the same 14-line pattern: `withLogging` → `requireAdmin` → `createSupabaseServiceClient` → try/catch → `ActionResult`. 10 actions are completely dead (never imported outside tests). ~40 are thin CRUD wrappers around a single Supabase query.

**Approach: `adminAction` factory + dead code removal**

Replace the 14-line-per-action boilerplate with a shared factory:
```typescript
// Defined once:
function adminAction<TInput, TOutput>(
  name: string,
  handler: (input: TInput, ctx: { supabase: SupabaseClient; adminUserId: string }) => Promise<TOutput>
) { /* auth + logging + error handling */ }

// Each action becomes 1-5 lines:
export const getPromptsAction = adminAction('getPrompts', async (filters, { supabase }) => {
  const { data } = await supabase.from('evolution_arena_topics').select('*').eq('status', filters.status ?? 'active');
  return data;
});
```

**What this eliminates:**
- 10 dead actions (deferred to M10/M11 when consuming UI pages are replaced)
- ~440 LOC of repeated boilerplate across ~40 thin CRUD actions
- 4 duplicate copies of `UUID_REGEX` and `validateUuid()`
- 7 near-identical `ActionResult<T>` type definitions
- Duplicated error handling patterns across 9 files

**What's preserved:**
- All ~25 complex actions with real business logic (queue run, arena comparison, dashboard aggregation, metrics computation)
- Full type safety and action discoverability
- Existing admin UI works unchanged (same exported function names)

**Dead actions to remove:**
- Arena: `getPromptBankCoverageAction`, `getPromptBankMethodSummaryAction`, `getArenaLeaderboardAction`, `getCrossTopicSummaryAction`, `deleteArenaEntryAction`, `deleteArenaTopicAction`
- Experiments: `archiveExperimentAction`, `unarchiveExperimentAction`, `startManualExperimentAction`
- Strategies: `getStrategyPresetsAction`

**Services LOC impact:**
| Metric | Before | After |
|--------|--------|-------|
| Server actions | 79 | ~65 (10 dead removed in M10/M11 when UI pages replaced) |
| Total LOC | 5,829 | ~3,800 (factory eliminates boilerplate) |
| Files | 9 | 9 (same files, less code per file) |

## Options Considered

### Option A: Refactor V1 In-Place
- **Cons**: High risk, can't simplify fundamental architecture

### Option B: V2 in Parallel Directory (CHOSEN)
- Build V2 in `evolution/src/lib/v2/`, V1 untouched
- Reuse proven modules (rating, comparison, format validation)
- **Pros**: Zero disruption, testable milestones, radical simplification

### Option C: Complete Rewrite
- **Cons**: Highest risk, loses battle-tested comparison/rating code

## Phased Execution Plan

### Milestone 1: Core Types + Reusable V1 Modules
**Goal**: Define minimal V2 types and verify V1 modules (rating, comparison, format validation) work standalone.

**Files to create**:
- `evolution/src/lib/v2/index.ts` (~80 LOC) — V2 barrel module. Re-exports all V1 reused symbols and V2-defined types/functions. This is the single entry point for all V2 consumers (`import { ... } from '@evolution/lib/v2/'`). See "V2 barrel re-export list" below for the complete symbol list with source paths.
- `evolution/src/lib/v2/types.ts` (~130 LOC) — V2-specific types plus re-exports from V1.
  - **TextVariation**: `export type { TextVariation } from '../types'` — re-export V1's type directly. Single source of truth, guarantees type identity when V2 variations are passed to V1 modules. V1's `textVariationFactory.ts` returns this same type so its `createTextVariation` can be re-exported without forking.
  - **Rating**: `export type { Rating } from '../core/rating'` — re-export, not redefined.
  - **V2Match**: V2-specific type: `{ winnerId: string; loserId: string; result: 'win' | 'draw'; judgeModel: string; reversed: boolean }`. Named `V2Match` (not `Match`) to avoid collision with V1's `Match` type (which uses `variationA`/`variationB`/`winner` fields). V2Match is used exclusively within V2's rank.ts and evolveArticle — it never crosses the V1 boundary. V1 modules never receive or return V2Match. No adapter needed. **Persistence**: when EvolutionResult.matchHistory is persisted to DB (M4), V2Match fields map directly to `evolution_agent_invocations.execution_detail` JSONB — no schema migration needed.
  - **EvolutionConfig**: V2's simplified, flat run config. Required fields: `iterations: number` (← V1 `maxIterations`), `budgetUsd: number` (← V1 `budgetCapUsd`), `judgeModel: string`, `generationModel: string`. Optional fields: `strategiesPerRound?: number` (← V1 `generation.strategies` — number of generation strategies to run per iteration, each producing one variant; named to match V1 semantics), `calibrationOpponents?: number` (← V1 `calibration.opponents`), `tournamentTopK?: number` (← V1 `tournament.topK`). **Fields dropped from V1 EvolutionRunConfig**: `plateau` (deprecated), `expansion` (V2 uses a fixed-size pool — no expansion phase; pool starts with initial seed + first generation and stays bounded by tournament selection), `budgetCaps` (deprecated), `calibration.minOpponents` (V2 uses calibrationOpponents as exact count). No Zod schema in M1 — runtime validation deferred to M3 (evolveArticle entry point validates config before running). **Defaults for optional fields** (applied by evolveArticle in M3): `strategiesPerRound` defaults to 3, `calibrationOpponents` defaults to 5, `tournamentTopK` defaults to 5. M2's rank.ts must handle undefined defensively (use `config.tournamentTopK ?? 5` etc.).
  - **EvolutionResult**: `{ winner: TextVariation; pool: TextVariation[]; ratings: Map<string, Rating>; matchHistory: V2Match[]; totalCost: number; iterationsRun: number; stopReason: 'budget_exceeded' | 'iterations_complete' | 'converged' | 'killed'; muHistory: number[][]; diversityHistory: number[] }`. `iterationsRun` (not `iterations`) to avoid name collision with EvolutionConfig.iterations. `muHistory[i]` is array of mu values for top-K variants after iteration i. `diversityHistory[i]` is pairwise text diversity score after iteration i.
- `evolution/src/lib/v2/strategy.ts` (~55 LOC) — Forked from V1 `evolution/src/lib/core/strategyConfig.ts`. **What is copied**: `hashStrategyConfig()` function body (~18 LOC — builds normalized object from config fields, JSON.stringify, crypto.createHash('sha256')), `labelStrategyConfig()` function body (~15 LOC — builds human-readable label from config fields), `shortenModel()` helper (~5 LOC — strips provider prefixes). **What is NOT copied**: `extractStrategyConfig` (uses Zod + AllowedLLMModelType), `diffStrategyConfigs` (uses AgentName), `normalizeEnabledAgents` (uses AgentName), `defaultStrategyName` (uses EVOLUTION_DEFAULT_MODEL). **Dependencies of forked code**: only `crypto.createHash` (Node built-in) — no external imports.
  - **V2StrategyConfig type**: `{ generationModel: string; judgeModel: string; iterations: number; strategiesPerRound?: number; budgetUsd?: number }`. This is a **separate type from V1's StrategyConfig** — NOT a Pick/subtype/supertype. V1's StrategyConfig has `agentModels?`, `enabledAgents?`, `singleArticle?`, `budgetCapUsd?` which V2 does not use, and V2 has `strategiesPerRound?`, `budgetUsd?` which V1 does not have. The two types are **structurally incompatible** in both directions. V2 code never passes V2StrategyConfig to V1 functions and vice versa — each system uses its own config type. The forked `hashStrategyConfig` and `labelStrategyConfig` accept `V2StrategyConfig`, not V1's type.
  - **Hash fields**: V2's `hashStrategyConfig()` hashes ONLY `generationModel`, `judgeModel`, `iterations`. V2-only fields (`strategiesPerRound`, `budgetUsd`) are excluded from hash (matching V1 precedent where `budgetCapUsd` is excluded). V1's hash conditionally includes `enabledAgents` and `singleArticle`. Hashes match V1 ONLY for V1 configs where `enabledAgents` was absent/undefined/empty and `singleArticle` was absent/undefined/false. Cross-compatibility for V1-only fields is NOT a goal.
  - **labelStrategyConfig behavioral delta**: V2's fork produces simpler labels (no `agentModels`, `enabledAgents`, `singleArticle`, `budgetCapUsd` segments). Test verifies V2 label format, not V1 parity.

**Files to reuse from V1 (import directly via barrel, no changes, no forks)**:
- `evolution/src/lib/core/rating.ts` — Rating type, createRating, updateRating, updateDraw, toEloScale, isConverged, eloToRating, computeEloPerDollar, DEFAULT_MU, DEFAULT_SIGMA, DEFAULT_CONVERGENCE_SIGMA, ELO_SIGMA_SCALE, DECISIVE_CONFIDENCE_THRESHOLD (78 LOC)
- `evolution/src/lib/comparison.ts` — ComparisonResult type, buildComparisonPrompt, parseWinner, aggregateWinners, compareWithBiasMitigation (145 LOC). **Note on transitive deps**: comparison.ts imports from `./core/reversalComparison` — this resolves from comparison.ts's own directory (evolution/src/lib/), not from V2's. Re-exporting via V2 barrel does NOT change V1's internal import resolution.
- `evolution/src/lib/core/reversalComparison.ts` — ReversalConfig<TParsed, TResult> type, run2PassReversal (39 LOC)
- `evolution/src/lib/core/comparisonCache.ts` — ComparisonCache class, CachedMatch type, MAX_CACHE_SIZE (95 LOC). **Note**: ComparisonCache's `get(textA, textB, structured, mode)` / `set()` API is NOT compatible with `compareWithBiasMitigation`'s `cache?: Map<string, ComparisonResult>` parameter. V2's `rank.ts` (M2) will manage its own `Map<string, ComparisonResult>`. ComparisonCache + CachedMatch re-exported as convenience for higher-level dedup. V2 internals do NOT use ComparisonCache.
- `evolution/src/lib/agents/formatValidator.ts` — FormatResult type, validateFormat (89 LOC). **Env var**: reads `process.env.FORMAT_VALIDATION_MODE` at call time (default: 'reject' — safe default). V2 inherits this dependency. Documented in V2 barrel JSDoc. Edge runtime / worker threads are not a concern for M1 — V2 runs in Node.js only (same as V1).
- `evolution/src/lib/agents/formatRules.ts` — FORMAT_RULES (8 LOC)
- `evolution/src/lib/core/formatValidationRules.ts` — Internal helpers used by formatValidator.ts (104 LOC). NOT re-exported from V2 barrel. Remain accessible via direct V1 import for V1 consumers (e.g., sectionFormatValidator.ts).
- `evolution/src/lib/core/errorClassification.ts` — isTransientError function (43 LOC). **External dependency**: imports `{ APIConnectionError, RateLimitError, InternalServerError }` from `openai` SDK — NOT zero-coupling as previously stated, but `openai` is already a project dependency so this is safe. Used by M3's V2 EvolutionLLMClient wrapper for retry logic.
- `evolution/src/lib/core/textVariationFactory.ts` — createTextVariation function (26 LOC). **Not forked** — re-exported directly. V1's `import type { TextVariation } from '../types'` is erased at compile time; the returned TextVariation is the same V1 type that V2 re-exports. Confirmed: V2's `TextVariation` and textVariationFactory's returned type are the identical type reference (both resolve to `evolution/src/lib/types.ts:TextVariation`). **Note**: `CreateTextVariationParams` is NOT exported from V1 (it's a module-internal interface). Consumers can infer parameter shape via `Parameters<typeof createTextVariation>[0]`.
- `evolution/src/lib/types.ts` — EvolutionLLMClient interface, LLMCompletionOptions interface, BudgetExceededError class. These are type-only re-exports (interfaces erased at compile time) except BudgetExceededError which is a runtime class. **Note**: types.ts imports Zod schemas at top-level, so the barrel's runtime `export { BudgetExceededError } from '../types'` pulls in V1's types module and its transitive Zod dependency. Acceptable since V2 runs in the same process. **`createEvolutionLLMClient` intentionally excluded from M1 barrel**: the factory function lives in `evolution/src/lib/core/llmClient.ts` and is an M3 concern (V2 will wrap it in a V2-specific LLM client). M1 re-exports only the interfaces for type annotations.

**V2 barrel re-export list** (`evolution/src/lib/v2/index.ts`): Complete, explicit — no "etc." or implicit additions. Each entry includes its V1 source path for the barrel's `export` statement:
- **Types (from `../types`)**: TextVariation, EvolutionLLMClient, LLMCompletionOptions. **Transitive dependency note**: EvolutionLLMClient's `completeStructured` method uses `z.ZodType<T>` in its signature (Zod dependency), and LLMCompletionOptions.model uses `AllowedLLMModelType` from `@/lib/schemas/schemas` (app-layer dependency). These transitive deps are acceptable since V2 runs in the same project with the same module aliases, but V2 consumers of these types inherit the Zod + app-schema coupling. This is a conscious trade-off: re-exporting the exact V1 interface preserves type identity for callers that pass V2-wrapped clients to V1 modules.
- **Types (from other V1 modules)**: Rating (from `../core/rating`), ComparisonResult (from `../comparison`), CachedMatch (from `../core/comparisonCache`), ReversalConfig (from `../core/reversalComparison`), FormatResult (from `../agents/formatValidator`)
- **Classes (from `../types`)**: BudgetExceededError — runtime class, creates a runtime dependency on V1's types module which imports Zod schemas at top-level; acceptable since both run in same process
- **Types (V2-defined, from `./types`)**: V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig (exported as `V2StrategyConfig` to avoid name collision with V1's `StrategyConfig`)
- **Rating functions** (from `../core/rating`): createRating, updateRating, updateDraw, toEloScale, isConverged, eloToRating, computeEloPerDollar
- **Rating constants** (from `../core/rating`): DEFAULT_MU, DEFAULT_SIGMA, DEFAULT_CONVERGENCE_SIGMA, ELO_SIGMA_SCALE, DECISIVE_CONFIDENCE_THRESHOLD
- **Comparison** (from `../comparison`): compareWithBiasMitigation, parseWinner, aggregateWinners, buildComparisonPrompt
- **Reversal** (from `../core/reversalComparison`): run2PassReversal
- **Cache** (from `../core/comparisonCache`): ComparisonCache, MAX_CACHE_SIZE
- **Format** (validateFormat from `../agents/formatValidator`, FORMAT_RULES from `../agents/formatRules`): validateFormat, FORMAT_RULES
- **Factory** (from `../core/textVariationFactory`): createTextVariation
- **Error classification** (from `../core/errorClassification`): isTransientError
- **V2 strategy** (from `./strategy`): hashStrategyConfig, labelStrategyConfig (shortenModel is internal — NOT exported)

**Prerequisites**:
- Install `expect-type` as a devDependency: `npm install -D expect-type` (not currently installed; needed for type-level assertions in types.test.ts)

**Files to modify** (non-V1 source files):
- `package.json` — Add `expect-type` devDependency (via `npm install -D expect-type`), add `"test:v1-regression"` script. These are project-level config changes, not V1 source modifications. Rollback includes reverting these changes.

**Test strategy**:
- **V1 regression gate**: Run ALL V1 tests (`npm test -- --testPathPattern='evolution/src/lib/' --testPathIgnorePatterns='v2/'`) BEFORE and AFTER adding V2 barrel. Uses `--testPathIgnorePatterns='v2/'` to avoid excluding V1 tests outside core/agents/. This is a local pre-merge check enforced via a package.json script: `"test:v1-regression": "jest --testPathPattern='evolution/src/lib/' --testPathIgnorePatterns='v2/'"`. **CI note**: CI uses `npm run test:ci -- --changedSince="origin/${BASE_REF}"`, which runs tests affected by changed files. For M1, v2/ files are new so their tests WILL run. However, in later milestones where only V1 files change, v2/ tests may NOT run unless Jest's dependency graph traces the change through. The V1 regression gate is a separate local check, not a CI step. **CI gap accepted**: local-only enforcement means V1 regressions could slip if the developer skips the check, but the risk is low since M1 only adds new files and does not modify V1 code. For M2+ milestones that modify V1 modules, consider adding `test:v1-regression` to CI. **Flaky test note**: the `--testPathPattern` matches ALL tests under `evolution/src/lib/` including heavyweight integration tests (pipeline.test.ts, arena.test.ts). If any are flaky, add `--bail` to fail fast, or narrow scope to just reused-module tests listed below.
- Rerun V1 tests for all reused modules (rating.test.ts, comparison.test.ts, comparisonCache.test.ts, formatValidator.test.ts, formatValidationRules.test.ts, reversalComparison.test.ts, textVariationFactory.test.ts, strategyConfig.test.ts, errorClassification.test.ts)
- V2 type compile tests at `evolution/src/lib/v2/types.test.ts` (~45 LOC): verify V2 TextVariation is identical to V1 (`expectTypeOf<V2.TextVariation>().toEqualTypeOf<V1.TextVariation>()` using `expect-type` library — installed as prerequisite); verify EvolutionConfig required fields (iterations, budgetUsd, judgeModel, generationModel) and optional fields (strategiesPerRound, calibrationOpponents, tournamentTopK); verify EvolutionResult shape including all fields; verify V2StrategyConfig is NOT assignable to V1 StrategyConfig (separate types); verify V2Match is NOT assignable to V1 Match
- V2 forked strategy.ts test at `evolution/src/lib/v2/strategy.test.ts` (~45 LOC): verify hashStrategyConfig produces identical hashes to V1 for configs with ONLY generationModel/judgeModel/iterations; test V2 hash matches V1 hash when V1's `enabledAgents` is absent/undefined (V1's `normalizeEnabledAgents` turns `[]` into `undefined`, and `hashStrategyConfig` skips falsy enabledAgents — so `enabledAgents=[]` produces the same hash as omitted; `singleArticle` is only included when truthy, so `undefined`/`false`/absent all match); verify V2 hash covers ONLY generationModel/judgeModel/iterations (V2-only fields strategiesPerRound and budgetUsd are NOT included in the hash — matching V1 precedent where budgetCapUsd is excluded from hash); verify labelStrategyConfig output format (V2 format, simpler than V1); verify shortenModel behavior indirectly via label output
- V2 barrel smoke test at `evolution/src/lib/v2/index.test.ts` (~50 LOC): assert `require.resolve('@evolution/lib/v2/')` succeeds (moduleNameMapper works); **dynamic `import('@evolution/lib/v2/')` test** to force full transitive dependency resolution at runtime (catches broken internal imports that static re-exports wouldn't surface); verify every exported symbol is defined and has correct typeof (functions are 'function', classes have prototype, constants have expected types); cover ALL symbols from barrel list above — no subset. **Note**: tsc compilation (already run in CI) provides real import resolution validation for production; this test covers the Jest/dev environment. **openai mock compatibility**: `errorClassification.ts` imports `{ APIConnectionError, RateLimitError, InternalServerError }` from `openai` — Jest uses the mock at `src/testing/mocks/openai.ts` (see jest.config.js moduleNameMapper). The dynamic import test will fail if the openai mock does not export these error classes. Verify the mock exports them, or add them if missing. The existing V1 `errorClassification.test.ts` already exercises this code path under the mock, so if V1 tests pass, the mock is adequate.

**Import strategy**: V2 barrel re-exports all V1 reused modules and V2-defined types/functions. Consumers always import from `@evolution/lib/v2/` — never from V1 paths directly. V1 barrel (`evolution/src/lib/index.ts`) remains untouched — V1 imports remain valid, V2 barrel is additive-only. **Name collision avoidance**: V2 uses `V2Match` and `V2StrategyConfig` to avoid ambiguity with V1's `Match` and `StrategyConfig`. **Path alias confirmed**: `tsconfig.json` already has `"@evolution/*": ["./evolution/src/*"]` under `compilerOptions.paths`, and `jest.config.js` has `'^@evolution/(.*)$': '<rootDir>/evolution/src/$1'` under `moduleNameMapper`. No changes needed — `@evolution/lib/v2/` resolves correctly in both tsc and Jest.

**Rollback plan**: M1 creates only new files in `evolution/src/lib/v2/` and does not modify any V1 source files. Non-source modifications: `package.json` (expect-type dep + test:v1-regression script) and `package-lock.json`. Revert = delete `v2/` directory + `git checkout package.json package-lock.json` (or revert the commit). Tag `git tag -a v2-m1-complete -m 'M1: V2 core types + barrel'` ONLY after all done-when criteria pass (annotated tag for future archaeology). If tag exists from prior failed attempt, delete first: `git tag -d v2-m1-complete`.

**Done when**: V2 index.ts (barrel) and types.ts created with: TextVariation re-exported from V1 (type identity confirmed), Rating re-exported, V2Match defined (separate from V1 Match), EvolutionConfig defined with field mapping from V1 EvolutionRunConfig, EvolutionResult fully specified; V2StrategyConfig defined as separate type (not sub/supertype of V1); all V1 module tests pass before and after V2 barrel (regression gate); V2 barrel re-exports complete explicit symbol list; createTextVariation re-exported from V1 (not forked); forked hashStrategyConfig/labelStrategyConfig produce correct output; dynamic import resolves full transitive dep tree; V2 type tests, strategy fork tests, and barrel smoke test all pass; annotated git tag created

**Depends on**: None

---

### Milestone 2: Helper Functions (Generate, Rank, Evolve)
**Goal**: Implement the three core helper functions as standalone, independently testable async functions.

**Files to create**:
- `evolution/src/lib/v2/generate.ts` (~100 LOC) — `generateVariants(text, iteration, llm, config, feedback?): Promise<TextVariation[]>`
  - `iteration: number` — passed to `createTextVariation` for `iterationBorn`
  - `feedback?: { weakestDimension: string; suggestions: string[] }` — optional guidance from M6 reflect, injected into prompts. Null when reflect is disabled.
  - Runs up to `config.strategiesPerRound ?? 3` strategies in parallel via `Promise.allSettled`, selected from the ordered list [structural_transform, lexical_simplify, grounding_enhance]. When `strategiesPerRound` < 3, uses the first N strategies; when > 3, caps at 3 (only 3 strategies exist — silently caps, no error). allSettled never throws — after settling, scan results: collect fulfilled variants, check for BudgetExceededError in rejected results. If any BudgetExceededError found, throw `BudgetExceededWithPartialResults` (defined in `evolution/src/lib/v2/errors.ts`, shared by generate.ts and evolve.ts, ~15 LOC: `class BudgetExceededWithPartialResults extends BudgetExceededError { constructor(public partialVariants: TextVariation[], originalError: BudgetExceededError) { super(originalError.agentName, originalError.spent, originalError.reserved, originalError.cap); } }` — V1's BudgetExceededError constructor is `(agentName: string, spent: number, reserved: number, cap: number)` at types.ts:512-517, confirmed compatible) carrying the fulfilled variants. If multiple strategies threw BudgetExceededError, the first one encountered (lowest array index) is used as `originalError`. The caller (evolveArticle M3) catches via `instanceof BudgetExceededWithPartialResults`, adds `partialVariants` to the pool, then exits with `stopReason='budget_exceeded'`. Same pattern used by evolve.ts. This preserves work from successful strategies. Other rejected results (non-budget LLM errors) are silently discarded (variant not produced for that strategy).
  - Calls validateFormat, createTextVariation
  - Prompt templates adapted from V1 generationAgent.ts. **Feedback information mapping**: V1's `MetaFeedback` has 4 arrays (recurringWeaknesses, priorityImprovements, successfulStrategies, patternsToAvoid). V2's feedback parameter is simplified to `{ weakestDimension, suggestions }` — intentional information reduction since V2 defers full meta-review to Appendix A. The weakestDimension maps to V1's top recurringWeakness; suggestions maps to priorityImprovements. successfulStrategies and patternsToAvoid are dropped until Appendix A reflect is implemented.

- `evolution/src/lib/v2/rank.ts` (~550 LOC — may reach 600; triage + Swiss + convergence + draw handling is denser than the other helpers) — `rankPool(pool: TextVariation[], ratings: Map<string, Rating>, matchCounts: Map<string, number>, newEntrantIds: string[], llm: EvolutionLLMClient, config: EvolutionConfig, budgetFraction?: number, cache?: Map<string, ComparisonResult>): Promise<{matches: V2Match[], ratingUpdates: Record<string, Rating>, matchCountIncrements: Record<string, number>, converged: boolean}>`
  - `budgetFraction?: number` — proportion of budget spent so far (0.0 = nothing spent, 1.0 = fully spent). Computed by caller (evolveArticle) as `1 - (costTracker.getAvailableBudget() / config.budgetUsd)` (matching V1 rankingAgent.ts:400-403 formula). Defaults to 0 (low pressure) when omitted. Used by budget pressure tiers.
  - **New entrant identification**: `newEntrantIds: string[]` parameter (passed by evolveArticle — variants added this iteration). Variants in `newEntrantIds` with sigma >= 5.0 go through triage. Already-triaged variants skip to fine-ranking.
  - **Edge cases**: pool.length < 2 → return empty matches, no rating updates. All new entrants with no existing variants (first iteration) → skip triage stratification, run fine-ranking only among the new entrants.
  - **Stratified opponent selection** (~45 LOC, inlined — NOT importing V1's PoolManager, which has V1 type deps on PipelineState/TextVariation arrays with V1-specific fields): For n=5 opponents: 2 from top quartile by mu, 2 from middle, 1 from bottom. Logic adapted from V1's `pool.ts:15-74` but reimplemented against V2's `pool: TextVariation[]` + `ratings: Map<string, Rating>` parameters (Map chosen to match V1's internal Map-based algorithm code — avoids needless Object.entries conversion; the return type `ratingUpdates` uses `Record<string, Rating>` for serialization-friendly output). Preferentially uses fellow new entrants for the bottom slot (falls back to bottom quartile if no other new entrants). V1's `state.newEntrantsThisIteration` maps to V2's `newEntrantIds` parameter; V1's `state.pool` maps to V2's `pool` parameter; V1's `state.ratings` (Map) maps to V2's `ratings` parameter (Map). Edge cases from V1's pool.ts: fewer existing than n-1 → use all available + pad with fellow new entrants; no ratings yet → random selection; n < 5 → proportionally reduce per-tier counts (minimum 1 top, 1 middle); n < 3 → return all available.
  - **Triage phase**: New entrants matched against stratified opponents sequentially (for-loop, not parallel — enables per-match sequential elimination like V1 rankingAgent.ts). Adaptive early exit: skip remaining opponents when `matchIndex >= MIN_TRIAGE_OPPONENTS - 1 AND decisiveCount >= MIN_TRIAGE_OPPONENTS AND avgConfidence >= 0.8` (the `matchIndex` guard ensures at least MIN_TRIAGE_OPPONENTS matches have been played before checking, matching V1 rankingAgent.ts:292's `i >= minOpp - 1` index guard). `MIN_TRIAGE_OPPONENTS = 2` is a local constant in rank.ts (V1's `calibration.minOpponents ?? 2` hardcoded since V2 drops that config field — see M1 EvolutionConfig note). `decisiveCount` = number of matches with confidence >= 0.7. Sequential elimination: variants where `mu + 2*sigma < top20%Cutoff` are dropped from fine-ranking.
  - **Fine-ranking phase**: Swiss pairing scored by `outcomeUncertainty * sigmaWeight` — maximize information gain per comparison. `outcomeUncertainty = 1 - |2*pWin - 1|` using logistic approximation with `BETA = DEFAULT_SIGMA * Math.SQRT2` (from V1 rankingAgent.ts:82-87, NOT OpenSkill's internal CDF). Greedy pair selection, skipping already-played pairs. **Eligibility filter** for Swiss pairing: `mu >= 3*sigma OR in topKIds` (distinct from triage elimination filter).
  - **Draw handling**: In fine-ranking: confidence < 0.3 → treated as draw → `updateDraw()` instead of `updateRating()`. In triage: confidence === 0 OR winnerId === loserId → treated as draw (matching V1 rankingAgent.ts:194 which checks both conditions).
  - **Convergence detection**: Stops when all eligible variant sigmas < `DEFAULT_CONVERGENCE_SIGMA` (3.0, from V1 rating.ts — re-exported via V2 barrel; same value as V1 config.ts `RATING_CONSTANTS.CONVERGENCE_SIGMA_THRESHOLD` but accessed via barrel) for 2 consecutive Swiss rounds, or no new pairs remain. "Eligible" = variants where mu >= 3*sigma OR in tournamentTopK. **V2 preserves V1 convergence logic**: V1 already uses a 2-consecutive-round pattern (`convergenceChecks = 2` with `convergenceStreak` counter at rankingAgent.ts:447-450, 573-581). V2 replicates this identical behavior. **State tracking**: rank.ts tracks convergence internally via a local `consecutiveConvergedRounds` counter (incremented when all eligible sigmas < threshold, reset to 0 otherwise). **Return type convergence signal**: rank.ts returns `{ matches, ratingUpdates, matchCountIncrements, converged: boolean }` — the `converged` field is true when 2-round convergence is reached or no new pairs remain. The caller (evolveArticle M3) uses this to set `stopReason='converged'`.
  - **Budget pressure tiers**: Low (<50% spent) → up to 40 comparisons. Medium ([50%, 80%)) → up to 25. High (>=80%) → up to 15. Boundaries match V1: < 0.5 low, [0.5, 0.8) medium, >= 0.8 high.
  - **Comparison callback**: rank.ts wraps the LLM call in try/catch: `async (prompt) => { try { return await llm.complete(prompt, 'ranking', { model: config.judgeModel }); } catch (error) { if (error instanceof BudgetExceededError) throw error; return ''; } }`. BudgetExceededError is re-thrown to propagate to evolveArticle's loop (matching V1's calibrationRanker.ts:73 pattern). Other LLM errors (after retry exhaustion) return empty string → parseWinner returns null → `aggregateWinners` with one null produces a low-confidence (0.3) partial result for the non-null side (NOT a clean TIE); if BOTH passes return null → confidence=0.0 → treated as draw. run2PassReversal explicitly does NOT catch errors, so the callback MUST handle them.
  - **Cache**: Optional `cache?: Map<string, ComparisonResult>` parameter passed directly to `compareWithBiasMitigation`'s cache parameter. This is a simple Map, NOT the ComparisonCache class (see M1 note). **Cache behavior note**: `compareWithBiasMitigation` only caches results with confidence > 0.3 (comparison.ts:141). V1's rankingAgent had its own additional cache layer (lines 138-150) that cached ALL results including draws. V2 intentionally drops the per-draw caching — low-confidence results are re-evaluated if the same pair is encountered again, which provides fresh data. The caller (evolveArticle in M3) creates and maintains this Map across iterations.
  - **V1 features intentionally dropped**: Multi-turn debate tiebreaker, flow comparison (flowCritique agent). These are V1-only features not carried to V2.
  - **ratingUpdates format**: Returns ALL ratings (full snapshot, not diffs) — matches V1 rankingAgent.ts:641-643 pattern. Simpler for callers than diff-based approach.
  - **matches includes both phases**: Returns ALL matches (triage + fine-ranking combined) in the matches array. Callers (evolveArticle) append all to matchHistory.
  - Returns: `{ matches: V2Match[], ratingUpdates: Record<id, Rating>, matchCountIncrements: Record<id, number>, converged: boolean }`. `matchCountIncrements` are **deltas** (number of new matches played this call, not absolute totals) — the caller adds these to its running `matchCounts` map. `converged` is true when 2-round convergence or no-new-pairs condition is met.

- `evolution/src/lib/v2/evolve.ts` (~120 LOC) — `evolveVariants(pool, ratings, iteration, llm, config, options?): Promise<TextVariation[]>`
  - `iteration: number` — passed to `createTextVariation` for `iterationBorn`
  - `options?: { feedback?: { weakestDimension: string; suggestions: string[] }; diversityScore?: number }` — optional guidance from M6 reflect + diversity from M6 proximity. Both default to safe values when omitted.
  - **Parent selection**: Sort `pool` by descending mu from `ratings` Map, select top-2 as parents. If pool has only 1 variant, skip crossover (mutation-only). If pool is empty, return empty array. **Version**: new variants use `Math.max(...parents.map(p => p.version)) + 1` (matching V1 evolvePool.ts:236-237 pattern).
  - Mutate (clarity, structure) + crossover (blend best parts of 2 parents)
  - Optional creative exploration trigger (fires when `options.diversityScore > 0 && options.diversityScore < 0.5` — the `> 0` guard prevents trigger when diversityScore is 0/default. Defaults to 1.0 when omitted, so never fires until Appendix A proximity is implemented and caller passes the score)
  - Calls validateFormat, createTextVariation
  - **BudgetExceededError handling**: evolve.ts calls LLM for mutation + crossover. If LLM throws BudgetExceededError, it propagates directly (no partial results for evolve — unlike generate.ts which uses allSettled, evolve.ts uses sequential await so the error propagates immediately). The caller (evolveArticle M3) catches BudgetExceededError and exits with stopReason='budget_exceeded'.
  - **V1 features intentionally dropped**: Outline mutation, metaFeedback integration (replaced by Appendix A reflect feedback parameter), random creative exploration chance (V1's CREATIVE_RANDOM_CHANCE = 0.3 unconditional trigger is dropped — V2 creative exploration is deterministically tied to diversityScore only). **Behavioral note**: V2 without Appendix A produces less diverse variants than V1 (which had 30% random creative trigger). This is an accepted trade-off — V2 prioritizes deterministic behavior; diversity can be restored via Appendix A proximity.

- `evolution/src/lib/v2/errors.ts` (~15 LOC) — `BudgetExceededWithPartialResults` class (extends V1's `BudgetExceededError` with `partialVariants: TextVariation[]` field). Constructor: `(partialVariants: TextVariation[], originalError: BudgetExceededError)`. Shared by generate.ts and evolve.ts. Already referenced inline in generate.ts description above — this entry makes the file creation explicit.

**Files to reuse from V1**: Prompt templates (adapted, not called directly), algorithm patterns from rankingAgent.ts/pool.ts/evolvePool.ts (reimplemented against V2 types, not imported)

**M1 barrel additions already included**: BudgetExceededError, EvolutionLLMClient, and LLMCompletionOptions are already listed in M1's barrel re-export list (lines 142-143). **M2 barrel addition**: `BudgetExceededWithPartialResults` from `errors.ts` must be added to the V2 barrel (`evolution/src/lib/v2/index.ts`) so M3's evolveArticle can import it for `instanceof` checks. This is the only barrel modification in M2.

**Test file locations**: All V2 test files are colocated with source (matching existing project convention): `evolution/src/lib/v2/generate.test.ts`, `rank.test.ts`, `evolve.test.ts`. The mock helper lives at `evolution/src/testing/v2MockLlm.ts` (colocated with existing `evolution-test-helpers.ts`).

**Mock LLM strategy**: Create `evolution/src/testing/v2MockLlm.ts` (~80 LOC, colocated with existing `evolution-test-helpers.ts`) — factory returning a mock `EvolutionLLMClient` with `complete: jest.fn()` that returns canned responses by phase label ('generation' → variant text, 'evolution' → mutated text) and by call-position for ranking ('ranking' label used by both triage and fine-ranking phases — label-only dispatch cannot distinguish them, so the mock must support both position-based sequences AND per-pair keyed responses. Position-based: `mockLlm.setRankingResponses(['A', 'B', 'TIE', ...])` consumed in order — works for triage (sequential calls, deterministic order). Per-pair keyed: `mockLlm.setRankingResponseForPair(textA, textB, 'A')` — works for fine-ranking where V1 uses `Promise.allSettled` for Swiss round pairs (parallel calls, nondeterministic consumption order). The mock dispatches to per-pair responses first (if set), falling back to positional sequence). Also implements `completeStructured: jest.fn()` stub (throws 'not implemented' — V2 helper functions use only `complete`, not `completeStructured`; the stub satisfies the EvolutionLLMClient interface). Configurable response sequences for deterministic tests. Adapted from V1's `createMockEvolutionLLMClient` but simplified (no ExecutionContext, callback-based).

**Test strategy**:
- generate.test.ts (~180 LOC, 8 tests): Test 3 strategies produce 3 variants with correct iterationBorn. Test format validation failure → variant discarded (returns fewer variants, does NOT retry). Test all 3 fail format → returns empty array. Test BudgetExceededError propagation (mock LLM throws → error propagates to caller, not swallowed). Test BudgetExceededWithPartialResults carries partial variants (1 strategy succeeds, 1 throws BudgetExceededError → thrown error has 1 variant in partialVariants; verify instanceof BudgetExceededError is true, instanceof BudgetExceededWithPartialResults is true). Test feedback parameter injects into prompts. Test parallel execution (all 3 LLM calls made). Test strategiesPerRound=1 runs only structural_transform strategy.
- rank.test.ts (~700 LOC, 26 tests — algorithm-heavy tests average ~25 LOC each for setup/mock config/assertions, plus ~50 LOC shared imports/describe blocks/helpers/beforeEach): Dedicated tests for each algorithm path: (1) triage with stratified opponents — verify correct tier distribution, (2) adaptive early exit when decisiveCount >= minOpp AND avgConfidence >= 0.8, (3) early exit does NOT fire when decisiveCount < MIN_TRIAGE_OPPONENTS even if avg >= 0.8, (4) sequential elimination when mu+2σ < cutoff, (5) Swiss pairing scored by outcomeUncertainty × sigma (using BETA = DEFAULT_SIGMA * SQRT2), (6) draw handling in fine-ranking (confidence < 0.3), (7) draw handling in triage (confidence === 0 OR winnerId === loserId), (8) convergence detection (2 consecutive rounds with eligible variant filtering: mu >= 3σ OR topK), (9-14) budget pressure tiers as 6 separate tests (budgetFraction: 0.0, 0.49, 0.5, 0.79, 0.8, 1.0 — verify correct tier and max comparisons). **Edge case tests**: (15) pool.length < 2 → empty result, (16) first iteration all-new-entrants → fine-ranking only, (17) matchCountIncrements correctness, (18) stratified with fewer existing than n, (19) mu direction verification, (20) LLM error → '' → low-confidence partial result (NOT clean TIE) with match recorded, (21) both LLM passes fail → confidence 0.0 → draw, (22) cache hit skips LLM call, (23) all-draws pool convergence behavior, (24) ratingUpdates returns full snapshot (all ratings, not diffs), (25) matches includes both triage + fine-ranking, (26) BudgetExceededError propagation from callback.
- evolve.test.ts (~200 LOC, 11 tests): Test parent selection from top-rated. Test crossover with 2 parents. Test format validation failure → variant discarded. Test creative exploration trigger (stubbed diversityScore = 0.3 < 0.5). Test creative exploration does NOT fire when diversityScore = 0 (> 0 guard). Test feedback parameter injects into mutation prompts. Test iterationBorn set correctly. Test BudgetExceededError propagation from LLM calls. Test empty pool returns empty array. Test single-variant pool skips crossover (mutation only). Test version numbering: new variant version = max(parent versions) + 1.
- Composition test at `evolution/src/lib/v2/compose.test.ts` (~60 LOC): generate output → rank → verify: ratings updated (mu direction correct), matchCountIncrements non-zero, matches array valid. Mock LLM configured with label-based dispatch: 'generation' label returns variant text, 'ranking' label returns 'A'/'B' responses (works because composition test uses sequential flow, not parallel fine-ranking within rank). Also test: generate returns empty → rank with empty newEntrants returns empty matches.

**V1 regression gate**: Run all V1 reused module tests (rating, comparison, comparisonCache, formatValidator, formatValidationRules, reversalComparison, textVariationFactory, strategyConfig, errorClassification) before and after M2 changes. V1 source files are not modified in M2, but the barrel re-export of BudgetExceededWithPartialResults could surface issues if error class imports have side effects. Use `npm run test:v1-regression` (defined in M1).

**Done when**: Each function works standalone with mocked LLM; unit tests pass (including format validation failure paths, BudgetExceededWithPartialResults partial variant preservation, and strategiesPerRound config); rank.ts accepts `ratings: Map<string, Rating>` input and returns `V2Match[]` (not V1 `Match`) with `ratingUpdates: Record<string, Rating>` output, and has 26 tests covering all algorithm paths (triage, Swiss, convergence, draw, budget tiers); functions compose correctly (generate output feeds into rank); `tournamentTopK` field present in V2 EvolutionConfig (M1 types.ts, default 5); M1 barrel updated to include BudgetExceededError, EvolutionLLMClient, LLMCompletionOptions; V2 barrel updated to export BudgetExceededWithPartialResults from errors.ts; mockLlm satisfies full EvolutionLLMClient interface (including completeStructured stub) and supports both positional and per-pair keyed ranking responses; composition test passes (compose.test.ts); errors.ts created with BudgetExceededWithPartialResults; evolve.ts edge cases (empty pool, single variant, version) tested; V1 regression gate passes

**Rollback plan**: M2 creates only new files in `evolution/src/lib/v2/` (generate.ts, rank.ts, evolve.ts, errors.ts) and adds one export to the V2 barrel (index.ts). No V1 files modified. Revert = delete M2 files + revert barrel change (single commit revert). V2 barrel smoke test from M1 still passes after revert (BudgetExceededWithPartialResults export removed, but no M1 test depends on it).

**Depends on**: Milestone 1

---

### Milestone 3: The Main Function + Cost Tracking
**Goal**: Implement the single `evolveArticle()` function that orchestrates generate→rank→evolve in a flat loop, with per-phase cost tracking and invocation logging.

**Files to create**:
- `evolution/src/lib/v2/evolve-article.ts` (~250 LOC) — The core function:
  ```typescript
  async function evolveArticle(
    originalText: string,
    llmProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> },
    db: SupabaseClient,
    runId: string,
    config: EvolutionConfig,
    options?: { logger?: RunLogger }
  ): Promise<EvolutionResult>
  // EvolutionResult = { winner, pool, ratings, matchHistory, totalCost, iterationsRun, stopReason, muHistory, diversityHistory }
  ```
  - **Config validation** (deferred from M1): At the top of `evolveArticle`, validate config before running. Checks: `iterations >= 1 && iterations <= 100`, `budgetUsd > 0 && budgetUsd <= 50`, `judgeModel` and `generationModel` are non-empty strings, `strategiesPerRound >= 1` (if provided), `calibrationOpponents >= 1` (if provided), `tournamentTopK >= 1` (if provided). Upper bounds prevent accidental runaway (iterations) and cost blowout from typos (budgetUsd). Model strings are NOT validated against an allowlist (models change frequently; invalid model strings will produce LLM errors at runtime). Throws a descriptive `Error` (not BudgetExceededError) on invalid config. Applies defaults for optional fields: `strategiesPerRound ?? 3`, `calibrationOpponents ?? 5`, `tournamentTopK ?? 5`. Validation is synchronous (no DB calls). **Normal completion**: When loop completes all `config.iterations` iterations without budget/kill interruption, sets `stopReason='iterations_complete'`.
  - **Baseline insertion**: First variant in pool is the original text with `strategy: 'baseline'`. Allows tracking "did evolution beat the original?" via baselineRank in run_summary.
  - **Winner determination**: After final iteration, winner = variant with highest mu in ratings. Ties broken by lowest sigma (most certain). If pool has only the baseline variant (all generated variants failed format validation), winner is the baseline. Winner field in EvolutionResult is the TextVariation object.
  - Local state: `pool` array, `ratings` Map, `matchCounts` Map (tracks matches played per variant — passed to rankPool's `matchCounts` parameter and updated from the returned `matchCountIncrements`; M2's `rankPool` accepts `matchCounts: Map<string, number>` as input and returns `matchCountIncrements: Map<string, number>` in its result), `matchHistory` array, `muHistory` array of arrays (top-K mu values appended as `number[]` each iteration, matching M1's `number[][]` type), `diversityHistory` array (if proximity enabled), `comparisonCache: Map<string, ComparisonResult>` (simple Map for deduping LLM calls across iterations — passed to rankPool's cache parameter), `costTracker` (created internally from config.budgetUsd)
  - Loop body: generate → rank → evolve (calling M2 helpers). After rank phase, collect top-K mu values (sorted descending) from ratings and append as `number[]` to muHistory. Pass `newEntrantIds` (variants added this iteration) to rankPool. Pass `costTracker.getTotalSpent() / config.budgetUsd` as budgetFraction to rankPool. Merge `matchCountIncrements` into `matchCounts` after each rank call. **Convergence check**: after rank phase, if `rankPool` returns `converged: true` (indicating top-K ratings have converged per `isConverged` thresholds), set `stopReason='converged'` and exit the loop. Partial results from completed iterations are preserved.
  - Comparison cache: `Map<string, ComparisonResult>` created once at start, passed to rank on each iteration. This is a simple Map (NOT the ComparisonCache class from V1) — compatible with `compareWithBiasMitigation`'s cache parameter.
  - Per-phase invocation logging: Before each phase call, snapshot `costTracker.getTotalSpent()`. After phase completes, compute delta = `costTracker.getTotalSpent() - snapshot`. Pass delta as `cost_usd` to `updateInvocation()`. This gives per-invocation cost, not cumulative.
  - Budget check: reserve-before-spend pattern throws BudgetExceededError (caught by loop, sets stopReason='budget_exceeded'). Partial results from completed iterations are preserved in the returned EvolutionResult.
  - **Parallel generate budget handling**: generate.ts calls 3 LLM calls via Promise.allSettled (NOT Promise.all). Since allSettled never throws, generate.ts must explicitly scan results: `const budgetErr = results.find(r => r.status === 'rejected' && r.reason instanceof BudgetExceededError)`. Fulfilled results are kept as partial variants, other rejected results are discarded. If budgetErr exists, throw `BudgetExceededWithPartialResults` (defined in `evolution/src/lib/v2/errors.ts`, shared by generate.ts and evolve.ts — extends `BudgetExceededError` with `partialVariants: TextVariation[]` field; exported from V2 barrel). **Consequence**: the caller (evolveArticle catch block) catches via `instanceof BudgetExceededWithPartialResults`, extracts `partialVariants`, adds them to the pool, then exits with `stopReason='budget_exceeded'`. For plain `BudgetExceededError` (no partial results), pool is preserved from prior iterations only. Same pattern for evolve phase. **Per-phase cost delta edge case**: if BudgetExceededError is thrown mid-rank (during reserve(), before spend), the cost delta captures only actual spend up to that point — this is correct since reserve doesn't spend.
  - Kill detection: check run status from DB via Supabase SDK (`supabase.from('evolution_runs').select('status').eq('id', runId).single()` — parameterized, no raw SQL) at iteration boundary (top of each loop iteration). If status is 'failed' or 'cancelled', set stopReason='killed' and exit loop (V1 pipeline.ts only checks 'failed'; V2 adds 'cancelled' for admin-initiated cancellation). **Status state machine**: valid transitions enforced by M9 schema or application-level guards: `pending→claimed→running→{completed,failed}`, plus `running→cancelled` (admin-initiated via cancelExperimentAction M11 or manual DB update). The kill detection check is read-only (SELECT, not UPDATE) so no authorization concern — only actors with service_role DB access can set status to 'cancelled'/'failed'. Status check DB errors are swallowed (logged via logger.warn, do not crash the loop). Accepted latency: if killed mid-ranking (up to 40 comparisons), the current iteration completes before exit. Worst case: ~$0.20 of wasted LLM calls. Mid-phase kill checks not implemented (same as V1).
  - **LLM client wiring**: `evolveArticle` receives a raw LLM provider (simple `{ complete(prompt, label, opts): Promise<string> }` interface). Internally, it creates the costTracker from `config.budgetUsd`, then wraps the raw LLM provider with the V2 EvolutionLLMClient wrapper (which adds cost tracking + retry). The wrapped client is what gets passed to M2 helpers. This way the caller (runner) doesn't need to know about cost tracking.
  - **Transient error retry**: Integrated into the V2 EvolutionLLMClient wrapper (`evolution/src/lib/v2/llm-client.ts`, ~100 LOC — NOT reusing V1's createEvolutionLLMClient which has V1 type deps). The wrapper satisfies the full `EvolutionLLMClient` interface: `complete()` wraps the raw provider with retry + cost tracking; `completeStructured()` throws `Error('completeStructured not supported in V2')` (V2 helpers only use `complete`; the stub satisfies the interface). Wraps the raw LLM provider with: retry on transient errors (exponential backoff 1s/2s/4s, max 3 retries, **per-call total timeout of 60s** — if timeout fires, release reserved budget and propagate error), cost tracking integration, and BudgetExceededError is NOT retried. Uses `isTransientError()` imported via V2 barrel (re-exported from V1's `errorClassification.ts`). Non-transient errors propagate immediately.
  - **Cost estimation**: Before each LLM call, the wrapper estimates cost via `estimatedCost = (prompt.length / 4) * inputPricePerToken + outputEstimateTokens * outputPricePerToken`. Model pricing from a simple config object (not V1's getModelPricing); unknown models use the most expensive model's pricing as fallback + `console.warn`. `outputEstimateTokens` defaults to 1000 for generation/evolution, 100 for ranking (comparison responses are short). This matches V1's estimateTokenCost approach but simplified. **Actual cost computation**: After LLM call returns response string, `actualCost = (prompt.length / 4) * inputPricePerToken + (response.length / 4) * outputPricePerToken` — same formula but using actual response length instead of estimated output tokens. **Known limitation**: char/4 approximation underestimates tokens for CJK/non-ASCII text (where 1 char ≈ 1 token). The 1.3x margin partially compensates but may be insufficient for purely CJK content. This matches V1's approach and is sufficient for English-primary content. **Known trade-off**: fixed output token estimates may cause premature BudgetExceededError near the budget ceiling if actual outputs are shorter (over-reserves) or under-reserves if outputs are longer. Document this in the runner's error message when stopReason='budget_exceeded'.
  - **Cost flow per LLM call**: `const margined = costTracker.reserve(phase, estimatedCost)` (reserve internally computes `estimatedCost * 1.3`, reserves it, returns the margined amount) → LLM call → on success: `costTracker.recordSpend(phase, actualCost, margined)` → on error: `costTracker.release(phase, margined)`. The wrapper stores `margined` in local scope, so reserve/recordSpend/release always use the same margined amount. Model pricing: simple inline config `{ inputPer1MTokens, outputPer1MTokens }` per model, defined in `llm-client.ts` (not imported from V1's getModelPricing).

- `evolution/src/lib/v2/cost-tracker.ts` (~120 LOC) — Budget-aware cost tracker with reserve-before-spend. This is a NEW simplified implementation (not reusing V1's CostTrackerImpl which has V1 type deps). **Interface delta from V1**: V1's CostTrackerImpl uses `addCost(phase, amount)` (spend-only, no reserve/release pattern). V2's cost-tracker uses `reserve/recordSpend/release` for parallel-safe pre-flight budget checks. These are intentionally incompatible — do not attempt to substitute one for the other.
  - **Formal interface** (defined in cost-tracker.ts, exported via barrel):
    ```typescript
    interface V2CostTracker {
      reserve(phase: string, estimatedCost: number): number;
      recordSpend(phase: string, actualCost: number, reservedAmount: number): void;
      release(phase: string, reservedAmount: number): void;
      getTotalSpent(): number;
      getPhaseCosts(): Record<string, number>;
      getAvailableBudget(): number;
    }
    ```
  - `reserve(phase, estimatedCost): number` — Synchronous (MUST have zero awaits internally — this is critical for parallel safety). `// INVARIANT: reserve() must remain synchronous to maintain parallel safety under Node.js single-threaded event loop. Do not add awaits to this function.` Computes `margined = estimatedCost * 1.3`. Checks `totalSpent + totalReserved + margined > budgetUsd` → throws `new BudgetExceededError(phase, this.totalSpent, this.totalReserved + margined, this.budgetUsd)` (imported from V1's `evolution/src/lib/types.ts` via V2 barrel — do NOT redefine the class in V2; `instanceof` checks fail if two separate class definitions exist). Increments `totalReserved += margined`. Returns `margined` — the LLM wrapper stores it in local scope and passes to recordSpend/release.
  - `recordSpend(phase, actualCost, reservedAmount): void` — Deducts `reservedAmount` from `totalReserved`, adds `actualCost` to `totalSpent`. **Edge case**: if `actualCost > reservedAmount` (LLM response longer than estimated), clamp `totalReserved` to `Math.max(0, totalReserved - reservedAmount)` (never go negative) and log a warning with the overage amount. **Post-spend check**: if `totalSpent > budgetUsd` after recording, log error-level warning with overage (defense-in-depth — the 1.3x margin should prevent this in practice, but repeated overages could accumulate). Tracks per-phase costs.
  - `release(phase, reservedAmount): void` — On LLM failure: deducts `reservedAmount` from `totalReserved` (clamped to 0) without spending.
  - `getTotalSpent(): number`, `getPhaseCosts(): Record<string, number>`, `getAvailableBudget(): number`
  - Budget flow (managed by V2 EvolutionLLMClient wrapper, NOT by evolveArticle/helpers): `const margined = reserve(phase, est)` → LLM call → `recordSpend(phase, actual, margined)`. On error → `release(phase, margined)`.
  - **Parallel safety invariant**: reserve() is synchronous (zero awaits). 3 concurrent generate calls each call reserve() synchronously before any await — all 3 reserves succeed or the last throws BudgetExceededError. Node.js single-thread guarantees atomic check+increment within one event loop tick. **Test requirement**: verify via a test that wraps 3 concurrent LLM calls (Promise.allSettled) and asserts totalReserved reflects all 3 reserves before any LLM call starts.

- `evolution/src/lib/v2/invocations.ts` (~50 LOC) — Invocation row helpers
  - `createInvocation(db, runId, iteration, phaseName, executionOrder): Promise<string | null>` — Returns UUID on success, `null` on DB error. Inserts row with `success: false`, `skipped: false` defaults (updated on completion).
  - `updateInvocation(db, id, { cost_usd, success, execution_detail, error_message? })` — `id` accepts `string | null` — if null, no-op (returns immediately). Sets success=true on completion, or success=false with `error_message` on failure (maps to the `error_message TEXT` column in `evolution_agent_invocations`). `execution_detail` JSONB stores variantsAdded, matchesPlayed, and phase-specific data.
  - Both take `db: SupabaseClient` as first parameter. Errors are swallowed (logged via console.warn on first failure, do not crash the pipeline).

- `evolution/src/lib/v2/run-logger.ts` (~70 LOC) — Structured run logging
  - `createRunLogger(runId, supabase)` → logger with `info/warn/error/debug` methods
  - Each method accepts `(message: string, context?: { iteration?: number; phaseName?: string; variantId?: string; [key: string]: unknown })`. The `iteration`, `phaseName`, and `variantId` fields from context are extracted and written to the corresponding `evolution_run_logs` columns (`iteration`, `agent_name`, `variant_id`); remaining context fields go into the `context JSONB` column. This matches the actual `evolution_run_logs` table schema: `{ id, run_id, created_at, level, agent_name, iteration, variant_id, message, context }`.
  - Fire-and-forget inserts (non-blocking, errors swallowed). **Known limitation**: no `flush()` method means in-flight inserts may be lost if the process exits immediately after the last log call. Mitigation: runner.ts awaits `finalizeRun()` before process exit, and any log calls after that are best-effort. If last-log loss becomes an issue, add an explicit `await Promise.allSettled(pendingInserts)` in runner.ts finally block.
  - Powers the Logs tab in admin UI (Timeline view uses iteration/agent_name, Explorer view uses variant_id)

**M3 barrel additions** (update `evolution/src/lib/v2/index.ts`): Add exports for `V2CostTracker` (interface), `BudgetExceededWithPartialResults` (class from errors.ts), `createRunLogger`, `createInvocation`, `updateInvocation`, `evolveArticle`. Note: M1's barrel list comment "Complete, explicit — no implicit additions" refers to M1's initial state; each milestone extends the barrel with its new exports.

**Test strategy**:
- **Supabase mock**: Create inline chainable mock (same pattern as V1 service tests — each test file defines its own mock supporting: `from().insert().select().single()` for invocations, `from().select().eq().single()` for kill detection status checks, `from().insert()` for run_logs). NOT a shared utility — each test file defines what it needs.
- **evolve-article.test.ts** (~480 LOC, 21 tests):
  - (1) Minimal 1-iteration test: verify generate→rank→evolve call sequence and baseline variant is first in pool with strategy='baseline', stopReason='iterations_complete'
  - (2) 3-iteration smoke test: verify pool grows, ratings converge (top mu increases), muHistory has 3 entries, stopReason='iterations_complete'
  - (3) Budget exhaustion: mock LLM throws BudgetExceededError on iteration 2 → stopReason='budget_exceeded', partial results from iteration 1 preserved
  - (4) Kill detection: mock DB returns status='failed' → stopReason='killed', loop exits
  - (5) Kill detection with status='cancelled' → stopReason='killed', loop exits
  - (6) Kill detection DB error: mock DB throws → error swallowed, run continues
  - (7) Winner is highest-mu variant from final ratings
  - (8) matchCounts correctly accumulated across iterations
  - (8b) matchHistory accumulates across iterations: verify matchHistory.length grows with each iteration and contains V2Match objects from all iterations
  - (9) comparisonCache reused across iterations (verify LLM mock called fewer times in iteration 2 than without caching — tests actual dedup, not just Map growth)
  - (10) Invocation rows created for each phase (verify mock DB insert called with correct table/columns; verify createInvocation returning null UUID does not crash updateInvocation)
  - (11) Per-phase cost delta: verify invocation cost_usd is delta (not cumulative) — e.g., generation=$0.05, rank=$0.03 → invocation rows get $0.05 and $0.03 respectively
  - (12) Parallel generate with BudgetExceededError: mock 1 of 3 generate calls to throw → fulfilled results kept as partial variants, BudgetExceededError re-thrown
  - (13) getPhaseCosts returns correct per-phase breakdown after run
  - (14) Config validation: iterations=0 throws Error; iterations=101 throws Error (upper bound); budgetUsd=-1 throws Error; budgetUsd=51 throws Error (upper bound); empty judgeModel throws Error; empty generationModel throws Error
  - (14b) diversityHistory is empty array when proximity is not enabled (no diversityScore passed)
  - (15) Config defaults applied: omitted strategiesPerRound defaults to 3, calibrationOpponents to 5, tournamentTopK to 5
  - (16) Normal completion: full iterations run → stopReason='iterations_complete', iterationsRun equals config.iterations
  - (17) Convergence: mock rankPool to return converged:true → stopReason='converged' in EvolutionResult
  - (18) Evolve phase BudgetExceededWithPartialResults: partial mutations preserved, exits with stopReason='budget_exceeded'
  - (19) LLM wrapping: verify raw provider passed to evolveArticle gets wrapped (retry behavior active on calls made by helpers)
- **cost-tracker.test.ts** (~150 LOC, 14 tests): reserve succeeds under budget; reserve throws BudgetExceededError when over (with 1.3x margin); recordSpend deducts from reserved and adds to spent; recordSpend with actualCost > reservedAmount clamps totalReserved to 0 and logs warning; release deducts from reserved without spending; getTotalSpent returns correct sum; getPhaseCosts tracks per-phase; getAvailableBudget computed correctly; parallel 3 reserves via Promise.allSettled all succeed when budget allows (verify totalReserved reflects all 3 before any LLM call); parallel 3 reserves where 3rd exceeds budget; release with wrong amount (edge case); zero-budget config throws on first reserve; reserve after full spend; concurrent llm-client wrapper calls reserve/spend correctly without double-counting
- **invocations.test.ts** (~50 LOC, 6 tests): createInvocation inserts correct row and returns UUID; updateInvocation sets success=true and cost_usd; updateInvocation sets success=false with error_message on failure; createInvocation DB error swallowed; updateInvocation DB error swallowed; execution_detail JSONB contains variantsAdded/matchesPlayed
- **run-logger.test.ts** (~60 LOC, 7 tests): info/warn/error write correct level to DB; DB error swallowed (does not propagate); context JSONB passed through (non-extracted fields); createRunLogger returns logger with all 4 methods (info/warn/error/debug); iteration extracted from context and written to `iteration` column; phaseName extracted from context and written to `agent_name` column; variantId extracted from context and written to `variant_id` column
- **llm-client.test.ts** (NEW file at `evolution/src/lib/v2/llm-client.test.ts`, ~110 LOC, 10 tests): successful call records spend; transient error retried with backoff (use `jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync()` to verify 1s/2s/4s delays); non-transient error propagates immediately; BudgetExceededError NOT retried; max 3 retries then propagate; reserve called before any await (verify synchronous call order); release called on failure; cost estimation formula verified with exact expected values for known prompt/response lengths; **per-call 60s timeout releases reserved budget and propagates error**; unknown model uses most-expensive model pricing as fallback and logs console.warn

**Done when**: `evolveArticle()` completes a 3-iteration run with mocked LLM; winner correctly identified as highest-mu variant; invocation rows written correctly; cost tracking accurate per phase (via getTotalSpent and getPhaseCosts); budget exhaustion stops with stopReason='budget_exceeded' preserving partial results; kill detection works for both 'failed' and 'cancelled' status; all 58 tests pass (21 evolve-article + 14 cost-tracker + 6 invocations + 7 run-logger + 10 llm-client = 58); config validation rejects invalid inputs; normal completion sets stopReason='iterations_complete'

**Depends on**: Milestone 2

---

### Milestone 4: Runner Integration
**Goal**: Wire `evolveArticle()` into the run execution lifecycle (claim, execute, persist results), with seed article generation for prompt-based runs and parallel execution support.

**Files to create**:
- `evolution/src/lib/v2/runner.ts` (~250 LOC) — Core run execution module:
  - `executeV2Run(runId, claimedRun, supabase, llmProvider)` — Resolve content → resolve config → call evolveArticle → persist minimal results → mark completed. `claimedRun` is the row returned by `claim_evolution_run` RPC (includes `id, explanation_id, prompt_id, config` JSONB, `experiment_id`, etc.) — avoids a redundant DB re-fetch after claim.
  - `llmProvider`: Raw LLM provider `{ complete(prompt, label, opts?): Promise<string> }` — same interface M3's evolveArticle expects. evolveArticle wraps it internally with cost tracking.
  - **Config resolution**: Claimed run has `config JSONB` with raw fields (generationModel, judgeModel, maxIterations, budgetCapUsd, etc.). Runner maps this to V2 `EvolutionConfig`: `{ iterations: config.maxIterations, strategiesPerRound: 3, budgetUsd: config.budgetCapUsd, judgeModel: config.judgeModel, generationModel: config.generationModel, calibrationOpponents: 5, tournamentTopK: 5 }`. Missing fields use V2 defaults. No complex resolveConfig — V2 config is flat. **Intentional**: V1 nested config fields (calibration, tournament, expansion sub-objects) are silently discarded — V2 inlines these as constants. This is by design; no warning is emitted.
  - Content resolution (2 paths):
    - If `explanation_id` set → fetch article text from `explanations` table
    - If `prompt_id` set (no explanation) → fetch prompt text from `evolution_arena_topics` table (`SELECT prompt FROM evolution_arena_topics WHERE id = claimedRun.prompt_id`; if topic row not found → markRunFailed with descriptive message), then call `generateSeedArticle(promptText, llm)` to create title + article (2 LLM calls via raw llmProvider — seed generation is pre-pipeline, untracked by cost tracker, matching V1 behavior)
    - If both null → markRunFailed('No content source: both explanation_id and prompt_id are null')
  - **Concurrent-run guard**: Before claiming, check active run count. This is a **soft limit** (TOCTOU race exists between count check and claim RPC — same as V1). With `--parallel N`, limit can be exceeded by up to N-1. Acceptable because: runs are cheap (<$1), the limit exists to prevent API rate limiting not budget control, and FOR UPDATE SKIP LOCKED prevents double-claiming the same run. **Guard duplication**: M5's `evolutionRunnerCore.ts` also contains a concurrent-run guard (for the HTTP-triggered path). These are not redundant — M4's guard is in the CLI batch runner path; M5's guard is in the web-triggered path. Each path enforces the limit independently.
  - Heartbeat (30s interval via setInterval, cleared in finally block; `clearInterval(undefined)` is a no-op in Node.js so null-guarding is implicit). Heartbeat DB error is non-fatal (try/catch with logger.warn inside the interval callback).
  - Error handling → markRunFailed with `(error instanceof Error ? error.message : String(error)).slice(0, 2000)` (type-guarded — non-Error throws won't crash on `.message`; matching V1's actual truncation length in evolution-runner.ts, NOT 500). Status guard: `UPDATE ... WHERE id = $1 AND status IN ('pending', 'claimed', 'running')` — idempotent, no-op if already completed/failed. **Intentional**: V1's guard also includes `'continuation_pending'`; V2 omits it because V2 has no continuation status (Decision 1).
  - **Strategy linking**: At run start, resolve or create `strategy_config_id` via V2's `hashStrategyConfig()` from `strategy.ts` (M1 fork) and `labelStrategyConfig()` for the label. Strategy upsert: `INSERT INTO evolution_strategy_configs (name, label, config, config_hash) VALUES (...) ON CONFLICT (config_hash) DO UPDATE SET name = EXCLUDED.name RETURNING id` — includes `label` (required NOT NULL column in current schema, auto-generated from config via `labelStrategyConfig()`). **Schema alignment**: Current V1 schema has `label TEXT NOT NULL` with no DEFAULT — M4 MUST include `label` in the INSERT to avoid NOT NULL violation. M9's V2 schema should also have `label NOT NULL DEFAULT ''` as a safety net. At finalization, call `update_strategy_aggregates` RPC — **deferred to M5**: M4's minimal persistence does not compute final Elo, but `update_strategy_aggregates` requires `p_final_elo`. M5's finalize.ts computes Elo via `toEloScale()` and calls the RPC with correct args. M4 does NOT call `update_strategy_aggregates`. **Schema alignment with M9**: M9 currently defines `evolution_strategy_configs` with `is_predefined` column. M4's upsert only writes `(name, label, config, config_hash)` — any additional columns M9 defines (e.g., `is_predefined`) must have DEFAULT values in M9's CREATE TABLE so the upsert does not fail. **Resolution**: M9 must ensure all columns beyond `(id, name, label, config, config_hash, created_at)` have DEFAULT values. Verify M9 schema against this upsert before deploying.
  - **Result persistence (minimal, before M5)**: After evolveArticle returns EvolutionResult, persist winner variant to `evolution_variants` with explicit columns: `(id, run_id, variant_content, elo_score, generation, parent_variant_id, agent_name, match_count, is_winner)` where `elo_score = toEloScale(winnerRating.mu)`, `generation = winner.iterationBorn`, `agent_name = winner.strategy`, `is_winner = true`. Mark run as `status: 'completed'` with `run_summary: { version: 3, totalIterations, stopReason, totalCost }`. **Note**: seed generation cost is untracked by cost tracker (pre-pipeline, ~$0.02 for 2 LLM calls) — totalCost in run_summary reflects pipeline costs only, matching V1 behavior. M5's finalize.ts will replace this with full V1-compatible persistence (all pool variants, detailed run_summary, experiment auto-completion). This avoids circular dependency with M5.
  - No checkpointing, no resume logic

- `evolution/scripts/evolution-runner-v2.ts` (~100 LOC) — CLI batch entry point (separate from module):
  - Arg parsing: `--parallel N`, `--max-runs N`, `--max-concurrent-llm N`
  - Batch loop: claim N runs sequentially (FOR UPDATE SKIP LOCKED prevents double-claiming), execute via Promise.allSettled
  - Graceful shutdown: SIGTERM/SIGINT sets `shuttingDown` flag → stops claiming, waits for in-flight runs
  - **Invocation**: `npx tsx evolution/scripts/evolution-runner-v2.ts [--parallel N] [--max-runs N]`. Add `"evolution:v2"` script to package.json: `"tsx evolution/scripts/evolution-runner-v2.ts"`. Default args: parallel=1, max-runs=Infinity, max-concurrent-llm=20.
  - **LLM rate limiting**: Shared `LLMSemaphore` caps concurrent LLM API calls across all parallel runs (default 20, configurable via `EVOLUTION_MAX_CONCURRENT_LLM`). The CLI script creates a new `wrapWithSemaphore(rawProvider, semaphore)` utility (~20 LOC, NEW — does not exist in V1) that wraps the raw LLM provider's `complete()` method with semaphore acquire/release (using try/finally to guarantee release on LLM error) BEFORE passing to executeV2Run. Layering: rawProvider → semaphore wrapper → [inside evolveArticle] cost-tracking + retry wrapper → M2 helpers. Reuse V1's `src/lib/services/llmSemaphore.ts` (~91 LOC) for the LLMSemaphore class (exports: LLMSemaphore, getLLMSemaphore, initLLMSemaphore, resetLLMSemaphore). V1's semaphore is used internally by the LLM client (different pattern); V2 uses it as an external wrapper — this is architecturally different but reuses the same semaphore primitive.

- `evolution/src/lib/v2/seed-article.ts` (~70 LOC) — Seed article generation for prompt-based runs
  - `generateSeedArticle(prompt, llm): Promise<{ title: string; content: string }>`
  - `llm`: Raw LLM provider `{ complete(prompt, label, opts?): Promise<string> }` — NOT V1's EvolutionLLMClient (which has V1 type deps). V2's seed-article.ts is a new implementation that reuses V1's prompt template strings but adapts the function signature for V2's raw provider interface. Cannot directly call V1's `generateSeedArticle()` (requires EvolutionLLMClient).
  - 2 LLM calls: title generation → article generation
  - **Timeout**: Each LLM call wrapped with 60s `Promise.race` timeout. On timeout, throw descriptive Error('Seed article generation timed out after 60s'). Seed generation is pre-pipeline (not retry-wrapped by M3's LLM client), so timeout is the only protection against hung LLM calls.
  - Prompt templates adapted from V1 `evolution/src/lib/core/seedArticle.ts` (67 LOC)

- `evolution/src/lib/v2/index.ts` (~60 LOC) — Barrel export:
  - `evolveArticle`, `executeV2Run`, `generateSeedArticle`
  - Types: TextVariation, EvolutionConfig, etc.
  - Re-exports of V1 modules: `rating` (Rating type, createRating, toEloScale), `comparison` (compareWithBiasMitigation), `formatValidator` (validateFormat), `textVariationFactory` (createTextVariation)

**Files to reuse from V1**:
- `claim_evolution_run` RPC — NOTE: actual signature is 2-arg `(TEXT, UUID DEFAULT NULL)` and also claims `continuation_pending` runs. V2 runner calls with only `p_runner_id` (2nd arg defaults to NULL). V2 must NOT accidentally claim `continuation_pending` V1 runs if both pipelines coexist briefly. **Decision**: M4 MUST NOT be deployed before M9 (which drops the RPC and recreates without `continuation_pending`). This eliminates the co-deployment race condition entirely. The continuation_pending post-filter is not needed — M9 is a prerequisite for M4 deployment (even though M4 code can be built in parallel with M9).
- Heartbeat pattern from evolutionRunnerCore.ts
- Prompt templates from `evolution/src/lib/core/seedArticle.ts` (67 LOC) — adapted, not called directly (interface incompatible)

**Files to modify** (non-V1 source files):
- `package.json` — Add `"evolution:v2"` script
- `evolution/src/lib/v2/index.ts` — Add M4 exports: `evolveArticle` (if not already from M3), `executeV2Run`, `generateSeedArticle`

**Test strategy**:
- **runner.test.ts** (~200 LOC, 20 tests):
  - (1) Full lifecycle: claim → resolve content → evolveArticle → persist winner → mark completed
  - (2) Config resolution: raw config JSONB → V2 EvolutionConfig with correct field mapping
  - (3) Config resolution with missing fields: defaults applied correctly
  - (4) Content resolution (explanation_id): fetches article text from explanations table
  - (5) Content resolution (prompt_id): fetches prompt from evolution_arena_topics, calls generateSeedArticle, uses result as input
  - (6) Content resolution (both null): markRunFailed with descriptive message
  - (7) Content resolution: explanation_id set but DB returns null → markRunFailed with 'Explanation <id> not found'
  - (8) Content resolution: prompt_id set but topic not found in DB → markRunFailed with 'Prompt <id> not found'
  - (9) Error during evolveArticle → markRunFailed with truncated message (≤2000 chars)
  - (10) Non-Error throw (string/number) → markRunFailed uses String() coercion, no crash
  - (11) markRunFailed status guard: only updates from pending/claimed/running (no-op if already completed)
  - (12) Heartbeat: setInterval called with 30s; clearInterval called in finally block
  - (13) Heartbeat DB error: non-fatal (caught, logged, run continues)
  - (14) Concurrent-run guard: at-limit → skip (returns without claiming)
  - (15) Strategy linking: hashStrategyConfig + labelStrategyConfig called, upsert includes label, creates/returns strategy_config_id
  - (15b) Strategy upsert ON CONFLICT: hash collision with existing strategy_config → returns existing id (no duplicate, no error)
  - (16) Result persistence: winner variant INSERT includes correct columns (run_id, variant_content, elo_score via toEloScale, generation, agent_name, is_winner=true)
  - (17) Result persistence: run_summary JSONB contains version:3, totalIterations, stopReason, totalCost
  - (18) Seed article generation failure: generateSeedArticle throws → markRunFailed called with seed error message
  - (19) Seed article cost: verify seed generation LLM calls are NOT tracked by cost tracker (pre-pipeline)
- **evolution-runner-v2.test.ts** (~90 LOC, 7 tests):
  - (1) Batch claim: N runs claimed sequentially via RPC
  - (2) Parallel execution: 3 runs via Promise.allSettled, mixed success/failure
  - (3) Graceful shutdown: SIGTERM sets shuttingDown → stops claiming, awaits in-flight batch
  - (4) Semaphore wrapping: throttledProvider limits concurrent LLM calls
  - (5) Semaphore release on LLM error: semaphore.release() called in finally even when complete() throws
  - (6) --max-runs flag: stops after N total runs processed
  - (7) No pending runs: claim returns empty → clean exit
- **seed-article.test.ts** (~60 LOC, 7 tests):
  - (1) Generates title + content from prompt via 2 LLM calls
  - (2) Title LLM error → propagates (seed generation is not retry-wrapped)
  - (3) Article LLM error → propagates
  - (4) Empty prompt → returns sensible default title
  - (5) Title includes `# ` prefix in content (matching V1 behavior: `# ${title}\n\n${articleContent}`)
  - (6) JSON title parse failure falls back to plain-text extraction (matching V1 generateTitle fallback)
  - (7) Seed article LLM call timeout at 60s → throws descriptive timeout error
- Mock strategy: Claim RPC mocked as `supabase.rpc('claim_evolution_run').returns({ data: [{ id, explanation_id, prompt_id, config }] })`. evolveArticle mocked as jest.fn() returning mock EvolutionResult (runner tests don't test pipeline internals — those are M3 tests).

**Rollback plan**: M4 adds runner.ts, seed-article.ts, evolution-runner-v2.ts in `evolution/src/lib/v2/` and `evolution/scripts/`. Revert = delete M4 files + revert barrel and package.json changes (single commit revert). V1 runner continues to work (M4 adds V2 runner alongside V1, does not modify V1 runner).

**Done when**: V2 run claimed via RPC, executed, winner persisted to evolution_variants, run marked completed; prompt-based runs generate seed article before pipeline; parallel execution works with `--parallel 3`; watchdog compatible (heartbeat updates); all 34 tests pass (20 runner + 7 CLI + 7 seed-article)

**Depends on**: Milestone 3

---

### Milestone 5: Admin UI Compatibility
**Goal**: V2 runs produce V1-compatible DB rows so existing admin pages display them without UI changes (except minor archive filter toggle). Core deliverable is `finalize.ts` which replaces M4's minimal persistence with full variant + run_summary persistence.

**Files to create**:
- `evolution/src/lib/v2/finalize.ts` (~190 LOC) — Persist V2 results in V1-compatible format
  - **Function signature**:
    ```typescript
    export async function finalizeRun(
      runId: string,
      result: EvolutionResult,
      run: { experiment_id: string | null; explanation_id: number | null; strategy_config_id: string | null },
      db: SupabaseClient,
      durationSeconds: number,
      logger?: RunLogger
    ): Promise<void>
    ```
    Note: `matchCounts` is accessed via `result.matchCounts` (added to EvolutionResult in M1 addendum), NOT passed as a separate parameter.
  - **Integration with runner.ts**: M4's `executeV2Run` calls `finalizeRun()` instead of its minimal persistence block. runner.ts imports finalize.ts and calls it after `evolveArticle()` returns. M4's minimal persistence (winner-only INSERT + basic run_summary UPDATE) is replaced entirely — not conditionally toggled.
  - **Run completion**: finalizeRun is responsible for setting `status: 'completed'`, `completed_at: new Date().toISOString()`, and `run_summary` on the run record. The run_summary UPDATE and status transition happen in a single UPDATE (not two separate calls): `UPDATE evolution_runs SET status = 'completed', completed_at = now(), run_summary = $summary WHERE id = $runId AND status IN ('claimed', 'running')`. The status guard makes it idempotent. This status transition MUST happen BEFORE the experiment auto-completion check (so the current run is no longer 'running' when the NOT EXISTS subquery fires). **Execution order**: (1) validate inputs, (2) UPDATE run to completed with run_summary, (3) UPSERT variants, (4) call update_strategy_aggregates RPC, (5) check experiment auto-completion.
  - Build `run_summary` JSONB matching EvolutionRunSummaryV3 schema from `EvolutionResult`:
    - `version: 3`, `stopReason`, `totalIterations`, `durationSeconds`
    - `finalPhase: 'COMPETITION'` (hardcoded — V2 flat loop is semantically all-competition)
    - `muHistory` and `diversityHistory` from EvolutionResult
    - `matchStats` computed from `matchHistory: ComparisonResult[]` — each ComparisonResult has `{ winnerId, confidence }`. `totalMatches = matchHistory.length`, `avgConfidence = totalMatches > 0 ? mean(matchHistory.map(m => m.confidence)) : 0`, `decisiveRate = totalMatches > 0 ? matchHistory.filter(m => m.confidence > 0.6).length / totalMatches : 0`. Division-by-zero guard is required — when `totalMatches === 0`, all stats default to 0 (no NaN).
    - `topVariants` from pool + ratings (top 5 by mu, with `isBaseline: variant.strategy === 'baseline'`)
    - `baselineRank` and `baselineMu` from the 'baseline' strategy variant in pool (null if baseline was eliminated)
    - `strategyEffectiveness` computed from pool variants' strategies + ratings: group by strategy, compute `{ count, avgMu }` per group
    - `metaFeedback: null` (no meta-review agent in V2), `actionCounts: undefined` (no action system)
  - **fromArena filtering (M10 cross-ref)**: Before persisting variants, filter out arena-loaded entries: `const localPool = result.pool.filter(v => !v.fromArena)`. Arena entries (`fromArena: true`, set by M10's `loadArenaEntries`) already exist in the arena and must NOT be persisted as new variant rows. This matches V1's pattern in `persistence.ts:70`. The `fromArena` flag is a field on `TextVariation` (types.ts:45). When M10 is not yet landed, all variants have `fromArena: undefined/false`, so the filter is a no-op — safe to include from M5.
  - Persist local pool variants (after fromArena filtering) to `evolution_variants` using **upsert** with `onConflict: 'id'` (NOT plain insert — matches V1's `persistence.ts:90` pattern to handle re-run/retry without duplicate key errors). Columns: `id, run_id, explanation_id` (from `run.explanation_id ?? null` — required by admin UI variant-to-explanation linking, matching V1's persistence.ts:76), `variant_content` (NOT `content` — actual column name is `variant_content`, verified in persistence.ts:77), `elo_score` (via `toEloScale(mu)` from V1's `evolution/src/lib/core/rating.ts`), `generation` (from `variant.version`), `parent_variant_id` (from `variant.parentIds[0] ?? null`), `agent_name` (from `variant.strategy`), `match_count, is_winner`. **matchCount source**: `result.matchCounts` (type `Record<string, number>`, map of variant ID to total matches played). Added to EvolutionResult in M1 addendum. evolveArticle populates this from its local `matchCounts: Map<string, number>`, converted to a plain object before returning. For each variant, `match_count = result.matchCounts[variant.id] ?? 0`. **M1 prerequisite**: M1's EvolutionResult type definition MUST include `matchCounts: Record<string, number>` before M5 implementation begins.
  - **Winner determination**: The winner is the variant with the highest mu in `result.ratings`. `const winner = localPool.reduce((best, v) => (result.ratings[v.id]?.mu ?? -Infinity) > (result.ratings[best.id]?.mu ?? -Infinity) ? v : best)`. `winnerMu = result.ratings[winner.id]?.mu ?? DEFAULT_MU`. Each variant gets `is_winner: variant.id === winner.id`. This `winnerMu` value is also used by the strategy aggregate update (step 4).
  - **Input validation**: Before persisting, validate local pool (after fromArena filtering) has length > 0 (at minimum baseline exists). If local pool is empty, mark run failed with `'Finalization failed: empty pool'`. Validate `result.ratings` has entries for all local pool variant IDs — if missing, log warning and use default rating (mu=DEFAULT_MU) for that variant's elo_score.
  - **Error handling**: All persistence happens in a single try/catch. If variant upsert fails, the run is NOT rolled back to failed (it is already marked 'completed' with run_summary from step 2). Instead, log a warning with the error. The run has summary but no variants, which is a detectable inconsistency (admin UI shows "0 variants" — operator can re-run). **Rationale for not rolling back**: the run did complete successfully (pipeline ran, results produced); only persistence of variants failed. Marking it 'failed' would lose the run_summary. If a truly unrecoverable error occurs during run_summary UPDATE (step 2), the outer try/catch in runner.ts handles it via markRunFailed.
  - **Strategy aggregate update**: After variant upsert, if `run.strategy_config_id` is set, call `update_strategy_aggregates` RPC with `p_strategy_config_id = run.strategy_config_id` and `p_final_elo = toEloScale(winnerMu)` (deferred from M4 which lacks final Elo). If strategy_config_id is null, skip (no-op). Failure is non-fatal — log warning and continue.
  - **Experiment auto-completion**: If `run.experiment_id` set, use a single atomic query to avoid TOCTOU race: `UPDATE evolution_experiments SET status = 'completed', updated_at = now() WHERE id = $1 AND status = 'running' AND NOT EXISTS (SELECT 1 FROM evolution_runs WHERE experiment_id = $1 AND status IN ('pending', 'claimed', 'running'))`. **Prerequisite**: The current run's status must already be 'completed' (from step 2 above) so it is NOT matched by the NOT EXISTS subquery. If step 2 failed, experiment auto-completion is skipped. The single query is atomic — no gap between count and update. The `AND status = 'running'` guard makes it idempotent. This is the canonical implementation (M11 does NOT replace or modify it). **Note**: The `updated_at = now()` is required by M11's experiment schema which includes an `updated_at` column.

**Files to reuse from V1**:
- `evolution/src/lib/core/rating.ts` — `toEloScale(mu)` (single argument, NOT `mu, sigma`) for converting TrueSkill mu to Elo-scale scores for `evolution_variants.elo_score`

**Files to modify** (minimal):
- `evolution/src/lib/types.ts` — Add `export` to `EvolutionRunSummaryV3Schema` (line 716: change `const EvolutionRunSummaryV3Schema` to `export const EvolutionRunSummaryV3Schema`). Required for finalize.ts runtime validation and test (1) zod parse.
- `evolution/src/lib/v2/runner.ts` — Replace M4's minimal persistence block (winner-only INSERT + basic run_summary UPDATE) with a single call to `finalizeRun(runId, result, run, db, durationSeconds, logger)`. This is a ~15 LOC replacement within `executeV2Run`. Runner.ts no longer sets status/completed_at (finalize.ts owns that now).
- `evolution/src/services/evolutionRunnerCore.ts` — Add V2 routing: after claiming a run, check `claimedRun.pipeline_version`. If `pipeline_version === 'v2'`, call `executeV2Run` directly (passing runId, supabase, llmProvider). Content resolution is NOT shared with V1's path — `executeV2Run` performs its own content resolution internally (M4 runner.ts). V1's evolutionRunnerCore content-resolution code is NOT called for V2 runs. The V2 branch should be inserted right after the claimedRun null check (lines 64-67: `if (!claimedRun) return`) and BEFORE the V1 resume check (`isResume`) since V2 runs never have `continuation_pending` status. **V2 runs get heartbeat management**: heartbeat is NOT set up before the V1/V2 branch — in V1 code, `startHeartbeat()` is called separately in both the resume path (line 116) and the fresh path (line 198). The V2 branch MUST call `heartbeatInterval = startHeartbeat(supabase, runId)` before calling `executeV2Run`. This ensures V2 runs are watchdog-compatible. The cleanup in the finally block (`clearInterval(heartbeatInterval)`) applies to all paths since `heartbeatInterval` is declared in the outer scope (line 71). **Deployment prerequisite**: M9 migration MUST be applied before M5's routing code is deployed (pipeline_version column must exist). For development/testing without M9, mock the column value. Add a runtime guard: if `claimedRun.pipeline_version` is undefined (column doesn't exist yet), fall through to V1 path with a console.warn.

**Run archiving**: Already implemented in V1 — `archiveRunAction` and `unarchiveRunAction` already exist in `evolutionActions.ts` (lines 408-448), and `getEvolutionRunsAction` already supports `includeArchived` filter via `get_non_archived_runs` RPC (which also filters runs from archived experiments via LEFT JOIN). The runs list page already has a "Show archived" checkbox. **No new work needed** — M5 inherits this from V1. M9's seed migration should preserve the `archived` column on `evolution_runs`.

**Strategy admin page**: **Deferred to M7** (Admin UI Component Simplification). M5's scope is limited to making V2 runs visible in existing admin pages. New admin pages (Strategy CRUD) belong in M7 where the RegistryPage component is built. M5 only ensures strategy_config_id FK on runs is populated correctly (already handled by M4's runner.ts).

**Structured logs**: Run detail Logs tab reads from `evolution_run_logs` table (populated by V2's `createRunLogger` from M3). Timeline tab reads from `evolution_agent_invocations` (populated by invocations.ts from M3). **Compatibility note**: V1's TimelineTab.tsx expects invocation rows with `agent_name, phase, iteration, success, execution_detail, cost_usd` columns. M3's invocations.ts writes exactly these columns (using `phaseName` as `agent_name` since V2 has no agents — phases map to: 'generate', 'rank', 'evolve'). The admin UI displays these as phase names in the timeline, which is correct for V2.

**Test strategy**:
- **finalize.test.ts** (~300 LOC, 21 tests):
  - (1) Full finalization: run status set to 'completed' with completed_at timestamp, run_summary matches EvolutionRunSummaryV3 schema (validated with zod parse against EvolutionRunSummaryV3Schema — NOTE: this schema is currently non-exported in evolution/src/lib/types.ts:716; must add `export` to it, or use `EvolutionRunSummarySchema` union and verify version:3 discriminant)
  - (2) All local pool variants (non-fromArena) persisted to evolution_variants with correct elo_score (toEloScale applied)
  - (3) Winner variant has `is_winner: true`, others have `is_winner: false`
  - (4) matchStats computed correctly: totalMatches, avgConfidence, decisiveRate from matchHistory
  - (5) topVariants: top 5 by mu, isBaseline flag set correctly
  - (6) baselineRank/baselineMu: correct rank and mu when baseline exists in pool
  - (7) baselineRank/baselineMu: null when baseline was eliminated from pool
  - (8) strategyEffectiveness: correct count and avgMu per strategy group
  - (9) Empty pool edge case: finalizeRun marks run failed with 'empty pool' error
  - (10) Experiment auto-completion: experiment marked completed when no sibling runs pending (verify current run is already 'completed' when NOT EXISTS fires — mock must assert run UPDATE precedes experiment UPDATE)
  - (11) Experiment auto-completion: experiment NOT marked completed when sibling runs still pending
  - (12) Variant upsert failure: run remains 'completed' (not rolled back), warning logged
  - (13) fromArena filtering: pool with fromArena=true entries — only non-fromArena variants persisted to evolution_variants (no arena duplicates)
  - (14) Execution order: run_summary UPDATE happens before variant UPSERT (verify mock call order)
  - (15) Experiment auto-completion sets updated_at on experiment row
  - (16) Idempotent experiment auto-completion: call `finalizeRun()` twice sequentially with the same experiment_id (simulating two sibling runs completing) — the experiment UPDATE's `AND status = 'running'` guard ensures only the first transitions the experiment; second is a no-op (0 rows updated, no error). **Note**: This tests the SQL idempotency guard, not true concurrency (which would require DB-level testing or parallel async calls). True concurrent race conditions are guarded by the atomic UPDATE's WHERE clause at the DB level.
  - (17) ratings missing entries for some pool variant IDs → warning logged, default rating used for elo_score
  - (18) explanation_id column: variants persisted with correct explanation_id from run.explanation_id (null when run has no explanation)
  - (19) Strategy aggregate update: update_strategy_aggregates RPC called with correct strategy_config_id and final Elo after variant upsert; null strategy_config_id skips call
  - (20) run_summary UPDATE failure (step 2): finalizeRun throws, experiment auto-completion is skipped, outer runner.ts catch calls markRunFailed. Verify no variant upsert attempted after step 2 failure.
  - (21) Winner determination: variant with highest mu gets `is_winner: true`; when multiple variants tie on mu, the first in pool order wins (deterministic)
- **runner-v2-routing.test.ts** (~70 LOC, 6 tests):
  - (1) pipeline_version='v2' → executeV2Run called (not V1 pipeline)
  - (2) pipeline_version='v1' or null → V1 pipeline called (backward compat)
  - (3) executeV2Run calls finalizeRun (not minimal persistence)
  - (4) V2 routing branch entered before V1 resume check (no isResume path for V2)
  - (5) V2 routing calls startHeartbeat() before executeV2Run and clearInterval in finally block (watchdog compatibility)
  - (6) pipeline_version undefined (M9 not yet applied) → falls through to V1 path with console.warn (runtime guard)
- Mock strategy: `db` mocked as chainable Supabase mock (same pattern as M3/M4 tests). `EvolutionResult` constructed with known pool, ratings, matchHistory values. `toEloScale` imported from real V1 rating.ts (not mocked — it's a pure function). For test (10), mock must verify the sequence: first the run UPDATE sets status='completed', then the experiment UPDATE's NOT EXISTS subquery correctly excludes the current run.

**Done when**: V2 run produces full `run_summary` (EvolutionRunSummaryV3-compliant); run marked 'completed' with completed_at; all local pool variants (non-fromArena) persisted to `evolution_variants` with Elo scores; run appears in `/admin/evolution/runs` list; detail page shows timeline with generate/rank/evolve phases; Logs tab shows structured logs; experiment auto-completion works (with correct ordering guarantee); archive filter works; all 27 tests pass (21 finalize + 6 routing)

**Depends on**: Milestone 4 (runner.ts with minimal persistence to replace), Milestone 9 (for `pipeline_version` column and `archived` column in schema — M9 migration MUST be applied before M5's evolutionRunnerCore routing code is deployed; finalize.ts and its tests can be developed in parallel with M9 using mocked DB). **M9 column cross-reference**: M5 assumes `evolution_variants` has columns: `id`, `run_id`, `explanation_id`, `variant_content`, `elo_score`, `generation`, `parent_variant_id`, `agent_name`, `match_count`, `is_winner`. These MUST be enumerated in M9's `evolution_variants` CREATE TABLE. `evolution_runs` must have: `status`, `completed_at`, `run_summary` (JSONB), `pipeline_version` (TEXT), `archived` (BOOLEAN), `strategy_config_id` (FK), `experiment_id` (FK). Verify M9 schema matches before M5 implementation.
---

### ~~Milestone 6~~ (Moved to Appendix A — Deferred)
Proximity + Reflection are deferred to post-V2 launch. See **Appendix A** for the full spec. The core pipeline (M1-M5) works without them: `diversityScore` defaults to 1.0, `feedback` defaults to null, creative exploration never fires. These can be added later as a quality improvement pass.

---

### Milestone 6: Services Layer Simplification
**Goal**: Eliminate boilerplate across server actions via `adminAction` factory and consolidate shared utilities. Dead action deletion deferred to M10/M11 (actions are live until UI pages are replaced).

**Files to create**:
- `evolution/src/services/adminAction.ts` (~80 LOC) — Shared factory that handles `withLogging` + `requireAdmin` + `createSupabaseServiceClient` + try/catch + `ActionResult` wrapping + `serverReadRequestId` outer wrapper. Handler receives `{ supabase, adminUserId }` context (5+ actions use adminUserId from requireAdmin). Signature: `export const fooAction = adminAction('foo', async (input, { supabase, adminUserId }) => { ... })`. **Variable arity support**: the factory uses TypeScript generics with rest parameters to preserve existing exported signatures: `adminAction<Args extends unknown[], T>(name, handler: (...args: [...Args], ctx: AdminContext) => Promise<T>)` returns `(...args: Args) => Promise<ActionResult<T>>`. This handles three patterns found in the codebase: (a) **zero-argument actions** (6 occurrences: `getStrategyAccuracyAction`, `getEvolutionDashboardDataAction`, `getCrossTopicSummaryAction`, `getPromptBankCoverageAction`, `getPromptBankMethodSummaryAction`, `getStrategyPresetsAction`) — handler is `(ctx) => Promise<T>`, exported as `() => Promise<ActionResult<T>>`; (b) **single-argument actions** (majority) — handler is `(input: I, ctx) => Promise<T>`; (c) **multi-parameter actions with defaults** (2 occurrences: `runArenaComparisonAction(topicId, judgeModel?, rounds?)`, `getStrategyRunsAction(strategyId, limit?)`) — handler receives all original params plus ctx as last arg, preserving default values. The factory appends `ctx` as the final argument to the handler, so existing parameter positions and defaults are unchanged. Produces identical exported function signature to current `serverReadRequestId(withLogging(...))`. Each generated action is wrapped with `'use server'` directive at the module level (the consuming service files already have `'use server'` at top — adminAction.ts itself does NOT add the directive per-function; the existing module-level directive in each service file is sufficient). **adminAction.ts must NOT have `'use server'` at top** — it only exports the factory helper, not client-callable actions; importing it from `'use server'` modules is safe. **Imports**: `handleError` and `ErrorResponse` from `@/lib/errorHandling`; `withLogging` from `@/lib/logging/server/automaticServerLoggingBase`; `requireAdmin` from `@/lib/services/adminAuth`; `createSupabaseServiceClient` from `@/lib/utils/supabase/server`; `serverReadRequestId` from `@/lib/serverReadRequestId`; `isNextRouterError` from `next/dist/client/components/is-next-router-error`; `ActionResult` from `./shared`. The try/catch in the factory must use `handleError()` to produce `ErrorResponse` objects (matching Shape A), not raw `String(err)`. **Critical: Next.js redirect/notFound re-throw**: the catch block must check `if (isNextRouterError(error)) throw error` BEFORE processing as an ActionResult error — Next.js `redirect()` and `notFound()` throw special error objects that must propagate. Use `isNextRouterError` from `next/dist/client/components/is-next-router-error` (covers both `RedirectError` and `HTTPAccessFallbackError`). **Note**: there is NO `isNotFoundError` export in Next.js — the combined `isNextRouterError` guard is the correct API. Input validation (e.g., validateUuid) remains the handler's responsibility — adminAction handles only auth, logging, error wrapping, and client creation.
- `evolution/src/services/shared.ts` (~50 LOC) — Shared `UUID_REGEX`, `UUID_V4_REGEX` (strict), `validateUuid()`, `ActionResult<T>` (replacing 4+ duplicates).
  - **UUID_REGEX divergence**: `evolutionActions.ts` uses a strict v4 UUID regex named `UUID_RE` (line 80: `4[0-9a-f]{3}-[89ab][0-9a-f]{3}`); the other 4 files (`promptRegistryActions.ts`, `arenaActions.ts`, `experimentActions.ts`, `evolutionVisualizationActions.ts`) use a loose generic regex named `UUID_REGEX`. shared.ts provides BOTH: `UUID_REGEX` (loose, for general use) and `UUID_V4_REGEX` (strict, replacing `UUID_RE` in `evolutionActions.ts` for `estimateRunCostAction` which validates strategy IDs). Each action file imports the appropriate one from shared.ts and deletes its local copy.
  - **ActionResult<T> divergence**: `eloBudgetActions.ts` uses `{ success: boolean; data?: T; error?: string }` (optional fields, plain string error). All other 7 files use `{ success: boolean; data: T | null; error: ErrorResponse | null }` (required fields, ErrorResponse type). **Resolution**: shared.ts defines the Shape A form (`data: T | null; error: ErrorResponse | null`) as canonical. eloBudgetActions.ts must be updated to use Shape A — **Caller impact**: verified callers (`RelatedRunsTab.tsx`, `strategies/page.tsx`, `strategies/[strategyId]/page.tsx`) only check `res.success && res.data` — none access `.error` as a string directly. The migration is therefore safe with no UI-side code changes needed, but test (12) must confirm this by asserting the new shape.

**Files to modify** (refactor existing):
- `evolution/src/services/promptRegistryActions.ts` — Replace 7 action wrappers with `adminAction()` calls (~130 LOC saved). Per-file helpers (`normalizePromptRow`, `validateUuid` calls) remain as-is inside the handler body — adminAction only replaces the outer wrapping pattern. Note: `resolvePromptByText` is NOT a server action (takes supabase param directly) — must NOT be wrapped by adminAction; keep as-is.
- `evolution/src/services/strategyRegistryActions.ts` — Replace 9 action wrappers (~160 LOC saved). Per-file helpers (`normalizeStrategyRow`) remain as-is inside the handler body. Note: `getStrategyPresets()` (non-action plain async function, line 396) and `createStrategyCore()` (internal helper) must NOT be wrapped by adminAction — keep as-is. **createStrategyCore double-auth fix**: refactor `createStrategyCore` to accept `{ supabase, adminUserId }` context parameter instead of calling `requireAdmin()` + `createSupabaseServiceClient()` internally. Callers (`_createStrategyAction`, `_updateStrategyAction`, `_cloneStrategyAction`) already have auth context from adminAction — pass it through. This eliminates the double `requireAdmin()` call.
- `evolution/src/services/variantDetailActions.ts` — Replace 5 action wrappers (~90 LOC saved)
- `evolution/src/services/costAnalyticsActions.ts` — Replace 1 action wrapper (~20 LOC saved)
- `evolution/src/services/evolutionActions.ts` — Replace thin actions with adminAction factory. `estimateRunCostAction` kept (imported by RunConfigForm) — refactored like other actions (~100 LOC saved)
- `evolution/src/services/arenaActions.ts` — Replace thin wrappers with adminAction factory (keep all actions — deletion deferred to M10)
- `evolution/src/services/experimentActions.ts` — Replace thin wrappers with adminAction factory (keep all actions — deletion deferred to M11)
- `evolution/src/services/evolutionVisualizationActions.ts` — Replace thin wrappers (~150 LOC saved)
- `evolution/src/services/eloBudgetActions.ts` — Normalize to use adminAction factory. **Note**: eloBudgetActions already calls requireAdmin internally (lines 65, 153) — the normalization adds withLogging + serverReadRequestId wrapping + ErrorResponse error shape, NOT auth (auth is already present). adminAction replaces the existing inline requireAdmin calls, not adding a redundant layer. Private helpers (`fetchRunVariantStats`, `computeDurationSecs`) already accept a supabase client parameter — the adminAction handler passes `ctx.supabase` to them.

**Dead action deletion deferred**: The 10 actions previously labeled "dead" are ALL actively imported by UI pages (arena/page.tsx, arena/[topicId]/page.tsx, ExperimentHistory.tsx, ExperimentForm.tsx, strategies/page.tsx). They can only be deleted AFTER the consuming pages are replaced:
- Arena actions (6): delete in M10 when arena pages are rebuilt
- Experiment actions (3): delete in M11 when experiment pages are rebuilt
- Strategy presets (1): delete in M7 when strategy page is rebuilt

**Test strategy**: All existing service tests must still pass. Verify signature compatibility via `tsc --noEmit`. Add tests in `evolution/src/services/adminAction.test.ts` for the `adminAction` factory (~19 tests): (1) auth failure returns `{ success: false, data: null, error: ErrorResponse }` without calling handler, (2) logging integration — withLogging called with correct action name string (not transposed), (3) error wrapping — handler throw produces `{ success: false, data: null, error: ErrorResponse }` (uses `handleError()`, NOT raw string), (4) serverReadRequestId passthrough — outer wrapper applied, (5) Supabase client creation — createSupabaseServiceClient called once per invocation, (6) adminUserId passed through from requireAdmin, (7) successful handler → `{ success: true, data: result, error: null }`, (8) handler receives valid Supabase client, (9) eloBudgetActions normalization — verify actions now require admin auth, (10) concurrent calls get independent Supabase clients, (11) factory composition test WITHOUT mocking withLogging/serverReadRequestId — verify actual wrapping chain works end-to-end (existing service tests mock these away and cannot detect factory composition bugs), (12) eloBudgetActions ActionResult shape migration — verify callers receive ErrorResponse|null not string, (13) strategyRegistryActions: verify createStrategyCore's refactored signature accepts `{ supabase, adminUserId }` and does NOT call requireAdmin internally (no double-auth), (14) promptRegistryActions: verify resolvePromptByText is NOT wrapped by adminAction (it takes supabase param directly, is not a server action), (15) strategyRegistryActions: verify `getStrategyPresets()` is NOT wrapped by adminAction (it is a plain async helper, not a server action — `getStrategyPresetsAction` wraps it separately), (16) Next.js router error re-throw: requireAdmin throws redirect → adminAction re-throws it (not caught as ErrorResponse), (17) _updateStrategyAction passes context to createStrategyCore in the version-on-config-change path (no double requireAdmin), (18) zero-argument action: adminAction with no input params produces `() => Promise<ActionResult<T>>` — verify via `getStrategyAccuracyAction()` or equivalent, (19) multi-parameter action with defaults: adminAction preserves default parameter values (e.g., `runArenaComparisonAction(topicId)` uses default judgeModel and rounds).

**Done when**: All 9 service files (including eloBudgetActions.ts) refactored to use `adminAction()`; all existing tests pass; exported function signatures unchanged (verified via `tsc --noEmit` + export name audit); adminAction factory has 19 passing tests (including factory composition test without mocking wrappers); eloBudgetActions auth normalization verified by dedicated test; eloBudgetActions ActionResult<T> migrated to Shape A (ErrorResponse|null) — no UI caller changes needed (verified: callers only check `res.success`); createStrategyCore refactored to accept pre-authed context (no double requireAdmin); shared.ts ActionResult<T> structural compatibility confirmed across all replaced definitions; total services LOC reduced by ~500 (boilerplate only, no action deletions yet)

**Rollback**: Since this is a pure refactor with no schema changes, rollback is a single `git revert` of the milestone commit. All exported function names and signatures are unchanged, so reverting restores the original code with no downstream breakage.

**Depends on**: None (can run in parallel with any milestone — factory refactor only, no deletions)

---

### Milestone 7: Admin UI Component Simplification
**Goal**: Reduce admin page boilerplate from ~7,300 LOC to ~3,300 LOC (55% reduction) by extracting config-driven shared components that consolidate duplicated list/detail/dialog/badge infrastructure across 87 UI files.

**Context** (from 3 rounds of UI research, 12 agents):
- Only 2/8 list pages use EntityListPage (25% reuse) — lacks CRUD dialogs, row actions, advanced filters
- 7/7 detail pages use EntityDetailHeader (100% reuse) — but each still has 100-300 LOC of tab/fetch boilerplate (Run, Variant, Strategy, Prompt, Experiment, Invocation, Arena Entry)
- ~85% of page code is repetitive: data loading, filter state, dialog boilerplate, tab switching, status badges
- Dialog/form code duplicated across Prompts, Strategies, Arena (~600 LOC)
- 7 distinct badge implementations (4 duplicated across files, ~180 LOC redundant)
- URL builders already 97% centralized (only 3 missing)

**Relationship to existing components**: RegistryPage **wraps** EntityListPage (not replaces it). EntityListPage remains the low-level table+filters component. RegistryPage adds CRUD dialog orchestration, auxiliary data fetching, and row actions on top. EntityDetailPageClient **wraps** EntityDetailHeader + EntityDetailTabs, adding data fetching, auto-refresh, and lazy tab loading. Both existing components remain in use; the new components are higher-level compositions.

**Security notes**: All admin evolution pages are behind server-side layout guard (`isUserAdmin()` in `src/app/admin/layout.tsx` — NOT middleware). Components do not independently enforce auth — they rely on the page-level guard, which is the existing pattern across all admin pages. Column `render` functions return React elements (not raw HTML), so XSS risk is structurally prevented by React's escaping. FormDialog values are passed to server actions which validate input server-side (via `adminAction` factory from M6). CSRF protection is handled implicitly by Next.js server actions (built-in CSRF token validation).

**Files to create**:
- `evolution/src/components/evolution/RegistryPage.tsx` (~150 LOC) — Config-driven list page with CRUD
  - **Wraps EntityListPage** internally — passes columns, filters, items, sorting, pagination down to it
  - Handles: filters (text/select/checkbox/date-range), sortable columns, row actions with conditional visibility, pagination, header action buttons, auxiliary data fetching. **Filter delegation note**: EntityListPage only supports `text` and `select` filter types. RegistryPage renders `checkbox` and `date-range` filters itself above EntityListPage, passing only supported filter types down.
  - **Auxiliary data fetching interface**: `auxiliaryFetches?: Array<{ key: string; action: () => Promise<ActionResult<T[]>>; rowKey: string; resultKey: string }>` — each fetch runs in parallel on mount. RegistryPage unwraps `ActionResult` (checks `result.success`, extracts `result.data`), then indexes the array by `rowKey` (field on each result item) and merges into row data under `resultKey`. Example: `{ key: 'peakStats', action: getPeakStatsAction, rowKey: 'variantId', resultKey: 'peakStats' }`. On action failure (`success: false`), the auxiliary data is omitted and a `console.warn` is logged with the fetch key and error message (column renders without it; no user-facing error for non-critical auxiliary data).
  - Integrates FormDialog + ConfirmDialog for create/edit/clone/archive/delete flows
  - Column `render` functions handle page-specific rendering (badges, color-coded metrics, custom joins). Render functions receive typed row data and return ReactNode — no dangerouslySetInnerHTML.
  - **Submit guard**: All CRUD operations disable the submit button on click and re-enable on completion/error (prevents double-submit). Uses `useTransition` or `useState` loading flag.
  - Replaces per-page boilerplate in Variants (135→60 LOC), Invocations (110→55 LOC), Prompts (582→200 LOC), Strategies (924→500 LOC — agent selection widget ~150 LOC + preset flow + imports + config stay as custom blocks). **Error display**: FormDialog error banner shows structured `ErrorResponse.message` from adminAction (already sanitized by `handleError()`) — no raw stack traces shown. Render functions must null-check auxiliary fields (auxiliaryFetches merge is string-key-based, not statically typed).

- `evolution/src/components/evolution/EntityDetailPageClient.tsx` (~120 LOC) — Config-driven detail page shell
  - **Wraps EntityDetailHeader + EntityDetailTabs** — composes them with data fetching, auto-refresh, error/loading states
  - Handles: data fetching, lazy tab loading, auto-refresh integration
  - Config: `{ title(data), statusBadge(data), links(data), tabs: [{id, label}], renderTabContent(tabId, data) }`
  - Replaces per-page boilerplate in 6 detail pages (Variant, Strategy, Prompt, Experiment, Invocation, Arena Entry). **Exception**: Run detail page cannot use EntityDetailPageClient — its AutoRefreshProvider wraps the entire page including header controls, and the polling interval is exposed as a user-configurable UI element. Absorbing it into EntityDetailPageClient's wrapper model would require exposing AutoRefreshProvider config as a top-level prop, significantly complicating the component. Run detail page stays custom.

- `evolution/src/components/evolution/FormDialog.tsx` (~100 LOC) — Reusable form dialog
  - Field types: text, textarea, select, number, checkbox, custom render (escape hatch for complex widgets like agent selection)
  - Props: `title`, `fields: FieldDef[]`, `initial`, `onSubmit`, `validate?`, `children?` (for presets), `onFormChange?` (imperative callback for preset application — presets call `onFormChange(presetValues)` to update form state externally)
  - **Error handling**: `onSubmit` errors are caught and displayed inline via error banner within the dialog. Submit button shows loading spinner and is disabled during submission.
  - Replaces: PromptFormDialog (~230 LOC), NewTopicDialog (~50 LOC). StrategyDialog partially — agent selection stays as `type: 'custom'` render block (~55 LOC page-specific)

- `evolution/src/components/evolution/ConfirmDialog.tsx` (~40 LOC) — Reusable confirmation dialog
  - Props: `title`, `message`, `confirmLabel`, `onConfirm`, `danger?` (danger=true renders red confirm button + warning icon)
  - Replaces 3+ inline confirm dialogs across Prompts, Strategies, Arena

- `evolution/src/components/evolution/StatusBadge.tsx` (~40 LOC) — Unified badge component
  - Variants: run-status, entity-status (active/archived), pipeline-type, generation-method, invocation-status, experiment-status, winner
  - **Fallback**: Unknown status values render a neutral gray badge with the raw status string (no runtime errors)
  - Replaces 7 separate implementations (~180 LOC redundant code)
  - **Naming note**: The existing `EvolutionStatusBadge.tsx` (kept, ~59 LOC — handles run status specifically) has a similar name. To avoid import confusion, the new unified badge should be imported as `StatusBadge` from `@evolution/components/evolution/StatusBadge` while EvolutionStatusBadge remains at its existing path. Pages migrated in Phase D should switch from EvolutionStatusBadge to StatusBadge's 'run-status' variant.

- Add 3 missing URL builders to `evolution/src/lib/utils/evolutionUrls.ts` (~15 LOC):
  - `buildRunCompareUrl(runId)`, `buildRunLogsUrl(runId, options?)`, `buildArenaEntryUrl(entryId)`

**Files to modify** (refactor existing — incremental, page-by-page):
- `src/app/admin/evolution/variants/page.tsx` — Swap to RegistryPage config (135→60 LOC)
- `src/app/admin/evolution/invocations/page.tsx` — Swap to RegistryPage config (110→55 LOC)
- `src/app/admin/evolution/prompts/page.tsx` — Swap to RegistryPage + FormDialog (582→200 LOC)
- `src/app/admin/evolution/strategies/page.tsx` — Swap to RegistryPage + FormDialog (924→500 LOC — agent selection widget ~150 LOC + preset flow + imports stay as custom blocks)
- 6 detail page directories — Swap to EntityDetailPageClient config (Variant, Strategy, Prompt, Experiment, Invocation, Arena Entry; Run stays custom). **Excluded**: Arena Topic detail (`arena/[topicId]/page.tsx`) — unique interactive features (leaderboard, cost-elo scatter, side-by-side diff, run comparisons) don't fit EntityDetailPageClient's tab model.
- Remove duplicate StatusBadge/PipelineBadge/MethodBadge functions from 4+ page files

**Migration order and rollback strategy**:
1. **Phase A — Build shared components** (no existing code changes): Create RegistryPage, EntityDetailPageClient, FormDialog, ConfirmDialog, StatusBadge. Unit test each in isolation. No risk to existing pages.
2. **Phase B — Migrate list pages** (simplest first): Variants → Invocations → Prompts → Strategies. Each page is a separate commit. After each commit, run `tsc --noEmit` + existing unit tests for that page. If a migration breaks, revert the single commit (page-level atomic changes).
3. **Phase C — Migrate detail pages** (3 simplest first): Invocation → Variant → Prompt detail pages first (less custom logic), then Strategy → Experiment → Arena Entry. Run detail page stays custom (AutoRefreshProvider exception).
4. **Phase D — Badge cleanup**: Remove duplicate StatusBadge/PipelineBadge/MethodBadge functions from page files (only after pages use unified StatusBadge).
- **Rollback**: Each page migration is one commit. `git revert <commit>` restores the page to pre-migration state. No cross-page dependencies between migrations.

**Test strategy** (~330 LOC across 5 test files, 32 test cases):
- RegistryPage.test.tsx (~110 LOC, 9 tests): renders columns from config, applies text/select filters, calls onSort, renders row actions, fires CRUD dialog on action click, handles auxiliary data fetch merge (success path), handles auxiliary data fetch failure (logs warning, columns render without data), submit guard disables button during operation, handles empty items array
- FormDialog.test.tsx (~80 LOC, 7 tests): renders all field types (text/textarea/select/number/checkbox), validates required fields, calls onSubmit with form values, shows error banner on submit failure, disables submit during loading, supports custom render field, preset application via onFormChange
- ConfirmDialog.test.tsx (~30 LOC, 3 tests): renders title/message, calls onConfirm on confirm click, renders danger variant with red button
- StatusBadge.test.tsx (~50 LOC, 8 tests): renders each of the 7 variant types with correct color, renders unknown status with gray fallback
- EntityDetailPageClient.test.tsx (~60 LOC, 5 tests): renders header from config, renders tabs, lazy-loads tab content, shows loading state, shows error state on fetch failure
- **E2E note**: No existing E2E tests exist for admin evolution pages (verified: zero .e2e.ts files in src/app/admin/evolution/). M7 creates TWO new E2E tests: (1) Prompts page (create/edit/archive flow, ~60 LOC), (2) Strategies page (create with agent selection/preset flow, ~60 LOC) — strategies is the highest-risk migration and needs E2E coverage.
- **Visual regression**: Deferred — Playwright screenshot comparison is too flaky across CI environments (font rendering, anti-aliasing). StatusBadge correctness is covered by unit tests checking className/text content instead.

**Done when**:
- 5 shared components created and tested (32 unit tests passing)
- At least 3 list pages + 3 detail pages refactored to use them
- All existing unit and E2E tests pass with no behavior changes
- New Prompts page E2E test passes (create/edit/archive flow)
- New Strategies page E2E test passes (create with agent selection/preset flow — highest-risk migration)
- Admin UI LOC reduced by 1,500+ (measured via cloc)
- 3 missing URL builders added

**Depends on**: Soft dependency on M6 (adminAction factory) — M7's security notes reference adminAction for server-side validation. If M7 ships before M6, server actions still have inline requireAdmin() (functionally safe) but the stated security model references a non-existent factory. Phase A (build shared components) has no dependencies. Phase B+ (page migrations) benefit from M6 completing first.

---

### Milestone 8: Test Suite Simplification
**Goal**: Reduce test suite from ~41,710 LOC to ~14,000 LOC (~68% reduction) by eliminating tests for V1 abstractions, centralizing mock infrastructure, and writing focused V2 tests. Co-delete ~9,600 LOC of V1 production code (pipeline/state/supervisor, 13 agent files, subsystems) alongside their tests per the critical sequencing rule. Further reduction to ~7,600 LOC after M10/M11 complete arena/experiment rewrites.

**Context** (from 3 rounds of test research, 12 agents):
- 165 test files, 41,710 LOC, 2,383 test cases
- Only 22% of test files use the shared mock factory (78% create mocks independently)
- 23 files independently mock `createSupabaseServiceClient` with identical code
- pipeline.test.ts alone is 2,870 LOC (~40% mock setup boilerplate)
- 8 eliminated agent test files account for ~3,400 LOC (debate, iterativeEditing, treeSearch, sectionDecomposition, outlineGeneration, metaReview, calibrationRanker, tournament — no separate flowCritique test file exists)
- Integration tests: 4,480 LOC, most test V1-specific checkpoint/supervisor features
- `parseWinner` tested in 3 separate files (comparison.test.ts, pairwiseRanker.test.ts, pipeline.test.ts)

**V1 core tests to eliminate** (~10,557 LOC, 24 files — pipeline/state/agents/subsystems/checkpoint only; integration, script, and API route tests listed in dedicated sections below and counted separately in the LOC table):
- Pipeline/state/reducer/supervisor tests: 5,036 LOC, 7 files (pipeline 2,870, state 460, supervisor 591, reducer 238, actions 160, pipelineFlow 232, pipelineUtilities 485)
- 7 eliminated agent tests: 2,924 LOC (debate 391, iterativeEditing 820, treeSearch 452, sectionDecomposition 286, outlineGeneration 403, metaReview 230, calibrationRanker 342). **Note**: tournament.test.ts (675 LOC) is KEPT until M10 — tournament.ts production code deletion is deferred to M10 (M10 must extract swissPairing first), so per the critical sequencing rule, its test must also be kept until M10.
- Subsystem tests (treeOfThought 4 files, section 4 files): 1,922 LOC (beamSearch 724, treeNode 223, evaluator 214, revisionActions 192, sectionEditRunner 127, sectionFormatValidator 115, sectionParser 202, sectionStitcher 125)
- Checkpoint/persistence tests: 675 LOC, 2 files (persistence 323, persistence.continuation 352)

**Integration tests for V1 features** (subset of the 4,480 LOC integration total — counted in the Integration row of the LOC table, not V1 core): 2,350 LOC to delete (pipeline 541, outline 324, treeSearch 356, costAttribution 525, visualization 318, costEstimation 213, cronGate 73). **KEEP (not V1-only)**: evolution-actions.integration.test.ts (401 LOC — tests queueEvolutionRunAction, killEvolutionRunAction, getEvolutionCostBreakdownAction which are V2-active), evolution-infrastructure.integration.test.ts (271 LOC — tests concurrent claim, heartbeat timeout, split-brain detection which are V2-active via same DB locking). Migrate these 2 files to V2 context, do not delete.

**V1 tests to keep** (~1,814 LOC actual, 9 files — original ~900 LOC estimate was low):
- `rating.test.ts` (255 LOC) — OpenSkill rating math
- `comparison.test.ts` (215 LOC) — Pairwise comparison + parseWinner
- `comparisonCache.test.ts` (186 LOC) — LRU cache
- `formatValidator.test.ts` (131 LOC) — Format validation rules
- `formatValidationRules.test.ts` (224 LOC) — Rule implementations (stripCodeBlocks, hasBulletPoints, etc.)
- `reversalComparison.test.ts` (103 LOC) — 2-pass bias mitigation
- `textVariationFactory.test.ts` (54 LOC) — Variant creation
- `strategyConfig.test.ts` (548 LOC) — Hash dedup + label generation (used by V2 M1/M4). **Note**: actual LOC is 5x the original estimate due to extensive diffing/normalization tests. **Risk**: if this file imports V1-specific types (e.g., `PromptMetadata`, `PipelineType`) from `evolution/src/lib/types.ts`, it will break when V1 types.ts is deleted in M8. Verify imports before marking V1 types.ts for deletion; remove any V1-type-only imports from the test (they can be replaced with inline type literals or `as` casts).
- `errorClassification.test.ts` (98 LOC) — isTransientError (used by V2 M3 retry logic)

**Verified clean**: All 9 files confirmed to have zero imports of V1 abstractions (PipelineStateImpl, ExecutionContext, AgentBase, etc.). Safe to keep as-is. **Exception**: strategyConfig.test.ts may import V1-specific *types* (not abstractions) — verify imports against V1 types.ts before that file is deleted.

**Files to create** (shared test infrastructure):
- `evolution/src/testing/service-test-mocks.ts` (~80 LOC) — `setupServiceTestMocks()` auto-mocks Supabase + adminAuth + serverReadRequestId + withLogging; `createSupabaseChainMock()` replaces 23 independent copies
- `evolution/src/testing/component-test-mocks.ts` (~60 LOC) — `setupComponentTestMocks()` for next/link, next/navigation, next/dynamic

**V2 tests to write** (~950 LOC):
- `generate.test.ts` (~150 LOC, 12 tests) — 3 strategies, format validation, variant creation
- `rank.test.ts` (~300 LOC, 20+ tests) — Triage, Swiss pairing, convergence, draw handling, budget pressure tiers, elimination, early exit
- `evolve.test.ts` (~140 LOC, 10 tests) — Parent selection, mutation, crossover, format validation
- `evolve-article.test.ts` (~260 LOC, 9 tests) — Smoke test: 3-iteration pipeline end-to-end; budget exhaustion; kill detection
- `runner.test.ts` (~120 LOC, 6 tests) — Claim → execute → persist → complete lifecycle
- `finalize.test.ts` (~60 LOC, 5 tests) — V1-compatible run_summary, variant persistence

**Integration tests** (V2, ~900 LOC replacing 4,480):
- Single "full lifecycle" test: create run → call evolveArticle with real Supabase + mock LLM → verify variants persisted, invocations logged, run completed → cleanup
- Error scenarios: budget exceeded, LLM failure, run killed

**Page tests** (with M7, ~750 LOC replacing 2,517):
- Shared component tests (RegistryPage, EntityDetailPageClient, FormDialog, ConfirmDialog, StatusBadge): ~320 LOC tested once
- Per-page tests shrink to ~20 LOC each (config validation + error handling only)

**Component tests** (34 files, ~3,994 LOC):
- **Keep** (~1,478 LOC, 18 files): V2-reused shared components — EntityListPage (104), EntityDetailHeader (102), EntityDetailTabs (54), MetricGrid (79), EmptyState (37), TableSkeleton (33), EloSparkline (40), TextDiff (71), EvolutionStatusBadge (56), AutoRefreshProvider (205), EntityTable (72), EvolutionBreadcrumb (65), useTabState (79), ElapsedTime (56), AttributionBadge (69). Plus variant detail: VariantContentSection (64), VariantLineageSection (141), VariantMatchHistory (151).
- **Delete** (~1,520 LOC, 9 files): V1-only agent detail views — AgentExecutionDetailView (264). V1-only tabs — TimelineTab (576), BudgetTab (185). V1-only components — ActionChips (99), StepScoreBar (81), InputArticleSection (42), LineageGraph (47), AgentErrorBlock (70), shared/agentDetails (156).
- **Keep but shrink** (~996 LOC → ~300 LOC, ~7 files): Tab tests rewritten to use M7 config-driven testing — LogsTab (256→40), MetricsTab (90→20), RelatedRunsTab (84→20), RelatedVariantsTab (61→20), VariantsTab (196→40), VariantDetailPanel (121→40). Surplus LOC eliminated via shared component-test-mocks.ts.

**Service tests** (14 files, ~6,962 LOC):
- **Keep** (~1,922 LOC, 6 files): evolutionActions (1,155), promptRegistryActions (298), variantDetailActions (101), costAnalyticsActions (120), strategyResolution (185), experimentReportPrompt (63). These test V2-active server actions.
- **Keep until M7/M10/M11 migrate consumers** (~1,514 LOC, 5 files): eloBudgetActions (290), costAnalytics (369), evolutionRunnerCore (187), evolutionRunClient (127), strategyRegistryActions (541). Production code actively imported by UI pages; per critical sequencing rule, tests NOT deleted until consuming pages are migrated.
- **Rewrite** (~1,198 LOC → ~600, 1 file): evolutionVisualizationActions (1,198 — refactored after M6 adminAction).
- **Rewrite after M10/M11** (~2,328 LOC, 2 files): arenaActions (1,495), experimentActions (833). Deferred until M10/M11 replace the actions.

**Uncategorized lib/core/utils tests** (32 files, ~6,921 LOC):
- **Delete** (~4,681 LOC, 20 files): V1-only core — arena (416), arenaIntegration (463), metricsWriter (564), agentSelection (85), agentToggle (118), budgetRedistribution (114), costEstimator (659), pruning (102), critiqueBatch (205), eloAttribution (216), diversityTracker (163 — replaced by M6 proximity), pool (112 — replaced by V2 local variables), configValidation (317 — V2 uses EvolutionConfig type validation), config (50). V1-only lib — flowRubric (465), diffComparison (175), outlineTypes (198), config (110). Utils — metaFeedback (67 — replaced by M6 reflect), frictionSpots (82).
- **Keep** (~1,682 LOC, 9 files): costTracker (424 — V2 uses same costTracker), llmClient (412 — V2 reuses llmClient), logger (148 — V2 reuses logger), jsonParser (77), seedArticle (104), validation (91), formatValidationRules (224 — supplements formatValidator), evolutionUrls (61), formatters (141).
- **Defer to M10/M11** (~558 LOC, 3 files): promptBankConfig (121), experimentMetrics (394), analysis (43).

**Non-eliminated agent tests** (6 files, ~2,296 LOC):
- **Delete** (~2,296 LOC): reflectionAgent (291 — replaced by M6 reflect), rankingAgent (466 — replaced by V2 rank.ts), evolvePool (483 — replaced by V2 evolve.ts), proximityAgent (393 — replaced by M6 proximity), generationAgent (217 — replaced by V2 generate.ts), pairwiseRanker (446 — merged into V2 rank.ts).

**Script tests** (10 files, ~2,613 LOC):
- **Delete** (~603 LOC, 2 files): backfill-prompt-ids (328), backfill-experiment-metrics (275). These test obsolete scripts deleted in M9.
- **Rewrite in M9** (~735 LOC, 2 files): evolution-runner (348), run-evolution-local (387). M9 keeps and simplifies these scripts, so their tests must be REWRITTEN (not deleted) when M9 lands. M8 must NOT delete or modify these tests.
- **Defer** (~1,275 LOC, 6 files): Moved with their scripts to `evolution/scripts/deferred/` — run-prompt-bank (260), run-prompt-bank-comparisons (135), run-bank-comparison (141), run-arena-comparison (141), arenaUtils (163), oneshotGenerator (286).

**API route tests** (3 files, ~1,114 LOC):
- **Defer to M11** (602 LOC, 1 file): experiment-driver/route.test.ts — M11 owns the route file deletion, so M11 co-deletes the test (per critical sequencing rule: tests co-deleted with production code)
- **Rewrite** (218 LOC, 1 file): evolution-watchdog/route.test.ts — remove checkpoint recovery tests (V2 has no checkpoints), keep stale-run → failed transition tests
- **Modify** (294 LOC, 1 file): evolution/run/route.test.ts — add V2 pipeline_version routing tests, keep existing dual-auth/GET/POST tests

**Page-specific tests requiring modification** (6 files across 3 categories):
- **Modify**: EvolutionStatusBadge.test.tsx — remove `continuation_pending` test cases (status eliminated in V2)
- **Rewrite after M11**: ExperimentForm.test.tsx (391 LOC) — V2 replaces wizard with FormDialog config; ExperimentAnalysisCard.test.tsx (97 LOC) and ReportTab.test.tsx (65 LOC) — components eliminated in V2
- **Rewrite after M10**: arena/[topicId]/page.test.tsx (135 LOC), arena/entries/[entryId]/page.test.tsx (65 LOC) — pages rebuilt with config-driven components

**LOC reconciliation** (all evolution test files + integration — each file counted in exactly one row; ~41,710 is approximate from research, verified row sums shown):
| Category | Files | Before LOC | After LOC | Delta |
|----------|-------|-----------|-----------|-------|
| V1 core eliminate (pipeline/state/agents/subsystems/checkpoint) | 24 | 10,557 | 0 | -10,557 |
| V1 agent test kept for M10 (tournament.test.ts) | 1 | 675 | 675 | 0 |
| V1 keep (rating/comparison/format/etc) | 9 | 1,814 | 1,814 | 0 |
| Non-eliminated agent tests (delete) | 6 | 2,296 | 0 | -2,296 |
| Component tests (keep) | 18 | 1,478 | 1,478 | 0 |
| Component tests (delete) | 9 | 1,520 | 0 | -1,520 |
| Component tests (shrink) | 7 | 996 | 300 | -696 |
| Service tests (keep) | 6 | 1,922 | 1,922 | 0 |
| Service tests (keep until M7/M10/M11 migrate consumers) | 5 | 1,514 | 1,514 | 0 |
| Service tests (rewrite in M8 after M6 adminAction) | 1 | 1,198 | 600 | -598 |
| Service tests (defer M10/M11) | 2 | 2,328 | 0* | -2,328 |
| Lib/core/utils (delete) | 20 | 4,681 | 0 | -4,681 |
| Lib/core/utils (keep) | 9 | 1,682 | 1,682 | 0 |
| Lib/core/utils (defer M10/M11) | 3 | 558 | 0* | -558 |
| Script tests (delete — obsolete) | 2 | 603 | 0 | -603 |
| Script tests (rewrite — M9 owns) | 2 | 735 | 735 | 0 |
| Script tests (defer) | 6 | 1,275 | 0* | -1,275 |
| API route tests (delete+rewrite+modify) | 3 | 1,114 | 512 | -602 |
| Integration tests (V1 → V2) | — | 4,480 | 900 | -3,580 |
| Page tests (M7+M8) | — | 2,517 | 750 | -1,767 |
| V2 new tests | 6 | 0 | 950 | +950 |
| Shared mock infrastructure | 2 | 0 | 140 | +140 |
| **Row totals** | | **~43,943** | **~13,972** | **~68% reduction** |

**Table notes**:
- The ~41,710 LOC total from research was approximate. Row-level verified sums total ~43,943 Before. The ~2.2K gap likely reflects partial overlap between page tests (2,517) and component tests already counted above. The reduction percentage (~68%) is based on verified row sums (the 1,514 LOC of service tests kept until M7/M10/M11 are included in the After total since they are actively kept in M8).
- *Deferred files (~4,161 LOC) are moved to `deferred/` or left in place awaiting M10/M11. They are excluded from the active test suite but not deleted in M8.
- Further reduction to ~7,600 LOC after M10/M11 complete (which rewrites arena/experiment service tests and removes deferred items).

**Test strategy**: Validate by running V1 reused module tests first (must pass unchanged, run against original V1 import paths — not V2 barrel — to confirm no regression). Then run V2 new tests. Then verify no V1 test imports reference eliminated modules via `tsc --noEmit` on the test files. **Pre-deletion check for strategyConfig.test.ts**: before deleting V1 types.ts, run `grep -n "import.*from.*types" evolution/src/__tests__/strategyConfig.test.ts` and replace any V1-only type imports with inline type literals or `as` casts.

**Boundary between evolve-article.test.ts (unit) and integration tests**: evolve-article.test.ts is a unit-level smoke test that mocks both LLM and DB calls — it tests the orchestration logic (loop control, budget exhaustion, kill detection) with no external dependencies. The integration test uses a real Supabase instance + mock LLM — it tests data persistence (variants written, invocations logged, run status updated) and cleanup. No overlap: unit tests mock DB, integration tests use real DB.

**Integration test infrastructure**: V2 integration tests use `supabase start` (local Supabase) seeded with the V2 migration from M9. Test setup: `beforeAll` creates a test run + topic via service_role key, `afterAll` deletes test data. LLM is mocked via Jest mock (not real API calls). This matches V1's existing integration test pattern (see `evolution-infrastructure.integration.test.ts`). CI runs integration tests via `test:integration:evolution` script which expects local Supabase to be running (started by CI workflow `supabase start` step).

**Page tests sequencing**: Page tests require M7 (config-driven pages) to exist before M8 can write the simplified per-page tests. M8 depends on M7 for page tests only; all other M8 work depends on M1-5. Page test work is parallelizable with the rest of M8 once M7 is complete.

**PR strategy** (recommended split for reviewability -- each PR co-deletes production code + tests per critical sequencing rule):
- **PR 1**: Create shared mock infrastructure (service-test-mocks.ts, component-test-mocks.ts). No deletions.
- **PR 2**: Delete V1 pipeline/state/supervisor/reducer production code + their 7 test files (~5,036 test LOC + ~2,314 production LOC). Verify `grep -r` shows no remaining imports.
- **PR 3**: Delete 7 V1-only agent production files + their 7 test files (~2,924 test LOC + ~3,825 production LOC). Keep tournament.ts + tournament.test.ts.
- **PR 4**: Delete subsystem production code (treeOfThought/, section/) + their 8 test files (~1,922 test LOC). Delete checkpoint/persistence tests + production code (~675 test LOC).
- **PR 5**: Delete 6 non-eliminated agent production files + their 6 test files (~2,296 test LOC + ~2,296 production LOC).
- **PR 6**: Delete V1-only lib/core/utils tests + their production code (20 test files, ~4,681 LOC). Delete V1-only component tests (9 files, ~1,520 LOC).
- **PR 7**: Write V2 new tests (6 files, ~950 LOC) + rewrite shrunk tab tests (7 files) + rewrite integration tests (~900 LOC). Recalibrate jest.config.js coverage thresholds using final baseline.
- **PR 8** (after M7): Write simplified page tests (~750 LOC).

**CI/CD updates required**:
- Update `jest.config.js` coverage thresholds: methodology is delete V1 production code and tests in the SAME PR, run full suite (`npm test -- --coverage`), record new baseline, set thresholds at `baseline - 5%` for each metric. Include `jest.config.js` changes in the PR to ensure CI runs full suite (not `--changedSince`). **Timing**: recalibrate thresholds in the FINAL M8 PR (PR 7) only -- intermediate deletion PRs temporarily set thresholds to 0% to avoid blocking on shifting baselines during multi-PR mass deletion.
- Update CI workflow test path patterns: V2 unit tests auto-discovered by Jest glob (`**/*.test.ts`) in `jest.config.js` testMatch — no config change needed. V2 integration tests: update `package.json` `test:integration:evolution` pattern from `'evolution-|arena-actions|manual-experiment|strategy-resolution'` to `'evolution-|arena-actions|manual-experiment|strategy-resolution|v2-lifecycle|v2-error'`. V2 integration test files placed at `src/__tests__/integration/v2-lifecycle.test.ts` and `src/__tests__/integration/v2-error-scenarios.test.ts` (matching existing `testPathIgnorePatterns` which excludes `src/__tests__/integration/` from unit runs but includes them in integration config).
- After V1 test deletion PRs, run `tsc --noEmit` to catch broken imports from remaining test files that referenced deleted V1 modules.
- Note: DB migration testing (`supabase db reset --dry-run`, RPC verification) belongs in M9, not M8. M8 tests mock all DB interactions.

**Critical sequencing rule**: Tests MUST be co-deleted with their production code in the SAME PR. Never delete tests while production code is still actively imported.

**V1 production code to co-delete with tests** (not previously assigned to any milestone — M8 owns this):
- Pipeline/state/supervisor: `pipeline.ts` (904 LOC), `state.ts` (~320 LOC), `supervisor.ts` (~213 LOC), `reducer.ts` (~160 LOC), `pipelineFlow.ts` (~232 LOC), `pipelineUtilities.ts` (~485 LOC)
- 7 V1-only agent files: debate, iterativeEditing, treeSearch, sectionDecomposition, outlineGeneration, metaReview, calibrationRanker (~3,825 LOC total). tournament.ts (~675 LOC) deferred to M10 — see exception below.
- Subsystems: treeOfThought/ (4 files), section/ (4 files)
- 6 non-eliminated agent production files (co-deleted with their tests): reflectionAgent.ts, rankingAgent.ts, evolvePool.ts, proximityAgent.ts, generationAgent.ts, pairwiseRanker.ts (~2,296 LOC total)
- **Exception**: tournament.ts deletion deferred to M10 (M10 must extract swissPairing first). M8 MUST NOT delete tournament.ts. This is a HARD requirement, not a suggestion.
- Note: Before deleting production code, verify NO remaining imports via `grep -r` across the active codebase. Any page/route still importing a V1 module blocks its deletion until that consumer is migrated.

**Service tests**: Do NOT delete service tests (eloBudgetActions, costAnalytics, evolutionRunnerCore, evolutionRunClient, strategyRegistryActions) until their production code is also deleted or rewritten. These 5 production files are actively imported by UI pages. Keep their tests until the consuming pages are migrated in M7/M10/M11.

**Script tests safety**: evolution-runner.test.ts and run-evolution-local.test.ts must be REWRITTEN (not deleted) when M9 simplifies the scripts. M8 must NOT delete or modify these tests since M9 keeps the scripts. Only the 2 truly obsolete script tests (backfill-prompt-ids, backfill-experiment-metrics) are deleted in M8.

**Rollback plan**: Each PR co-deletes production code + tests atomically. `git revert <PR-commit>` restores both. No cross-PR dependencies between deletion batches (each PR self-contains its grep verification). If mid-sequence issues arise, remaining PRs can be deferred — the partially-deleted codebase still compiles because each PR's grep check verified no remaining imports before deletion.

**Done when**:
- Shared mock factory (`setupServiceTestMocks`) adopted by all kept/rewritten service test files
- V1 core test files co-deleted WITH their production code (24 test files + corresponding production files in same PRs; tournament.test.ts kept for M10)
- Non-eliminated agent tests deleted with their agent production files (6 test files + 6 agent files)
- tournament.test.ts (675 LOC) KEPT — deferred to M10 with tournament.ts production code
- V1-only component tests deleted (9 files) and shrunk tab tests rewritten (7 files)
- Service tests for actively-used production code KEPT (not deleted) — 5 files remain until M7/M10/M11 migrate consumers
- V1-only lib/core/utils tests deleted (20 files)
- Obsolete script tests deleted (2 files), script tests for M9-kept scripts left in place (2 files), deferred script tests moved (6 files)
- V2 test suite passes: 62 new test cases across 6 files
- Reused V1 tests pass unchanged (including strategyConfig, errorClassification, costTracker, llmClient, logger)
- strategyConfig.test.ts verified: no V1-type-only imports remain (or replaced with inline literals)
- Integration tests consolidated: 4,480 LOC → ~900 LOC (2 files)
- jest.config.js coverage thresholds recalibrated using baseline-5% methodology
- CI test:integration:evolution pattern updated to include v2- prefix
- Total active test LOC: ~14,000 (~68% reduction; further to ~7,600 LOC after M10/M11 (service tests for migrated consumers deleted))

**Depends on**: Milestones 1-5 (V2 core code must exist to test it), M7 (for page tests only). Mock infrastructure (service-test-mocks.ts, component-test-mocks.ts) can be created anytime.

---

### Milestone 9: Scripts + DB Migration Cleanup
**Goal**: Add a DROP+CREATE migration alongside existing ~102 V1 migration files; delete 4 obsolete scripts and simplify 2 runners for V2.

**DB Migrations — Collapse to single seed file**:

Recreating dev and prod from scratch with no backward compatibility. All historical evolution data (runs, variants, arena entries, experiments) will be dropped. No data export/import needed — this is an intentional clean slate.

**Migration collapse approach**: Keep old migration files in place but add a NEW migration (`20260315000001_evolution_v2.sql`) that DROPs all V1 evolution tables and recreates them with V2 schema. This avoids breaking `supabase db push` (which tracks applied migration history) — old migrations stay "applied" in the history, and the new migration cleanly replaces the schema. No need for `supabase migration repair` or orphan cleanup.

**V1 tables to DROP** (explicit enumeration — all use `DROP TABLE IF EXISTS ... CASCADE`):
- `evolution_runs`, `evolution_variants`, `evolution_checkpoints`, `evolution_agent_invocations`
- `evolution_run_logs`, `evolution_budget_events`, `evolution_agent_cost_baselines` (NOT `evolution_cost_baselines` — actual name after rename in 20260221000002)
- `evolution_run_agent_metrics` (created in 20260205000001, FK to evolution_runs — would CASCADE-drop but list explicitly for clarity)
- `evolution_arena_topics`, `evolution_arena_entries`, `evolution_arena_comparisons`, `evolution_arena_elo`
- `evolution_experiments`, `evolution_experiment_rounds`
- `evolution_strategy_configs`
- `evolution_batch_runs` (created in 20260205000004, renamed in 20260221000002 — missed in original enumeration). Batch functionality removed entirely in V2: batch runs were for systematic model/iteration/budget exploration via `run-evolution-local.ts --batch`; V2 replaces this with experiment-driven runs via `evolution_experiments` table (M11 Experiments UI). The `batch_run_id` FK on `evolution_runs` is also dropped.
- Also DROP V1 RPCs (use `DROP FUNCTION IF EXISTS` with explicit argument-type signatures to handle overloads): `checkpoint_and_continue`, `apply_evolution_winner`, `compute_run_variant_stats`, `claim_evolution_run(TEXT)`, `claim_evolution_run(TEXT, UUID)` (two overloads from 20260222000001), `sync_to_arena`, `update_strategy_aggregates`, `get_non_archived_runs`, `archive_experiment`, `unarchive_experiment`, `checkpoint_pruning_rpc`, `get_latest_checkpoint_ids_per_iteration` (created in 20260221000005 — missed in original enumeration)
- Also DROP backward-compatible VIEWs (created in 20260221000002 and 20260303000005): `DROP VIEW IF EXISTS content_evolution_runs, content_evolution_variants, hall_of_fame_entries, hall_of_fame_comparisons, strategy_configs, batch_runs, agent_cost_baselines CASCADE` (and any other evolution_* views). These views reference V1 tables; without dropping them, orphaned views persist and could bypass RLS (views execute as owner, not caller). Test via `pg_views` assertion.
- Total: 16 V1 tables + ~7 V1 views + 12 V1 RPCs dropped, replaced by 10 V2 tables + 4 V2 RPCs.
- **Note**: actual V1 migration file count is ~102 (not ~73 as originally estimated). All stay in place (already applied in DB history).

**Rollback / backup strategy**: Before applying to staging or prod, take a Supabase project snapshot (Dashboard → Settings → Snapshots) or `pg_dump` the evolution tables. Since this is an intentional clean-slate with no data preservation, rollback = restore snapshot + `supabase migration repair --status reverted 20260315000001`. Document in PR description.

**Migration files**: Keep existing ~102 V1 migration files in place (they're already applied in staging/prod DB history). Add one new migration that drops and recreates.

**Files to create**:
- `supabase/migrations/20260315000001_evolution_v2.sql` (~350 LOC) — Drops all V1 evolution tables + RPCs, then creates V2 schema:
  - **V2.0 Core** (5 tables): `evolution_runs` (config JSONB + `strategy_config_id` FK, `archived` boolean, `pipeline_version` TEXT), `evolution_variants` (Elo + lineage), `evolution_agent_invocations` (per-phase timeline), `evolution_run_logs` (id BIGSERIAL PK, run_id UUID FK CASCADE, created_at TIMESTAMPTZ, level TEXT, agent_name TEXT, iteration INT, variant_id TEXT, message TEXT, context JSONB — same columns as V1, indexes: by run+created_at DESC, by run+iteration, by run+agent_name, by run+variant_id, by run+level), `evolution_strategy_configs` (id, name, config JSONB, config_hash for dedup, is_predefined, created_at). No `evolution_checkpoints` table (Decision 1: no checkpointing).
  - **V2.1 Arena** (3 tables): `evolution_arena_topics` (prompts, case-insensitive unique), `evolution_arena_entries` (Elo merged in — no separate elo table; includes `archived_at TIMESTAMPTZ` for soft-delete; `run_id UUID REFERENCES evolution_runs(id) NULL` — nullable because manual entries have no associated run), `evolution_arena_comparisons` (minimal: topic_id FK, entry_a, entry_b, winner, confidence, run_id UUID NULL — nullable for admin-initiated comparisons with no associated run, `status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed'))` — pending state used by M10's two-phase rate limit pattern for single comparisons, created_at — topic_id included to avoid join-through-entries for Match History tab queries)
  - **V2.1 Batch tracking** (1 table): `evolution_arena_batch_runs` (id UUID PK, topic_id UUID FK → topics, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ — NULL while running, set on completion/failure). Used by M10's batch comparison global rate limit (max 3 concurrent batches). Index: `(finished_at) WHERE finished_at IS NULL` for efficient active-batch count queries.
  - **V2.2 Experiments** (1 table): `evolution_experiments` (6 columns: id, name, prompt_id FK, status, created_at, updated_at — updated_at required by M11)
  - **RPCs** (4, all SECURITY DEFINER with explicit `REVOKE EXECUTE ON FUNCTION <name> FROM PUBLIC; GRANT EXECUTE ON FUNCTION <name> TO service_role;` plus `SET search_path = public` on each function definition to prevent search_path injection — V1 omitted these on sync_to_arena and update_strategy_aggregates, leaving them callable by anon):
    - `claim_evolution_run` (FOR UPDATE SKIP LOCKED — reuse V1 logic)
    - `sync_to_arena` (NEW — rewritten for merged schema: upserts entries with elo_rating + match_count inline (no separate elo table), inserts match results to `evolution_arena_comparisons` (minimal: topic_id, entry_a, entry_b, winner, confidence, run_id, created_at — no dimension_scores). Accepts p_entries + p_matches JSONB arrays. `p_elo_rows` parameter removed — elo is embedded in p_entries directly since there's no separate elo table. Input validation is NEW (not from V1): `p_entries` max 200 elements, `p_matches` max 1000 elements, raises exception on oversized input)
    - `cancel_experiment` (NEW — atomically cancels experiment + bulk-fails its pending/claimed/running runs. SECURITY DEFINER, service_role only. Used by M11's cancelExperimentAction)
    - `update_strategy_aggregates` (reuse V1 — updates run_count, avg_final_elo, total_cost_usd on strategy_configs after run finalization)
  - **Dropped RPCs**: `checkpoint_and_continue` (no checkpointing), `apply_evolution_winner` (no winner application), `compute_run_variant_stats` (V2 computes metrics in application layer via direct queries)
  - **Indexes**: pending claim, heartbeat staleness, variant-by-run, arena leaderboard, experiment status, archived filter, logs by run, strategy config_hash unique
  - **FKs**: runs.prompt_id → topics, runs.experiment_id → experiments (nullable), runs.strategy_config_id → strategy_configs (nullable), arena entries → topics + runs
  - No budget_events, no cost_baselines, no separate elo table, no experiment_rounds. Comparisons table IS included (minimal, for Match History tab).
  - **RLS policy**: Enable RLS on all 10 tables. All tables get a single restrictive policy: `CREATE POLICY "deny_all" ON <table> FOR ALL USING (false) WITH CHECK (false)` — `USING (false)` blocks reads + update/delete row matching; `WITH CHECK (false)` blocks inserts + update new-row validation. Both clauses required for full default-deny. All data access goes through SECURITY DEFINER RPCs (which bypass RLS) or service_role key (which bypasses RLS). This ensures anon/authenticated users cannot read or write evolution data directly. If future client-side reads are needed, add explicit SELECT policies per table.
  - **RPC input validation**: `sync_to_arena` validates JSONB array params: `p_entries` max 200 elements, `p_matches` max 1000 elements. Raises exception on oversized input. (`p_elo_rows` is removed — elo is embedded in p_entries.) All RPCs validate required fields are non-null before processing.

**Scripts to delete** (4 production files + 2 associated test files, ~988+ LOC):
- `evolution/scripts/backfill-prompt-ids.ts` (339 LOC) — V1 data migration
- `evolution/scripts/backfill-prompt-ids.test.ts` — associated test file (delete with production code)
- `evolution/scripts/backfill-experiment-metrics.ts` (247 LOC) — V1 checkpoint backfill
- `evolution/scripts/backfill-experiment-metrics.test.ts` — associated test file (delete with production code)
- `evolution/scripts/backfill-diff-metrics.ts` (243 LOC) — V1 diff backfill
- `evolution/scripts/audit-evolution-configs.ts` (159 LOC) — V1 config validation

**CI workflows to update**:
- `.github/workflows/supabase-migrations.yml` — Remove `backfill-prompt-ids.ts` from path triggers and deploy steps **before** deleting the script file (CI must not reference a deleted file — remove from workflow first, merge, then delete the script in a follow-up commit). Review orphan/duplicate repair logic (designed for incremental migrations, may need simplifying after collapse to single seed).
- `.github/workflows/ci.yml` — M8 mass-deletion PR should run full test suite (not `--changedSince`) to validate transition. Add `supabase db push --dry-run` step (path-filtered to `supabase/migrations/`) to verify the prod deployment path (`supabase db reset` has no `--dry-run` flag).
- `.github/workflows/migration-reorder.yml` — Keep for now (V1 migrations still exist in history). Remove only after confirming no other non-evolution migrations depend on reorder logic.
- `jest.config.js` — Coverage threshold recalibration: delete V1 production code and tests in the SAME PR (never delete tests without their production code). Run full suite, record new baseline, set thresholds at baseline minus 5%. Include `jest.config.js` changes in the PR to trigger full CI (not `--changedSince`).

**Scripts to defer** (6 files, ~1,747 LOC — move to `evolution/scripts/deferred/`):
- Arena scripts: `add-to-arena.ts`, `add-to-bank.ts`, `run-arena-comparison.ts`, `run-bank-comparison.ts`
- Experiment scripts: `run-prompt-bank.ts`, `run-prompt-bank-comparisons.ts`
- Plus `lib/arenaUtils.ts`
- Plus associated test files: `run-prompt-bank.test.ts`, `run-prompt-bank-comparisons.test.ts`, `run-bank-comparison.test.ts`, `run-arena-comparison.test.ts`, `lib/arenaUtils.test.ts` (note: `add-to-arena.ts` and `add-to-bank.ts` have no test files)
- Update `jest.config.js` `testPathIgnorePatterns` to exclude `deferred/` directory. Add `deferred/tsconfig.json` (extends root tsconfig, includes only `deferred/**/*.ts`) so deferred scripts can be type-checked independently via `tsc -p evolution/scripts/deferred/tsconfig.json --noEmit` without blocking the main `tsc --noEmit` build.

**Scripts to keep and simplify** (3 files, ~1,553 LOC → ~800 LOC):
- `evolution-runner.ts` (425→200 LOC) — Remove checkpoint/resume/continuation logic, simplify to: claim → resolve content → call evolveArticle → persist
- `run-evolution-local.ts` (811→400 LOC) — Remove checkpoint expansion, bank logic, outline mutation; keep core: seed → run pipeline → print result
- `lib/oneshotGenerator.ts` (317 LOC) — Keep as-is (stays in `lib/`, NOT deferred)
- Associated test files: `evolution-runner.test.ts`, `run-evolution-local.test.ts`, `lib/oneshotGenerator.test.ts` — keep and update alongside their production files

**Test strategy**:
- **Schema verification**: Run `supabase db reset` with new migration; then run automated SQL assertions against `information_schema.tables` and `information_schema.columns` to verify all 9 tables created with correct columns (not just exit-code success). Verify all indexes exist via `pg_indexes`. Verify FKs enforce referential integrity. Also test `supabase db push --dry-run` against a linked remote to verify the prod deployment path (push, not just reset). Note: `supabase db reset` has no `--dry-run` flag — use `supabase db push --dry-run` for that purpose.
- **RPC test cases**:
  - `claim_evolution_run`: (1) Two concurrent claims on same pending run — only one succeeds (SKIP LOCKED). (2) Claim updates status to `running` and sets `claimed_by`. (3) No pending runs returns null gracefully.
  - `sync_to_arena`: (1) Upsert new entries — verify elo_rating + match_count populated. (2) Upsert existing entries — verify idempotent (no duplicates). (3) Match results inserted to comparisons table with correct FKs. (4) Oversized JSONB array (>200 entries) raises exception. (5) FK violation: nonexistent topic_id in p_entries raises FK constraint error (entry must reference existing arena_topics row).
  - `update_strategy_aggregates`: (1) After run finalization, run_count incremented and avg_final_elo recalculated. (2) Null strategy_config_id on run — no-op, no error.
  - `cancel_experiment`: (1) Atomically cancels experiment + bulk-fails pending/claimed/running runs. (2) Already-completed experiment is no-op. (3) Anon key cannot call cancel_experiment RPC (REVOKE verified).
- **Negative / idempotency tests**: (1) Migration is idempotent — running it twice doesn't error (DROP IF EXISTS). (2) RPC called with invalid FK (nonexistent run_id) returns appropriate error. (3) Anon key cannot call any of the 4 RPCs (REVOKE verified). (4) Direct table INSERT/SELECT with anon key blocked by RLS (test both SELECT and INSERT to verify USING + WITH CHECK). (5) All V1 function overloads dropped — verify pg_proc shows only V2 signature for claim_evolution_run. (6) All 16 V1 tables dropped — verify pg_tables returns exactly 10 evolution_* V2 tables. (7) All backward-compatible views dropped — verify `SELECT count(*) FROM pg_views WHERE viewname LIKE 'evolution_%' OR viewname LIKE 'content_evolution_%' OR viewname LIKE 'hall_of_fame_%'` returns 0.
- **Deferred scripts**: Verify deferred/ scripts still compile (`tsc --noEmit` on deferred directory) and their test files are excluded from `jest` default run via `testPathIgnorePatterns`.
- **CI**: Use `DROP TABLE IF EXISTS ... CASCADE` in migration to handle FK dependencies.

**Done when**:
- V1 migration files kept in place (already applied in DB history)
- 1 new migration drops V1 tables + creates V2 schema (10 tables + 4 RPCs)
- `supabase db reset` succeeds on fresh database
- 4 obsolete scripts deleted
- 6 deferred scripts moved to `deferred/` directory
- Runner scripts simplified (checkpoint/resume logic removed)
- RLS enabled on all 10 tables with default-deny policies
- Anon key cannot call RPCs or access tables directly (verified by test)
- `supabase db push` succeeds against fresh project (prod path verified)
- Deferred scripts excluded from jest + tsc main runs
- Total LOC removed: ~988 (scripts deleted) + ~753 (scripts simplified) = ~1,741 LOC

**Depends on**: Milestone 1 (V2 types define the schema requirements). Can run in parallel with M2-M5. **Cross-milestone note**: M11 depends on M9 for the `cancel_experiment` RPC definition.

---

### Milestone 10: V2.1 Arena (Simplified Leaderboard)
**Goal**: Build a streamlined Arena for comparing text variants across prompts — 3 tables (topics + entries with merged Elo + minimal comparisons), 8 server actions, 2 config-driven admin pages.

**Context** (from 3 rounds of Arena/Experiments research, 12 agents):
- Arena is fundamentally "a leaderboard of variants per prompt, ranked by Elo"
- V1 has 4 tables (topics, entries, comparisons, elo) — V2.1 merges elo into entries (no separate elo table), keeps minimal comparisons table for Match History
- V1 has 14 server actions (6 dead) — V2.1 needs 8
- Pipeline integration simplifies: prompt_id required upfront (no auto-resolution fallbacks)
- Topics = prompts (same table: `evolution_arena_topics`)

**Key simplification**: Require `prompt_id` set BEFORE run starts. For explanation-based runs (explanation_id set), auto-create a topic from the explanation title at run creation time (before pipeline starts, not inside it). For prompt-based runs, prompt_id is provided directly. DB enforced: `evolution_runs.prompt_id UUID NOT NULL REFERENCES evolution_arena_topics(id)`. **Note**: V1 migration 20260215000001 explicitly reverted NOT NULL on prompt_id because "explanation-based runs have no prompt_id". V2's M9 seed migration drops and recreates evolution_runs with NOT NULL — this is safe in the clean-slate approach (no existing runs preserved). Eliminates `autoLinkPrompt()` with its 3 in-pipeline fallback strategies — resolution happens once at run creation, not during finalization. Also eliminates `resolveTopicId()` from `arenaIntegration.ts`. **Sequencing**: `pipeline.ts` (deleted in M8) is the primary caller of `autoLinkPrompt`. M10 can only delete `autoLinkPrompt` from `arenaIntegration.ts` after M8 deletes `pipeline.ts` — otherwise the import reference breaks `tsc --noEmit`. Verify via grep before deletion.

**Files to create**:
- `evolution/src/lib/v2/arena.ts` (~150 LOC) — Core Arena functions:
  - `loadArenaEntries(promptId, supabase)` — Load active (non-archived) arena entries into pool with preset ratings (mu/sigma). Query filters: `WHERE topic_id = $promptId AND archived_at IS NULL`. Entries marked `fromArena: true` so they're filtered from variant persistence but participate in ranking. **V1 signature delta**: V1's `arenaIntegration.ts` has a different signature for its equivalent function. All call sites (runner.ts M4 for load-before-evolve, finalize.ts M5 for fromArena filtering) must use V2's new signature — there are no shared call sites with V1's version.
  - `syncToArena(runId, promptId, pool, ratings, matchHistory, supabase)` — Full sync via `sync_to_arena` RPC:
    - **Type contracts**: `pool: TextVariation[]` (from types.ts), `ratings: Map<string, { mu: number; sigma: number }>` (OpenSkill rating objects keyed by variant ID), `matchHistory: Array<{ entryA: string; entryB: string; winner: 'a' | 'b' | 'draw'; confidence: number }>` (same shape as comparisons table minus run_id/created_at which are added server-side)
    1. **New variants**: All non-arena variants (`pool.filter(v => !v.fromArena)`) upserted as arena entries (content, generation_method, model, cost, elo_rating)
    2. **Match history**: All pairwise comparison results from the run (entry_a, entry_b, winner, confidence) — includes matches involving arena-loaded variants
    3. **Elo updates for ALL entries**: Updated mu/sigma/elo_rating for both new AND existing arena entries that participated in this run's ranking. This means existing arena entries get their ratings refined by competing against new variants.
    - **Upsert conflict key**: `ON CONFLICT (topic_id, id)` — each variant has a unique ID generated at creation time, not content-based. Two variants with identical text but different IDs are distinct arena entries.
    - **RPC atomicity**: `sync_to_arena` executes all three operations (upsert entries, insert match history, update Elo ratings) inside a single Postgres transaction. Partial failures roll back the entire sync. The RPC is defined in M9's seed migration.
    - **RPC payload validation**: The `sync_to_arena` RPC validates JSONB payload shape server-side before processing: (a) `variants` array elements must have `id UUID`, `content TEXT NOT NULL`, `elo_rating NUMERIC`; (b) `match_history` elements must have `entry_a UUID`, `entry_b UUID`, `winner TEXT CHECK (winner IN ('a','b','draw'))`, `confidence NUMERIC CHECK (confidence BETWEEN 0 AND 1)`; (c) `ratings` object keys must be valid UUIDs. Malformed payloads raise an exception that rolls back the transaction — no partial writes.
  - `isArenaEntry(variant: TextVariation): variant is ArenaTextVariation` — Type guard function exported from arena.ts. Checks `'fromArena' in variant && (variant as ArenaTextVariation).fromArena === true`. All consumer code (finalize.ts, evolve-article.ts) uses this guard instead of raw property checks.
  - No `autoLinkPrompt`, no `resolveTopicId`, no `findOrCreateTopic`

**Server actions** (8, down from 14 — all use `adminAction` factory from M6 for auth enforcement + error handling). **Scope note**: V1's `arenaActions.ts` has 13+ references to the separate `evolution_arena_elo` table (selects, inserts, upserts). These are all replaced in V2 by direct reads/writes to the `elo_rating` and `match_count` columns on `evolution_arena_entries`. The entire arenaActions.ts file is rewritten (not patched) in M10.
- `getArenaTopicsAction` — List topics with entry counts + Elo range
- `getArenaEntriesAction(topicId)` — Ranked entries (replaces both getEntries + getLeaderboard)
- `runArenaComparisonAction(topicId, entryAId, entryBId)` — Single-pair LLM compare + update Elo. **LLM provider**: Uses `createEvolutionLLMProvider()` (or equivalent service-level LLM client) with the default judge model from environment config. LLM costs for admin-initiated comparisons are NOT tracked per-run (no associated run) — they are fire-and-forget operational costs. If cost visibility is needed later, add a `comparison_cost_usd` column to `evolution_arena_comparisons`. Server-side: `elo_rating` computed from mu via `toEloScale()` inside the RPC. Match_count incremented server-side. **Rate limit**: max 10 comparisons per topic per minute — enforced via DB-backed timestamps using advisory lock to prevent race conditions: `SELECT pg_advisory_xact_lock(hashtext('arena_compare_' || $topic_id))` then COUNT recent + INSERT in same transaction. In-memory rate limiting is ineffective in serverless (cold starts reset state). **CSRF**: Handled implicitly by Next.js server actions (built-in CSRF token validation) — no additional CSRF protection needed. **LLM error handling**: If the LLM call fails, the entire transaction rolls back (no comparison recorded, no Elo update, no rate limit slot consumed). The advisory lock is released on transaction rollback. Sequence: acquire advisory lock → check rate limit count → call LLM → INSERT comparison + UPDATE Elo → commit (releases lock). LLM failure before INSERT means no row written, rate limit slot not consumed. LLM calls have a 30-second timeout via AbortSignal. **Cost visibility**: LLM costs for admin-initiated comparisons are NOT tracked per-run. Cross-topic abuse (10/min × N topics) is limited by the global batch rate limit (max 3 concurrent batches).
- `runArenaBatchComparisonAction(topicId, rounds)` — Swiss-paired batch comparison: runs N rounds of info-maximizing pairwise comparisons across all entries in a topic. **Swiss pairing extraction**: Extract `swissPairing()` from V1's `evolution/src/lib/agents/tournament.ts` (line 68, currently private module-level function with 4 params: `pool, ratings, completedPairs, topK`). **CRITICAL sequencing**: M8 MUST NOT delete tournament.ts (enforced in M8's production code co-delete list — tournament.ts is excluded). M10 extracts swissPairing from tournament.ts and THEN deletes tournament.ts + its test file. This is a HARD requirement resolved in M8's plan. Refactor to accept entry arrays + rating maps + empty Set for completedPairs. V2 arena.ts adapter converts DB entry rows to the expected TextVariation-like shape. Batch action loads entries from DB, builds ephemeral rating map, calls swissPairing per round. **Rate limit**: max 1 batch per topic per 5 minutes (DB-backed, same pattern as single comparison). **Global rate limit**: max 3 concurrent batch comparisons across all topics, enforced via advisory lock: `SELECT pg_advisory_xact_lock(hashtext('arena_batch_global'))` then `SELECT count(*) FROM evolution_arena_batch_runs WHERE started_at > now() - interval '5 minutes' AND finished_at IS NULL` — if count >= 3, reject. The `evolution_arena_batch_runs` table (added in M9 seed migration) tracks `id, topic_id, started_at, finished_at` for active batches. Row inserted at batch start, `finished_at` set on completion/failure (in a finally block). Prevents unbounded LLM cost from triggering batches across many topics simultaneously.
- `upsertArenaEntryAction` — Add/update entry (replaces addToArena + generateAndAdd). Input validation: content max 50KB (enforced at Zod schema level: `z.string().max(50 * 1024)`), generation_method from allowed enum. **Note**: V1 arenaActions.ts lacked this Zod-level cap — it must be added in V2, not just as a handler-level check.
- `deleteArenaEntryAction(entryId)` — NEW V2 soft-delete (sets `archived_at` timestamp). Replaces V1 `deleteArenaEntryAction` which was a hard delete — same name, rewritten implementation.
- `archiveArenaTopicAction` — Soft archive topic (sets `archived_at`, does NOT cascade to entries — entries remain for historical leaderboard, topic hidden from active list)
- `createArenaTopicAction` — New topic. Input validation: name max 200 chars, trimmed, non-empty.

**Admin pages** (2 pages, ~100 LOC config total using M7 components):
- Arena list — RegistryPage config: topic name, entry count, Elo range, best method, status filter (~45 LOC)
- Arena topic detail — EntityDetailPageClient config: 2 tabs (Leaderboard, Match History). No scatter chart, no text diff, no coverage grid — defer to later (~55 LOC). **Feature regression**: V1 topic detail page is 937 LOC with 4 tabs (Leaderboard, Coverage Grid, Scatter Chart, Match History). V2.1 drops Coverage Grid and Scatter Chart tabs intentionally — these are analytics features that can be re-added later if needed. Acknowledge in PR description.
- Drop entry detail page (use modal drill from leaderboard instead)

**Pipeline integration** (called from runner.ts, NOT from evolve-article.ts — evolveArticle's M3 signature has no promptId param):
- **Integration point**: runner.ts (M4) orchestrates the arena flow around evolveArticle. Runner reads `prompt_id` from the run record (NOT NULL per M9 schema), calls `loadArenaEntries(promptId, supabase)` BEFORE evolveArticle, then passes arena entries via evolveArticle's `options.initialPool` parameter (M10 addendum to M3: add `initialPool?: TextVariation[]` to evolveArticle's options — these are prepended to the pool alongside the baseline variant at loop start; their existing ratings are seeded into the ratings Map). After evolveArticle returns, runner calls `syncToArena(...)`. This keeps evolveArticle arena-agnostic (it treats initialPool entries like any other variant). M10 modifies runner.ts to add ~15 LOC for load-before + sync-after, and adds ~5 LOC to evolve-article.ts for initialPool handling. **initialPool handling detail** (the ~5 LOC in evolve-article.ts): At the start of the evolve loop, prepend `options.initialPool` entries to the pool array alongside the baseline variant. For each initialPool entry that has mu/sigma (arena entries do), seed its rating into the OpenSkill ratings Map via `rating([entry.mu, entry.sigma])` (OpenSkill's `rating()` accepts [mu, sigma] tuple). Entries without mu/sigma get default OpenSkill ratings. This ensures arena entries start with their existing skill estimate rather than the default, so ranking immediately reflects their historical performance. **Pre-wiring**: M3 should include `initialPool?: TextVariation[]` in evolveArticle's options type definition (defaulting to empty array) so M10's modification is additive, not a signature change. M10 adds the implementation that uses it.
- At start: `loadArenaEntries(promptId, supabase)` → returns existing arena entries with preset ratings (fromArena: true). Runner prepends these to the initial pool before calling evolveArticle. These compete naturally alongside new variants during ranking.
- At end: `syncToArena(runId, promptId, pool, ratings, matchHistory, supabase)` → atomic sync of:
  - All new variants (not fromArena) as arena entries
  - Full match history (all comparisons, including those involving arena entries)
  - Updated elo for ALL pool entries (new + existing arena entries get refined ratings)
  - This means the arena is a continuous rating space — each run refines existing ratings AND adds new contenders.
- **fromArena filtering in finalize.ts (M5 cross-ref)**: finalize.ts persists variants to `evolution_variants` table. Arena-loaded entries (`fromArena: true`) must NOT be persisted as new variant rows — they already exist in the arena. finalize.ts filters: `pool.filter(v => !v.fromArena)` before upserting to `evolution_variants`. The `fromArena` flag is NOT a field on V1's TextVariation type (which is re-exported unchanged from M1). Instead, define `ArenaTextVariation = TextVariation & { fromArena: boolean; mu?: number; sigma?: number }` in V2 types.ts (M1 addendum — add to V2 barrel exports). The optional `mu`/`sigma` fields carry the entry's existing OpenSkill rating from the arena DB — `loadArenaEntries` populates them from the DB columns. Runner.ts reads these when seeding the OpenSkill ratings Map before calling evolveArticle. `loadArenaEntries` returns `ArenaTextVariation[]`. Consumer code uses the `isArenaEntry()` type guard from arena.ts for filtering (not raw property checks). This avoids modifying V1's TextVariation type while maintaining type safety.
- **Strategy column for manual entries**: Entries added manually (no linked run) show strategy as "Manual" in leaderboard. Join `entry.run_id → run.strategy_config_id → strategy.name` returns null for manual entries; UI renders "Manual" fallback.

**Test strategy** (~340 LOC across 3 test files, 20 unit tests + 3 E2E + 8 integration):
- arena.test.ts (~120 LOC, 10 tests): (1) loadArenaEntries returns entries with fromArena=true and preset mu/sigma, (2) loadArenaEntries with empty topic returns empty array, (3) syncToArena filters out fromArena entries from upsert payload, (4) syncToArena includes all match history (arena + new), (5) syncToArena updates elo for existing arena entries, (6) syncToArena calls RPC with correct JSONB structure, (7) syncToArena with empty pool is no-op, (8) swissPair produces info-maximizing pairs from rating map, (9) swissPair handles <2 entries gracefully, (10) isArenaEntry type guard correctly identifies arena vs non-arena variants
- arena-actions.test.ts (~120 LOC, 10 tests): (1) getArenaTopicsAction returns entry counts, (2) getArenaEntriesAction returns sorted by elo, (3) upsertArenaEntryAction validates content size, (4) deleteArenaEntryAction sets archived_at, (5) createArenaTopicAction validates name length, (6) runArenaComparisonAction updates elo + records match, (7) upsertArenaEntryAction rejects content exceeding 50KB (Zod validation), (8) runArenaBatchComparisonAction runs N rounds with Swiss pairing, (9) runArenaBatchComparisonAction rate limit rejects within 5-min window, (10) archiveArenaTopicAction sets archived_at without cascading to entries
- **E2E** (~60 LOC, 3 tests): Arena list page renders topics with entry counts; Arena detail page renders leaderboard tab with entries sorted by Elo; Arena batch comparison triggers and updates leaderboard; **NOTE**: existing V1 E2E file `admin-arena.spec.ts` tests V1 features (scatter chart, text diff, coverage grid, separate elo table) — must be fully rewritten for V2.1, not patched. **E2E rewrite logistics**: Delete V1's `admin-arena.spec.ts` and create new `admin-arena-v2.spec.ts` in the same directory. V1 E2E tests will fail once M10 replaces the admin pages (expected — they test V1 UI elements that no longer exist). No parallel operation needed; the rewrite is part of M10's atomic scope.
- **Integration** — file: `arena-integration.test.ts` in `evolution/src/lib/v2/__tests__/` (8 tests, requires DB + M9 migration applied, mock LLM via dependency-injected provider param): (1) create topic → add 3 entries → runArenaComparison → verify Elo updated + match history recorded, (2) anon key cannot call sync_to_arena RPC (REVOKE verified — requires M9 migration applied first), (3) finalize.ts fromArena filtering: run with arena-loaded entries → verify only non-fromArena variants persisted to evolution_variants (no duplicate rows), (4) full pipeline arena flow: loadArenaEntries → evolveArticle (mock LLM) → syncToArena → verify arena entries updated with new ratings and new variants added, (5) concurrent syncToArena: two runs finishing simultaneously for same topic — both succeed without data corruption (upsert idempotency), (6) loadArenaEntries excludes soft-deleted entries (archived_at IS NOT NULL) — only active entries returned, (7) runArenaComparisonAction rate limit rejects when >10/min (DB-backed advisory lock check), (8) runArenaBatchComparisonAction global rate limit rejects when 3 concurrent batches active

**Done when**:
- Arena tables populated via seed migration (M9)
- 8 server actions working (including batch comparison)
- loadArenaEntries + syncToArena integrated into runner.ts (wrapping evolveArticle calls)
- finalize.ts filters out `fromArena` variants before persisting (no duplicate rows)
- 2 admin pages render with config-driven components
- 20 unit tests + 3 E2E tests + 8 integration tests passing
- Existing V1 E2E file `admin-arena.spec.ts` fully rewritten for V2.1
- V1 `arenaIntegration.ts` replaced by V2 `arena.ts` (autoLinkPrompt, resolveTopicId eliminated)
- Dead arena actions (6) deleted after consuming pages replaced
- `tsc --noEmit` passes after deletions (verify zero stale imports)
- Grep verification: no remaining imports of deleted V1 actions outside deferred/ directory. Specific grep targets (must all return 0 results): `getPromptBankCoverageAction`, `getPromptBankMethodSummaryAction`, `getArenaLeaderboardAction`, `getCrossTopicSummaryAction`, V1 `deleteArenaEntryAction` (old hard-delete), V1 `deleteArenaTopicAction`
- Integration test verifies anon key CANNOT call sync_to_arena RPC (REVOKE verified)
- ArenaTextVariation type added to V2 types.ts and exported from V2 barrel (M1 addendum)
- evolveArticle options.initialPool parameter added (M3 addendum) — arena entries injected into pool at start

**Depends on**: Milestone 3 (evolveArticle exists), Milestone 4 (runner.ts exists for arena integration), Milestone 5 (admin UI + finalize.ts fromArena filter), Milestone 7 (config-driven UI components), Milestone 8 (pipeline.ts deleted — required before autoLinkPrompt deletion; BUT tournament.ts deletion must be deferred or swissPairing extracted first), Milestone 9 (arena tables in seed)

**Strategy integration**: Arena entries display strategy label (from linked run → strategy_config_id → strategy name). Arena leaderboard includes strategy column so users can see which strategy produced which entry. Manual entries (no run) render "Manual" fallback.

**Rollback plan**: M10 is deployed as a single atomic PR. If deployment fails: (1) revert the PR (git revert) — this restores V1 arena actions and admin pages; (2) M9 arena tables remain (inert without M10 code calling them — no harm); (3) V1 arenaIntegration.ts and pipeline.ts are already deleted by M8, so rollback only covers M10's own changes (V2 arena.ts, rewritten arenaActions.ts, admin pages). The critical invariant: M10 must not delete V1 arena code until V2 replacements are tested and working in the same PR.

**V1 code eliminated**: 14→8 server actions (~450 LOC). M10 fully rewrites `arenaActions.ts` (not patched from M6's adminAction refactor) — M6 migrated the wrappers but kept all actions; M10 deletes the 6 dead ones and rewrites the 8 kept ones to use V2's merged-elo schema. Delete the 6 deferred "dead" V1 arena actions from M6 (getPromptBankCoverageAction, getPromptBankMethodSummaryAction, getArenaLeaderboardAction, getCrossTopicSummaryAction, deleteArenaEntryAction, deleteArenaTopicAction) — safe to delete now because M10 replaces the consuming pages. Note: V2 `deleteArenaEntryAction` is a NEW implementation (soft-delete via archived_at), not the V1 action retained. Also: separate elo table + comparisons table, autoLinkPrompt + resolveTopicId (~200 LOC), 3 admin pages (~1,802 LOC) → 2 config-driven pages (~100 LOC)

---

### Milestone 11: V2.2 Experiments (Simplified Batches)
**Goal**: Build a lightweight experiment system — "a labeled batch of runs against the same prompt" with 1 table, 5 server actions, no cron driver, synchronous metrics.

**Context**:
- An experiment is just `{ name, prompt_id, status, runs[] }` — no L8 factorial design, no rounds, no bootstrap CIs, no LLM reports. Per-experiment budget enforcement intentionally dropped (V2 runs are <$1 each, budget enforced per-run by cost tracker). If budget caps are needed later, add `budget_cap_usd` column.
- V1 has 17 server actions — V2.2 needs 5
- V1 requires cron driver for state transitions — V2.2 auto-completes via application-level check in finalize.ts when last run finishes
- Metrics (maxElo, cost, eloPer$) computed synchronously on page load, not async via cron

**Experiments table schema** (created in M9 seed migration, consumed here):
```sql
CREATE TABLE evolution_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  prompt_id UUID NOT NULL REFERENCES evolution_arena_topics(id),  -- NOT evolution_prompts (V2 uses arena_topics as prompts)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS enabled with default-deny (consistent with M9 approach for all 9 evolution_* tables):
ALTER TABLE evolution_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "default deny" ON evolution_experiments FOR ALL USING (false) WITH CHECK (false);
-- USING(false) blocks reads + update/delete; WITH CHECK(false) blocks inserts + update new-row (consistent with M9 full default-deny).
-- All access via service_role key (bypasses RLS) through adminAction factory. No JWT-based policy needed.
```
- `evolution_runs.experiment_id UUID REFERENCES evolution_experiments(id)` — nullable FK added in M9 seed. Runs without experiments have `experiment_id = NULL`. This is the join key used by auto-completion and metrics queries.

**Security & validation** (all actions wrapped by M6 `adminAction` factory which enforces admin auth):
- `createExperimentAction`: validates name (1-200 chars, trimmed), promptId (UUID format + FK existence check via SELECT before INSERT). Name uniqueness not enforced (multiple experiments per prompt expected).
- `addRunToExperimentAction`: validates experimentId exists and status is 'pending' or 'running' (rejects if 'completed'/'cancelled'). **Prompt alignment**: validates that the run's prompt_id matches the experiment's prompt_id (prevents adding runs for unrelated prompts). Config validated by existing run config schema from M4 (`EvolutionConfig` type validation). **Run creation mechanism**: inserts a new `evolution_runs` row with `status: 'pending'`, `experiment_id` FK set, `prompt_id` matching the experiment's prompt, and config from the validated input. The run is then picked up by the existing claim-and-execute flow (M3's `claim_evolution_run` RPC + runner). This action does NOT call `evolveArticle` directly — it only creates the queued run row. On first run added, auto-transitions experiment from 'pending' to 'running' (single UPDATE with `WHERE status = 'pending'` guard for idempotency). **Partial failure handling**: if run INSERT succeeds but experiment status transition fails, the run is still valid (will be picked up by runner) — the experiment transition will be retried on next addRun call or can be manually corrected. If run INSERT fails, adminAction's try/catch returns error; experiment status is unchanged (no partial state).
- `cancelExperimentAction`: admin-only (no per-user ownership — all experiments are shared admin resources, consistent with runs/prompts/strategies). **Ordering**: first UPDATE experiment status to 'cancelled' with `updated_at = now()`, then bulk-UPDATE runs in `status IN ('pending', 'claimed', 'running')` to 'failed'. Order matters: setting experiment to 'cancelled' first prevents a concurrent finalize.ts from auto-completing the experiment (auto-completion guard checks `status = 'running'`). Both statements use service_role (bypasses RLS). **Transaction**: wrap both statements in a single Supabase RPC (`cancel_experiment(p_experiment_id UUID)`, defined in M9 seed migration as the 4th RPC alongside claim_evolution_run, sync_to_arena, update_strategy_aggregates). The RPC is SECURITY DEFINER with REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO service_role; SET search_path = public (consistent with M9's other RPCs). RPC body: UPDATE experiment to cancelled with updated_at, then UPDATE runs to failed -- both in PL/pgSQL function body for implicit transaction atomicity. If the bulk-UPDATE of runs fails, the entire RPC rolls back — the experiment is NOT left as 'cancelled' with still-active runs. **RPC error handling**: if the RPC call fails (network error, timeout, Postgres error), adminAction's try/catch returns `{ success: false, error: ErrorResponse }` to the client. No retry — admin can re-click cancel (the RPC is idempotent: cancelling an already-cancelled experiment is a no-op due to `WHERE status IN ('pending', 'running')` guard on the experiment UPDATE). **Race analysis**: (1) finalize marks run completed THEN cancel fires → cancel sets experiment 'cancelled', auto-completion WHERE status='running' is a no-op (already cancelled) — safe. (2) cancel fires THEN finalize completes last run → auto-completion WHERE status='running' skips (already 'cancelled') — safe.
- `getExperimentAction`: validates experimentId (UUID format). Returns experiment with joined runs + inline metrics from `computeExperimentMetrics`.
- `listExperimentsAction`: optional status filter validated against allowed enum. Returns experiments with run counts.
- No per-user ownership model — experiments are admin-scoped resources, same as all other evolution entities. All access gated by `requireAdmin` middleware + `adminAction` factory.

**Key simplification**: Eliminate the `analyzing` state. When last run completes → experiment auto-transitions to `completed` via application-level check in finalize.ts (idempotent, testable). No cron needed, no DB trigger.

**Files to create**:
- `evolution/src/services/experimentActionsV2.ts` (~120 LOC) — 5 server actions (replaces V1 experimentActions.ts actions). Each wrapped by M6 `adminAction` factory. Imports core functions from `experiments.ts`. Existing V1 `experimentActions.ts` actions are deleted in "Done when" section.
- `evolution/src/lib/v2/experiments.ts` (~100 LOC) — Core functions:
  - `createExperiment(name, promptId, supabase)` — Insert experiment row
  - `addRunToExperiment(experimentId, config, supabase)` — Create run with experiment_id FK, auto-transition pending→running on first run
  - `computeExperimentMetrics(experimentId, supabase)` — Synchronous: query completed runs for this experiment. **Definitive column sources** (single implementation path, no alternatives):
    - **Elo**: JOIN `evolution_variants` on `run_id` with `is_winner = true` to read `elo_score`. Query: `SELECT r.id, v.elo_score FROM evolution_runs r JOIN evolution_variants v ON v.run_id = r.id AND v.is_winner = true WHERE r.experiment_id = $1 AND r.status = 'completed'`. (NOT `evolution_runs.elo_rating` which does not exist — winner elo is persisted by M5 finalize.ts to `evolution_variants.elo_score` via `toEloScale()`.)
    - **Cost**: Read from `(evolution_runs.run_summary::jsonb ->> 'totalCost')::numeric` (use `->>` for text extraction then cast to numeric for arithmetic; the `run_summary` JSONB column contains `totalCost` as a top-level key, populated by M5 finalize.ts). Runs with null/missing totalCost are included with cost=0.
    - Computes per-run: `{ runId, elo, cost, eloPer$ (elo/cost, null if cost=0 or elo=null) }`. Aggregates: `{ maxElo: max(elo), totalCost: sum(cost), runs: [...] }`. Runs with null elo (no winner variant) are included with elo=null, excluded from maxElo. Division by zero guard: `eloPer$` is null when cost is 0. No bootstrap, no cron.

**Server actions** (5, down from 17):
- `createExperimentAction(name, promptId)` — Create experiment
- `addRunToExperimentAction(experimentId, config)` — Add run (auto-transitions pending→running)
- `getExperimentAction(experimentId)` — Detail with runs + inline metrics
- `listExperimentsAction(status?)` — List with filter
- `cancelExperimentAction(experimentId)` — Cancel + bulk-fail pending, claimed, and running runs

**Eliminated**: archiveExperiment, unarchiveExperiment, startManualExperiment, regenerateReport, getExperimentName, renameExperiment, getExperimentMetrics (separate), getStrategyMetrics, getRunMetrics (separate), getActionDistribution, deleteExperiment

**Admin pages** (2 pages, ~100 LOC config total using M7 components):
- Experiments list at `src/app/admin/evolution/experiments/page.tsx` (route: `/admin/evolution/experiments`) — RegistryPage config: name, prompt, status, run count, best Elo, cost, create button opens FormDialog (~40 LOC)
- Experiment detail at `src/app/admin/evolution/experiments/[experimentId]/page.tsx` (route: `/admin/evolution/experiments/:id`) — EntityDetailPageClient config: 2 tabs (Overview with MetricGrid, Runs with RelatedRunsTab). No Analysis card, no Report tab, no Action Distribution (~60 LOC)
- Start experiment becomes a FormDialog on list page (not a separate page): name, prompt dropdown, config, run count (~30 LOC FormDialog config). **Batch creation**: FormDialog onSubmit calls `createExperimentAction` once, then calls `addRunToExperimentAction` N times in a `for` loop (sequential, not parallel — avoids overwhelming the DB). If any addRun call fails, the experiment still exists with fewer runs than requested; error displayed to admin with count of successful/failed runs.

**Experiment auto-completion** (application-level, not DB trigger):
- **Integration point**: M5's finalize.ts implements the atomic NOT EXISTS auto-completion query directly (see M5 spec). M11 does NOT modify or replace finalize.ts auto-completion — it is already correct when M5 ships. M11's scope for auto-completion is: (1) verifying the integration tests pass with real Supabase, (2) ensuring the `updated_at` column is populated by the UPDATE query. No stub pattern needed.
- After finalize.ts persists run results and marks status='completed', it checks `run.experiment_id` (nullable FK on evolution_runs, added in M9). If set, executes the atomic auto-complete query:
- At end of `finalize.ts` (M5): if `run.experiment_id` is set, use a single atomic query to avoid TOCTOU race:
  ```sql
  UPDATE evolution_experiments SET status = 'completed', updated_at = now()
  WHERE id = $1 AND status = 'running'
    AND NOT EXISTS (
      SELECT 1 FROM evolution_runs
      WHERE experiment_id = $1
        AND status IN ('pending', 'claimed', 'running')
    )
  ```
  The single query is atomic — no gap between count and update. The `AND status = 'running'` guard makes it idempotent. Simpler than a DB trigger, easier to test, no heartbeat-induced spurious fires.

**Test strategy** (~200 LOC, 21 test cases across `experiments.test.ts` + `experimentActionsV2.test.ts`):
- **Unit tests — core functions** (10 in `experiments.test.ts`): createExperiment inserts row with correct fields; addRunToExperiment creates run with FK + transitions experiment pending→running; addRun rejects if experiment completed/cancelled; addRun rejects if run prompt_id differs from experiment prompt_id; computeMetrics returns correct maxElo/totalCost/eloPer$; computeMetrics handles zero runs (returns nulls); computeMetrics handles null/malformed run_summary (missing totalCost → cost=0); cancelExperiment sets cancelled + bulk-fails pending/claimed/running runs atomically (via RPC) and sets updated_at; cancel is no-op on already-completed; createExperiment rejects empty/overlength name.
- **Unit tests — server actions** (4 in `experimentActionsV2.test.ts`): listExperimentsAction returns filtered results by status and returns run counts (tests both with and without status filter); listExperimentsAction with invalid status filter returns error; getExperimentAction returns experiment with joined runs and computed metrics; getExperimentAction with nonexistent UUID returns error.
- **Integration tests** (4): full lifecycle (create → add 3 runs → complete each via finalize.ts persisting winner elo_score to evolution_variants + totalCost in run_summary JSONB → verify auto-complete fires → verify computeExperimentMetrics returns correct maxElo/totalCost/eloPer$); concurrent finalize calls idempotent (both attempt auto-complete, one succeeds, no error); cancel mid-experiment with mix of pending/running runs — verify experiment updated_at is set; add run to experiment then cancel — verify run status also updated. **Note**: integration test #1 (full lifecycle) must assert `updated_at > created_at` on the experiment row after auto-completion fires — verifies the `updated_at = now()` clause in the auto-completion SQL. **CI environment**: integration tests require a running Supabase instance — use `supabase start` in CI (already configured for M3/M5 integration tests).
- **E2E** (3): list page renders columns (name, status, run count, Elo); detail page renders Overview + Runs tabs; create experiment via FormDialog → verify appears in list.
- Auto-completion SQL tested against real Supabase (not mocked) to verify NOT EXISTS atomicity.

**Done when**:
- Experiments table populated via seed migration (M9)
- 5 server actions working
- Application-level auto-completion works (finalize.ts checks sibling runs, marks experiment completed)
- Metrics computed synchronously (maxElo, cost, eloPer$ per run)
- 2 admin pages render with config-driven components
- Integration test: create → add runs → complete → auto-complete → metrics passes
- Experiment cron driver deleted: route file (`/api/cron/experiment-driver`), test file, AND `vercel.json` cron entry removed. **Ownership note**: M8 lists `experiment-driver/route.test.ts` (602 LOC) for deletion but M8's critical sequencing rule says "tests MUST be co-deleted with their production code". M11 owns the route file deletion, so M11 co-deletes the test file. M8 should skip this file (mark as "deferred to M11")
- Dead experiment actions (3) deleted: `archiveExperimentAction`, `unarchiveExperimentAction`, `startManualExperimentAction` — safe because M11 replaces consuming pages
- `tsc --noEmit` passes after all deletions (verify zero stale imports)

**Depends on**: Milestone 3 (evolveArticle for creating runs), Milestone 4 (EvolutionConfig schema for run config validation in addRunToExperimentAction), Milestone 5 (finalize.ts auto-completion), Milestone 6 (adminAction factory for all 5 server actions), Milestone 7 (config-driven UI components), Milestone 9 (experiments table in seed)

**V1 code eliminated**: 17→5 server actions (~580 LOC), experiment cron driver (~332 LOC), ExperimentAnalysisCard (~266 LOC), ReportTab (~117 LOC), ExperimentForm wizard (~458→~80 LOC), bootstrap CI computation (~200 LOC), LLM report generation (~150 LOC)

## V2 File Structure (Final)

```
evolution/src/lib/v2/
├── types.ts              (120 LOC)  — Minimal types
├── generate.ts           (100 LOC)  — Generate variants helper
├── rank.ts               (400 LOC)  — Rank pool helper (triage + Swiss + convergence)
├── evolve.ts             (120 LOC)  — Evolve/mutate helper
├── evolve-article.ts     (200 LOC)  — THE main function
├── cost-tracker.ts       (90 LOC)   — Budget-aware cost tracker (reserve-before-spend)
├── invocations.ts        (50 LOC)   — Invocation row helpers
├── run-logger.ts         (60 LOC)   — Structured run logging (powers Logs tab)
├── runner.ts             (200 LOC)  — Claim/execute/persist + parallel support
├── seed-article.ts       (60 LOC)   — Seed article generation for prompt-based runs
├── finalize.ts           (100 LOC)  — V1-compatible result persistence
├── proximity.ts          (80 LOC)   — Diversity tracking (deferred — Appendix A)
├── reflect.ts            (120 LOC)  — Quality critique (deferred — Appendix A)
├── strategy.ts           (80 LOC)   — Strategy hash dedup + CRUD + presets
├── arena.ts              (150 LOC)  — Arena load/sync (V2.1)
├── experiments.ts        (100 LOC)  — Experiment CRUD + metrics (V2.2)
├── index.ts              (60 LOC)   — Barrel export
└── __tests__/
    ├── generate.test.ts
    ├── rank.test.ts
    ├── evolve.test.ts
    ├── evolve-article.test.ts  — Smoke test
    ├── runner.test.ts
    ├── seed-article.test.ts
    ├── finalize.test.ts
    ├── proximity.test.ts      — Deferred (Appendix A)
    ├── reflect.test.ts        — Deferred (Appendix A)
    ├── arena.test.ts          — V2.1
    └── experiments.test.ts    — V2.2
Total: ~1,750 LOC production + ~1,400 LOC tests
```

## V1 Modules Reused Directly (No Changes)

| Module | LOC | Why reusable |
|--------|-----|-------------|
| rating.ts | 78 | Pure OpenSkill wrapper, zero coupling |
| comparison.ts | 146 | Takes callLLM callback, cache optional |
| reversalComparison.ts | 40 | Generic 2-pass framework |
| comparisonCache.ts | 96 | Standalone LRU cache |
| formatValidator.ts | 89 | Pure string validation |
| formatRules.ts | 15 | String constant |
| textVariationFactory.ts | 26 | UUID factory, no deps |
| strategyConfig.ts | 80 | Hash dedup + label generation — **forked** into V2 strategy.ts (transitive V1 imports prevent direct reuse) |
| **Total reused** | **~570** | (strategyConfig forked, not imported directly) |

## What V2 Eliminates vs V1

**Intentional drops**: Winner application (`applyWinnerAction` — writing winner text back to `explanations.content`) is removed. V2 evolution produces winners in `evolution_variants` and syncs them to the arena leaderboard. Articles in the main app are not modified by evolution.

| V1 Concept | LOC | V2 Replacement |
|------------|-----|---------------|
| Winner application to explanations | ~100 | Dropped (winners live in arena, not written back to articles) |
| AgentBase class + 14 subclasses | 4,500 | Helper functions (~420 LOC) |
| PipelineStateImpl (18 fields) | 320 | Local variables in function scope |
| PipelineAction union + reducer | 160 | Direct mutations on local arrays/maps |
| PoolSupervisor + phase transitions | 213 | Flat for-loop |
| Pipeline orchestrator | 904 | evolve-article.ts (~200 LOC) |
| Checkpoint/resume/continuation | 350 | Eliminated (short runs, re-run on crash) |
| ExecutionContext | 100 | Function parameters |
| Agent invocation lifecycle | 200 | Simple createInvocation/updateInvocation |
| Services boilerplate (79 actions) | ~1,500 | adminAction factory (~500 LOC saved) |
| Dead server actions (10) | ~500 | Deleted in M10/M11 (when consuming UI pages replaced) |
| Admin page boilerplate (list/detail/dialog) | ~4,000 | Config-driven components (~1,500 LOC saved) |
| Duplicate badge implementations | ~180 | Unified StatusBadge |
| V1 test suite (eliminated abstractions) | ~14,350 | ~950 LOC V2 tests + ~720 reused |
| Mock boilerplate duplication | ~930 | ~150 shared factory |
| ~40 incremental DB migrations | ~2,530 | 1 seed file (~150 LOC) |
| 4 obsolete scripts + runner simplification | ~1,741 | Deleted + simplified |
| 6 deferred scripts | ~1,747 | Moved to deferred/ |
| V1 Arena (4 tables, 14 actions, 3 pages) | ~3,450 | 2 tables, 6 actions, 2 pages (~320 LOC) |
| V1 Experiments (17 actions, cron, 3+ pages) | ~2,900 | 1 table, 5 actions, 2 pages, no cron (~300 LOC) |
| V1 Strategy configs (9 actions, 2 pages) | ~1,700 | Simplified (keep table + hash dedup + presets, reduce to ~4 actions + 1 page) |
| **Total eliminated** | **~42,458** | **~1,560 pipeline + ~3,800 services + ~3,300 UI + ~5,500 tests + ~230 DB + ~800 scripts** |

## Migration Strategy

This is a **clean-slate rebuild**, not a coexistence migration. After M9 runs (`supabase db reset`), V1 schema is gone and V1 code cannot execute.

**Sequencing**:
1. Build V2 code (M1–M5) and tests alongside V1 code in `evolution/src/lib/v2/`
2. Verify V2 works end-to-end with mock LLM (smoke tests, integration tests)
3. Run M9: apply V2 migration (DROPs V1 tables + creates V2 schema), delete obsolete scripts. **This is the point of no return** — all historical data is dropped. V1 migration files stay in place (already applied in DB history).
4. Deploy V2 runner code (M4/M5). All new runs use V2.
5. Clean up V1 code at leisure (M6–M8). Proximity/Reflection (Appendix A) can be added post-launch.

**Rollback**: If V2 has critical bugs after M9, rollback is via git: revert to the pre-M9 commit, restore V1 migrations, `supabase db reset` with V1 schema. Historical data is already gone (accepted as clean-slate trade-off).

**`pipeline_version` column**: Retained on `evolution_runs` for future-proofing (e.g., V3), not for V1/V2 routing. Default is `'v2'`.

## Testing

### Test LOC Summary (verified actuals)
| Category | Current (actual) | V2 Target | Change |
|----------|-----------------|-----------|--------|
| V1 tests eliminated (agents, pipeline, state, subsystems) | 15,660 | 0 | -15,660 |
| V1 tests retained (rating, comparison, format, cache, etc.) | 1,590 | 1,590 | 0 |
| V2 new tests (helpers, smoke, runner, finalize) | 0 | 950 | +950 |
| Shared mock infrastructure | 930 duplication | 150 shared | -780 |
| Integration tests | 4,480 | 900 | -3,580 |
| Page tests (with M7) | 2,517 | 750 | -1,767 |
| Script tests | 2,464 | 600 | -1,864 |
| API route tests | 1,114 | 512 | -602 |
| Remaining (service tests, component tests, other) | ~14,245 | ~4,148 | ~-10,097 |
| **Total** | **~42,000** | **~9,600** | **~-32,400 (77%)** |

After M10/M11 (arena/experiment rewrites): **~5,500 LOC (87% total reduction)**

### Reusable V1 Tests (unchanged, verified clean — zero V1 abstraction imports)
- rating.test.ts (255), comparison.test.ts (215), comparisonCache.test.ts (186), formatValidator.test.ts (131), formatValidationRules.test.ts (224), reversalComparison.test.ts (103), textVariationFactory.test.ts (54), strategyConfig.test.ts (548), errorClassification.test.ts (98)

### New V2 Tests (per milestone)
- M1: V2 types compile; reused V1 module tests pass
- M2: Each helper function tested independently with mock LLM
- M3: End-to-end smoke test (seed → 3 iterations → winner); cost tracking; invocations
- M4: Full lifecycle test (claim → execute → persist → complete)
- M5: V2 run appears in admin UI
- M6: adminAction factory tests (~10 tests); verify all existing service tests pass with refactored wrappers (same signatures)
- M7: RegistryPage, EntityDetailPageClient, FormDialog, ConfirmDialog, StatusBadge unit tests; E2E for refactored pages
- M8: Delete 28+ V1 test files; write V2 tests; centralize mocks; consolidate integration tests

### Smoke Test
3-iteration mini pipeline with mock LLM + mock Supabase: seed article → generate 3 → rank → evolve → repeat 2 more iterations → verify pool grows, ratings converge, winner identified, costs tracked per phase, invocation rows created

## Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Historical data loss | Accepted | Intentional clean slate — no export needed |
| No checkpointing = lost work on crash | Low | Runs are <$1 and <10 min; just re-run |
| V2 critical bug after M9 | Medium | Git revert to pre-M9 commit + `supabase db reset` with V1 migrations |
| Feature gaps (debate, editing, tree search) | Medium | Phase in as helpers after core V2 stable |
| Admin UI incompatibility | Low | Same invocation/variant table schema; V1-compatible run_summary |

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Pipeline is now one function, not supervisor+agents
- `evolution/docs/evolution/data_model.md` - State is local variables, not PipelineStateImpl
- `evolution/docs/evolution/entity_diagram.md` - Same entities, simpler relationships
- `evolution/docs/evolution/reference.md` - Config is 3 fields, not 15+
- `evolution/docs/evolution/rating_and_comparison.md` - Reused as-is, doc unchanged
- `evolution/docs/evolution/README.md` - Needs V2 section
- `evolution/docs/evolution/arena.md` - Deferred to V2.1
- `evolution/docs/evolution/experimental_framework.md` - Deferred to V2.2
- `evolution/docs/evolution/curriculum.md` - V2 learning path (much simpler)
- `evolution/docs/evolution/visualization.md` - V2 runs use existing components

---

## Appendix A: Proximity + Reflection (Deferred)

**Status**: Deferred to post-V2 launch. The core pipeline (M1-M5) works without these — `diversityScore` defaults to 1.0, `feedback` defaults to null, creative exploration never fires. Add these as a quality improvement pass after V2 is stable.

**Why deferred**: Proximity is ~90 LOC of pure math (no LLM cost) and Reflect adds 1 LLM call per iteration. For short runs (3-5 iterations), the quality impact is likely marginal. Can be measured and added later.

**Depends on**: Milestone 3 (evolveArticle exists)

### Proximity: `computeDiversity(pool, topN?, ratings?): number`

**File**: `evolution/src/lib/v2/proximity.ts` (~90 LOC)

**Algorithm**: Build 64-dim embedding per variant using word-level trigrams (3-consecutive-word shingles, matching V1's `_embed()`): lowercase + strip non-alphanumeric → split words → hash each 3-word shingle via `Math.imul(31, hash)` into 64 buckets → L2-normalize. Compute pairwise cosine similarity among top-N variants. Return `1 - mean(pairwise similarities)`. Default topN=10. When `ratings` is provided, selects topN by highest mu; otherwise uses first topN from pool.

Returns single diversity score (0-1). Score appended to diversityHistory in evolveArticle.

**Edge cases**: pool.length < 2 → returns 1.0. pool.length < topN → uses all available variants. All identical texts → returns 0.0. Variant text shorter than 3 words → embedding is zero vector. Empty ratings map → returns 1.0.

Drops V1's semantic embedding blend (70/30) and LRU cache — keeps only the lexical path. The word-trigram hash projection logic duplicates V1's `ProximityAgent._embed()` (~20 LOC of pure math, acceptable duplication).

Pure function, no LLM calls, no async.

### Reflect: `critiqueTopVariants(pool, ratings, llm, config, logger?): Promise<CritiqueResult>`

**File**: `evolution/src/lib/v2/reflect.ts` (~130 LOC)

Critique top 3 variants (by mu) on 5 quality dimensions (clarity, engagement, precision, voice_fidelity, conciseness — copied from V1's `flowRubric.ts`, not imported).

**Types** (added to types.ts): `Critique = { variantId, scores: Record<string, number>, reasoning }`. `CritiqueResult = { critiques, weakestDimension, suggestions }`. `Feedback = { weakestDimension, suggestions }`.

**LLM output validation**: Parse JSON with try/catch. On failure → safe default: `{ critiques: [], weakestDimension: 'overall', suggestions: ['Continue improving overall quality'] }`.

**Feedback sanitization**: `weakestDimension` validated against known dimensions (falls back to 'overall'). `suggestions` truncated to 500 chars each, max 5, newlines collapsed, `#` characters stripped.

**Feedback loop**: weakestDimension + suggestions passed to NEXT iteration's generate/evolve as optional `feedback` parameter.

### evolve-article.ts Modifications

Loop body changes from `generate → rank → evolve` to `generate → rank → proximity → reflect → evolve`:
- After rank: `computeDiversity(pool, 10, ratings)` → append to diversityHistory, store as diversityScore
- After proximity: `critiqueTopVariants(...)` → extract feedback for next iteration
- Error handling: proximity errors propagate (pure function bugs). Reflect errors caught and logged (feedback=null, loop continues). BudgetExceededError always re-thrown.

### Test Strategy (24 tests)

- **proximity.test.ts** (9 tests): near-duplicate, diverse, identical, small pool, topN, ratings selection, short text, empty ratings
- **reflect.test.ts** (10 tests): valid response, malformed JSON, missing fields, bad dimension, long suggestions, too many suggestions, LLM error, BudgetExceededError, cost tracking, small pool
- **Integration** (5 tests): feedback flows across iterations, reflect failure graceful, diversityHistory, creative exploration trigger boundaries, dimension validation end-to-end
