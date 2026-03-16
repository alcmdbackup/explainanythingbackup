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
- 10 dead actions (deferred to M11/M12 when consuming UI pages are replaced)
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
| Server actions | 79 | ~65 (10 dead removed in M11/M12 when UI pages replaced) |
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
- `evolution/src/lib/v2/types.ts` (~160 LOC) — Minimal types: TextVariation (id, text, strategy, parentIds, iterationBorn, version, createdAt, fromArena?, costUsd?), Match, EvolutionConfig (iterations, variantsPerRound, budgetUsd, judgeModel, generationModel, calibrationOpponents, tournamentTopK), StrategyConfig (name, config JSONB, config_hash), EvolutionResult (winner, pool, ratings, matchHistory, totalCost, iterations, stopReason, muHistory, diversityHistory). **Rating**: Re-export from `rating.ts` (not redefined) — V2 uses V1's `Rating = { mu: number; sigma: number }` directly to avoid type duplication.

**Files to reuse from V1 (import directly, no changes)**:
- `evolution/src/lib/core/rating.ts` — createRating, updateRating, updateDraw, toEloScale (78 LOC)
- `evolution/src/lib/comparison.ts` — compareWithBiasMitigation, parseWinner (146 LOC)
- `evolution/src/lib/core/reversalComparison.ts` — run2PassReversal (40 LOC)
- `evolution/src/lib/core/comparisonCache.ts` — ComparisonCache (96 LOC). **Note**: ComparisonCache is a class with `get(textA, textB, structured, mode)` / `set()` API — it is NOT compatible with `compareWithBiasMitigation`'s `cache?: Map<string, ComparisonResult>` parameter. V2's `rank.ts` (M2) will manage its own `Map<string, ComparisonResult>` for comparison caching within `compareWithBiasMitigation` calls. ComparisonCache is re-exported from the V2 barrel as a convenience export for callers that want the class API for higher-level dedup (e.g., cross-run dedup in future tooling). V2 internals (rank.ts, evolveArticle) do NOT use ComparisonCache — they use a plain Map. If no caller ends up using it, the re-export can be removed at cleanup time without breaking anything.
- `evolution/src/lib/agents/formatValidator.ts` — validateFormat (89 LOC)
- `evolution/src/lib/agents/formatRules.ts` — FORMAT_RULES (8 LOC)
- `evolution/src/lib/core/formatValidationRules.ts` — Rule implementations: stripCodeBlocks, hasBulletPoints, hasNumberedLists, etc. (104 LOC, required dependency of formatValidator.ts)
- `evolution/src/lib/core/textVariationFactory.ts` — Fork into V2 (26 LOC). Original uses `import type { TextVariation } from '../types'` — a type-only import with zero runtime coupling (erased at compile). Fork is still justified for genuine V2 module independence (no reference to V1 types at all), not for runtime dependency reasons.
- `evolution/src/lib/core/strategyConfig.ts` (212 LOC source; forking ~73 LOC) — Fork `hashStrategyConfig()`, `labelStrategyConfig()`, and `shortenModel()` helper into V2's `strategy.ts`. Also redefine a minimal V2 `StrategyConfig` interface (without `AgentName`, `enabledAgents`, `singleArticle`, `agentModels`). The original has a runtime import of `EVOLUTION_DEFAULT_MODEL` from `llmClient.ts` (chains to openai/anthropic/supabase), requiring the fork. Functions NOT forked: `extractStrategyConfig`, `diffStrategyConfigs`, `normalizeEnabledAgents`, `defaultStrategyName` — these depend on AgentName and are V1-only.
  - **Hash cross-compatibility**: V1's `hashStrategyConfig()` conditionally includes `enabledAgents` and `singleArticle` in the hash. Since V2 StrategyConfig drops these fields, V2's forked hash will match V1 ONLY for configs where those fields were absent/default. The cross-compatibility test must test against configs with ONLY `generationModel`/`judgeModel`/`iterations` (no `enabledAgents`/`singleArticle`). Hash parity for configs that used V1-only fields is NOT a goal.
  - **labelStrategyConfig behavioral delta**: V2's fork will omit `agentModels`, `enabledAgents`, `singleArticle`, and `budgetCapUsd` label segments since those fields don't exist in V2 StrategyConfig. This is intentional — V2 labels are simpler. The test should verify V2 label format (not V1 parity).

**Test strategy**:
- Rerun V1 tests for all reused modules (rating.test.ts, comparison.test.ts, comparisonCache.test.ts, formatValidator.test.ts, formatValidationRules.test.ts, reversalComparison.test.ts, textVariationFactory.test.ts, strategyConfig.test.ts)
- V2 type compile tests (~30 LOC): verify V2 TextVariation is structurally assignable to contexts where V1 modules consume it; verify EvolutionConfig required/optional fields; verify EvolutionResult shape
- V2 forked textVariationFactory test (~20 LOC): primarily a compile-path verification (imports V2 types.ts not V1); verify createTextVariation produces valid V2 TextVariation (including createdAt field); verify id uniqueness
- V2 forked strategy.ts test (~30 LOC): verify hashStrategyConfig produces identical hashes to V1 for configs with ONLY generationModel/judgeModel/iterations (no enabledAgents/singleArticle — hash parity for V1-only fields is not a goal); verify labelStrategyConfig output format (V2 format, simpler than V1); verify shortenModel
- V2 barrel smoke test at `evolution/src/lib/v2/__tests__/barrel.test.ts` (~30 LOC): import each re-exported symbol from `@evolution/lib/v2/` and verify it's defined — must cover all symbols: compareWithBiasMitigation, parseWinner, aggregateWinners, updateRating, createRating, updateDraw, toEloScale, validateFormat, createTextVariation, hashStrategyConfig, labelStrategyConfig, run2PassReversal, ComparisonCache, FORMAT_RULES. Verify jest moduleNameMapper resolves `@evolution/*` correctly in test context.

**Import strategy**: V2 barrel (`evolution/src/lib/v2/index.ts`) re-exports all V1 reused modules. Consumers always import from `@evolution/lib/v2/` — never from V1 paths directly. This creates a single import surface. V1 barrel (`evolution/src/lib/index.ts`) remains untouched for any V1 code still running.

**Done when**: V2 types defined (including createdAt on TextVariation, Rating re-exported from rating.ts); all reused V1 module tests pass; V2 barrel re-exports all V1 modules (rating, comparison, reversalComparison, comparisonCache, formatValidator, formatRules, formatValidationRules); V2 can import and call compareWithBiasMitigation, updateRating, validateFormat, createTextVariation, hashStrategyConfig, run2PassReversal, ComparisonCache via `@evolution/lib/v2/`; forked strategy.ts hash output matches V1 for equivalent configs; V2 type tests, fork tests, and barrel smoke test all pass

**Depends on**: None

---

### Milestone 2: Helper Functions (Generate, Rank, Evolve)
**Goal**: Implement the three core helper functions as standalone, independently testable async functions.

**Files to create**:
- `evolution/src/lib/v2/generate.ts` (~100 LOC) — `generateVariants(text, iteration, llm, config, feedback?): Promise<TextVariation[]>`
  - `iteration: number` — passed to `createTextVariation` for `iterationBorn`
  - `feedback?: { weakestDimension: string; suggestions: string[] }` — optional guidance from M6 reflect, injected into prompts. Null when reflect is disabled.
  - 3 strategies in parallel (structural_transform, lexical_simplify, grounding_enhance)
  - Calls validateFormat, createTextVariation
  - Prompt templates adapted from V1 generationAgent.ts (feedback sections removed/made optional since V2 uses M6 feedback parameter instead of V1 metaFeedback)

- `evolution/src/lib/v2/rank.ts` (~550 LOC — may reach 600; triage + Swiss + convergence + draw handling is denser than the other helpers) — `rankPool(pool, ratings, matchCounts, newEntrantIds, llm, config, budgetFraction?, cache?): Promise<{matches, ratingUpdates, matchCountIncrements}>`
  - `budgetFraction?: number` — proportion of budget spent so far (0.0 = nothing spent, 1.0 = fully spent). Computed by caller (evolveArticle) as `1 - (costTracker.getAvailableBudget() / config.budgetUsd)` (matching V1 rankingAgent.ts:400-403 formula). Defaults to 0 (low pressure) when omitted. Used by budget pressure tiers.
  - **New entrant identification**: `newEntrantIds: string[]` parameter (passed by evolveArticle — variants added this iteration). Variants in `newEntrantIds` with sigma >= 5.0 go through triage. Already-triaged variants skip to fine-ranking.
  - **Edge cases**: pool.length < 2 → return empty matches, no rating updates. All new entrants with no existing variants (first iteration) → skip triage stratification, run fine-ranking only among the new entrants.
  - **Stratified opponent selection** (~45 LOC, inlined — not PoolManager): For n=5 opponents: 2 from top quartile by mu, 2 from middle, 1 from bottom. Preferentially uses fellow new entrants for the bottom slot (falls back to bottom quartile if no other new entrants). Edge cases from V1's pool.ts: fewer existing than n-1 → use all available + pad with fellow new entrants; no ratings yet → random selection; n < 5 → proportionally reduce per-tier counts (minimum 1 top, 1 middle); n < 3 → return all available.
  - **Triage phase**: New entrants matched against stratified opponents sequentially (for-loop, not parallel — enables per-match sequential elimination like V1 rankingAgent.ts). Adaptive early exit: skip remaining opponents when `decisiveCount >= minOpponents AND avgConfidence >= 0.8` (matching V1 rankingAgent.ts:292 count-based semantic, NOT the older CalibrationRanker's `every()` pattern). `decisiveCount` = number of matches with confidence >= 0.7. Sequential elimination: variants where `mu + 2*sigma < top20%Cutoff` are dropped from fine-ranking.
  - **Fine-ranking phase**: Swiss pairing scored by `outcomeUncertainty * sigmaWeight` — maximize information gain per comparison. `outcomeUncertainty = 1 - |2*pWin - 1|` using logistic approximation with `BETA = DEFAULT_SIGMA * Math.SQRT2` (from V1 rankingAgent.ts:82-87, NOT OpenSkill's internal CDF). Greedy pair selection, skipping already-played pairs. **Eligibility filter** for Swiss pairing: `mu >= 3*sigma OR in topKIds` (distinct from triage elimination filter).
  - **Draw handling**: In fine-ranking: confidence < 0.3 → treated as draw → `updateDraw()` instead of `updateRating()`. In triage: confidence === 0 OR winnerId === loserId → treated as draw (matching V1 rankingAgent.ts:194 which checks both conditions).
  - **Convergence detection**: Stops when all eligible variant sigmas < `RATING_CONSTANTS.CONVERGENCE_SIGMA_THRESHOLD` (3.0, from V1 config.ts:90 — use this constant, not `DEFAULT_CONVERGENCE_SIGMA` from rating.ts) for 2 consecutive rounds, or no new pairs remain. "Eligible" = variants where mu >= 3*sigma OR in tournamentTopK.
  - **Budget pressure tiers**: Low (<50% spent) → up to 40 comparisons. Medium ([50%, 80%)) → up to 25. High (>=80%) → up to 15. Boundaries match V1: < 0.5 low, [0.5, 0.8) medium, >= 0.8 high.
  - **Comparison callback**: rank.ts wraps the LLM call in try/catch: `async (prompt) => { try { return await llm.complete(prompt, 'ranking', { model: config.judgeModel }); } catch (error) { if (error instanceof BudgetExceededError) throw error; return ''; } }`. BudgetExceededError is re-thrown to propagate to evolveArticle's loop (matching V1's calibrationRanker.ts:73 pattern). Other LLM errors (after retry exhaustion) return empty string → parseWinner returns null → `aggregateWinners` with one null produces a low-confidence (0.3) partial result for the non-null side (NOT a clean TIE); if BOTH passes return null → confidence=0.0 → treated as draw. run2PassReversal explicitly does NOT catch errors, so the callback MUST handle them.
  - **Cache**: Optional `cache?: Map<string, ComparisonResult>` parameter passed directly to `compareWithBiasMitigation`'s cache parameter. This is a simple Map, NOT the ComparisonCache class (see M1 note). The caller (evolveArticle in M3) creates and maintains this Map across iterations. ComparisonCache (class) is NOT used by rank.ts.
  - **V1 features intentionally dropped**: Multi-turn debate tiebreaker, flow comparison (flowCritique agent). These are V1-only features not carried to V2.
  - **ratingUpdates format**: Returns ALL ratings (full snapshot, not diffs) — matches V1 rankingAgent.ts:641-643 pattern. Simpler for callers than diff-based approach.
  - **matches includes both phases**: Returns ALL matches (triage + fine-ranking combined) in the matches array. Callers (evolveArticle) append all to matchHistory.
  - Returns: `{ matches: Match[], ratingUpdates: Record<id, Rating>, matchCountIncrements: Record<id, number> }`

- `evolution/src/lib/v2/evolve.ts` (~120 LOC) — `evolveVariants(pool, ratings, iteration, llm, config, options?): Promise<TextVariation[]>`
  - `iteration: number` — passed to `createTextVariation` for `iterationBorn`
  - `options?: { feedback?: { weakestDimension: string; suggestions: string[] }; diversityScore?: number }` — optional guidance from M6 reflect + diversity from M6 proximity. Both default to safe values when omitted.
  - Select top-rated parents
  - Mutate (clarity, structure) + crossover
  - Optional creative exploration trigger (fires when `options.diversityScore > 0 && options.diversityScore < 0.5` — the `> 0` guard prevents trigger when diversityScore is 0/default. Defaults to 1.0 when omitted, so never fires until M6 proximity is implemented and caller passes the score)
  - Calls validateFormat, createTextVariation
  - **V1 features intentionally dropped**: Outline mutation, metaFeedback integration (replaced by M6 reflect feedback parameter), random creative exploration chance (V1's CREATIVE_RANDOM_CHANCE = 0.3 unconditional trigger is dropped — V2 creative exploration is deterministically tied to diversityScore only)

**Files to reuse from V1**: Prompt templates, Swiss pairing logic, opponent selection

**Mock LLM strategy**: Create `evolution/src/lib/v2/__tests__/helpers/mockLlm.ts` (~40 LOC) — factory returning a mock `EvolutionLLMClient` with `complete: jest.fn()` that returns canned responses by phase label ('generation' → variant text, 'evolution' → mutated text) and by call-position for ranking ('ranking' label used by both triage and fine-ranking phases — label-only dispatch cannot distinguish them, so the mock must support position-based response sequences: e.g., `mockLlm.setRankingResponses(['A', 'B', 'TIE', ...])` consumed in order). Configurable response sequences for deterministic tests. Adapted from V1's `createMockEvolutionLLMClient` but simplified (no ExecutionContext, callback-based).

**Test strategy**:
- generate.test.ts (~150 LOC, 6 tests): Test 3 strategies produce 3 variants with correct iterationBorn. Test format validation failure → variant discarded (returns fewer variants, does NOT retry). Test all 3 fail format → returns empty array. Test BudgetExceededError propagation (mock LLM throws → error propagates to caller, not swallowed). Test feedback parameter injects into prompts. Test parallel execution (all 3 LLM calls made).
- rank.test.ts (~400 LOC, 26 tests): Dedicated tests for each algorithm path: (1) triage with stratified opponents — verify correct tier distribution, (2) adaptive early exit when decisiveCount >= minOpp AND avgConfidence >= 0.8, (3) early exit does NOT fire when decisiveCount < minOpp even if avg >= 0.8, (4) sequential elimination when mu+2σ < cutoff, (5) Swiss pairing scored by outcomeUncertainty × sigma (using BETA = DEFAULT_SIGMA * SQRT2), (6) draw handling in fine-ranking (confidence < 0.3), (7) draw handling in triage (confidence === 0 OR winnerId === loserId), (8) convergence detection (2 consecutive rounds with eligible variant filtering: mu >= 3σ OR topK), (9-14) budget pressure tiers as 6 separate tests (budgetFraction: 0.0, 0.49, 0.5, 0.79, 0.8, 1.0 — verify correct tier and max comparisons). **Edge case tests**: (15) pool.length < 2 → empty result, (16) first iteration all-new-entrants → fine-ranking only, (17) matchCountIncrements correctness, (18) stratified with fewer existing than n, (19) mu direction verification, (20) LLM error → '' → low-confidence partial result (NOT clean TIE) with match recorded, (21) both LLM passes fail → confidence 0.0 → draw, (22) cache hit skips LLM call, (23) all-draws pool convergence behavior, (24) ratingUpdates returns full snapshot (all ratings, not diffs), (25) matches includes both triage + fine-ranking, (26) BudgetExceededError propagation from callback.
- evolve.test.ts (~160 LOC, 8 tests): Test parent selection from top-rated. Test crossover with 2 parents. Test format validation failure → variant discarded. Test creative exploration trigger (stubbed diversityScore = 0.3 < 0.5). Test creative exploration does NOT fire when diversityScore = 0 (> 0 guard). Test feedback parameter injects into mutation prompts. Test iterationBorn set correctly. Test BudgetExceededError propagation from LLM calls.
- Composition test (~50 LOC): generate output → rank → verify: ratings updated (mu direction correct), matchCountIncrements non-zero, matches array valid. Also test: generate returns empty → rank with empty newEntrants returns empty matches.

**Done when**: Each function works standalone with mocked LLM; unit tests pass (including format validation failure paths); rank.ts has 26 tests covering all algorithm paths (triage, Swiss, convergence, draw, budget tiers); functions compose correctly (generate output feeds into rank); `tournamentTopK` field present in V2 EvolutionConfig (M1 types.ts, default 5)

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
  // EvolutionResult = { winner, pool, ratings, matchHistory, totalCost, iterations, stopReason, muHistory, diversityHistory }
  ```
  - **Baseline insertion**: First variant in pool is the original text with `strategy: 'baseline'`. Allows tracking "did evolution beat the original?" via baselineRank in run_summary.
  - **Winner determination**: After final iteration, winner = variant with highest mu in ratings. Ties broken by lowest sigma (most certain). If pool has only the baseline variant (all generated variants failed format validation), winner is the baseline. Winner field in EvolutionResult is the TextVariation object.
  - Local state: `pool` array, `ratings` Map, `matchCounts` Map (tracks matches played per variant — passed to rankPool and updated from matchCountIncrements), `matchHistory` array, `muHistory` array (top mu appended each iteration), `diversityHistory` array (if proximity enabled), `comparisonCache: Map<string, ComparisonResult>` (simple Map for deduping LLM calls across iterations — passed to rankPool's cache parameter), `costTracker` (created internally from config.budgetUsd)
  - Loop body: generate → rank → evolve (calling M2 helpers). After rank phase, append top mu to muHistory. Pass `newEntrantIds` (variants added this iteration) to rankPool. Pass `costTracker.getTotalSpent() / config.budgetUsd` as budgetFraction to rankPool. Merge `matchCountIncrements` into `matchCounts` after each rank call.
  - Comparison cache: `Map<string, ComparisonResult>` created once at start, passed to rank on each iteration. This is a simple Map (NOT the ComparisonCache class from V1) — compatible with `compareWithBiasMitigation`'s cache parameter.
  - Per-phase invocation logging: Before each phase call, snapshot `costTracker.getTotalSpent()`. After phase completes, compute delta = `costTracker.getTotalSpent() - snapshot`. Pass delta as `cost_usd` to `updateInvocation()`. This gives per-invocation cost, not cumulative.
  - Budget check: reserve-before-spend pattern throws BudgetExceededError (caught by loop, sets stopReason='budget_exceeded'). Partial results from completed iterations are preserved in the returned EvolutionResult.
  - **Parallel generate budget handling**: generate.ts calls 3 LLM calls via Promise.allSettled (NOT Promise.all). Since allSettled never throws, generate.ts must explicitly scan results: `const budgetErr = results.find(r => r.status === 'rejected' && r.reason instanceof BudgetExceededError)`. Fulfilled results are kept as partial variants, other rejected results are discarded. If budgetErr exists, re-throw it after collecting fulfilled variants: `if (budgetErr) throw budgetErr.reason`. Same pattern for evolve phase.
  - Kill detection: check run status from DB (`SELECT status FROM evolution_runs WHERE id = $runId`) at iteration boundary (top of each loop iteration). If status is 'failed' or 'cancelled', set stopReason='killed' and exit loop (V1 pipeline.ts only checks 'failed'; V2 adds 'cancelled' for admin-initiated cancellation). Status check DB errors are swallowed (logged via logger.warn, do not crash the loop). Accepted latency: if killed mid-ranking (up to 40 comparisons), the current iteration completes before exit. Worst case: ~$0.20 of wasted LLM calls. Mid-phase kill checks not implemented (same as V1).
  - **LLM client wiring**: `evolveArticle` receives a raw LLM provider (simple `{ complete(prompt, label, opts): Promise<string> }` interface). Internally, it creates the costTracker from `config.budgetUsd`, then wraps the raw LLM provider with the V2 EvolutionLLMClient wrapper (which adds cost tracking + retry). The wrapped client is what gets passed to M2 helpers. This way the caller (runner) doesn't need to know about cost tracking.
  - **Transient error retry**: Integrated into the V2 EvolutionLLMClient wrapper (`evolution/src/lib/v2/llm-client.ts`, ~80 LOC — NOT reusing V1's createEvolutionLLMClient which has V1 type deps). Wraps the raw LLM provider with: retry on transient errors (exponential backoff 1s/2s/4s, max 3 retries), cost tracking integration, and BudgetExceededError is NOT retried. Uses `isTransientError()` from V1's `errorClassification.ts` (43 LOC, zero V1 coupling, reuse directly). Non-transient errors propagate immediately.
  - **Cost estimation**: Before each LLM call, the wrapper estimates cost via `estimatedCost = (prompt.length / 4) * inputPricePerToken + outputEstimateTokens * outputPricePerToken`. Model pricing from a simple config object (not V1's getModelPricing). `outputEstimateTokens` defaults to 1000 for generation/evolution, 100 for ranking (comparison responses are short). This matches V1's estimateTokenCost approach but simplified. **Known trade-off**: fixed output token estimates may cause premature BudgetExceededError near the budget ceiling if actual outputs are shorter (over-reserves) or under-reserves if outputs are longer. The 1.3x margin partially compensates, but runs with budgets set close to actual cost may stop one iteration early. Document this in the runner's error message when stopReason='budget_exceeded'.
  - **Cost flow per LLM call**: `const margined = estimatedCost * 1.3; reserve(phase, estimatedCost)` [which reserves `margined`] → LLM call → on success: `recordSpend(phase, actualCost, margined)` → on error: `release(phase, margined)`. The wrapper stores `margined` in local scope, so reserve/recordSpend/release always use the same margined amount. Model pricing: simple inline config `{ inputPer1MTokens, outputPer1MTokens }` per model, defined in `llm-client.ts` (not imported from V1's getModelPricing).

- `evolution/src/lib/v2/cost-tracker.ts` (~100 LOC) — Budget-aware cost tracker with reserve-before-spend. This is a NEW simplified implementation (not reusing V1's CostTrackerImpl which has V1 type deps). **Interface delta from V1**: V1's CostTrackerImpl uses `addCost(phase, amount)` (spend-only, no reserve/release pattern). V2's cost-tracker uses `reserve/recordSpend/release` for parallel-safe pre-flight budget checks. These are intentionally incompatible — do not attempt to substitute one for the other.
  - `reserve(phase, estimatedCost): number` — Synchronous (MUST have zero awaits internally — this is critical for parallel safety). Computes `margined = estimatedCost * 1.3`. Checks `totalSpent + totalReserved + margined > budgetUsd` → throws `BudgetExceededError` (defined in V2 types.ts — prefer importing from V1 to avoid instanceof failures across module boundary, or ensure V2 re-exports V1's class). Increments `totalReserved += margined`. Returns `margined` — the LLM wrapper stores it in local scope and passes to recordSpend/release.
  - `recordSpend(phase, actualCost, reservedAmount): void` — Deducts `reservedAmount` from `totalReserved`, adds `actualCost` to `totalSpent`. Tracks per-phase costs. The caller (LLM client wrapper) passes both actual and reserved amounts since it has both in scope.
  - `release(phase, reservedAmount): void` — On LLM failure: deducts `reservedAmount` from `totalReserved` without spending. The caller passes the same estimate used in reserve() (available in the same function scope).
  - `getTotalSpent(): number`, `getPhaseCosts(): Record<string, number>`, `getAvailableBudget(): number`
  - Budget flow (managed by V2 EvolutionLLMClient wrapper, NOT by evolveArticle/helpers): `reserve(est)` → LLM call → `recordSpend(actual)`. On error → `release(est)`.
  - Parallel safety: reserve() is synchronous (zero awaits). 3 concurrent generate calls each reserve() synchronously before any await — all 3 reserves succeed or the last throws BudgetExceededError. Node.js single-thread guarantees atomic check+increment within one event loop tick.

- `evolution/src/lib/v2/invocations.ts` (~50 LOC) — Invocation row helpers
  - `createInvocation(db, runId, iteration, phaseName, executionOrder)` → UUID. Inserts row with `success: false`, `skipped: false` defaults (updated on completion).
  - `updateInvocation(db, id, { cost_usd, success, execution_detail })` — Sets success=true on completion. `execution_detail` JSONB stores variantsAdded, matchesPlayed, and phase-specific data.
  - Both take `db: SupabaseClient` as first parameter. Errors are swallowed (logged via console.warn, do not crash the pipeline).

- `evolution/src/lib/v2/run-logger.ts` (~60 LOC) — Structured run logging
  - `createRunLogger(runId, supabase)` → logger with `info/warn/error/debug` methods
  - Each log entry written to `evolution_run_logs` table: `{ run_id, level, message, context JSONB, created_at }`
  - Fire-and-forget inserts (non-blocking, errors swallowed). **Known limitation**: no `flush()` method means in-flight inserts may be lost if the process exits immediately after the last log call. Mitigation: runner.ts awaits `finalizeRun()` before process exit, and any log calls after that are best-effort. If last-log loss becomes an issue, add an explicit `await Promise.allSettled(pendingInserts)` in runner.ts finally block.
  - Powers the Logs tab in admin UI

**Test strategy**:
- **Supabase mock**: Create inline chainable mock (same pattern as V1 service tests — each test file defines its own mock supporting: `from().insert().select().single()` for invocations, `from().select().eq().single()` for kill detection status checks, `from().insert()` for run_logs). NOT a shared utility — each test file defines what it needs.
- **evolve-article.test.ts** (~320 LOC, 13 tests):
  - (1) Minimal 1-iteration test: verify generate→rank→evolve call sequence and baseline variant is first in pool with strategy='baseline'
  - (2) 3-iteration smoke test: verify pool grows, ratings converge (top mu increases), muHistory has 3 entries
  - (3) Budget exhaustion: mock LLM throws BudgetExceededError on iteration 2 → stopReason='budget_exceeded', partial results from iteration 1 preserved
  - (4) Kill detection: mock DB returns status='failed' → stopReason='killed', loop exits
  - (5) Kill detection with status='cancelled' → stopReason='killed', loop exits
  - (6) Kill detection DB error: mock DB throws → error swallowed, run continues
  - (7) Winner is highest-mu variant from final ratings
  - (8) matchCounts correctly accumulated across iterations
  - (9) comparisonCache reused across iterations (verify LLM mock called fewer times in iteration 2 than without caching — tests actual dedup, not just Map growth)
  - (10) Invocation rows created for each phase (verify mock DB insert called with correct table/columns; verify createInvocation returning null UUID does not crash updateInvocation)
  - (11) Per-phase cost delta: verify invocation cost_usd is delta (not cumulative) — e.g., generation=$0.05, rank=$0.03 → invocation rows get $0.05 and $0.03 respectively
  - (12) Parallel generate with BudgetExceededError: mock 1 of 3 generate calls to throw → fulfilled results kept as partial variants, BudgetExceededError re-thrown
  - (13) getPhaseCosts returns correct per-phase breakdown after run
- **cost-tracker.test.ts** (~100 LOC, 12 tests): reserve succeeds under budget; reserve throws BudgetExceededError when over (with 1.3x margin); recordSpend deducts from reserved and adds to spent; release deducts from reserved without spending; getTotalSpent returns correct sum; getPhaseCosts tracks per-phase; getAvailableBudget computed correctly; parallel 3 reserves all succeed when budget allows; parallel 3 reserves where 3rd exceeds budget; release with wrong amount (edge case); zero-budget config throws on first reserve; reserve after full spend
- **invocations.test.ts** (~40 LOC, 5 tests): createInvocation inserts correct row and returns UUID; updateInvocation sets success=true and cost_usd; createInvocation DB error swallowed; updateInvocation DB error swallowed; execution_detail JSONB contains variantsAdded/matchesPlayed
- **run-logger.test.ts** (~40 LOC, 4 tests): info/warn/error write correct level to DB; DB error swallowed (does not propagate); context JSONB passed through; createRunLogger returns logger with all 4 methods
- **llm-client.test.ts** (NEW file at `evolution/src/lib/v2/__tests__/llm-client.test.ts`, ~80 LOC, 8 tests): successful call records spend; transient error retried with backoff (use `jest.useFakeTimers()` + `jest.advanceTimersByTime()` to verify 1s/2s/4s delays without real waiting); non-transient error propagates immediately; BudgetExceededError NOT retried; max 3 retries then propagate; reserve called before any await (verify synchronous call order); release called on failure; cost estimation formula produces reasonable values (prompt.length/4 * inputPrice + outputEstimate * outputPrice)

**Done when**: `evolveArticle()` completes a 3-iteration run with mocked LLM; winner correctly identified as highest-mu variant; invocation rows written correctly; cost tracking accurate per phase (via getTotalSpent and getPhaseCosts); budget exhaustion stops with stopReason='budget_exceeded' preserving partial results; kill detection works for both 'failed' and 'cancelled' status; all 40 tests pass (13 evolve-article + 12 cost-tracker + 5 invocations + 4 run-logger + 8 llm-client = 42)

**Depends on**: Milestone 2

---

### Milestone 4: Runner Integration
**Goal**: Wire `evolveArticle()` into the run execution lifecycle (claim, execute, persist results), with seed article generation for prompt-based runs and parallel execution support.

**Files to create**:
- `evolution/src/lib/v2/runner.ts` (~200 LOC) — Core run execution module:
  - `executeV2Run(runId, supabase, llmProvider)` — Resolve content → resolve config → call evolveArticle → persist minimal results → mark completed
  - `llmProvider`: Raw LLM provider `{ complete(prompt, label, opts?): Promise<string> }` — same interface M3's evolveArticle expects. evolveArticle wraps it internally with cost tracking.
  - **Config resolution**: Claimed run has `config JSONB` with raw fields (generationModel, judgeModel, maxIterations, budgetCapUsd, etc.). Runner maps this to V2 `EvolutionConfig`: `{ iterations: config.maxIterations, variantsPerRound: 3, budgetUsd: config.budgetCapUsd, judgeModel: config.judgeModel, generationModel: config.generationModel, calibrationOpponents: 5, tournamentTopK: 10 }`. Missing fields use V2 defaults. No complex resolveConfig — V2 config is flat. **Intentional**: V1 nested config fields (calibration, tournament, expansion sub-objects) are silently discarded — V2 inlines these as constants. This is by design; no warning is emitted.
  - Content resolution (2 paths):
    - If `explanation_id` set → fetch article text from `explanations` table
    - If `prompt_id` set (no explanation) → call `generateSeedArticle()` to create title + article from prompt (2 LLM calls via raw llmProvider — seed generation is pre-pipeline, untracked by cost tracker, matching V1 behavior)
    - If both null → markRunFailed('No content source: both explanation_id and prompt_id are null')
  - **Concurrent-run guard**: Before claiming, check active run count. This is a **soft limit** (TOCTOU race exists between count check and claim RPC — same as V1). With `--parallel N`, limit can be exceeded by up to N-1. Acceptable because: runs are cheap (<$1), the limit exists to prevent API rate limiting not budget control, and FOR UPDATE SKIP LOCKED prevents double-claiming the same run. **Guard duplication**: M5's `evolutionRunnerCore.ts` also contains a concurrent-run guard (for the HTTP-triggered path). These are not redundant — M4's guard is in the CLI batch runner path; M5's guard is in the web-triggered path. Each path enforces the limit independently.
  - Heartbeat (30s interval via setInterval, cleared in finally block; `clearInterval(undefined)` is a no-op in Node.js so null-guarding is implicit). Heartbeat DB error is non-fatal (try/catch with logger.warn inside the interval callback).
  - Error handling → markRunFailed with `error.message.slice(0, 2000)` (matching V1's actual truncation length in evolution-runner.ts, NOT 500). Status guard: `UPDATE ... WHERE id = $1 AND status IN ('pending', 'claimed', 'running')` — idempotent, no-op if already completed/failed.
  - **Strategy linking**: At run start, resolve or create `strategy_config_id` via V2's `hashStrategyConfig()` from `strategy.ts` (M1 fork). Strategy upsert: `INSERT INTO evolution_strategy_configs (name, config, config_hash) VALUES (...) ON CONFLICT (config_hash) DO UPDATE SET name = EXCLUDED.name RETURNING id` — simple upsert, not V1's strategyResolution.ts service. At finalization, call `update_strategy_aggregates` RPC. **Schema dependency**: The M10 seed migration's `evolution_strategy_configs` table must contain ONLY these columns (name, config, config_hash, id, created_at) — no V1 extras like `label`, `is_predefined`, `pipeline_type`, `status`, `created_by`. The runner's upsert will fail with "column does not exist" if M10 includes those V1 columns. Verify M10 schema against this upsert before deploying.
  - **Result persistence (minimal, before M5)**: After evolveArticle returns EvolutionResult, persist winner variant to `evolution_variants` with `is_winner: true`. Mark run as `status: 'completed'` with `run_summary: { version: 3, totalIterations, stopReason, totalCost }`. M5's finalize.ts will replace this with full V1-compatible persistence (all pool variants, detailed run_summary, experiment auto-completion). This avoids circular dependency with M5.
  - No checkpointing, no resume logic

- `evolution/scripts/evolution-runner-v2.ts` (~100 LOC) — CLI batch entry point (separate from module):
  - Arg parsing: `--parallel N`, `--max-runs N`, `--max-concurrent-llm N`
  - Batch loop: claim N runs sequentially (FOR UPDATE SKIP LOCKED prevents double-claiming), execute via Promise.allSettled
  - Graceful shutdown: SIGTERM/SIGINT sets `shuttingDown` flag → stops claiming, waits for in-flight runs
  - **LLM rate limiting**: Shared `LLMSemaphore` caps concurrent LLM API calls across all parallel runs (default 20, configurable via `EVOLUTION_MAX_CONCURRENT_LLM`). The CLI script creates a new `wrapWithSemaphore(rawProvider, semaphore)` utility (~20 LOC, NEW — does not exist in V1) that wraps the raw LLM provider's `complete()` method with semaphore acquire/release BEFORE passing to executeV2Run. Layering: rawProvider → semaphore wrapper → [inside evolveArticle] cost-tracking + retry wrapper → M2 helpers. Reuse V1's `src/lib/services/llmSemaphore.ts` (~91 LOC) for the LLMSemaphore class (exports: LLMSemaphore, getLLMSemaphore, initLLMSemaphore, resetLLMSemaphore). V1's semaphore is used internally by the LLM client (different pattern); V2 uses it as an external wrapper — this is architecturally different but reuses the same semaphore primitive.

- `evolution/src/lib/v2/seed-article.ts` (~60 LOC) — Seed article generation for prompt-based runs
  - `generateSeedArticle(prompt, llm): Promise<{ title: string; content: string }>`
  - `llm`: Raw LLM provider `{ complete(prompt, label, opts?): Promise<string> }` — NOT V1's EvolutionLLMClient (which has V1 type deps). V2's seed-article.ts is a new implementation that reuses V1's prompt template strings but adapts the function signature for V2's raw provider interface. Cannot directly call V1's `generateSeedArticle()` (requires EvolutionLLMClient).
  - 2 LLM calls: title generation → article generation
  - Prompt templates adapted from V1 `evolution/src/lib/core/seedArticle.ts` (67 LOC)

- `evolution/src/lib/v2/index.ts` (~60 LOC) — Barrel export:
  - `evolveArticle`, `executeV2Run`, `generateSeedArticle`
  - Types: TextVariation, EvolutionConfig, etc.
  - Re-exports of V1 modules (rating, comparison, etc.)

**Files to reuse from V1**:
- `claim_evolution_run` RPC — NOTE: actual signature is 2-arg `(TEXT, UUID DEFAULT NULL)` and also claims `continuation_pending` runs. V2 runner calls with only `p_runner_id` (2nd arg defaults to NULL). V2 must ensure it does not accidentally claim `continuation_pending` V1 runs if both pipelines coexist briefly. Consider adding `AND status = 'pending'` filter in V2's claim if needed.
- Heartbeat pattern from evolutionRunnerCore.ts
- Prompt templates from `evolution/src/lib/core/seedArticle.ts` (67 LOC) — adapted, not called directly (interface incompatible)

**Test strategy**:
- **runner.test.ts** (~180 LOC, 14 tests):
  - (1) Full lifecycle: claim → resolve content → evolveArticle → persist winner → mark completed
  - (2) Config resolution: raw config JSONB → V2 EvolutionConfig with correct field mapping
  - (3) Config resolution with missing fields: defaults applied correctly
  - (4) Content resolution (explanation_id): fetches article text from explanations table
  - (5) Content resolution (prompt_id): calls generateSeedArticle, uses result as input
  - (6) Content resolution (both null): markRunFailed with descriptive message
  - (7) Error during evolveArticle → markRunFailed with truncated message (≤2000 chars)
  - (8) markRunFailed status guard: only updates from pending/claimed/running (no-op if already completed)
  - (9) Heartbeat: setInterval called with 30s; clearInterval called in finally block
  - (10) Heartbeat DB error: non-fatal (caught, logged, run continues)
  - (11) Concurrent-run guard: at-limit → skip (returns without claiming)
  - (12) Concurrent-run guard: under-limit → proceed with claim
  - (13) Strategy linking: hashStrategyConfig called, upsert creates/returns strategy_config_id
  - (14) Strategy linking: update_strategy_aggregates RPC called at finalization
- **evolution-runner-v2.test.ts** (~80 LOC, 6 tests):
  - (1) Batch claim: N runs claimed sequentially via RPC
  - (2) Parallel execution: 3 runs via Promise.allSettled, mixed success/failure
  - (3) Graceful shutdown: SIGTERM sets shuttingDown → stops claiming, awaits in-flight batch
  - (4) Semaphore wrapping: throttledProvider limits concurrent LLM calls
  - (5) --max-runs flag: stops after N total runs processed
  - (6) No pending runs: claim returns empty → clean exit
- **seed-article.test.ts** (~60 LOC, 6 tests):
  - (1) Generates title + content from prompt via 2 LLM calls
  - (2) Title LLM error → propagates (seed generation is not retry-wrapped)
  - (3) Article LLM error → propagates
  - (4) Empty prompt → returns sensible default title
  - (5) Explanation-not-found: runner calls markRunFailed with descriptive message when DB returns null
  - (6) Prompt-not-found: similar to (5) for prompt_id resolution
- Mock strategy: Claim RPC mocked as `supabase.rpc('claim_evolution_run').returns({ data: [{ id, explanation_id, prompt_id, config }] })`. evolveArticle mocked as jest.fn() returning mock EvolutionResult (runner tests don't test pipeline internals — those are M3 tests).

**Done when**: V2 run claimed via RPC, executed, winner persisted to evolution_variants, run marked completed; prompt-based runs generate seed article before pipeline; parallel execution works with `--parallel 3`; watchdog compatible (heartbeat updates); all 23 runner tests pass

**Depends on**: Milestone 3

---

### Milestone 5: Admin UI Compatibility
**Goal**: V2 runs produce V1-compatible DB rows so existing admin pages display them without UI changes (except minor archive filter toggle). Core deliverable is `finalize.ts` which replaces M4's minimal persistence with full variant + run_summary persistence.

**Files to create**:
- `evolution/src/lib/v2/finalize.ts` (~150 LOC) — Persist V2 results in V1-compatible format
  - **Function signature**:
    ```typescript
    async function finalizeRun(
      runId: string,
      result: EvolutionResult,
      run: { experiment_id: string | null; strategy_config_id: string | null },
      db: SupabaseClient,
      durationSeconds: number,
      logger?: RunLogger
    ): Promise<void>
    ```
  - **Integration with runner.ts**: M4's `executeV2Run` calls `finalizeRun()` instead of its minimal persistence block. runner.ts imports finalize.ts and calls it after `evolveArticle()` returns. M4's minimal persistence (winner-only INSERT + basic run_summary UPDATE) is replaced entirely — not conditionally toggled.
  - Build `run_summary` JSONB matching EvolutionRunSummaryV3 schema from `EvolutionResult`:
    - `version: 3`, `stopReason`, `totalIterations`, `durationSeconds`
    - `finalPhase: 'COMPETITION'` (hardcoded — V2 flat loop is semantically all-competition)
    - `muHistory` and `diversityHistory` from EvolutionResult
    - `matchStats` computed from `matchHistory: ComparisonResult[]` — each ComparisonResult has `{ winnerId, confidence }`. `totalMatches = matchHistory.length`, `avgConfidence = mean(matchHistory.map(m => m.confidence))`, `decisiveRate = matchHistory.filter(m => m.confidence > 0.6).length / totalMatches`. Empty matchHistory: `{ totalMatches: 0, avgConfidence: 0, decisiveRate: 0 }`.
    - `topVariants` from pool + ratings (top 5 by mu, with `isBaseline: variant.strategy === 'baseline'`)
    - `baselineRank` and `baselineMu` from the 'baseline' strategy variant in pool (null if baseline was eliminated)
    - `strategyEffectiveness` computed from pool variants' strategies + ratings: group by strategy, compute `{ count, avgMu }` per group
    - `metaFeedback: null` (no meta-review agent in V2), `actionCounts: undefined` (no action system)
  - Persist ALL pool variants to `evolution_variants` in a single bulk insert: `id, run_id, variant_content` (NOT `content` — actual column name is `variant_content`, verified in persistence.ts:77), `elo_score` (via `toEloScale` from V1's `evolution/src/lib/core/rating.ts`), `generation, parent_variant_id, agent_name, match_count, is_winner`
  - **Input validation**: Before persisting, validate `result.pool.length > 0` (at minimum baseline exists). If pool is empty, mark run failed with `'Finalization failed: empty pool'`. Validate `result.ratings` has entries for all pool variant IDs.
  - **Error handling**: All persistence happens in a single try/catch. If variant bulk insert fails, the run is marked failed (not completed) with `error_message: 'Finalization failed: <message>'`. Partial writes are acceptable (no transaction wrapping) because a failed run can be re-run cheaply. The `run_summary` UPDATE and `variant` INSERT are sequential (not parallel) — if run_summary succeeds but variants fail, the run has summary but no variants, which is a detectable inconsistency (admin UI shows "0 variants" — operator can re-run).
  - **Experiment auto-completion**: If `run.experiment_id` set, use a single atomic query to avoid TOCTOU race: `UPDATE evolution_experiments SET status = 'completed' WHERE id = $1 AND status = 'running' AND NOT EXISTS (SELECT 1 FROM evolution_runs WHERE experiment_id = $1 AND status IN ('pending', 'claimed', 'running'))`. The single query is atomic — no gap between count and update. The `AND status = 'running'` guard makes it idempotent. This is the canonical implementation (M12 does NOT replace or modify it).

**Files to reuse from V1**:
- `evolution/src/lib/core/rating.ts` — `toEloScale(mu, sigma)` for converting TrueSkill ratings to Elo-scale scores for `evolution_variants.elo_score`

**Files to modify** (minimal):
- `evolution/src/lib/v2/runner.ts` — Replace M4's minimal persistence block (winner-only INSERT + basic run_summary UPDATE) with a single call to `finalizeRun(runId, result, run, db, durationSeconds, logger)`. This is a ~15 LOC replacement within `executeV2Run`.
- `evolution/src/services/evolutionRunnerCore.ts` — Add V2 routing: if `pipeline_version === 'v2'`, call `executeV2Run` directly (passing runId, supabase, llmProvider). Content resolution is NOT shared with V1's path — `executeV2Run` performs its own content resolution internally (M4 runner.ts). V1's evolutionRunnerCore content-resolution code is NOT called for V2 runs. **Note**: The `pipeline_version` TEXT column is created in M10's seed migration. For M5 development/testing, this column must exist. If M10 hasn't landed yet, M5 tests mock the column value from the run record. In production, M10 must be applied before M5's routing code is deployed.

**Run archiving**: Already implemented in V1 — `archiveRunAction` and `unarchiveRunAction` already exist in `evolutionActions.ts` (lines 408-448), and `getEvolutionRunsAction` already supports `includeArchived` filter via `get_non_archived_runs` RPC (which also filters runs from archived experiments via LEFT JOIN). The runs list page already has a "Show archived" checkbox. **No new work needed** — M5 inherits this from V1. M10's seed migration should preserve the `archived` column on `evolution_runs`.

**Strategy admin page**: **Deferred to M8** (Admin UI Component Simplification). M5's scope is limited to making V2 runs visible in existing admin pages. New admin pages (Strategy CRUD) belong in M8 where the RegistryPage component is built. M5 only ensures strategy_config_id FK on runs is populated correctly (already handled by M4's runner.ts).

**Structured logs**: Run detail Logs tab reads from `evolution_run_logs` table (populated by V2's `createRunLogger` from M3). Timeline tab reads from `evolution_agent_invocations` (populated by invocations.ts from M3). **Compatibility note**: V1's TimelineTab.tsx expects invocation rows with `agent_name, phase, iteration, success, execution_detail, cost_usd` columns. M3's invocations.ts writes exactly these columns (using `phaseName` as `agent_name` since V2 has no agents — phases map to: 'generate', 'rank', 'evolve'). The admin UI displays these as phase names in the timeline, which is correct for V2.

**Test strategy**:
- **finalize.test.ts** (~180 LOC, 12 tests):
  - (1) Full finalization: run_summary matches EvolutionRunSummaryV3 schema (validated with zod parse against EvolutionRunSummaryV3Schema — NOTE: this schema is currently non-exported in evolution/src/lib/types.ts:716; must add `export` to it, or use `EvolutionRunSummarySchema` union and verify version:3 discriminant)
  - (2) All pool variants persisted to evolution_variants with correct elo_score (toEloScale applied)
  - (3) Winner variant has `is_winner: true`, others have `is_winner: false`
  - (4) matchStats computed correctly: totalMatches, avgConfidence, decisiveRate from matchHistory
  - (5) topVariants: top 5 by mu, isBaseline flag set correctly
  - (6) baselineRank/baselineMu: correct rank and mu when baseline exists in pool
  - (7) baselineRank/baselineMu: null when baseline was eliminated from pool
  - (8) strategyEffectiveness: correct count and avgMu per strategy group
  - (9) Empty pool edge case: finalizeRun marks run failed with 'empty pool' error
  - (10) Experiment auto-completion: experiment marked completed when no sibling runs pending
  - (11) Experiment auto-completion: experiment NOT marked completed when sibling runs still pending
  - (12) Variant insert failure → run marked failed with descriptive error message
- **runner-v2-routing.test.ts** (~40 LOC, 3 tests):
  - (1) pipeline_version='v2' → executeV2Run called (not V1 pipeline)
  - (2) pipeline_version='v1' or null → V1 pipeline called (backward compat)
  - (3) executeV2Run calls finalizeRun (not minimal persistence)
- Mock strategy: `db` mocked as chainable Supabase mock (same pattern as M3/M4 tests). `EvolutionResult` constructed with known pool, ratings, matchHistory values. `toEloScale` imported from real V1 rating.ts (not mocked — it's a pure function).

**Done when**: V2 run produces full `run_summary` (EvolutionRunSummaryV3-compliant); all pool variants persisted to `evolution_variants` with Elo scores; run appears in `/admin/evolution/runs` list; detail page shows timeline with generate/rank/evolve phases; Logs tab shows structured logs; experiment auto-completion works; archive filter works; all 15 tests pass

**Depends on**: Milestone 4, Milestone 10 (for `pipeline_version` column and `archived` column in schema)

---

### Milestone 6: Proximity + Reflection (Optional Phases)
**Goal**: Add diversity tracking (for creative exploration trigger + diversityHistory) and quality critique (for targeted improvement feedback) as helper functions within the main loop.

**Note**: Proximity is recommended (not optional) because evolve.ts's creative exploration trigger depends on diversityScore. Without proximity, creative exploration never fires (diversityScore defaults to 1.0 = "maximally diverse" = no trigger).

**Files to create**:
- `evolution/src/lib/v2/proximity.ts` (~80 LOC) — `computeDiversity(pool, topN?, ratings?): number`
  - Lexical trigram similarity (64-dim hash projection) across top-N variants (default topN=10). When `ratings` is provided, selects topN by highest mu; otherwise uses first topN from pool.
  - Returns single diversity score (0-1). Score appended to diversityHistory in evolveArticle.
  - **Edge cases**: pool.length < 2 → returns 1.0 (maximally diverse / no comparison possible). pool.length < topN → uses all available variants. All identical texts → returns 0.0.
  - Drops V1's semantic embedding blend (70/30) and LRU cache — keeps only the lexical path for simplicity. **Intentional fork**: The trigram hash projection logic duplicates V1's `ProximityAgent._embed()` method (`evolution/src/lib/agents/proximityAgent.ts`). Direct reuse is blocked by ProximityAgent's class structure and V1 type dependencies. The fork is ~20 LOC of pure math — acceptable duplication. Semantic blend can be added later if quality impact is measured.
  - Pure function, no LLM calls, no async — no error handling needed beyond input validation.

- `evolution/src/lib/v2/reflect.ts` (~120 LOC) — `critiqueTopVariants(pool, ratings, llm, config, logger?): Promise<CritiqueResult>`
  - `llm`: Same wrapped `EvolutionLLMClient` instance from evolveArticle (cost tracking + retry already applied). Reflect LLM calls go through the same costTracker as generate/rank/evolve — no separate cost wiring needed.
  - `config`: `EvolutionConfig` (same type as M3) — uses `config.generationModel` for critique calls.
  - `logger?`: Optional `RunLogger` from M3's run-logger.ts. Used to log warnings on LLM parse failures and validation fallbacks. Falls back to `console.warn` when omitted.
  - Critique top 3 variants (by mu from ratings) on quality dimensions (reuse QUALITY_DIMENSIONS from V1 — `evolution/src/lib/flowRubric.ts` (NOT qualityDimensions.ts which does not exist), zero V1 coupling, pure `Record<string,string>` with 5 keys: clarity, engagement, precision, voice_fidelity, conciseness).
  - Returns `CritiqueResult: { critiques: Critique[], weakestDimension: string, suggestions: string[] }`
  - **CritiqueResult type**: Added to `evolution/src/lib/v2/types.ts`. `Critique = { variantId: string; scores: Record<string, number>; reasoning: string }`. `CritiqueResult = { critiques: Critique[]; weakestDimension: string; suggestions: string[] }`.
  - **LLM output validation**: Parse LLM response as JSON with try/catch. Validate required fields (weakestDimension is string, suggestions is string array, critiques is array with valid scores). On parse failure or validation failure → return safe default: `{ critiques: [], weakestDimension: 'overall', suggestions: ['Continue improving overall quality'] }`. Log warning via logger. This prevents malformed LLM output from injecting arbitrary content into subsequent prompts.
  - **Feedback sanitization**: `weakestDimension` is validated against `Object.keys(QUALITY_DIMENSIONS)` (it's a Record, not an enum) — if not a known dimension, falls back to 'overall'. `suggestions` strings are truncated to 500 chars each, max 5 suggestions, newlines collapsed to spaces (prevents `\n## Instructions` injection into prompt structure). This bounds the content injected into generate/evolve prompts.
  - **Feedback serialization**: V2 helpers (generate.ts, evolve.ts) receive the structured `Feedback` type `{ weakestDimension, suggestions }`. Each helper serializes it into the prompt string inline: `## Feedback to Address\nWeakest dimension: ${feedback.weakestDimension}\nSuggestions:\n${feedback.suggestions.map(s => '- ' + s).join('\n')}`. This replaces V1's `formatMetaFeedback()` utility.
  - **Feedback loop**: `weakestDimension` and `suggestions` are passed to the NEXT iteration's `generateVariants()` and `evolveVariants()` as optional `feedback` parameter — injected into prompts to guide improvement. If reflect is disabled, feedback is null and prompts use no guidance.
  - Results also stored in invocation execution_detail for admin UI.

**Files to modify**:
- `evolution/src/lib/v2/types.ts` — Add `Critique`, `CritiqueResult`, and `Feedback` types: `Feedback = { weakestDimension: string; suggestions: string[] }`.
- `evolution/src/lib/v2/evolve-article.ts` — Modify loop body from `generate → rank → evolve` to `generate → rank → proximity → reflect → evolve`:
  - After rank phase: call `computeDiversity(pool, 10, ratings)` → store as `diversityScore`, append to `diversityHistory`.
  - After proximity: call `critiqueTopVariants(pool, ratings, wrappedLlm, config)` → store result. Extract `feedback = { weakestDimension: result.weakestDimension, suggestions: result.suggestions }`.
  - Pass `feedback` and `diversityScore` to NEXT iteration's `generateVariants(..., feedback)` and `evolveVariants(..., { feedback, diversityScore })`. First iteration has no feedback (null).
  - **Error handling for proximity**: computeDiversity is a pure sync function — errors are programming bugs, let them propagate (crash is correct).
  - **Error handling for reflect**: Wrap `critiqueTopVariants` call in try/catch. On failure: log warning via logger, set feedback to null (skip guidance for next iteration), continue loop. Reflect is advisory — its failure must never crash the pipeline. Exception: BudgetExceededError is re-thrown (matching M3's pattern for budget errors).
  - Per-phase invocation logging: Create invocations for proximity and reflect phases (same pattern as generate/rank/evolve). Proximity cost_usd is always 0 (no LLM calls). Reflect cost_usd computed via costTracker delta snapshot.

**Test strategy**:
- **proximity.test.ts** (~80 LOC, 7 tests):
  - (1) Near-duplicate texts → score < 0.5
  - (2) Diverse texts → score > 0.8
  - (3) Identical texts → score = 0.0
  - (4) pool.length < 2 → returns 1.0
  - (5) pool.length < topN → uses all variants (no error)
  - (6) With ratings parameter → selects top-N by mu
  - (7) Without ratings → uses first N from pool
- **reflect.test.ts** (~120 LOC, 9 tests):
  - (1) Valid LLM response → correct CritiqueResult with weakestDimension and suggestions
  - (2) Malformed LLM JSON → returns safe default, no throw
  - (3) Missing required fields in LLM response → returns safe default
  - (4) weakestDimension not in QUALITY_DIMENSIONS → falls back to 'overall'
  - (5) suggestions exceed 500 chars → truncated
  - (6) suggestions exceed 5 items → capped at 5
  - (7) LLM call throws error → returns safe default (error swallowed)
  - (8) LLM call throws BudgetExceededError → re-thrown (not swallowed, matching M3 pattern)
  - (9) Cost tracked through same costTracker (verify costTracker.getTotalSpent increases after reflect)
- **Feedback loop integration test** (in evolve-article.test.ts, ~80 LOC, 5 tests):
  - (10) 2-iteration run: verify reflect output from iteration 1 is passed as feedback to iteration 2's generate/evolve calls
  - (11) Reflect failure in iteration 1 → feedback is null in iteration 2 → generate/evolve called without feedback, loop continues
  - (12) diversityScore appended to diversityHistory each iteration, correct values logged
  - (13) Creative exploration trigger fires when diversityScore < 0.5 (verify evolveVariants called with diversityScore triggering creative path)
  - (14) weakestDimension validation end-to-end: reflect returns unknown dimension → falls back to 'overall' → generate receives 'overall' not the unknown value

**Done when**: Main loop calls proximity each iteration (diversityScore logged + appended to history); reflect critiques top variants with validated/sanitized output (newlines collapsed in suggestions); feedback flows to next generation/evolution prompts; creative exploration triggers when diversityScore > 0 AND < 0.5; reflect failure does not crash the loop; all 23 tests pass (7 proximity + 9 reflect + 5 integration + 1 identical-texts + 1 all-identical-→-0.0)

**Depends on**: Milestone 3

---

### Milestone 7: Services Layer Simplification
**Goal**: Eliminate boilerplate across server actions via `adminAction` factory and consolidate shared utilities. Dead action deletion deferred to M11/M12 (actions are live until UI pages are replaced).

**Files to create**:
- `evolution/src/services/adminAction.ts` (~60 LOC) — Shared factory that handles `withLogging` + `requireAdmin` + `createSupabaseServiceClient` + try/catch + `ActionResult` wrapping + `serverReadRequestId` outer wrapper. Handler receives `{ supabase, adminUserId }` context (5+ actions use adminUserId from requireAdmin). Signature: `export const fooAction = adminAction('foo', async (input, { supabase, adminUserId }) => { ... })`. Produces identical exported function signature to current `serverReadRequestId(withLogging(...))`. Each generated action is wrapped with `'use server'` directive at the module level (the consuming service files already have `'use server'` at top — adminAction.ts itself does NOT add the directive per-function; the existing module-level directive in each service file is sufficient). Input validation (e.g., validateUuid) remains the handler's responsibility — adminAction handles only auth, logging, error wrapping, and client creation.
- `evolution/src/services/shared.ts` (~50 LOC) — Shared `UUID_REGEX`, `UUID_V4_REGEX` (strict), `validateUuid()`, `ActionResult<T>` (replacing 4+ duplicates).
  - **UUID_REGEX divergence**: `evolutionActions.ts` uses a strict v4 UUID regex (`4[0-9a-f]{3}-[89ab][0-9a-f]{3}`); all others use a loose generic regex. shared.ts provides BOTH: `UUID_REGEX` (loose, for general use) and `UUID_V4_REGEX` (strict, for `estimateRunCostAction` which validates strategy IDs). Each action file uses the appropriate one.
  - **ActionResult<T> divergence**: `eloBudgetActions.ts` uses `{ success: boolean; data?: T; error?: string }` (optional fields, plain string error). All other 7 files use `{ success: boolean; data: T | null; error: ErrorResponse | null }` (required fields, ErrorResponse type). **Resolution**: shared.ts defines the Shape A form (`data: T | null; error: ErrorResponse | null`) as canonical. eloBudgetActions.ts must be updated to use Shape A — callers checking `result.error` as string must be updated to check `result.error?.message` or similar. Scope this consumer update explicitly in M7.

**Files to modify** (refactor existing):
- `evolution/src/services/promptRegistryActions.ts` — Replace 7 action wrappers with `adminAction()` calls (~130 LOC saved)
- `evolution/src/services/strategyRegistryActions.ts` — Replace 9 action wrappers (~160 LOC saved)
- `evolution/src/services/variantDetailActions.ts` — Replace 5 action wrappers (~90 LOC saved)
- `evolution/src/services/costAnalyticsActions.ts` — Replace 1 action wrapper (~20 LOC saved)
- `evolution/src/services/evolutionActions.ts` — Replace thin actions with adminAction factory. `estimateRunCostAction` kept (imported by RunConfigForm) — refactored like other actions (~100 LOC saved)
- `evolution/src/services/arenaActions.ts` — Replace thin wrappers with adminAction factory (keep all actions — deletion deferred to M11)
- `evolution/src/services/experimentActions.ts` — Replace thin wrappers with adminAction factory (keep all actions — deletion deferred to M12)
- `evolution/src/services/evolutionVisualizationActions.ts` — Replace thin wrappers (~150 LOC saved)
- `evolution/src/services/eloBudgetActions.ts` — Normalize to use adminAction factory (currently lacks withLogging/serverReadRequestId — adding them is a behavior improvement, verified by dedicated test below)

**Dead action deletion deferred**: The 10 actions previously labeled "dead" are ALL actively imported by UI pages (arena/page.tsx, arena/[topicId]/page.tsx, ExperimentHistory.tsx, ExperimentForm.tsx, strategies/page.tsx). They can only be deleted AFTER the consuming pages are replaced:
- Arena actions (6): delete in M11 when arena pages are rebuilt
- Experiment actions (3): delete in M12 when experiment pages are rebuilt
- Strategy presets (1): delete in M8 when strategy page is rebuilt

**Test strategy**: All existing service tests must still pass. Verify signature compatibility via `tsc --noEmit`. Add tests for `adminAction` factory (~14 tests): (1) auth failure returns `{ success: false }` without calling handler, (2) logging integration — withLogging called with correct action name string (not transposed), (3) error wrapping — handler throw → `{ success: false, error: message }`, (4) serverReadRequestId passthrough — outer wrapper applied, (5) Supabase client creation — createSupabaseServiceClient called once per invocation, (6) adminUserId passed through from requireAdmin, (7) successful handler → `{ success: true, data: result }`, (8) handler receives valid Supabase client, (9) eloBudgetActions normalization — verify actions now require admin auth, (10) concurrent calls get independent Supabase clients, (11) factory composition test WITHOUT mocking withLogging/serverReadRequestId — verify actual wrapping chain works end-to-end (existing service tests mock these away and cannot detect factory composition bugs), (12) eloBudgetActions ActionResult shape migration — verify callers receive ErrorResponse|null not string, (13) strategyRegistryActions: verify createStrategyCore's internal requireAdmin does not double-auth when adminAction also calls requireAdmin (refactor createStrategyCore to accept pre-authed context), (14) promptRegistryActions: verify resolvePromptByText is NOT wrapped by adminAction (it takes supabase param directly, is not a server action).

**Done when**: All 9 service files (including eloBudgetActions.ts) refactored to use `adminAction()`; all existing tests pass; exported function signatures unchanged (verified via `tsc --noEmit` + export name audit); adminAction factory has 14 passing tests (including factory composition test without mocking wrappers); eloBudgetActions auth normalization verified by dedicated test; eloBudgetActions ActionResult<T> migrated to Shape A (ErrorResponse|null) with caller updates; shared.ts ActionResult<T> structural compatibility confirmed across all replaced definitions; total services LOC reduced by ~500 (boilerplate only, no action deletions yet)

**Depends on**: None (can run in parallel with any milestone — factory refactor only, no deletions)

---

### Milestone 8: Admin UI Component Simplification
**Goal**: Reduce admin page boilerplate from ~7,300 LOC to ~3,300 LOC (55% reduction) by extracting config-driven shared components that consolidate duplicated list/detail/dialog/badge infrastructure across 87 UI files.

**Context** (from 3 rounds of UI research, 12 agents):
- Only 2/8 list pages use EntityListPage (25% reuse) — lacks CRUD dialogs, row actions, advanced filters
- 6/6 detail pages use EntityDetailHeader (100% reuse) — but each still has 100-300 LOC of tab/fetch boilerplate
- ~85% of page code is repetitive: data loading, filter state, dialog boilerplate, tab switching, status badges
- Dialog/form code duplicated across Prompts, Strategies, Arena (~600 LOC)
- 7 distinct badge implementations (4 duplicated across files, ~180 LOC redundant)
- URL builders already 97% centralized (only 3 missing)

**Relationship to existing components**: RegistryPage **wraps** EntityListPage (not replaces it). EntityListPage remains the low-level table+filters component. RegistryPage adds CRUD dialog orchestration, auxiliary data fetching, and row actions on top. EntityDetailPageClient **wraps** EntityDetailHeader + EntityDetailTabs, adding data fetching, auto-refresh, and lazy tab loading. Both existing components remain in use; the new components are higher-level compositions.

**Security notes**: All admin evolution pages are behind Next.js middleware admin auth (`requireAdmin`). Components do not independently enforce auth — they rely on the page-level guard, which is the existing pattern across all admin pages. Column `render` functions return React elements (not raw HTML), so XSS risk is structurally prevented by React's escaping. FormDialog values are passed to server actions which validate input server-side (via `adminAction` factory from M7).

**Files to create**:
- `evolution/src/components/evolution/RegistryPage.tsx` (~150 LOC) — Config-driven list page with CRUD
  - **Wraps EntityListPage** internally — passes columns, filters, items, sorting, pagination down to it
  - Handles: filters (text/select/checkbox/date-range), sortable columns, row actions with conditional visibility, pagination, header action buttons, auxiliary data fetching
  - **Auxiliary data fetching interface**: `auxiliaryFetches?: Array<{ key: string; action: () => Promise<ActionResult<T[]>>; rowKey: string; resultKey: string }>` — each fetch runs in parallel on mount. RegistryPage unwraps `ActionResult` (checks `result.success`, extracts `result.data`), then indexes the array by `rowKey` (field on each result item) and merges into row data under `resultKey`. Example: `{ key: 'peakStats', action: getPeakStatsAction, rowKey: 'variantId', resultKey: 'peakStats' }`. On action failure (`success: false`), the auxiliary data is silently omitted (column renders without it).
  - Integrates FormDialog + ConfirmDialog for create/edit/clone/archive/delete flows
  - Column `render` functions handle page-specific rendering (badges, color-coded metrics, custom joins). Render functions receive typed row data and return ReactNode — no dangerouslySetInnerHTML.
  - **Submit guard**: All CRUD operations disable the submit button on click and re-enable on completion/error (prevents double-submit). Uses `useTransition` or `useState` loading flag.
  - Replaces per-page boilerplate in Variants (135→60 LOC), Invocations (110→55 LOC), Prompts (582→250 LOC), Strategies (925→450 LOC — agent selection widget + preset flow stay as custom render blocks ~150 LOC)

- `evolution/src/components/evolution/EntityDetailPageClient.tsx` (~120 LOC) — Config-driven detail page shell
  - **Wraps EntityDetailHeader + EntityDetailTabs** — composes them with data fetching, auto-refresh, error/loading states
  - Handles: data fetching, lazy tab loading, auto-refresh integration
  - Config: `{ title(data), statusBadge(data), links(data), tabs: [{id, label}], renderTabContent(tabId, data) }`
  - Replaces per-page boilerplate in 5 detail pages (Variant, Strategy, Prompt, Experiment, Invocation). **Exception**: Run detail page cannot use EntityDetailPageClient — its AutoRefreshProvider wraps the entire page including header controls, and the polling interval is exposed as a user-configurable UI element. Absorbing it into EntityDetailPageClient's wrapper model would require exposing AutoRefreshProvider config as a top-level prop, significantly complicating the component. Run detail page stays custom.

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
  - **Naming note**: The existing `EvolutionStatusBadge.tsx` (kept, ~56 LOC — handles run status specifically) has a similar name. To avoid import confusion, the new unified badge should be imported as `StatusBadge` from `@evolution/components/evolution/StatusBadge` while EvolutionStatusBadge remains at its existing path. Pages migrated in Phase D should switch from EvolutionStatusBadge to StatusBadge's 'run-status' variant.

- Add 3 missing URL builders to `evolution/src/lib/utils/evolutionUrls.ts` (~15 LOC):
  - `buildRunCompareUrl(runId)`, `buildRunLogsUrl(runId, options?)`, `buildArenaEntryUrl(entryId)`

**Files to modify** (refactor existing — incremental, page-by-page):
- `src/app/admin/evolution/variants/page.tsx` — Swap to RegistryPage config (135→60 LOC)
- `src/app/admin/evolution/invocations/page.tsx` — Swap to RegistryPage config (110→55 LOC)
- `src/app/admin/evolution/prompts/page.tsx` — Swap to RegistryPage + FormDialog (582→200 LOC)
- `src/app/admin/evolution/strategies/page.tsx` — Swap to RegistryPage + FormDialog (925→300 LOC)
- 6 detail page directories — Swap to EntityDetailPageClient config
- Remove duplicate StatusBadge/PipelineBadge/MethodBadge functions from 4+ page files

**Migration order and rollback strategy**:
1. **Phase A — Build shared components** (no existing code changes): Create RegistryPage, EntityDetailPageClient, FormDialog, ConfirmDialog, StatusBadge. Unit test each in isolation. No risk to existing pages.
2. **Phase B — Migrate list pages** (simplest first): Variants → Invocations → Prompts → Strategies. Each page is a separate commit. After each commit, run `tsc --noEmit` + existing unit tests for that page. If a migration breaks, revert the single commit (page-level atomic changes).
3. **Phase C — Migrate detail pages** (3 simplest first): Invocation → Variant → Prompt detail pages first (less custom logic), then Strategy → Experiment → Run.
4. **Phase D — Badge cleanup**: Remove duplicate StatusBadge/PipelineBadge/MethodBadge functions from page files (only after pages use unified StatusBadge).
- **Rollback**: Each page migration is one commit. `git revert <commit>` restores the page to pre-migration state. No cross-page dependencies between migrations.

**Test strategy** (~320 LOC across 5 test files, 28 test cases):
- RegistryPage.test.tsx (~100 LOC, 8 tests): renders columns from config, applies text/select filters, calls onSort, renders row actions, fires CRUD dialog on action click, handles auxiliary data fetch merge, submit guard disables button during operation, handles empty items array
- FormDialog.test.tsx (~80 LOC, 7 tests): renders all field types (text/textarea/select/number/checkbox), validates required fields, calls onSubmit with form values, shows error banner on submit failure, disables submit during loading, supports custom render field, preset application via onFormChange
- ConfirmDialog.test.tsx (~30 LOC, 3 tests): renders title/message, calls onConfirm on confirm click, renders danger variant with red button
- StatusBadge.test.tsx (~50 LOC, 8 tests): renders each of the 7 variant types with correct color, renders unknown status with gray fallback
- EntityDetailPageClient.test.tsx (~60 LOC, 5 tests): renders header from config, renders tabs, lazy-loads tab content, shows loading state, shows error state on fetch failure
- **E2E note**: No existing E2E tests exist for admin evolution pages (verified: zero .e2e.ts files in src/app/admin/evolution/). The "must not break existing E2E tests" constraint refers to any project-wide E2E tests that navigate through admin pages. M8 creates ONE new E2E test for the Prompts page (create/edit/archive flow, ~60 LOC) using Playwright as a regression baseline.
- **Visual regression**: Use Playwright screenshot comparison (`expect(page).toHaveScreenshot()`) for StatusBadge variants. Captured once as baseline, compared on CI. No external service needed.

**Done when**:
- 5 shared components created and tested (28 unit tests passing)
- At least 3 list pages + 3 detail pages refactored to use them
- All existing unit and E2E tests pass with no behavior changes
- New Prompts page E2E test passes
- Admin UI LOC reduced by 1,500+ (measured via cloc)
- 3 missing URL builders added

**Depends on**: Soft dependency on M7 (adminAction factory) — M8's security notes reference adminAction for server-side validation. If M8 ships before M7, server actions still have inline requireAdmin() (functionally safe) but the stated security model references a non-existent factory. Phase A (build shared components) has no dependencies. Phase B+ (page migrations) benefit from M7 completing first.

---

### Milestone 9: Test Suite Simplification
**Goal**: Reduce test suite from 41,710 LOC to ~9,600 LOC (77% reduction) by eliminating tests for V1 abstractions, centralizing mock infrastructure, and writing focused V2 tests. Further reduction to ~5,500 LOC (87%) after M11/M12 complete arena/experiment rewrites.

**Context** (from 3 rounds of test research, 12 agents):
- 165 test files, 41,710 LOC, 2,383 test cases
- Only 22% of test files use the shared mock factory (78% create mocks independently)
- 23 files independently mock `createSupabaseServiceClient` with identical code
- pipeline.test.ts alone is 2,870 LOC (~40% mock setup boilerplate)
- 8 eliminated agent test files account for ~3,400 LOC (debate, iterativeEditing, treeSearch, sectionDecomposition, outlineGeneration, metaReview, calibrationRanker, tournament — no separate flowCritique test file exists)
- Integration tests: 4,480 LOC, most test V1-specific checkpoint/supervisor features
- `parseWinner` tested in 3 separate files (comparison.test.ts, pairwiseRanker.test.ts, pipeline.test.ts)

**V1 tests to eliminate** (~15,660 LOC verified):
- Pipeline/state/reducer/supervisor tests: 5,036 LOC actual (pipeline 2,870, state 460, supervisor 591, reducer 238, actions 160, pipelineFlow 232, pipelineUtilities 485)
- 8 eliminated agent tests: 3,599 LOC actual (debate 391, iterativeEditing 820, treeSearch 452, sectionDecomposition 286, outlineGeneration 403, metaReview 230, calibrationRanker 342, tournament 675)
- Subsystem tests (treeOfThought 4 files, section 4 files): 1,922 LOC (beamSearch 724, treeNode 223, evaluator 214, revisionActions 192, sectionEditRunner 127, sectionFormatValidator 115, sectionParser 202, sectionStitcher 125)
- Checkpoint/persistence tests: 675 LOC (persistence 323, persistence.continuation 352)
- Integration tests for V1 features: 2,350 LOC actual (pipeline 541, outline 324, treeSearch 356, costAttribution 525, visualization 318, costEstimation 213, cronGate 73). **KEEP (not V1-only)**: evolution-actions.integration.test.ts (401 LOC — tests queueEvolutionRunAction, killEvolutionRunAction, getEvolutionCostBreakdownAction which are V2-active), evolution-infrastructure.integration.test.ts (271 LOC — tests concurrent claim, heartbeat timeout, split-brain detection which are V2-active via same DB locking). Migrate these 2 files to V2 context, do not delete.
- Script tests for obsolete scripts: 1,338 LOC actual (backfill-prompt-ids 328, backfill-experiment-metrics 275, evolution-runner 348, run-evolution-local 387)
- API route test: experiment-driver/route.test.ts 602 LOC (cron driver eliminated in V2)

**V1 tests to keep** (~1,590 LOC actual, unchanged — original ~900 LOC estimate was low):
- `rating.test.ts` (255 LOC) — OpenSkill rating math
- `comparison.test.ts` (215 LOC) — Pairwise comparison + parseWinner
- `comparisonCache.test.ts` (186 LOC) — LRU cache
- `formatValidator.test.ts` (131 LOC) — Format validation rules
- `formatValidationRules.test.ts` (224 LOC) — Rule implementations (stripCodeBlocks, hasBulletPoints, etc.)
- `reversalComparison.test.ts` (103 LOC) — 2-pass bias mitigation
- `textVariationFactory.test.ts` (54 LOC) — Variant creation
- `strategyConfig.test.ts` (548 LOC) — Hash dedup + label generation (used by V2 M1/M4). **Note**: actual LOC is 5x the original estimate due to extensive diffing/normalization tests. **Risk**: if this file imports V1-specific types (e.g., `PromptMetadata`, `PipelineType`) from `evolution/src/lib/types.ts`, it will break when V1 types.ts is deleted in M9. Verify imports before marking V1 types.ts for deletion; remove any V1-type-only imports from the test (they can be replaced with inline type literals or `as` casts).
- `errorClassification.test.ts` (98 LOC) — isTransientError (used by V2 M3 retry logic)

**Verified clean**: All 9 files confirmed to have zero imports of V1 abstractions (PipelineStateImpl, ExecutionContext, AgentBase, etc.). Safe to keep as-is.

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

**Page tests** (with M8, ~750 LOC replacing 2,517):
- Shared component tests (RegistryPage, EntityDetailPageClient, FormDialog, ConfirmDialog, StatusBadge): ~320 LOC tested once
- Per-page tests shrink to ~20 LOC each (config validation + error handling only)

**Component tests** (33 files, ~3,806 LOC):
- **Keep** (~1,500 LOC, ~15 files): V2-reused shared components — EntityListPage (104), EntityDetailHeader (102), EntityDetailTabs (54), MetricGrid (79), EmptyState (37), TableSkeleton (33), EloSparkline (40), TextDiff (71), EvolutionStatusBadge (56), AutoRefreshProvider (205), EntityTable (72), EvolutionBreadcrumb (65), useTabState (79), ElapsedTime (56), AttributionBadge (69). Plus variant detail: VariantContentSection (64), VariantLineageSection (141), VariantMatchHistory (151).
- **Delete** (~1,310 LOC, ~9 files): V1-only agent detail views — AgentExecutionDetailView (264). V1-only tabs — TimelineTab (576), BudgetTab (185). V1-only components — ActionChips (99), StepScoreBar (81), InputArticleSection (42), LineageGraph (47), AgentErrorBlock (70), shared/agentDetails (156).
- **Keep but shrink** (~996 LOC → ~300 LOC, ~7 files): Tab tests rewritten to use M8 config-driven testing — LogsTab (256→40), MetricsTab (90→20), RelatedRunsTab (84→20), RelatedVariantsTab (61→20), VariantsTab (196→40), VariantDetailPanel (121→40). Surplus LOC eliminated via shared component-test-mocks.ts.

**Service tests** (14 files, ~6,962 LOC):
- **Keep** (~1,922 LOC, 7 files): evolutionActions (1,155), promptRegistryActions (298), variantDetailActions (101), costAnalyticsActions (120), strategyResolution (185), experimentReportPrompt (63). These test V2-active server actions.
- **Delete** (~2,512 LOC, 5 files): eloBudgetActions (290 — no separate elo table in V2), costAnalytics (369 — V2 computes in app layer), evolutionRunnerCore (187 — replaced by V2 runner), evolutionRunClient (127 — replaced by V2 runner), strategyRegistryActions (541 — rewritten in M7).
- **Rewrite** (~1,198 LOC → ~600, 1 file): evolutionVisualizationActions (1,198 — refactored after M7 adminAction).
- **Rewrite after M11/M12** (~2,328 LOC, 2 files): arenaActions (1,495), experimentActions (833). Deferred until M11/M12 replace the actions.

**Uncategorized lib/core/utils tests** (32 files, ~6,921 LOC):
- **Delete** (~4,723 LOC, ~21 files): V1-only core — arena (416), arenaIntegration (463), metricsWriter (564), agentSelection (85), agentToggle (118), budgetRedistribution (114), costEstimator (659), pruning (102), critiqueBatch (205), eloAttribution (216), diversityTracker (163 — replaced by M6 proximity), pool (112 — replaced by V2 local variables), configValidation (317 — V2 uses EvolutionConfig type validation), config (50). V1-only lib — flowRubric (465), diffComparison (175), outlineTypes (198), config (110). Utils — metaFeedback (67 — replaced by M6 reflect), frictionSpots (82).
- **Keep** (~1,640 LOC, ~9 files): costTracker (424 — V2 uses same costTracker), llmClient (412 — V2 reuses llmClient), logger (148 — V2 reuses logger), jsonParser (77), seedArticle (104), validation (91), formatValidationRules (224 — supplements formatValidator), evolutionUrls (61), formatters (141).
- **Defer to M11/M12** (~558 LOC, 3 files): promptBankConfig (121), experimentMetrics (394), analysis (43).

**Non-eliminated agent tests** (6 files, ~2,296 LOC):
- **Delete** (~2,296 LOC): reflectionAgent (291 — replaced by M6 reflect), rankingAgent (466 — replaced by V2 rank.ts), evolvePool (483 — replaced by V2 evolve.ts), proximityAgent (393 — replaced by M6 proximity), generationAgent (217 — replaced by V2 generate.ts), pairwiseRanker (446 — merged into V2 rank.ts).

**Script tests** (10 files, ~2,464 LOC):
- **Delete** (~1,189 LOC, 4 files): backfill-prompt-ids (328), backfill-experiment-metrics (275), evolution-runner (348), run-evolution-local (387). These test obsolete/deleted scripts.
- **Defer** (~1,275 LOC, 6 files): Moved with their scripts to `evolution/scripts/deferred/` — run-prompt-bank (260), run-prompt-bank-comparisons (135), run-bank-comparison (141), run-arena-comparison (141), arenaUtils (163), oneshotGenerator (286).

**API route tests** (3 files, ~1,114 LOC):
- **Delete** (602 LOC, 1 file): experiment-driver/route.test.ts — V2 eliminates cron driver (experiments auto-complete via finalize.ts)
- **Rewrite** (218 LOC, 1 file): evolution-watchdog/route.test.ts — remove checkpoint recovery tests (V2 has no checkpoints), keep stale-run → failed transition tests
- **Modify** (294 LOC, 1 file): evolution/run/route.test.ts — add V2 pipeline_version routing tests, keep existing dual-auth/GET/POST tests

**Page-specific tests requiring modification** (2 files):
- **Modify**: EvolutionStatusBadge.test.tsx — remove `continuation_pending` test cases (status eliminated in V2)
- **Rewrite after M12**: ExperimentForm.test.tsx (391 LOC) — V2 replaces wizard with FormDialog config; ExperimentAnalysisCard.test.tsx (97 LOC) and ReportTab.test.tsx (65 LOC) — components eliminated in V2
- **Rewrite after M11**: arena/[topicId]/page.test.tsx (135 LOC), arena/entries/[entryId]/page.test.tsx (65 LOC) — pages rebuilt with config-driven components

**LOC reconciliation** (all evolution test files + integration):
| Category | Files | Before LOC | After LOC | Delta |
|----------|-------|-----------|-----------|-------|
| V1 eliminate (pipeline/state/agents/subsystems/checkpoint) | 31 | 15,660 | 0 | -15,660 |
| V1 keep (rating/comparison/format/etc) | 9 | 1,814 | 1,814 | 0 |
| Non-eliminated agent tests (delete) | 6 | 2,296 | 0 | -2,296 |
| Component tests (keep) | 15 | 1,500 | 1,500 | 0 |
| Component tests (delete) | 9 | 1,520 | 0 | -1,520 |
| Component tests (shrink) | 7 | 996 | 300 | -696 |
| Service tests (keep) | 7 | 1,922 | 1,922 | 0 |
| Service tests (delete) | 5 | 1,514 | 0 | -1,514 |
| Service tests (rewrite M7) | 1 | 1,198 | 600 | -598 |
| Service tests (defer M11/M12) | 2 | 2,328 | 0* | -2,328 |
| Lib/core/utils (delete) | 21 | 4,723 | 0 | -4,723 |
| Lib/core/utils (keep) | 9 | 1,640 | 1,640 | 0 |
| Lib/core/utils (defer M11/M12) | 3 | 558 | 0* | -558 |
| Script tests (delete) | 4 | 1,189 | 0 | -1,189 |
| Script tests (defer) | 6 | 1,275 | 0* | -1,275 |
| API route tests (delete+rewrite+modify) | 3 | 1,114 | 512 | -602 |
| Integration tests (V1 → V2) | — | 4,480 | 900 | -3,580 |
| Page tests (M8+M9) | — | 2,517 | 750 | -1,767 |
| V2 new tests | 6 | 0 | 950 | +950 |
| Shared mock infrastructure | 2 | 0 | 140 | +140 |
| **Total** | | **~41,710** | **~9,602** | **~77% reduction** |

*Deferred files (~4,161 LOC) are moved to `deferred/` or left in place awaiting M11/M12. They are excluded from the active test suite but not deleted in M9.

**Note**: The original 87% / ~5,500 LOC target was based on incomplete categorization. With full file-by-file inventory, M9 achieves ~77% reduction to ~9,600 LOC. Further reduction to ~5,500 requires M11/M12 completion (which rewrites arena/experiment service tests and removes deferred items). Updated goal accordingly.

**Test strategy**: Validate by running V1 reused module tests first (must pass unchanged, run against original V1 import paths — not V2 barrel — to confirm no regression). Then run V2 new tests. Then verify no V1 test imports reference eliminated modules via `tsc --noEmit` on the test files.

**Boundary between evolve-article.test.ts (unit) and integration tests**: evolve-article.test.ts is a unit-level smoke test that mocks both LLM and DB calls — it tests the orchestration logic (loop control, budget exhaustion, kill detection) with no external dependencies. The integration test uses a real Supabase instance + mock LLM — it tests data persistence (variants written, invocations logged, run status updated) and cleanup. No overlap: unit tests mock DB, integration tests use real DB.

**Page tests sequencing**: Page tests require M8 (config-driven pages) to exist before M9 can write the simplified per-page tests. M9 depends on M8 for page tests only; all other M9 work depends on M1-6. Page test work is parallelizable with the rest of M9 once M8 is complete.

**CI/CD updates required**:
- Update `jest.config.js` coverage thresholds: methodology is delete V1 production code and tests in the SAME PR, run full suite (`npm test -- --coverage`), record new baseline, set thresholds at `baseline - 5%` for each metric. Include `jest.config.js` changes in the PR to ensure CI runs full suite (not `--changedSince`).
- Update CI workflow test path patterns: V2 unit tests auto-discovered by Jest glob (`**/*.test.ts`) in `jest.config.js` testMatch — no config change needed. V2 integration tests: update `package.json` `test:integration:evolution` pattern from `'evolution-|arena-actions|manual-experiment|strategy-resolution'` to `'evolution-|arena-actions|manual-experiment|strategy-resolution|v2-lifecycle|v2-error'`. V2 integration test files placed at `src/__tests__/integration/v2-lifecycle.test.ts` and `src/__tests__/integration/v2-error-scenarios.test.ts` (matching existing `testPathIgnorePatterns` which excludes `src/__tests__/integration/` from unit runs but includes them in integration config).
- Note: DB migration testing (`supabase db reset --dry-run`, RPC verification) belongs in M10, not M9. M9 tests mock all DB interactions.

**Critical sequencing rule**: Tests MUST be co-deleted with their production code in the SAME PR. Never delete tests while production code is still actively imported.

**V1 production code to co-delete with tests** (not previously assigned to any milestone — M9 owns this):
- Pipeline/state/supervisor: `pipeline.ts` (904 LOC), `state.ts` (~320 LOC), `supervisor.ts` (~213 LOC), `reducer.ts` (~160 LOC), `pipelineFlow.ts` (~232 LOC), `pipelineUtilities.ts` (~485 LOC)
- 8 V1-only agent files: debate, iterativeEditing, treeSearch, sectionDecomposition, outlineGeneration, metaReview, calibrationRanker, tournament (~4,500 LOC total)
- Subsystems: treeOfThought/ (4 files), section/ (4 files)
- Note: Before deleting production code, verify NO remaining imports via `grep -r` across the active codebase. Any page/route still importing a V1 module blocks its deletion until that consumer is migrated.

**Service tests**: Do NOT delete service tests (eloBudgetActions, costAnalytics, evolutionRunnerCore, evolutionRunClient, strategyRegistryActions) until their production code is also deleted or rewritten. These 5 production files are actively imported by UI pages. Keep their tests until the consuming pages are migrated in M8/M11/M12.

**Script tests**: evolution-runner.test.ts and run-evolution-local.test.ts should be REWRITTEN (not deleted) when M10 simplifies the scripts. M9 should NOT delete these tests since M10 keeps the scripts.

**Done when**:
- Shared mock factory (`setupServiceTestMocks`) adopted by all kept/rewritten service test files
- V1 eliminated test files co-deleted WITH their production code (28+ test files + corresponding production files in same PRs)
- Non-eliminated agent tests deleted with their agent production files (6 test files + 6 agent files)
- V1-only component tests deleted (11 files) and shrunk tab tests rewritten (7 files)
- Service tests for actively-used production code KEPT (not deleted) — 5 files remain until M8/M11/M12 migrate consumers
- V1-only lib/core/utils tests deleted (21 files)
- Obsolete script tests deleted (4 files), deferred script tests moved (6 files)
- V2 test suite passes: 62 new test cases across 6 files
- Reused V1 tests pass unchanged (including strategyConfig, errorClassification, costTracker, llmClient, logger)
- Integration tests consolidated: 4,480 LOC → ~900 LOC (2 files)
- jest.config.js coverage thresholds recalibrated using baseline-5% methodology
- CI test:integration:evolution pattern updated to include v2- prefix
- Total test LOC: 41,710 → ~9,600 (77% reduction; further to ~5,500 after M11/M12)

**Depends on**: Milestones 1-6 (V2 code must exist to test it), M8 (for page tests only). Mock infrastructure (service-test-mocks.ts, component-test-mocks.ts) can be created anytime.

---

### Milestone 10: Scripts + DB Migration Cleanup
**Goal**: Add a DROP+CREATE migration alongside existing ~73 V1 migration files; delete 4 obsolete scripts and simplify 2 runners for V2.

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
- Also DROP V1 RPCs: `checkpoint_and_continue`, `apply_evolution_winner`, `compute_run_variant_stats`, `claim_evolution_run`, `sync_to_arena`, `update_strategy_aggregates`, `get_non_archived_runs`, `archive_experiment`, `unarchive_experiment`, `checkpoint_pruning_rpc`
- Total: 15 V1 tables + 10 V1 RPCs dropped, replaced by 9 V2 tables + 3 V2 RPCs.
- **Note**: actual V1 migration file count is ~102 (not ~73 as originally estimated). All stay in place (already applied in DB history).

**Rollback / backup strategy**: Before applying to staging or prod, take a Supabase project snapshot (Dashboard → Settings → Snapshots) or `pg_dump` the evolution tables. Since this is an intentional clean-slate with no data preservation, rollback = restore snapshot + `supabase migration repair --status reverted 20260315000001`. Document in PR description.

**Migration files**: Keep existing ~73 V1 migration files in place (they're already applied in staging/prod DB history). Add one new migration that drops and recreates.

**Files to create**:
- `supabase/migrations/20260315000001_evolution_v2.sql` (~350 LOC) — Drops all V1 evolution tables + RPCs, then creates V2 schema:
  - **V2.0 Core** (5 tables): `evolution_runs` (config JSONB + `strategy_config_id` FK, `archived` boolean, `pipeline_version` TEXT), `evolution_variants` (Elo + lineage), `evolution_agent_invocations` (per-phase timeline), `evolution_run_logs` (structured logging for Logs tab), `evolution_strategy_configs` (id, name, config JSONB, config_hash for dedup, is_predefined, created_at). No `evolution_checkpoints` table (Decision 1: no checkpointing).
  - **V2.1 Arena** (3 tables): `evolution_arena_topics` (prompts, case-insensitive unique), `evolution_arena_entries` (Elo merged in — no separate elo table; includes `archived_at TIMESTAMPTZ` for soft-delete), `evolution_arena_comparisons` (minimal: topic_id FK, entry_a, entry_b, winner, confidence, run_id, created_at — topic_id included to avoid join-through-entries for Match History tab queries)
  - **V2.2 Experiments** (1 table): `evolution_experiments` (6 columns: id, name, prompt_id FK, status, created_at, updated_at — updated_at required by M12)
  - **RPCs** (3, all SECURITY DEFINER with explicit `REVOKE EXECUTE ON FUNCTION <name> FROM PUBLIC; GRANT EXECUTE ON FUNCTION <name> TO service_role;` — V1 omitted these on sync_to_arena and update_strategy_aggregates, leaving them callable by anon):
    - `claim_evolution_run` (FOR UPDATE SKIP LOCKED — reuse V1 logic)
    - `sync_to_arena` (NEW — rewritten for merged schema: upserts entries with elo_rating + match_count inline (no separate elo table), inserts match results to `evolution_arena_comparisons` (minimal: topic_id, entry_a, entry_b, winner, confidence, run_id, created_at — no dimension_scores). Accepts p_entries + p_matches JSONB arrays. `p_elo_rows` parameter removed — elo is embedded in p_entries directly since there's no separate elo table. Input validation is NEW (not from V1): `p_entries` max 200 elements, `p_matches` max 1000 elements, raises exception on oversized input)
    - `update_strategy_aggregates` (reuse V1 — updates run_count, avg_final_elo, total_cost_usd on strategy_configs after run finalization)
  - **Dropped RPCs**: `checkpoint_and_continue` (no checkpointing), `apply_evolution_winner` (no winner application), `compute_run_variant_stats` (V2 computes metrics in application layer via direct queries)
  - **Indexes**: pending claim, heartbeat staleness, variant-by-run, arena leaderboard, experiment status, archived filter, logs by run, strategy config_hash unique
  - **FKs**: runs.prompt_id → topics, runs.experiment_id → experiments (nullable), runs.strategy_config_id → strategy_configs (nullable), arena entries → topics + runs
  - No budget_events, no cost_baselines, no separate elo table, no experiment_rounds. Comparisons table IS included (minimal, for Match History tab).
  - **RLS policy**: Enable RLS on all 9 tables. All tables get `USING (false)` default-deny policy (no direct row access). All data access goes through SECURITY DEFINER RPCs (which bypass RLS) or service_role key (which bypasses RLS). This ensures anon/authenticated users cannot read or write evolution data directly. If future client-side reads are needed, add explicit SELECT policies per table.
  - **RPC input validation**: `sync_to_arena` validates JSONB array params: `p_entries` max 200 elements, `p_matches` max 1000 elements. Raises exception on oversized input. (`p_elo_rows` is removed — elo is embedded in p_entries.) All RPCs validate required fields are non-null before processing.

**Scripts to delete** (4 files, ~988 LOC):
- `evolution/scripts/backfill-prompt-ids.ts` (339 LOC) — V1 data migration
- `evolution/scripts/backfill-experiment-metrics.ts` (247 LOC) — V1 checkpoint backfill
- `evolution/scripts/backfill-diff-metrics.ts` (243 LOC) — V1 diff backfill
- `evolution/scripts/audit-evolution-configs.ts` (159 LOC) — V1 config validation

**CI workflows to update**:
- `.github/workflows/supabase-migrations.yml` — Remove `backfill-prompt-ids.ts` from path triggers and deploy steps **before** deleting the script file (CI must not reference a deleted file — remove from workflow first, merge, then delete the script in a follow-up commit). Review orphan/duplicate repair logic (designed for incremental migrations, may need simplifying after collapse to single seed).
- `.github/workflows/ci.yml` — M9 mass-deletion PR should run full test suite (not `--changedSince`) to validate transition. Add `supabase db reset` dry-run step (path-filtered to `supabase/migrations/`).
- `.github/workflows/migration-reorder.yml` — Keep for now (V1 migrations still exist in history). Remove only after confirming no other non-evolution migrations depend on reorder logic.
- `jest.config.js` — Coverage threshold recalibration: delete V1 production code and tests in the SAME PR (never delete tests without their production code). Run full suite, record new baseline, set thresholds at baseline minus 5%. Include `jest.config.js` changes in the PR to trigger full CI (not `--changedSince`).

**Scripts to defer** (6 files, ~1,747 LOC — move to `evolution/scripts/deferred/`):
- Arena scripts: `add-to-arena.ts`, `add-to-bank.ts`, `run-arena-comparison.ts`, `run-bank-comparison.ts`
- Experiment scripts: `run-prompt-bank.ts`, `run-prompt-bank-comparisons.ts`
- Plus `lib/arenaUtils.ts`
- Plus associated test files: `run-prompt-bank.test.ts`, `run-prompt-bank-comparisons.test.ts`, `run-bank-comparison.test.ts`, `run-arena-comparison.test.ts`, `lib/arenaUtils.test.ts`
- Update `jest.config.js` `testPathIgnorePatterns` to exclude `deferred/` directory. Update `tsconfig.json` exclude (or add a `deferred/tsconfig.json`) so deferred scripts don't block main `tsc --noEmit`.

**Scripts to keep and simplify** (3 files, ~1,553 LOC → ~800 LOC):
- `evolution-runner.ts` (425→200 LOC) — Remove checkpoint/resume/continuation logic, simplify to: claim → resolve content → call evolveArticle → persist
- `run-evolution-local.ts` (811→400 LOC) — Remove checkpoint expansion, bank logic, outline mutation; keep core: seed → run pipeline → print result
- `lib/oneshotGenerator.ts` (317 LOC) — Keep as-is

**Test strategy**:
- **Schema verification**: Run `supabase db reset` with new migration; then run automated SQL assertions against `information_schema.tables` and `information_schema.columns` to verify all 9 tables created with correct columns (not just exit-code success). Verify all indexes exist via `pg_indexes`. Verify FKs enforce referential integrity. Also test `supabase db push --dry-run` against a linked remote to verify the prod deployment path (push, not just reset). Note: `supabase db reset` has no `--dry-run` flag — use `supabase db push --dry-run` for that purpose.
- **RPC test cases**:
  - `claim_evolution_run`: (1) Two concurrent claims on same pending run — only one succeeds (SKIP LOCKED). (2) Claim updates status to `running` and sets `claimed_by`. (3) No pending runs returns null gracefully.
  - `sync_to_arena`: (1) Upsert new entries — verify elo_rating + match_count populated. (2) Upsert existing entries — verify idempotent (no duplicates). (3) Match results inserted to comparisons table with correct FKs. (4) Oversized JSONB array (>200 entries) raises exception. (5) FK violation: nonexistent topic_id in p_entries raises FK constraint error (entry must reference existing arena_topics row).
  - `update_strategy_aggregates`: (1) After run finalization, run_count incremented and avg_final_elo recalculated. (2) Null strategy_config_id on run — no-op, no error.
- **Negative / idempotency tests**: (1) Migration is idempotent — running it twice doesn't error (DROP IF EXISTS). (2) RPC called with invalid FK (nonexistent run_id) returns appropriate error. (3) Anon key cannot call any of the 3 RPCs (REVOKE verified). (4) Direct table INSERT/SELECT with anon key blocked by RLS.
- **Deferred scripts**: Verify deferred/ scripts still compile (`tsc --noEmit` on deferred directory) and their test files are excluded from `jest` default run via `testPathIgnorePatterns`.
- **CI**: Use `DROP TABLE IF EXISTS ... CASCADE` in migration to handle FK dependencies.

**Done when**:
- V1 migration files kept in place (already applied in DB history)
- 1 new migration drops V1 tables + creates V2 schema (9 tables + 3 RPCs)
- `supabase db reset` succeeds on fresh database
- 4 obsolete scripts deleted
- 6 deferred scripts moved to `deferred/` directory
- Runner scripts simplified (checkpoint/resume logic removed)
- RLS enabled on all 9 tables with default-deny policies
- Anon key cannot call RPCs or access tables directly (verified by test)
- `supabase db push` succeeds against fresh project (prod path verified)
- Deferred scripts excluded from jest + tsc main runs
- Total LOC removed: ~2,530 (migrations) + ~988 (scripts deleted) + ~753 (scripts simplified) = ~4,271 LOC

**Depends on**: Milestone 1 (V2 types define the schema requirements). Can run in parallel with M2-M6.

---

### Milestone 11: V2.1 Arena (Simplified Leaderboard)
**Goal**: Build a streamlined Arena for comparing text variants across prompts — 3 tables (topics + entries with merged Elo + minimal comparisons), 8 server actions, 2 config-driven admin pages.

**Context** (from 3 rounds of Arena/Experiments research, 12 agents):
- Arena is fundamentally "a leaderboard of variants per prompt, ranked by Elo"
- V1 has 4 tables (topics, entries, comparisons, elo) — V2.1 merges elo into entries (no separate elo table), keeps minimal comparisons table for Match History
- V1 has 14 server actions (6 dead) — V2.1 needs 8
- Pipeline integration simplifies: prompt_id required upfront (no auto-resolution fallbacks)
- Topics = prompts (same table: `evolution_arena_topics`)

**Key simplification**: Require `prompt_id` set BEFORE run starts. For explanation-based runs (explanation_id set), auto-create a topic from the explanation title at run creation time (before pipeline starts, not inside it). For prompt-based runs, prompt_id is provided directly. DB enforced: `evolution_runs.prompt_id UUID NOT NULL REFERENCES evolution_arena_topics(id)`. **Note**: V1 migration 20260215000001 explicitly reverted NOT NULL on prompt_id because "explanation-based runs have no prompt_id". V2's M10 seed migration drops and recreates evolution_runs with NOT NULL — this is safe in the clean-slate approach (no existing runs preserved). Eliminates `autoLinkPrompt()` with its 3 in-pipeline fallback strategies — resolution happens once at run creation, not during finalization. Also eliminates `resolveTopicId()` from `arenaIntegration.ts`. **Sequencing**: `pipeline.ts` (deleted in M9) is the primary caller of `autoLinkPrompt`. M11 can only delete `autoLinkPrompt` from `arenaIntegration.ts` after M9 deletes `pipeline.ts` — otherwise the import reference breaks `tsc --noEmit`. Verify via grep before deletion.

**Files to create**:
- `evolution/src/lib/v2/arena.ts` (~150 LOC) — Core Arena functions:
  - `loadArenaEntries(promptId, supabase)` — Load existing arena entries into pool with preset ratings (mu/sigma). Entries marked `fromArena: true` so they're filtered from variant persistence but participate in ranking. **V1 signature delta**: V1's `arenaIntegration.ts` has a different signature for its equivalent function. All call sites (evolve-article.ts M3, finalize.ts M5) must use V2's new signature — there are no shared call sites with V1's version.
  - `syncToArena(runId, promptId, pool, ratings, matchHistory, supabase)` — Full sync via `sync_to_arena` RPC:
    - **Type contracts**: `pool: TextVariation[]` (from types.ts), `ratings: Map<string, { mu: number; sigma: number }>` (OpenSkill rating objects keyed by variant ID), `matchHistory: Array<{ entryA: string; entryB: string; winner: 'a' | 'b' | 'draw'; confidence: number }>` (same shape as comparisons table minus run_id/created_at which are added server-side)
    1. **New variants**: All non-arena variants (`pool.filter(v => !v.fromArena)`) upserted as arena entries (content, generation_method, model, cost, elo_rating)
    2. **Match history**: All pairwise comparison results from the run (entry_a, entry_b, winner, confidence) — includes matches involving arena-loaded variants
    3. **Elo updates for ALL entries**: Updated mu/sigma/elo_rating for both new AND existing arena entries that participated in this run's ranking. This means existing arena entries get their ratings refined by competing against new variants.
  - No `autoLinkPrompt`, no `resolveTopicId`, no `findOrCreateTopic`

**Server actions** (8, down from 14 — all use `adminAction` factory from M7 for auth enforcement + error handling). **Scope note**: V1's `arenaActions.ts` has 13+ references to the separate `evolution_arena_elo` table (selects, inserts, upserts). These are all replaced in V2 by direct reads/writes to the `elo_rating` and `match_count` columns on `evolution_arena_entries`. The entire arenaActions.ts file is rewritten (not patched) in M11.
- `getArenaTopicsAction` — List topics with entry counts + Elo range
- `getArenaEntriesAction(topicId)` — Ranked entries (replaces both getEntries + getLeaderboard)
- `runArenaComparisonAction(topicId, entryAId, entryBId)` — Single-pair LLM compare + update Elo. Server-side: `elo_rating` computed from mu via `toEloScale()` inside the RPC. Match_count incremented server-side. **Rate limit**: max 10 comparisons per topic per minute — enforced via DB-backed timestamps (INSERT comparison timestamp, COUNT recent comparisons via `SELECT count(*) FROM evolution_arena_comparisons WHERE topic_id = $1 AND created_at > now() - interval '1 minute'`). In-memory rate limiting is ineffective in serverless (cold starts reset state).
- `runArenaBatchComparisonAction(topicId, rounds)` — Swiss-paired batch comparison: runs N rounds of info-maximizing pairwise comparisons across all entries in a topic. **Swiss pairing extraction**: Extract `swissPairing()` from V1's `evolution/src/lib/agents/tournament.ts` (line 68, currently private module-level function with 4 params: `pool, ratings, completedPairs, topK`). Refactor to accept entry arrays + rating maps + empty Set for completedPairs. V2 arena.ts adapter converts DB entry rows to the expected TextVariation-like shape. Batch action loads entries from DB, builds ephemeral rating map, calls swissPairing per round. **Rate limit**: max 1 batch per topic per 5 minutes (DB-backed, same pattern as single comparison). Essential for automated arena evaluation after pipeline sync.
- `upsertArenaEntryAction` — Add/update entry (replaces addToArena + generateAndAdd). Input validation: content max 50KB (enforced at Zod schema level: `z.string().max(50 * 1024)`), generation_method from allowed enum. **Note**: V1 arenaActions.ts lacked this Zod-level cap — it must be added in V2, not just as a handler-level check.
- `deleteArenaEntryAction(entryId)` — NEW V2 soft-delete (sets `archived_at` timestamp). Replaces V1 `deleteArenaEntryAction` which was a hard delete — same name, rewritten implementation.
- `archiveArenaTopicAction` — Soft archive topic (sets `archived_at`, does NOT cascade to entries — entries remain for historical leaderboard, topic hidden from active list)
- `createArenaTopicAction` — New topic. Input validation: name max 200 chars, trimmed, non-empty.

**Admin pages** (2 pages, ~100 LOC config total using M8 components):
- Arena list — RegistryPage config: topic name, entry count, Elo range, best method, status filter (~45 LOC)
- Arena topic detail — EntityDetailPageClient config: 2 tabs (Leaderboard, Match History). No scatter chart, no text diff, no coverage grid — defer to later (~55 LOC). **Feature regression**: V1 topic detail page is 937 LOC with 4 tabs (Leaderboard, Coverage Grid, Scatter Chart, Match History). V2.1 drops Coverage Grid and Scatter Chart tabs intentionally — these are analytics features that can be re-added later if needed. Acknowledge in PR description.
- Drop entry detail page (use modal drill from leaderboard instead)

**Pipeline integration** (called from evolve-article.ts):
- At start: `loadArenaEntries(promptId, supabase)` → add existing arena entries to pool with preset ratings (fromArena: true). These compete naturally alongside new variants during ranking.
- At end: `syncToArena(runId, promptId, pool, ratings, matchHistory, supabase)` → atomic sync of:
  - All new variants (not fromArena) as arena entries
  - Full match history (all comparisons, including those involving arena entries)
  - Updated elo for ALL pool entries (new + existing arena entries get refined ratings)
  - This means the arena is a continuous rating space — each run refines existing ratings AND adds new contenders.
- **fromArena filtering in finalize.ts (M5 cross-ref)**: finalize.ts persists variants to `evolution_variants` table. Arena-loaded entries (`fromArena: true`) must NOT be persisted as new variant rows — they already exist in the arena. finalize.ts filters: `pool.filter(v => !v.fromArena)` before upserting to `evolution_variants`. The `fromArena` flag is a field on `TextVariation` type (added in M1 types.ts), set by `loadArenaEntries`, consumed by both `finalize.ts` and `syncToArena`.
- **Strategy column for manual entries**: Entries added manually (no linked run) show strategy as "Manual" in leaderboard. Join `entry.run_id → run.strategy_config_id → strategy.name` returns null for manual entries; UI renders "Manual" fallback.

**Test strategy** (~180 LOC across 2 test files, 15 unit tests + 2 E2E + 2 integration):
- arena.test.ts (~120 LOC, 10 tests): (1) loadArenaEntries returns entries with fromArena=true and preset mu/sigma, (2) loadArenaEntries with empty topic returns empty array, (3) syncToArena filters out fromArena entries from upsert payload, (4) syncToArena includes all match history (arena + new), (5) syncToArena updates elo for existing arena entries, (6) syncToArena calls RPC with correct JSONB structure, (7) syncToArena with empty pool is no-op, (8) swissPair produces info-maximizing pairs from rating map, (9) swissPair handles <2 entries gracefully, (10) rate limit rejects rapid successive comparison calls
- arena-actions.test.ts (~120 LOC, 10 tests): (1) getArenaTopicsAction returns entry counts, (2) getArenaEntriesAction returns sorted by elo, (3) upsertArenaEntryAction validates content size, (4) deleteArenaEntryAction sets archived_at, (5) createArenaTopicAction validates name length, (6) runArenaComparisonAction updates elo + records match, (7) runArenaComparisonAction rate limit rejects when >10/min (DB-backed check), (8) runArenaBatchComparisonAction runs N rounds with Swiss pairing, (9) runArenaBatchComparisonAction rate limit rejects within 5-min window, (10) archiveArenaTopicAction sets archived_at without cascading to entries
- **E2E** (~60 LOC, 3 tests): Arena list page renders topics with entry counts; Arena detail page renders leaderboard tab with entries sorted by Elo; **NOTE**: existing V1 E2E file `admin-arena.spec.ts` tests V1 features (scatter chart, text diff, coverage grid, separate elo table) — must be fully rewritten for V2.1, not patched. Include E2E rewrite in M11 scope.
- **Integration** (3 tests): (1) create topic → add 3 entries → runArenaComparison → verify Elo updated + match history recorded, (2) anon key cannot call sync_to_arena RPC (REVOKE verified — requires M10 migration applied first), (3) finalize.ts fromArena filtering: run with arena-loaded entries → verify only non-fromArena variants persisted to evolution_variants (no duplicate rows)

**Done when**:
- Arena tables populated via seed migration (M10)
- 8 server actions working (including batch comparison)
- loadArenaEntries + syncToArena integrated into evolveArticle
- finalize.ts filters out `fromArena` variants before persisting (no duplicate rows)
- 2 admin pages render with config-driven components
- 20 unit tests + 3 E2E tests + 3 integration tests passing
- Existing V1 E2E file `admin-arena.spec.ts` fully rewritten for V2.1
- V1 `arenaIntegration.ts` replaced by V2 `arena.ts` (autoLinkPrompt, resolveTopicId eliminated)
- Dead arena actions (6) deleted after consuming pages replaced
- `tsc --noEmit` passes after deletions (verify zero stale imports)
- Grep verification: no remaining imports of deleted V1 actions outside deferred/ directory
- Integration test verifies anon key CANNOT call sync_to_arena RPC (REVOKE verified)

**Depends on**: Milestone 3 (evolveArticle exists), Milestone 5 (admin UI + finalize.ts fromArena filter), Milestone 8 (config-driven UI components), Milestone 10 (arena tables in seed)

**Strategy integration**: Arena entries display strategy label (from linked run → strategy_config_id → strategy name). Arena leaderboard includes strategy column so users can see which strategy produced which entry. Manual entries (no run) render "Manual" fallback.

**V1 code eliminated**: 14→8 server actions (~450 LOC). M11 fully rewrites `arenaActions.ts` (not patched from M7's adminAction refactor) — M7 migrated the wrappers but kept all actions; M11 deletes the 6 dead ones and rewrites the 8 kept ones to use V2's merged-elo schema. Delete the 6 deferred "dead" V1 arena actions from M7 (getPromptBankCoverageAction, getPromptBankMethodSummaryAction, getArenaLeaderboardAction, getCrossTopicSummaryAction, deleteArenaEntryAction, deleteArenaTopicAction) — safe to delete now because M11 replaces the consuming pages. Note: V2 `deleteArenaEntryAction` is a NEW implementation (soft-delete via archived_at), not the V1 action retained. Also: separate elo table + comparisons table, autoLinkPrompt + resolveTopicId (~200 LOC), 3 admin pages (~1,802 LOC) → 2 config-driven pages (~100 LOC)

---

### Milestone 12: V2.2 Experiments (Simplified Batches)
**Goal**: Build a lightweight experiment system — "a labeled batch of runs against the same prompt" with 1 table, 5 server actions, no cron driver, synchronous metrics.

**Context**:
- An experiment is just `{ name, prompt_id, status, runs[] }` — no L8 factorial design, no rounds, no bootstrap CIs, no LLM reports. Per-experiment budget enforcement intentionally dropped (V2 runs are <$1 each, budget enforced per-run by cost tracker). If budget caps are needed later, add `budget_cap_usd` column.
- V1 has 17 server actions — V2.2 needs 5
- V1 requires cron driver for state transitions — V2.2 auto-completes via application-level check in finalize.ts when last run finishes
- Metrics (maxElo, cost, eloPer$) computed synchronously on page load, not async via cron

**Experiments table schema** (created in M10 seed migration, consumed here):
```sql
CREATE TABLE evolution_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  prompt_id UUID NOT NULL REFERENCES evolution_arena_topics(id),  -- NOT evolution_prompts (V2 uses arena_topics as prompts)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS enabled, admin-only policy (matches all other evolution_* tables):
ALTER TABLE evolution_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access" ON evolution_experiments FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
```
- `evolution_runs.experiment_id UUID REFERENCES evolution_experiments(id)` — nullable FK added in M10 seed. Runs without experiments have `experiment_id = NULL`. This is the join key used by auto-completion and metrics queries.

**Security & validation** (all actions wrapped by M7 `adminAction` factory which enforces admin auth):
- `createExperimentAction`: validates name (1-200 chars, trimmed), promptId (UUID format + FK existence check via SELECT before INSERT). Name uniqueness not enforced (multiple experiments per prompt expected).
- `addRunToExperimentAction`: validates experimentId exists and status is 'pending' or 'running' (rejects if 'completed'/'cancelled'). Config validated by existing run config schema from M4.
- `cancelExperimentAction`: admin-only (no per-user ownership — all experiments are shared admin resources, consistent with runs/prompts/strategies). Updates experiment status + bulk-updates runs in `status IN ('pending', 'claimed', 'running')` to 'failed' (not just pending — running runs should also be stopped to prevent them from auto-completing a cancelled experiment).
- No per-user ownership model — experiments are admin-scoped resources, same as all other evolution entities. All access gated by `requireAdmin` middleware + `adminAction` factory.

**Key simplification**: Eliminate the `analyzing` state. When last run completes → experiment auto-transitions to `completed` via application-level check in finalize.ts (idempotent, testable). No cron needed, no DB trigger.

**Files to create**:
- `evolution/src/lib/v2/experiments.ts` (~100 LOC) — Core functions:
  - `createExperiment(name, promptId, supabase)` — Insert experiment row
  - `addRunToExperiment(experimentId, config, supabase)` — Create run with experiment_id FK, auto-transition pending→running on first run
  - `computeExperimentMetrics(experimentId, supabase)` — Synchronous: query completed runs for this experiment. Elo: read winner's `elo_score` from `evolution_variants` where `is_winner = true AND run_id = $runId` (NOT from `evolution_runs.elo_rating` which does not exist — winner elo is persisted by finalize.ts to evolution_variants). Alternatively, M10 can add `winner_elo NUMERIC` column to `evolution_runs` and have finalize.ts populate it. Cost: read from `run_summary JSONB -> 'totalCost'` (NOT `evolution_runs.total_cost` — actual column stores cost inside run_summary JSONB, or as `total_cost_usd`). Computes maxElo, totalCost, eloPer$ (elo/cost) per run. Returns `{ maxElo, totalCost, runs: [{runId, elo, cost, eloPer$}] }`. No bootstrap, no cron.

**Server actions** (5, down from 17):
- `createExperimentAction(name, promptId)` — Create experiment
- `addRunToExperimentAction(experimentId, config)` — Add run (auto-transitions pending→running)
- `getExperimentAction(experimentId)` — Detail with runs + inline metrics
- `listExperimentsAction(status?)` — List with filter
- `cancelExperimentAction(experimentId)` — Cancel + bulk-fail pending, claimed, and running runs

**Eliminated**: archiveExperiment, unarchiveExperiment, startManualExperiment, regenerateReport, getExperimentName, renameExperiment, getExperimentMetrics (separate), getStrategyMetrics, getRunMetrics (separate), getActionDistribution, deleteExperiment

**Admin pages** (2 pages, ~100 LOC config total using M8 components):
- Experiments list — RegistryPage config: name, prompt, status, run count, best Elo, cost, create button opens FormDialog (~40 LOC)
- Experiment detail — EntityDetailPageClient config: 2 tabs (Overview with MetricGrid, Runs with RelatedRunsTab). No Analysis card, no Report tab, no Action Distribution (~60 LOC)
- Start experiment becomes a FormDialog on list page (not a separate page): name, prompt dropdown, config, run count (~30 LOC FormDialog config)

**Experiment auto-completion** (application-level, not DB trigger):
- **Integration point**: M5's finalize.ts implements the atomic NOT EXISTS auto-completion query directly (see M5 spec). M12 does NOT modify or replace finalize.ts auto-completion — it is already correct when M5 ships. M12's scope for auto-completion is: (1) verifying the integration tests pass with real Supabase, (2) ensuring the `updated_at` column is populated by the UPDATE query. No stub pattern needed.
- After finalize.ts persists run results and marks status='completed', it checks `run.experiment_id` (nullable FK on evolution_runs, added in M10). If set, executes the atomic auto-complete query:
- At end of `finalize.ts` (M5): if `run.experiment_id` is set, use a single atomic query to avoid TOCTOU race:
  ```sql
  UPDATE evolution_experiments SET status = 'completed'
  WHERE id = $1 AND status = 'running'
    AND NOT EXISTS (
      SELECT 1 FROM evolution_runs
      WHERE experiment_id = $1
        AND status IN ('pending', 'claimed', 'running')
    )
  ```
  The single query is atomic — no gap between count and update. The `AND status = 'running'` guard makes it idempotent. Simpler than a DB trigger, easier to test, no heartbeat-induced spurious fires.

**Test strategy** (~120 LOC, 15 test cases in `experiments.test.ts`):
- **Unit tests** (8): createExperiment inserts row with correct fields; addRunToExperiment creates run with FK + transitions experiment pending→running; addRun rejects if experiment completed/cancelled; computeMetrics returns correct maxElo/totalCost/eloPer$; computeMetrics handles zero runs (returns nulls); cancelExperiment sets cancelled + bulk-fails pending/claimed/running runs; cancel is no-op on already-completed; createExperiment rejects empty/overlength name.
- **Integration tests** (4): full lifecycle (create → add 3 runs → complete each via finalize.ts writing elo_rating+total_cost → verify auto-complete + metrics); concurrent finalize calls idempotent (both attempt auto-complete, one succeeds, no error); cancel mid-experiment with mix of pending/running runs; add run to experiment then cancel — verify run status also updated.
- **E2E** (3): list page renders columns (name, status, run count, Elo); detail page renders Overview + Runs tabs; create experiment via FormDialog → verify appears in list.
- Auto-completion SQL tested against real Supabase (not mocked) to verify NOT EXISTS atomicity.

**Done when**:
- Experiments table populated via seed migration (M10)
- 5 server actions working
- Application-level auto-completion works (finalize.ts checks sibling runs, marks experiment completed)
- Metrics computed synchronously (maxElo, cost, eloPer$ per run)
- 2 admin pages render with config-driven components
- Integration test: create → add runs → complete → auto-complete → metrics passes
- Experiment cron driver deleted: route file (`/api/cron/experiment-driver`), test file, AND `vercel.json` cron entry removed
- Dead experiment actions (3) deleted: `archiveExperimentAction`, `unarchiveExperimentAction`, `startManualExperimentAction` — safe because M12 replaces consuming pages
- `tsc --noEmit` passes after all deletions (verify zero stale imports)

**Depends on**: Milestone 3 (evolveArticle for creating runs), Milestone 5 (admin UI), Milestone 8 (config-driven UI components), Milestone 10 (experiments table in seed)

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
├── proximity.ts          (80 LOC)   — Diversity tracking (optional)
├── reflect.ts            (120 LOC)  — Quality critique (optional)
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
    ├── proximity.test.ts      — M6: 7 tests
    ├── reflect.test.ts        — M6: 9 tests
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
| Dead server actions (10) | ~500 | Deleted in M11/M12 (when consuming UI pages replaced) |
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

This is a **clean-slate rebuild**, not a coexistence migration. After M10 runs (`supabase db reset`), V1 schema is gone and V1 code cannot execute.

**Sequencing**:
1. Build V2 code (M1–M6) and tests alongside V1 code in `evolution/src/lib/v2/`
2. Verify V2 works end-to-end with mock LLM (smoke tests, integration tests)
3. Run M10: apply V2 migration (DROPs V1 tables + creates V2 schema), delete obsolete scripts. **This is the point of no return** — all historical data is dropped. V1 migration files stay in place (already applied in DB history).
4. Deploy V2 runner code (M4/M5). All new runs use V2.
5. Clean up V1 code at leisure (M7–M9).

**Rollback**: If V2 has critical bugs after M10, rollback is via git: revert to the pre-M10 commit, restore V1 migrations, `supabase db reset` with V1 schema. Historical data is already gone (accepted as clean-slate trade-off).

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
| Page tests (with M8) | 2,517 | 750 | -1,767 |
| Script tests | 2,464 | 600 | -1,864 |
| API route tests | 1,114 | 512 | -602 |
| Remaining (service tests, component tests, other) | ~14,245 | ~4,148 | ~-10,097 |
| **Total** | **~42,000** | **~9,600** | **~-32,400 (77%)** |

After M11/M12 (arena/experiment rewrites): **~5,500 LOC (87% total reduction)**

### Reusable V1 Tests (unchanged, verified clean — zero V1 abstraction imports)
- rating.test.ts (255), comparison.test.ts (215), comparisonCache.test.ts (186), formatValidator.test.ts (131), formatValidationRules.test.ts (224), reversalComparison.test.ts (103), textVariationFactory.test.ts (54), strategyConfig.test.ts (548), errorClassification.test.ts (98)

### New V2 Tests (per milestone)
- M1: V2 types compile; reused V1 module tests pass
- M2: Each helper function tested independently with mock LLM
- M3: End-to-end smoke test (seed → 3 iterations → winner); cost tracking; invocations
- M4: Full lifecycle test (claim → execute → persist → complete)
- M5: V2 run appears in admin UI
- M6: Diversity + critique integration
- M7: adminAction factory tests (~10 tests); verify all existing service tests pass with refactored wrappers (same signatures)
- M8: RegistryPage, EntityDetailPageClient, FormDialog, ConfirmDialog, StatusBadge unit tests; E2E for refactored pages
- M9: Delete 28+ V1 test files; write V2 tests; centralize mocks; consolidate integration tests

### Smoke Test
3-iteration mini pipeline with mock LLM + mock Supabase: seed article → generate 3 → rank → evolve → repeat 2 more iterations → verify pool grows, ratings converge, winner identified, costs tracked per phase, invocation rows created

## Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Historical data loss | Accepted | Intentional clean slate — no export needed |
| No checkpointing = lost work on crash | Low | Runs are <$1 and <10 min; just re-run |
| V2 critical bug after M10 | Medium | Git revert to pre-M10 commit + `supabase db reset` with V1 migrations |
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
