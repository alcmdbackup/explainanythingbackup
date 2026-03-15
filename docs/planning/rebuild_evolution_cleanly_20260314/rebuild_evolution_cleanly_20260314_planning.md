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
- 10 dead actions (delete immediately)
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
| Server actions | 79 | ~65 (remove 10 dead, keep rest) |
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
- `evolution/src/lib/v2/types.ts` (~120 LOC) — Minimal types: TextVariation (id, text, strategy, parentIds, iterationBorn, version), Rating, Match, EvolutionConfig (iterations, variantsPerRound, budgetUsd)

**Files to reuse from V1 (import directly, no changes)**:
- `evolution/src/lib/core/rating.ts` — createRating, updateRating, updateDraw, toEloScale (78 LOC)
- `evolution/src/lib/comparison.ts` — compareWithBiasMitigation, parseWinner (146 LOC)
- `evolution/src/lib/core/reversalComparison.ts` — run2PassReversal (40 LOC)
- `evolution/src/lib/core/comparisonCache.ts` — ComparisonCache (96 LOC)
- `evolution/src/lib/agents/formatValidator.ts` — validateFormat (89 LOC)
- `evolution/src/lib/agents/formatRules.ts` — FORMAT_RULES (15 LOC)
- `evolution/src/lib/core/textVariationFactory.ts` — createTextVariation (26 LOC)

**Test strategy**: Rerun V1 tests for all reused modules; write V2 type tests

**Done when**: V2 types defined; all reused V1 module tests pass; V2 can import and call compareWithBiasMitigation, updateRating, validateFormat, createTextVariation

**Depends on**: None

---

### Milestone 2: Helper Functions (Generate, Rank, Evolve)
**Goal**: Implement the three core helper functions as standalone, independently testable async functions.

**Files to create**:
- `evolution/src/lib/v2/generate.ts` (~100 LOC) — `generateVariants(text, llm, config): Promise<TextVariation[]>`
  - 3 strategies in parallel (structural_transform, lexical_simplify, grounding_enhance)
  - Calls validateFormat, createTextVariation
  - Prompt templates from V1 generationAgent.ts

- `evolution/src/lib/v2/rank.ts` (~200 LOC) — `rankPool(pool, ratings, matchCounts, llm, config): Promise<{matches, ratingUpdates}>`
  - Stratified opponent selection for new entrants (triage)
  - Swiss pairing for top contenders (fine-ranking)
  - Uses compareWithBiasMitigation from V1
  - Budget-aware: stops when cost limit approached

- `evolution/src/lib/v2/evolve.ts` (~120 LOC) — `evolveVariants(pool, ratings, llm, config): Promise<TextVariation[]>`
  - Select top-rated parents
  - Mutate (clarity, structure) + crossover
  - Optional creative exploration trigger
  - Calls validateFormat, createTextVariation

**Files to reuse from V1**: Prompt templates, Swiss pairing logic, opponent selection

**Test strategy**: Test each function independently with mock LLM. Test generate produces 3 variants. Test rank updates ratings correctly. Test evolve produces children from parents.

**Done when**: Each function works standalone with mocked LLM; unit tests pass; functions compose correctly (generate output feeds into rank)

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
  - Budget check after each phase
  - Kill detection: check run status from DB at iteration boundary

- `evolution/src/lib/v2/cost-tracker.ts` (~80 LOC) — Budget-aware cost tracker
  - `canAfford(estimatedCost): boolean` — Pre-check before LLM calls (prevents overshoot)
  - `recordCost(phase, amount)` — Post-call actual cost recording
  - `getTotalCost()`, `getPhaseCosts()`, `getAvailableBudget()`
  - Budget enforcement: `canAfford` checks `totalSpent + estimate <= budgetUsd` before each LLM call
  - No FIFO queue — but does pre-check (unlike V1's full reservation pattern, this is lighter while still preventing overshoot)

- `evolution/src/lib/v2/invocations.ts` (~50 LOC) — Invocation row helpers
  - `createInvocation(runId, iteration, phaseName)` → UUID
  - `updateInvocation(id, { cost, variantsAdded, matchesPlayed, executionDetail })`

- `evolution/src/lib/v2/run-logger.ts` (~60 LOC) — Structured run logging
  - `createRunLogger(runId, supabase)` → logger with `info/warn/error/debug` methods
  - Each log entry written to `evolution_run_logs` table: `{ run_id, level, message, context JSONB, created_at }`
  - Fire-and-forget inserts (non-blocking, errors swallowed)
  - Powers the Logs tab in admin UI

**Test strategy**: End-to-end smoke test with mock LLM: seed → 2 iterations → verify pool grows, ratings converge, cost tracked per phase, invocation rows created. Test budget exhaustion stops early. Test kill detection.

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
  - No checkpointing, no resume logic
  - Supports `--parallel N` flag: claim + execute multiple runs concurrently via Promise.all

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
  - Write per-agent cost metrics to evolution_run_agent_metrics (from invocation rows)

**Files to modify** (minimal):
- `evolution/src/services/evolutionRunnerCore.ts` — Add V2 routing: if `pipeline_version === 'v2'`, call `executeV2Run`

**Run archiving**: `evolution_runs` includes `archived BOOLEAN DEFAULT false`. Runs list filters by `archived = false` by default with "Show archived" toggle. Archive/unarchive via simple UPDATE (no separate action needed — reuse existing pattern).

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
**Goal**: Eliminate boilerplate across 79 server actions via `adminAction` factory, remove 10 dead actions, and consolidate shared utilities.

**Files to create**:
- `evolution/src/services/adminAction.ts` (~40 LOC) — Shared factory that handles withLogging, requireAdmin, createSupabaseServiceClient, try/catch, ActionResult wrapping
- `evolution/src/services/shared.ts` (~30 LOC) — Shared `UUID_REGEX`, `validateUuid()`, `ActionResult<T>` (replacing 4+ duplicates)

**Files to modify** (refactor existing):
- `evolution/src/services/promptRegistryActions.ts` — Replace 7 action wrappers with `adminAction()` calls (~130 LOC saved)
- `evolution/src/services/strategyRegistryActions.ts` — Replace 9 action wrappers (~160 LOC saved)
- `evolution/src/services/variantDetailActions.ts` — Replace 5 action wrappers (~90 LOC saved)
- `evolution/src/services/costAnalyticsActions.ts` — Replace 1 action wrapper (~20 LOC saved)
- `evolution/src/services/evolutionActions.ts` — Replace thin actions, remove `estimateRunCostAction` if unused (~100 LOC saved)
- `evolution/src/services/arenaActions.ts` — Remove 6 dead actions, replace thin wrappers (~300 LOC saved)
- `evolution/src/services/experimentActions.ts` — Remove 3 dead actions, replace thin wrappers (~200 LOC saved)
- `evolution/src/services/evolutionVisualizationActions.ts` — Replace thin wrappers (~150 LOC saved)

**Dead code to remove** (10 actions):
- `getPromptBankCoverageAction`, `getPromptBankMethodSummaryAction`, `getArenaLeaderboardAction`, `getCrossTopicSummaryAction`, `deleteArenaEntryAction`, `deleteArenaTopicAction`
- `archiveExperimentAction`, `unarchiveExperimentAction`, `startManualExperimentAction`
- `getStrategyPresetsAction`

**Test strategy**: All existing service tests must still pass (same exported function signatures). Add tests for `adminAction` factory. Verify dead action removal doesn't break any imports.

**Done when**: All 9 service files refactored to use `adminAction()`; 10 dead actions removed; all existing tests pass; total services LOC reduced from 5,829 to ~3,800

**Depends on**: None (can run in parallel with any milestone — this is V1 cleanup, not V2-specific)

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

**V1 tests to keep** (~720 LOC, unchanged):
- `rating.test.ts` (~150 LOC) — OpenSkill rating math
- `comparison.test.ts` (~200 LOC) — Pairwise comparison + parseWinner
- `comparisonCache.test.ts` (~120 LOC) — LRU cache
- `formatValidator.test.ts` (~130 LOC) — Format validation rules
- `reversalComparison.test.ts` (~80 LOC) — 2-pass bias mitigation
- `textVariationFactory.test.ts` (~40 LOC) — Variant creation

**Files to create** (shared test infrastructure):
- `evolution/src/testing/service-test-mocks.ts` (~80 LOC) — `setupServiceTestMocks()` auto-mocks Supabase + adminAuth + serverReadRequestId + withLogging; `createSupabaseChainMock()` replaces 23 independent copies
- `evolution/src/testing/component-test-mocks.ts` (~60 LOC) — `setupComponentTestMocks()` for next/link, next/navigation, next/dynamic

**V2 tests to write** (~950 LOC):
- `generate.test.ts` (~150 LOC, 12 tests) — 3 strategies, format validation, variant creation
- `rank.test.ts` (~220 LOC, 14 tests) — Swiss pairing, opponent selection, rating updates, budget-aware stop
- `evolve.test.ts` (~140 LOC, 10 tests) — Parent selection, mutation, crossover, format validation
- `evolve-article.test.ts` (~260 LOC, 9 tests) — Smoke test: 2-iteration pipeline end-to-end; budget exhaustion; kill detection
- `runner.test.ts` (~120 LOC, 6 tests) — Claim → execute → persist → complete lifecycle
- `finalize.test.ts` (~60 LOC, 5 tests) — V1-compatible run_summary, variant persistence

**Integration tests** (V2, ~900 LOC replacing 4,480):
- Single "full lifecycle" test: create run → call evolveArticle with real Supabase + mock LLM → verify variants persisted, invocations logged, run completed → cleanup
- Error scenarios: budget exceeded, LLM failure, run killed

**Page tests** (with M8, ~750 LOC replacing 2,517):
- Shared component tests (RegistryPage, EntityDetailPageClient, FormDialog, ConfirmDialog, StatusBadge): ~320 LOC tested once
- Per-page tests shrink to ~20 LOC each (config validation + error handling only)

**Test strategy**: Validate by running V1 reused module tests first (must pass unchanged). Then run V2 new tests. Then verify no V1 test imports reference eliminated modules. Monitor coverage % to ensure it doesn't drop for code that still exists.

**Done when**:
- Shared mock factory (`setupServiceTestMocks`) adopted by all service test files
- V1 eliminated test files deleted (28+ files)
- V2 test suite passes: 56 new test cases across 6 files
- Reused V1 tests pass unchanged: ~40 test cases across 6 files
- Integration tests consolidated: 4,480 LOC → ~900 LOC
- Total test LOC: 41,710 → ~5,500

**Depends on**: Milestones 1-6 (V2 code must exist to test it). Mock infrastructure (service-test-mocks.ts, component-test-mocks.ts) can be created anytime.

---

### Milestone 10: Scripts + DB Migration Cleanup
**Goal**: Delete 66 incremental V1 migration files and replace with a single seed migration; delete 4 obsolete scripts and simplify 2 runners for V2.

**DB Migrations — Collapse to single seed file**:

Recreating dev and prod from scratch with no backward compatibility. Replace 66 incremental migrations (~2,530 LOC) with one file defining the final V2 schema.

**Files to delete** (66 migration files):
- All `supabase/migrations/202601*_*evolution*` through `supabase/migrations/202603*_*evolution*`
- All `supabase/migrations/*arena*`, `*hall_of_fame*`, `*strategy*`, `*experiment*`
- All evolution-related RPCs embedded in migrations (claim, checkpoint_and_continue, apply_winner, sync_to_arena, update_strategy_aggregates, etc.)

**Files to create**:
- `supabase/migrations/00000000000001_evolution_v2.sql` (~260 LOC) — Unified seed covering V2.0 + V2.1 + V2.2:
  - **V2.0 Core** (5 tables): `evolution_runs` (config JSONB inlined, `archived` boolean, no strategy FK), `evolution_variants` (Elo + lineage), `evolution_checkpoints` (reserved), `evolution_agent_invocations` (per-phase timeline), `evolution_run_logs` (structured logging for Logs tab)
  - **V2.1 Arena** (2 tables): `evolution_arena_topics` (prompts, case-insensitive unique), `evolution_arena_entries` (Elo merged in — no separate elo table, no comparisons table)
  - **V2.2 Experiments** (1 table): `evolution_experiments` (5 columns: id, name, prompt_id FK, status, created_at)
  - **RPCs** (2): `claim_evolution_run` (FOR UPDATE SKIP LOCKED), `sync_to_arena` (atomic entry + elo upsert)
  - **Indexes**: pending claim, heartbeat staleness, variant-by-run, arena leaderboard, experiment status, archived filter, logs by run
  - **FKs**: runs.prompt_id → topics, runs.experiment_id → experiments (nullable), arena entries → topics + runs
  - No strategy_configs table (config inlined on runs), no budget_events, no cost_baselines, no comparisons table, no experiment_rounds

**Scripts to delete** (4 files, ~988 LOC):
- `evolution/scripts/backfill-prompt-ids.ts` (339 LOC) — V1 data migration
- `evolution/scripts/backfill-experiment-metrics.ts` (247 LOC) — V1 checkpoint backfill
- `evolution/scripts/backfill-diff-metrics.ts` (243 LOC) — V1 diff backfill
- `evolution/scripts/audit-evolution-configs.ts` (159 LOC) — V1 config validation

**Scripts to defer** (6 files, ~1,747 LOC — move to `evolution/scripts/deferred/`):
- Arena scripts: `add-to-arena.ts`, `add-to-bank.ts`, `run-arena-comparison.ts`, `run-bank-comparison.ts`
- Experiment scripts: `run-prompt-bank.ts`, `run-prompt-bank-comparisons.ts`
- Plus `lib/arenaUtils.ts`

**Scripts to keep and simplify** (3 files, ~1,553 LOC → ~800 LOC):
- `evolution-runner.ts` (425→200 LOC) — Remove checkpoint/resume/continuation logic, simplify to: claim → resolve content → call evolveArticle → persist
- `run-evolution-local.ts` (811→400 LOC) — Remove checkpoint expansion, bank logic, outline mutation; keep core: seed → run pipeline → print result
- `lib/oneshotGenerator.ts` (317 LOC) — Keep as-is

**Test strategy**: Run `supabase db reset` with new seed migration; verify all 7 tables created; verify claim RPC works; verify sync_to_arena RPC works; verify V2 runner can claim + execute against fresh schema

**Done when**:
- 66 migration files deleted
- 1 seed migration creates complete V2 schema (7 tables + 2 RPCs)
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
- `evolution/src/lib/v2/arena.ts` (~120 LOC) — Core Arena functions:
  - `loadArenaEntries(promptId, supabase)` — Load entries with Elo into pool (simplified, no fallback resolution)
  - `syncToArena(runId, promptId, pool, ratings, supabase)` — Filter new variants, call sync_to_arena RPC
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
- At start: `const arenaEntries = await loadArenaEntries(promptId, supabase)` → add to pool with preset ratings
- At end: `await syncToArena(runId, promptId, pool, ratings, supabase)` → upsert winners to arena

**Test strategy**: Unit test loadArenaEntries + syncToArena with mock Supabase. Integration test: create topic → add 3 entries → run comparison → verify Elo updated. E2E: admin pages render topic list + leaderboard.

**Done when**:
- Arena tables populated via seed migration (M10)
- 6 server actions working
- loadArenaEntries + syncToArena integrated into evolveArticle
- 2 admin pages render with config-driven components
- Integration test: topic → entries → comparison → Elo passes

**Depends on**: Milestone 3 (evolveArticle exists), Milestone 5 (admin UI compatibility), Milestone 10 (arena tables in seed)

**V1 code eliminated**: 14→6 server actions (~450 LOC), separate elo table + comparisons table, autoLinkPrompt + resolveTopicId (~200 LOC), 3 admin pages (~1,802 LOC) → 2 config-driven pages (~100 LOC)

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
├── rank.ts               (200 LOC)  — Rank pool helper
├── evolve.ts             (120 LOC)  — Evolve/mutate helper
├── evolve-article.ts     (200 LOC)  — THE main function
├── cost-tracker.ts       (80 LOC)   — Budget-aware cost tracker (pre-check + record)
├── invocations.ts        (50 LOC)   — Invocation row helpers
├── run-logger.ts         (60 LOC)   — Structured run logging (powers Logs tab)
├── runner.ts             (200 LOC)  — Claim/execute/persist + parallel support
├── seed-article.ts       (60 LOC)   — Seed article generation for prompt-based runs
├── finalize.ts           (100 LOC)  — V1-compatible result persistence
├── proximity.ts          (80 LOC)   — Diversity tracking (optional)
├── reflect.ts            (100 LOC)  — Quality critique (optional)
├── arena.ts              (120 LOC)  — Arena load/sync (V2.1)
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
| **Total reused** | **~490** | |

## What V2 Eliminates vs V1

| V1 Concept | LOC | V2 Replacement |
|------------|-----|---------------|
| AgentBase class + 14 subclasses | 4,500 | Helper functions (~420 LOC) |
| PipelineStateImpl (18 fields) | 320 | Local variables in function scope |
| PipelineAction union + reducer | 160 | Direct mutations on local arrays/maps |
| PoolSupervisor + phase transitions | 213 | Flat for-loop |
| Pipeline orchestrator | 904 | evolve-article.ts (~200 LOC) |
| Checkpoint/resume/continuation | 350 | Eliminated (short runs, re-run on crash) |
| ExecutionContext | 100 | Function parameters |
| Agent invocation lifecycle | 200 | Simple createInvocation/updateInvocation |
| Services boilerplate (79 actions) | ~1,500 | adminAction factory (~500 LOC saved) |
| Dead server actions (10) | ~500 | Deleted |
| Admin page boilerplate (list/detail/dialog) | ~4,000 | Config-driven components (~1,500 LOC saved) |
| Duplicate badge implementations | ~180 | Unified StatusBadge |
| V1 test suite (eliminated abstractions) | ~14,350 | ~950 LOC V2 tests + ~720 reused |
| Mock boilerplate duplication | ~930 | ~150 shared factory |
| 66 incremental DB migrations | ~2,530 | 1 seed file (~150 LOC) |
| 4 obsolete scripts + runner simplification | ~1,741 | Deleted + simplified |
| 6 deferred scripts | ~1,747 | Moved to deferred/ |
| V1 Arena (4 tables, 14 actions, 3 pages) | ~3,450 | 2 tables, 6 actions, 2 pages (~320 LOC) |
| V1 Experiments (17 actions, cron, 3+ pages) | ~2,900 | 1 table, 5 actions, 2 pages, no cron (~300 LOC) |
| V1 Strategy configs (table, 9 actions, 2 pages) | ~1,700 | Eliminated (config inlined on runs) |
| **Total eliminated** | **~42,458** | **~1,560 pipeline + ~3,800 services + ~3,300 UI + ~5,500 tests + ~230 DB + ~800 scripts** |

## Coexistence Strategy

1. V2 code lives in `evolution/src/lib/v2/` — V1 completely untouched
2. Runner routes via `pipeline_version` field on evolution_runs (`'v1'` or `'v2'`)
3. Same DB tables — V2 writes to same evolution_runs, evolution_variants, evolution_agent_invocations
4. Admin UI shows both V1 and V2 runs without modification (same invocation schema)
5. Rollback: set `pipeline_version = 'v1'` for pending V2 runs

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
- rating.test.ts, comparison.test.ts, comparisonCache.test.ts, formatValidator.test.ts, reversalComparison.test.ts, textVariationFactory.test.ts

### New V2 Tests (per milestone)
- M1: V2 types compile; reused V1 module tests pass
- M2: Each helper function tested independently with mock LLM
- M3: End-to-end smoke test (seed → 2 iterations → winner); cost tracking; invocations
- M4: Full lifecycle test (claim → execute → persist → complete)
- M5: V2 run appears in admin UI
- M6: Diversity + critique integration
- M7: adminAction factory tests; verify dead action removal doesn't break imports; all existing service tests pass
- M8: RegistryPage, EntityDetailPageClient, FormDialog, ConfirmDialog, StatusBadge unit tests; E2E for refactored pages
- M9: Delete 28+ V1 test files; write V2 tests; centralize mocks; consolidate integration tests

### Smoke Test
2-iteration mini pipeline with mock LLM: seed article → generate 3 → rank → evolve 2 → generate 3 more → rank → verify winner identified, costs tracked, invocations logged

## Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| V1 run loss during migration | High | Pre-migration queue drain + runner tagging |
| No checkpointing = lost work on crash | Low | Runs are <$1 and <10 min; just re-run |
| Dual runner claiming | Medium | Runner ID prefixes (v1-*, v2-*) |
| Feature gaps (debate, editing, tree search) | Medium | Phase in as helpers after core V2 stable |
| Rollback needed | High | Keep V1 frozen; feature flag EVOLUTION_USE_V2 |
| Admin UI incompatibility | Low | Same invocation/variant tables; V1-compatible summary |

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
