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
  handler: (input: TInput, supabase: SupabaseClient) => Promise<TOutput>
) { /* auth + logging + error handling */ }

// Each action becomes 1-5 lines:
export const getPromptsAction = adminAction('getPrompts', async (filters, supabase) => {
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
- `evolution/src/lib/v2/types.ts` (~140 LOC) — Minimal types: TextVariation (id, text, strategy, parentIds, iterationBorn, version), Rating, Match, EvolutionConfig (iterations, variantsPerRound, budgetUsd), StrategyConfig (name, config JSONB, config_hash)

**Files to reuse from V1 (import directly, no changes)**:
- `evolution/src/lib/core/rating.ts` — createRating, updateRating, updateDraw, toEloScale (78 LOC)
- `evolution/src/lib/comparison.ts` — compareWithBiasMitigation, parseWinner (146 LOC)
- `evolution/src/lib/core/reversalComparison.ts` — run2PassReversal (40 LOC)
- `evolution/src/lib/core/comparisonCache.ts` — ComparisonCache (96 LOC)
- `evolution/src/lib/agents/formatValidator.ts` — validateFormat (89 LOC)
- `evolution/src/lib/agents/formatRules.ts` — FORMAT_RULES (15 LOC)
- `evolution/src/lib/core/textVariationFactory.ts` — createTextVariation (26 LOC)
- `evolution/src/lib/core/strategyConfig.ts` — Fork `hashStrategyConfig()` and `labelStrategyConfig()` (~80 LOC) into V2's `strategy.ts`. The original file has transitive imports to V1's full types.ts (AgentName union) and llmClient.ts (EVOLUTION_DEFAULT_MODEL). V2 forks only the hash + label functions, replacing V1 type imports with V2 equivalents.

**Test strategy**: Rerun V1 tests for all reused modules; write V2 type tests

**Import strategy**: V2 barrel (`evolution/src/lib/v2/index.ts`) re-exports all V1 reused modules. Consumers always import from `@evolution/lib/v2/` — never from V1 paths directly. This creates a single import surface. V1 barrel (`evolution/src/lib/index.ts`) remains untouched for any V1 code still running.

**Done when**: V2 types defined; all reused V1 module tests pass; V2 barrel re-exports V1 modules; V2 can import and call compareWithBiasMitigation, updateRating, validateFormat, createTextVariation, hashStrategyConfig via `@evolution/lib/v2/`

**Depends on**: None

---

### Milestone 2: Helper Functions (Generate, Rank, Evolve)
**Goal**: Implement the three core helper functions as standalone, independently testable async functions.

**Files to create**:
- `evolution/src/lib/v2/generate.ts` (~100 LOC) — `generateVariants(text, llm, config): Promise<TextVariation[]>`
  - 3 strategies in parallel (structural_transform, lexical_simplify, grounding_enhance)
  - Calls validateFormat, createTextVariation
  - Prompt templates from V1 generationAgent.ts

- `evolution/src/lib/v2/rank.ts` (~400 LOC) — `rankPool(pool, ratings, matchCounts, llm, config): Promise<{matches, ratingUpdates}>`
  - **Triage phase**: New entrants (sigma >= 5.0) matched against stratified opponents (2 top quartile, 2 mid, 1 bottom). Adaptive early exit: skip remaining opponents if avg confidence >= 0.7. Sequential elimination: variants where `mu + 2*sigma < top20%Cutoff` are dropped from fine-ranking.
  - **Fine-ranking phase**: Swiss pairing scored by `outcomeUncertainty * sigmaWeight` — maximize information gain per comparison. `outcomeUncertainty = 1 - |2*pWin - 1|` using logistic CDF from OpenSkill model. Greedy pair selection, skipping already-played pairs.
  - **Draw handling**: Confidence < 0.3 → treated as draw → `updateDraw()` instead of `updateRating()`.
  - **Convergence detection**: Stops when all eligible variant sigmas < 3.0 for 2 consecutive rounds, or no new pairs remain.
  - **Budget pressure tiers**: Low (<50% spent) → up to 40 comparisons. Medium (50-80%) → up to 25. High (>80%) → up to 15.
  - Uses compareWithBiasMitigation from V1 (2-pass reversal). V1's comparison.ts takes a `callLLM: (prompt: string) => Promise<string>` callback — rank.ts wraps V2's `EvolutionLLMClient.complete()` as this callback: `(prompt) => llm.complete(prompt, 'ranking')`.
  - Returns: `{ matches: Match[], ratingUpdates: Record<id, Rating>, matchCountIncrements: Record<id, number> }`

- `evolution/src/lib/v2/evolve.ts` (~120 LOC) — `evolveVariants(pool, ratings, llm, config): Promise<TextVariation[]>`
  - Select top-rated parents
  - Mutate (clarity, structure) + crossover
  - Optional creative exploration trigger
  - Calls validateFormat, createTextVariation

**Files to reuse from V1**: Prompt templates, Swiss pairing logic, opponent selection

**Test strategy**:
- generate.test.ts: Test 3 strategies produce 3 variants. Test format validation failure → variant discarded (returns fewer variants, does NOT retry). Test all 3 fail format → returns empty array. Test budget exhaustion mid-generation.
- rank.test.ts (~300 LOC, 20+ tests): Dedicated tests for each algorithm path: (1) triage with stratified opponents, (2) adaptive early exit at confidence >= 0.7, (3) sequential elimination when mu+2σ < cutoff, (4) Swiss pairing scored by outcomeUncertainty × sigma, (5) draw handling (confidence < 0.3), (6) convergence detection (2 consecutive rounds), (7) budget pressure tiers (low/med/high). Comparable to V1's rankingAgent.test.ts coverage.
- evolve.test.ts: Test parent selection from top-rated. Test crossover with 2 parents. Test format validation failure → variant discarded. Test creative exploration trigger.
- Composition test: generate output → rank → verify ratings updated correctly.

**Done when**: Each function works standalone with mocked LLM; unit tests pass (including format validation failure paths); rank.ts has 20+ tests covering all algorithm paths; functions compose correctly (generate output feeds into rank)

**Depends on**: Milestone 1

---

### Milestone 3: The Main Function + Cost Tracking
**Goal**: Implement the single `evolveArticle()` function that orchestrates generate→rank→evolve in a flat loop, with per-phase cost tracking and invocation logging.

**Files to create**:
- `evolution/src/lib/v2/evolve-article.ts` (~200 LOC) — The core function:
  ```typescript
  async function evolveArticle(
    originalText: string,
    llm: EvolutionLLMClient,
    db: SupabaseClient,
    runId: string,
    config: { iterations: number; variantsPerRound: number; budgetUsd: number }
  ): Promise<{ winner: TextVariation; pool: TextVariation[]; totalCost: number }>
  ```
  - Local state: `pool` array, `ratings` Map, `matchHistory` array
  - Loop body: generate → rank → evolve (calling M2 helpers)
  - Per-phase invocation logging: `createInvocation()` / `updateInvocation()`
  - Budget check after each phase via `costTracker.canAfford()`
  - Kill detection: check run status from DB at iteration boundary. Accepted latency: if killed mid-ranking (up to 40 comparisons), the current iteration completes before exit. Worst case: ~$0.20 of wasted LLM calls. Mid-phase kill checks not implemented (same as V1).
  - **Transient error retry**: LLM calls wrapped with retry-on-transient (rate limits, socket timeouts, 5xx). Uses `isTransientError()` from V1's `errorClassification.ts`. Exponential backoff (1s, 2s, 4s), max 3 retries. Non-transient errors fail immediately.

- `evolution/src/lib/v2/cost-tracker.ts` (~100 LOC) — Budget-aware cost tracker with reserve-before-spend
  - `reserve(phase, estimatedCost): void` — Checks `totalSpent + totalReserved + (estimate * 1.3) > budgetUsd` → throws `BudgetExceededError`. The 1.3x safety margin (from V1) prevents cost underestimation from blowing budget. Atomically increments `totalReserved`.
  - `recordSpend(phase, actualCost): void` — Deducts from `totalReserved`, adds to `totalSpent`.
  - `release(phase, estimatedCost): void` — On LLM failure: deducts from `totalReserved` without spending.
  - `getTotalCost()`, `getPhaseCosts()`, `getAvailableBudget()`
  - Budget flow: `reserve(est)` → LLM call → `recordSpend(actual)`. On error → `release(est)`.
  - Parallel safety: 3 concurrent generate calls each `reserve()` synchronously before any await — all 3 reserves succeed or the last throws BudgetExceededError. Node.js single-thread guarantees atomic check+increment within one event loop tick.

- `evolution/src/lib/v2/invocations.ts` (~50 LOC) — Invocation row helpers
  - `createInvocation(runId, iteration, phaseName)` → UUID
  - `updateInvocation(id, { cost, variantsAdded, matchesPlayed, executionDetail })`

- `evolution/src/lib/v2/run-logger.ts` (~60 LOC) — Structured run logging
  - `createRunLogger(runId, supabase)` → logger with `info/warn/error/debug` methods
  - Each log entry written to `evolution_run_logs` table: `{ run_id, level, message, context JSONB, created_at }`
  - Fire-and-forget inserts (non-blocking, errors swallowed)
  - Powers the Logs tab in admin UI

**Test strategy**: End-to-end smoke test with mock LLM + mock Supabase (chainable mock from `createSupabaseChainMock()` — same pattern as V1 service tests): seed → 3 iterations → verify pool grows, ratings converge, cost tracked per phase, invocation rows created via mock DB calls. Test budget exhaustion stops early. Test kill detection (mock DB returns `status: 'failed'`). Test cost-tracker reserve/spend/release cycle independently (~10 tests for parallel reserve, overshoot prevention, release on failure).

**Done when**: `evolveArticle()` completes a 3-iteration run with mocked LLM; invocation rows written correctly; cost tracking accurate per phase; budget exhaustion works

**Depends on**: Milestone 2

---

### Milestone 4: Runner Integration
**Goal**: Wire `evolveArticle()` into the run execution lifecycle (claim, execute, persist results), with seed article generation for prompt-based runs and parallel execution support.

**Files to create**:
- `evolution/src/lib/v2/runner.ts` (~200 LOC)
  - `executeV2Run(runId, supabase, llmClient)` — Claim → resolve content → call evolveArticle → persist results
  - Content resolution (2 paths):
    - If `explanation_id` set → fetch article text from `explanations` table
    - If `prompt_id` set (no explanation) → call `generateSeedArticle()` to create title + article from prompt (2 LLM calls)
  - Heartbeat (30s interval via setInterval, cleared in finally)
  - Error handling → markRunFailed with error message
  - On success: persist winner + pool to evolution_variants, update evolution_runs (completed, cost, summary)
  - **Strategy linking**: At run start, resolve or create `strategy_config_id` via `hashStrategyConfig()` (hash dedup — identical configs share one row). At finalization, update strategy aggregates (run_count, avg_final_elo).
  - No checkpointing, no resume logic
  - Supports `--parallel N` flag: claim + execute multiple runs concurrently via `Promise.allSettled` (not `Promise.all` — one failed run must not abort others)
  - **LLM rate limiting**: Shared `LLMSemaphore` caps concurrent LLM API calls across all parallel runs (default 20, configurable via `EVOLUTION_MAX_CONCURRENT_LLM` env var). Integrated INSIDE the `EvolutionLLMClient` wrapper — every `llm.complete()` call acquires the semaphore before calling the underlying LLM and releases after. Helper functions (generate, rank, evolve) don't need to know about the semaphore. Reuse V1's `src/lib/services/llmSemaphore.ts` (~91 LOC).

- `evolution/src/lib/v2/seed-article.ts` (~60 LOC) — Seed article generation for prompt-based runs
  - `generateSeedArticle(prompt, llm): Promise<{ title: string; content: string }>`
  - 2 LLM calls: title generation → article generation
  - Reuse prompt templates from V1 `evolution/src/lib/core/seedArticle.ts`

- `evolution/src/lib/v2/index.ts` (~60 LOC) — Barrel export:
  - `evolveArticle`, `executeV2Run`, `generateSeedArticle`
  - Types: TextVariation, EvolutionConfig, etc.
  - Re-exports of V1 modules (rating, comparison, etc.)

**Files to reuse from V1**:
- `claim_evolution_run` RPC (unchanged)
- Heartbeat pattern from evolutionRunnerCore.ts
- `persistVariants()` from persistence.ts (or simplified version)
- Prompt templates from `evolution/src/lib/core/seedArticle.ts` (67 LOC)

**Test strategy**: Mock claim RPC; mock LLM; test full lifecycle: claim → evolveArticle → persist variants → mark completed. Test error → markRunFailed. Test heartbeat fires. Test prompt-based run: prompt_id set, no explanation → seed article generated → pipeline runs. Test parallel: 3 runs claimed + executed concurrently.

**Done when**: V2 run claimed via RPC, executed, winner persisted to evolution_variants, run marked completed; prompt-based runs generate seed article before pipeline; parallel execution works with `--parallel 3`; watchdog compatible (heartbeat updates)

**Depends on**: Milestone 3

---

### Milestone 5: Admin UI Compatibility
**Goal**: V2 runs visible in existing admin pages without any UI changes. Run archiving and structured logs visible.

**Files to create**:
- `evolution/src/lib/v2/finalize.ts` (~100 LOC) — Persist V2 results in V1-compatible format
  - Build `run_summary` JSONB matching V1 EvolutionRunSummary schema
  - Persist all variants with ratings to evolution_variants
  - Per-phase cost metrics derived from `evolution_agent_invocations` at query time (no separate metrics table needed)

**Files to modify** (minimal):
- `evolution/src/services/evolutionRunnerCore.ts` — Add V2 routing: if `pipeline_version === 'v2'`, call `executeV2Run`. The `pipeline_version` TEXT column is created in the seed migration (M10) with default `'v2'`.

**Run archiving**: `evolution_runs` includes `archived BOOLEAN DEFAULT false`. Runs list filters by `archived = false` by default with "Show archived" toggle. Archive/unarchive via simple UPDATE (no separate action needed — reuse existing pattern).

**Strategy admin page**: Strategies tab in evolution dashboard showing all strategies with name, config hash, run count, avg Elo, presets badge. CRUD: create (with 3 presets: Economy/Balanced/Quality), archive, delete (zero-run only). Config display is read-only (hash dedup means editing creates a new strategy). Uses RegistryPage config (~50 LOC). Server actions (4): `listStrategiesAction`, `createStrategyAction`, `archiveStrategyAction`, `deleteStrategyAction`.

**Structured logs**: Run detail Logs tab reads from `evolution_run_logs` table (populated by V2's `createRunLogger` from M3). Timeline tab reads from `evolution_agent_invocations` (populated by invocations.ts from M3).

**Test strategy**: Create V2 run → execute → verify appears in admin runs list; verify run detail page loads; verify timeline tab shows per-phase invocations; verify Logs tab shows structured logs; verify archive toggle hides/shows runs; E2E with real admin pages

**Done when**: V2 run appears in `/admin/evolution/runs`; detail page shows timeline with generation/ranking/evolution phases; Logs tab shows structured logs; cost breakdown visible; archive/unarchive works; no UI code changes needed

**Depends on**: Milestone 4

---

### Milestone 6: Proximity + Reflection (Optional Phases)
**Goal**: Add diversity tracking and quality critique as optional helper functions called within the main loop.

**Files to create**:
- `evolution/src/lib/v2/proximity.ts` (~80 LOC) — `computeDiversity(pool): number`
  - Lexical trigram similarity across top-10 variants
  - Returns single diversity score (0-1)

- `evolution/src/lib/v2/reflect.ts` (~100 LOC) — `critiqueTopVariants(pool, ratings, llm): Promise<CritiqueResult>`
  - Critique top 3 variants on quality dimensions
  - Results stored in invocation execution_detail (not pipeline state)
  - Optional: feed critique into next generation prompt

**Test strategy**: Unit test proximity with known-similar texts. Unit test reflection with mock LLM critique response.

**Done when**: Main loop optionally calls proximity and reflect; diversity score logged; critique appears in invocation detail

**Depends on**: Milestone 3

---

### Milestone 7: Services Layer Simplification
**Goal**: Eliminate boilerplate across server actions via `adminAction` factory and consolidate shared utilities. Dead action deletion deferred to M11/M12 (actions are live until UI pages are replaced).

**Files to create**:
- `evolution/src/services/adminAction.ts` (~50 LOC) — Shared factory that handles `withLogging` + `requireAdmin` + `createSupabaseServiceClient` + try/catch + `ActionResult` wrapping + `serverReadRequestId` outer wrapper. All 3 wrapping layers preserved: `export const fooAction = adminAction('foo', async (input, supabase) => { ... })` produces identical signature to current `serverReadRequestId(withLogging(async () => { ... }, 'foo'))`.
- `evolution/src/services/shared.ts` (~30 LOC) — Shared `UUID_REGEX`, `validateUuid()`, `ActionResult<T>` (replacing 4+ duplicates)

**Files to modify** (refactor existing):
- `evolution/src/services/promptRegistryActions.ts` — Replace 7 action wrappers with `adminAction()` calls (~130 LOC saved)
- `evolution/src/services/strategyRegistryActions.ts` — Replace 9 action wrappers (~160 LOC saved)
- `evolution/src/services/variantDetailActions.ts` — Replace 5 action wrappers (~90 LOC saved)
- `evolution/src/services/costAnalyticsActions.ts` — Replace 1 action wrapper (~20 LOC saved)
- `evolution/src/services/evolutionActions.ts` — Replace thin actions, remove `estimateRunCostAction` if unused (~100 LOC saved)
- `evolution/src/services/arenaActions.ts` — Replace thin wrappers with adminAction factory (keep all actions — deletion deferred to M11)
- `evolution/src/services/experimentActions.ts` — Replace thin wrappers with adminAction factory (keep all actions — deletion deferred to M12)
- `evolution/src/services/evolutionVisualizationActions.ts` — Replace thin wrappers (~150 LOC saved)

**Dead action deletion deferred**: The 10 actions previously labeled "dead" are ALL actively imported by UI pages (arena/page.tsx, arena/[topicId]/page.tsx, ExperimentHistory.tsx, ExperimentForm.tsx, strategies/page.tsx). They can only be deleted AFTER the consuming pages are replaced:
- Arena actions (6): delete in M11 when arena pages are rebuilt
- Experiment actions (3): delete in M12 when experiment pages are rebuilt
- Strategy presets (1): delete in M8 when strategy page is rebuilt

**Test strategy**: All existing service tests must still pass (same exported function signatures — including `serverReadRequestId` wrapping). Add tests for `adminAction` factory covering: auth failure, logging integration, error wrapping, serverReadRequestId passthrough, Supabase client creation (~10 tests).

**Done when**: All 9 service files refactored to use `adminAction()`; all existing tests pass; exported function signatures unchanged (verified via `tsc --noEmit`); total services LOC reduced by ~500 (boilerplate only, no action deletions yet)

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

**Files to create**:
- `evolution/src/components/evolution/RegistryPage.tsx` (~150 LOC) — Config-driven list page with CRUD
  - Handles: filters (text/select/checkbox/date-range), sortable columns, row actions, pagination, header action buttons
  - Integrates FormDialog + ConfirmDialog for create/edit/clone/archive/delete flows
  - Replaces per-page boilerplate in Variants (135→60 LOC), Invocations (110→55 LOC), Prompts (582→200 LOC), Strategies (925→300 LOC)

- `evolution/src/components/evolution/EntityDetailPageClient.tsx` (~120 LOC) — Config-driven detail page shell
  - Handles: data fetching, EntityDetailHeader + EntityDetailTabs setup, lazy tab loading, auto-refresh integration
  - Config: `{ title(data), statusBadge(data), links(data), tabs: [{id, label}], renderTabContent(tabId, data) }`
  - Replaces per-page boilerplate in 6 detail pages (Variant, Strategy, Prompt, Experiment, Invocation, Run)

- `evolution/src/components/evolution/FormDialog.tsx` (~80 LOC) — Reusable form dialog
  - Field types: text, textarea, select, number, checkbox, custom render
  - Props: `title`, `fields: FieldDef[]`, `initial`, `onSubmit`, `validate?`, `children?` (for presets)
  - Replaces: StrategyDialog (~275 LOC), PromptFormDialog (~230 LOC), NewTopicDialog (~50 LOC)

- `evolution/src/components/evolution/ConfirmDialog.tsx` (~40 LOC) — Reusable confirmation dialog
  - Props: `title`, `message`, `confirmLabel`, `onConfirm`, `danger?`
  - Replaces 3+ inline confirm dialogs across Prompts, Strategies, Arena

- `evolution/src/components/evolution/StatusBadge.tsx` (~40 LOC) — Unified badge component
  - Variants: run-status, entity-status (active/archived), pipeline-type, generation-method, invocation-status, experiment-status, winner
  - Replaces 7 separate implementations (~180 LOC redundant code)

- Add 3 missing URL builders to `evolution/src/lib/utils/evolutionUrls.ts` (~15 LOC):
  - `buildRunCompareUrl(runId)`, `buildRunLogsUrl(runId, options?)`, `buildArenaEntryUrl(entryId)`

**Files to modify** (refactor existing — incremental, page-by-page):
- `src/app/admin/evolution/variants/page.tsx` — Swap to RegistryPage config (135→60 LOC)
- `src/app/admin/evolution/invocations/page.tsx` — Swap to RegistryPage config (110→55 LOC)
- `src/app/admin/evolution/prompts/page.tsx` — Swap to RegistryPage + FormDialog (582→200 LOC)
- `src/app/admin/evolution/strategies/page.tsx` — Swap to RegistryPage + FormDialog (925→300 LOC)
- 6 detail page directories — Swap to EntityDetailPageClient config
- Remove duplicate StatusBadge/PipelineBadge/MethodBadge functions from 4+ page files

**Test strategy**:
- Unit test RegistryPage with mock columns/filters/actions
- Unit test FormDialog with field definitions and validation
- Unit test ConfirmDialog with danger/non-danger variants
- Unit test StatusBadge for all variants
- E2E: refactored Prompts page passes same user flows as before
- Visual regression: badge colors match across all entity types

**Done when**:
- 5 shared components created and tested
- At least 3 list pages + 3 detail pages refactored to use them
- All existing E2E tests pass with no behavior changes
- Admin UI LOC reduced by 1,500+ (measured via cloc)
- 3 missing URL builders added

**Depends on**: None (can run in parallel with any milestone — this is UI-only)

---

### Milestone 9: Test Suite Simplification
**Goal**: Reduce test suite from 41,710 LOC to ~5,500 LOC (87% reduction) by eliminating tests for V1 abstractions, centralizing mock infrastructure, and writing focused V2 tests.

**Context** (from 3 rounds of test research, 12 agents):
- 165 test files, 41,710 LOC, 2,383 test cases
- Only 22% of test files use the shared mock factory (78% create mocks independently)
- 23 files independently mock `createSupabaseServiceClient` with identical code
- pipeline.test.ts alone is 2,870 LOC (~40% mock setup boilerplate)
- 9 eliminated agents account for 3,599 LOC of tests
- Integration tests: 4,480 LOC, most test V1-specific checkpoint/supervisor features
- `parseWinner` tested in 3 separate files (comparison.test.ts, pairwiseRanker.test.ts, pipeline.test.ts)

**V1 tests to eliminate** (~14,350 LOC):
- Pipeline/state/reducer/supervisor tests: 4,159 LOC (PipelineStateImpl, PipelineAction, applyActions, PoolSupervisor — all replaced by local variables + flat loop)
- 9 eliminated agent tests: 3,599 LOC (debate, iterativeEditing, treeSearch, sectionDecomposition, outlineGeneration, metaReview, calibrationRanker, tournament, flowCritique)
- Subsystem tests (treeOfThought 4 files, section 4 files): 1,922 LOC
- Checkpoint/persistence tests: 675 LOC (no checkpointing in V2)
- Integration tests for V1 features: ~2,680 LOC (checkpoint resume, supervisor phases, agent orchestration)
- Script tests for obsolete scripts: ~1,120 LOC (backfill-prompt-ids, backfill-experiment-metrics, bank/arena comparison runners)

**V1 tests to keep** (~900 LOC, unchanged):
- `rating.test.ts` (~150 LOC) — OpenSkill rating math
- `comparison.test.ts` (~200 LOC) — Pairwise comparison + parseWinner
- `comparisonCache.test.ts` (~120 LOC) — LRU cache
- `formatValidator.test.ts` (~130 LOC) — Format validation rules
- `reversalComparison.test.ts` (~80 LOC) — 2-pass bias mitigation
- `textVariationFactory.test.ts` (~40 LOC) — Variant creation
- `strategyConfig.test.ts` (~100 LOC) — Hash dedup + label generation (used by V2 M1/M4)
- `errorClassification.test.ts` (~80 LOC) — isTransientError (used by V2 M3 retry logic)

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

**Test strategy**: Validate by running V1 reused module tests first (must pass unchanged). Then run V2 new tests. Then verify no V1 test imports reference eliminated modules.

**CI/CD updates required**:
- Update `jest.config.js` coverage thresholds: recalibrate after V1 test deletion (current: branches:41, functions:35, lines:42, statements:42 — these will shift when both code and tests are removed)
- Update CI workflow test path patterns: V2 tests live in `evolution/src/lib/v2/__tests__/` — add to `testPathPatterns` in CI config
- DB migration testing: add `supabase db reset --dry-run` step to CI (or validate seed SQL syntax) to catch schema errors before deployment
- Seed migration RPC testing: integration tests must verify `claim_evolution_run` and `sync_to_arena` RPCs work against the new schema

**Done when**:
- Shared mock factory (`setupServiceTestMocks`) adopted by all service test files
- V1 eliminated test files deleted (28+ files)
- V2 test suite passes: 56 new test cases across 6 files
- Reused V1 tests pass unchanged (including strategyConfig + errorClassification)
- Integration tests consolidated: 4,480 LOC → ~900 LOC
- jest.config.js coverage thresholds recalibrated
- CI test routing includes V2 test paths
- Total test LOC: 41,710 → ~5,500

**Depends on**: Milestones 1-6 (V2 code must exist to test it). Mock infrastructure (service-test-mocks.ts, component-test-mocks.ts) can be created anytime.

---

### Milestone 10: Scripts + DB Migration Cleanup
**Goal**: Delete ~40 incremental V1 migration files and replace with a single seed migration; delete 4 obsolete scripts and simplify 2 runners for V2.

**DB Migrations — Collapse to single seed file**:

Recreating dev and prod from scratch with no backward compatibility. All historical evolution data (runs, variants, arena entries, experiments) will be dropped. No data export/import needed — this is an intentional clean slate.

**Migration collapse approach**: Keep old migration files in place but add a NEW migration (`20260315000001_evolution_v2.sql`) that DROPs all V1 evolution tables and recreates them with V2 schema. This avoids breaking `supabase db push` (which tracks applied migration history) — old migrations stay "applied" in the history, and the new migration cleanly replaces the schema. No need for `supabase migration repair` or orphan cleanup.

**Migration files**: Keep existing ~40 V1 migration files in place (they're already applied in staging/prod DB history). Add one new migration that drops and recreates.

**Files to create**:
- `supabase/migrations/20260315000001_evolution_v2.sql` (~280 LOC) — Drops all V1 evolution tables + RPCs, then creates V2 schema:
  - **V2.0 Core** (5 tables): `evolution_runs` (config JSONB + `strategy_config_id` FK, `archived` boolean, `pipeline_version` TEXT), `evolution_variants` (Elo + lineage), `evolution_agent_invocations` (per-phase timeline), `evolution_run_logs` (structured logging for Logs tab), `evolution_strategy_configs` (id, name, config JSONB, config_hash for dedup, is_predefined, created_at). No `evolution_checkpoints` table (Decision 1: no checkpointing).
  - **V2.1 Arena** (2 tables): `evolution_arena_topics` (prompts, case-insensitive unique), `evolution_arena_entries` (Elo merged in — no separate elo table, no comparisons table)
  - **V2.2 Experiments** (1 table): `evolution_experiments` (5 columns: id, name, prompt_id FK, status, created_at)
  - **RPCs** (2, both SECURITY DEFINER with REVOKE FROM PUBLIC + GRANT TO service_role):
    - `claim_evolution_run` (FOR UPDATE SKIP LOCKED — reuse V1 logic)
    - `sync_to_arena` (NEW — rewritten for merged schema: upserts entries with elo_rating + match_count inline, no separate elo table. Accepts p_entries JSONB array + p_elo_rows JSONB array. Match history NOT persisted to a comparisons table — if match history needed for admin UI, store in evolution_agent_invocations execution_detail JSONB instead)
  - **Indexes**: pending claim, heartbeat staleness, variant-by-run, arena leaderboard, experiment status, archived filter, logs by run, strategy config_hash unique
  - **FKs**: runs.prompt_id → topics, runs.experiment_id → experiments (nullable), runs.strategy_config_id → strategy_configs (nullable), arena entries → topics + runs
  - No budget_events, no cost_baselines, no comparisons table, no experiment_rounds

**Scripts to delete** (4 files, ~988 LOC):
- `evolution/scripts/backfill-prompt-ids.ts` (339 LOC) — V1 data migration
- `evolution/scripts/backfill-experiment-metrics.ts` (247 LOC) — V1 checkpoint backfill
- `evolution/scripts/backfill-diff-metrics.ts` (243 LOC) — V1 diff backfill
- `evolution/scripts/audit-evolution-configs.ts` (159 LOC) — V1 config validation

**CI workflows to update**:
- `.github/workflows/supabase-migrations.yml` — Remove `backfill-prompt-ids.ts` from path triggers and deploy steps. Review orphan/duplicate repair logic (designed for incremental migrations, may need simplifying after collapse to single seed).
- `.github/workflows/ci.yml` — M9 mass-deletion PR should run full test suite (not `--changedSince`) to validate transition. Add `supabase db reset` dry-run step (path-filtered to `supabase/migrations/`).
- `.github/workflows/migration-reorder.yml` — Review after collapse; may be removable if only 1 seed file exists.
- `jest.config.js` — Coverage threshold recalibration: delete V1 production code and tests in the SAME PR (never delete tests without their production code). Run full suite, record new baseline, set thresholds at baseline minus 5%. Include `jest.config.js` changes in the PR to trigger full CI (not `--changedSince`).

**Scripts to defer** (6 files, ~1,747 LOC — move to `evolution/scripts/deferred/`):
- Arena scripts: `add-to-arena.ts`, `add-to-bank.ts`, `run-arena-comparison.ts`, `run-bank-comparison.ts`
- Experiment scripts: `run-prompt-bank.ts`, `run-prompt-bank-comparisons.ts`
- Plus `lib/arenaUtils.ts`

**Scripts to keep and simplify** (3 files, ~1,553 LOC → ~800 LOC):
- `evolution-runner.ts` (425→200 LOC) — Remove checkpoint/resume/continuation logic, simplify to: claim → resolve content → call evolveArticle → persist
- `run-evolution-local.ts` (811→400 LOC) — Remove checkpoint expansion, bank logic, outline mutation; keep core: seed → run pipeline → print result
- `lib/oneshotGenerator.ts` (317 LOC) — Keep as-is

**Test strategy**: Run `supabase db reset` with new migration; verify all 8 tables created (5 core + 2 arena + 1 experiments); verify both RPCs work (claim_evolution_run, sync_to_arena); verify V2 runner can claim + execute against fresh schema. Use `DROP TABLE IF EXISTS ... CASCADE` in migration to handle FK dependencies.

**Done when**:
- V1 migration files kept in place (already applied in DB history)
- 1 new migration drops V1 tables + creates V2 schema (8 tables + 2 RPCs)
- `supabase db reset` succeeds on fresh database
- 4 obsolete scripts deleted
- 6 deferred scripts moved to `deferred/` directory
- Runner scripts simplified (checkpoint/resume logic removed)
- Total LOC removed: ~2,530 (migrations) + ~988 (scripts deleted) + ~753 (scripts simplified) = ~4,271 LOC

**Depends on**: Milestone 1 (V2 types define the schema requirements). Can run in parallel with M2-M6.

---

### Milestone 11: V2.1 Arena (Simplified Leaderboard)
**Goal**: Build a streamlined Arena for comparing text variants across prompts — 2 tables (topics + entries with merged Elo), 6 server actions, 2 config-driven admin pages.

**Context** (from 3 rounds of Arena/Experiments research, 12 agents):
- Arena is fundamentally "a leaderboard of variants per prompt, ranked by Elo"
- V1 has 4 tables (topics, entries, comparisons, elo) — V2.1 merges elo into entries, drops comparisons table
- V1 has 14 server actions (6 dead) — V2.1 needs 6
- Pipeline integration simplifies: prompt_id required upfront (no auto-resolution fallbacks)
- Topics = prompts (same table: `evolution_arena_topics`)

**Key simplification**: Require `prompt_id` set BEFORE run starts. Eliminates `autoLinkPrompt()` with its 3 fallback strategies.

**Files to create**:
- `evolution/src/lib/v2/arena.ts` (~150 LOC) — Core Arena functions:
  - `loadArenaEntries(promptId, supabase)` — Load existing arena entries into pool with preset ratings (mu/sigma). Entries marked `fromArena: true` so they're filtered from variant persistence but participate in ranking.
  - `syncToArena(runId, promptId, pool, ratings, matchHistory, supabase)` — Full sync via `sync_to_arena` RPC:
    1. **New variants**: All non-arena variants upserted as arena entries (content, generation_method, model, cost, elo_rating)
    2. **Match history**: All pairwise comparison results from the run (entry_a, entry_b, winner, confidence) — includes matches involving arena-loaded variants
    3. **Elo updates for ALL entries**: Updated mu/sigma/elo_rating for both new AND existing arena entries that participated in this run's ranking. This means existing arena entries get their ratings refined by competing against new variants.
  - No `autoLinkPrompt`, no `resolveTopicId`, no `findOrCreateTopic`

**Server actions** (6, down from 14):
- `getArenaTopicsAction` — List topics with entry counts + Elo range
- `getArenaEntriesAction(topicId)` — Ranked entries (replaces both getEntries + getLeaderboard)
- `runArenaComparisonAction(topicId, entryAId, entryBId)` — LLM compare + update Elo
- `upsertArenaEntryAction` — Add/update entry (replaces addToArena + generateAndAdd)
- `archiveArenaTopicAction` — Soft archive
- `createArenaTopicAction` — New topic

**Admin pages** (2 pages, ~100 LOC config total using M8 components):
- Arena list — RegistryPage config: topic name, entry count, Elo range, best method, status filter (~45 LOC)
- Arena topic detail — EntityDetailPageClient config: 2 tabs (Leaderboard, Match History). No scatter chart, no text diff, no coverage grid — defer to later (~55 LOC)
- Drop entry detail page (use modal drill from leaderboard instead)

**Pipeline integration** (called from evolve-article.ts):
- At start: `loadArenaEntries(promptId, supabase)` → add existing arena entries to pool with preset ratings (fromArena: true). These compete naturally alongside new variants during ranking.
- At end: `syncToArena(runId, promptId, pool, ratings, matchHistory, supabase)` → atomic sync of:
  - All new variants (not fromArena) as arena entries
  - Full match history (all comparisons, including those involving arena entries)
  - Updated elo for ALL pool entries (new + existing arena entries get refined ratings)
  - This means the arena is a continuous rating space — each run refines existing ratings AND adds new contenders.

**Test strategy**: Unit test loadArenaEntries + syncToArena with mock Supabase. Integration test: create topic → add 3 entries → run comparison → verify Elo updated. E2E: admin pages render topic list + leaderboard.

**Done when**:
- Arena tables populated via seed migration (M10)
- 6 server actions working
- loadArenaEntries + syncToArena integrated into evolveArticle
- 2 admin pages render with config-driven components
- Integration test: topic → entries → comparison → Elo passes

**Depends on**: Milestone 3 (evolveArticle exists), Milestone 5 (admin UI compatibility), Milestone 10 (arena tables in seed)

**Strategy integration**: Arena entries display strategy label (from linked run → strategy_config_id → strategy name). Arena leaderboard includes strategy column so users can see which strategy produced which entry.

**V1 code eliminated**: 14→6 server actions (~450 LOC). Delete the 6 deferred "dead" arena actions from M7 (getPromptBankCoverageAction, getPromptBankMethodSummaryAction, getArenaLeaderboardAction, getCrossTopicSummaryAction, deleteArenaEntryAction, deleteArenaTopicAction) — safe to delete now because M11 replaces the consuming pages. Also: separate elo table + comparisons table, autoLinkPrompt + resolveTopicId (~200 LOC), 3 admin pages (~1,802 LOC) → 2 config-driven pages (~100 LOC)

---

### Milestone 12: V2.2 Experiments (Simplified Batches)
**Goal**: Build a lightweight experiment system — "a labeled batch of runs against the same prompt" with 1 table, 5 server actions, no cron driver, synchronous metrics.

**Context**:
- An experiment is just `{ name, prompt_id, status, runs[] }` — no L8 factorial design, no rounds, no bootstrap CIs, no LLM reports
- V1 has 17 server actions — V2.2 needs 5
- V1 requires cron driver for state transitions — V2.2 auto-completes via DB trigger when last run finishes
- Metrics (maxElo, cost, eloPer$) computed synchronously on page load, not async via cron

**Key simplification**: Eliminate the `analyzing` state. When last run completes → experiment auto-transitions to `completed` via DB trigger. No cron needed.

**Files to create**:
- `evolution/src/lib/v2/experiments.ts` (~100 LOC) — Core functions:
  - `createExperiment(name, promptId, supabase)` — Insert experiment row
  - `addRunToExperiment(experimentId, config, supabase)` — Create run with experiment_id FK, auto-transition pending→running on first run
  - `computeExperimentMetrics(experimentId, supabase)` — Synchronous: query runs, compute maxElo/cost/eloPer$ per run, return aggregate. No bootstrap, no cron.

**Server actions** (5, down from 17):
- `createExperimentAction(name, promptId)` — Create experiment
- `addRunToExperimentAction(experimentId, config)` — Add run (auto-transitions pending→running)
- `getExperimentAction(experimentId)` — Detail with runs + inline metrics
- `listExperimentsAction(status?)` — List with filter
- `cancelExperimentAction(experimentId)` — Cancel + fail pending runs

**Eliminated**: archiveExperiment, unarchiveExperiment, startManualExperiment, regenerateReport, getExperimentName, renameExperiment, getExperimentMetrics (separate), getStrategyMetrics, getRunMetrics (separate), getActionDistribution, deleteExperiment

**Admin pages** (2 pages, ~100 LOC config total using M8 components):
- Experiments list — RegistryPage config: name, prompt, status, run count, best Elo, cost, create button opens FormDialog (~40 LOC)
- Experiment detail — EntityDetailPageClient config: 2 tabs (Overview with MetricGrid, Runs with RelatedRunsTab). No Analysis card, no Report tab, no Action Distribution (~60 LOC)
- Start experiment becomes a FormDialog on list page (not a separate page): name, prompt dropdown, config, run count (~30 LOC FormDialog config)

**DB trigger** (in seed migration, ~15 LOC):
- `ON UPDATE evolution_runs` → if experiment_id set and no pending/running runs remain → mark experiment completed

**Test strategy**: Unit test createExperiment + addRun + computeMetrics. Integration test: create experiment → add 3 runs → complete runs → verify experiment auto-completed, metrics correct. E2E: admin pages render list + detail.

**Done when**:
- Experiments table populated via seed migration (M10)
- 5 server actions working
- DB trigger auto-completes experiments (no cron)
- Metrics computed synchronously (maxElo, cost, eloPer$ per run)
- 2 admin pages render with config-driven components
- Integration test: create → add runs → complete → auto-complete → metrics passes
- Experiment cron driver (`/api/cron/experiment-driver`) can be deleted

**Depends on**: Milestone 3 (evolveArticle for creating runs), Milestone 5 (admin UI), Milestone 10 (experiments table in seed)

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
├── reflect.ts            (100 LOC)  — Quality critique (optional)
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
    └── finalize.test.ts
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

### Test LOC Summary
| Category | Current | V2 Target | Change |
|----------|---------|-----------|--------|
| V1 tests eliminated (agents, pipeline, state, subsystems) | 14,350 | 0 | -14,350 |
| V1 tests retained (rating, comparison, format, cache) | 720 | 720 | 0 |
| V2 new tests (helpers, smoke, runner, finalize) | 0 | 950 | +950 |
| Shared mock infrastructure | 930 duplication | 150 shared | -780 |
| Integration tests | 4,480 | 900 | -3,580 |
| Page tests (with M8) | 2,517 | 750 | -1,767 |
| Script tests | 2,015 | 600 | -1,415 |
| Remaining (service tests, component tests, other) | ~16,698 | ~2,430 | ~-14,268 |
| **Total** | **~41,710** | **~5,500** | **-36,210 (87%)** |

### Reusable V1 Tests (unchanged)
- rating.test.ts, comparison.test.ts, comparisonCache.test.ts, formatValidator.test.ts, reversalComparison.test.ts, textVariationFactory.test.ts, strategyConfig.test.ts, errorClassification.test.ts

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
