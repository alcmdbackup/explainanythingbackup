# Find Improvements Evolution Implementation Research

## Problem Statement
This project involves a comprehensive audit of the evolution pipeline to identify bugs, inefficiencies, and improvement opportunities across all agents, core infrastructure, and configuration. The goal is to analyze the codebase for correctness issues, performance bottlenecks, and areas where the pipeline could produce better results for less cost.

## Requirements (from GH Issue #436)
- Look for any bugs or improvement opportunities in the evolution pipeline

## High Level Summary

Comprehensive audit of ~80+ files across the evolution pipeline (9 parallel research agents in Rounds 1-2, 4 deep-dive agents in Round 3, 4 specialized agents in Round 4) identified **17 critical bugs**, **28 high-priority issues**, **60 medium-priority issues**, and **27 low-priority issues** totaling **132 findings** across 18 categories. The most impactful findings are:

**Pipeline & Config (from Round 1):**
1. **Config propagation gap** — Strategy config fields (`iterations`, `generationModel`, `judgeModel`, `budgetCaps`, `agentModels`) are NOT copied to run config JSONB, causing all production runs to ignore strategy settings and use defaults
2. **Off-by-one iteration bug** — `maxIterations=N` only runs N-1 agent iterations due to premature `shouldStop()` check
3. **Semaphore resource leak** — LLM call failures permanently leak semaphore slots, eventually hanging all LLM calls
4. **Cron auth bypass** — Fail-open when `CRON_SECRET` is not set
5. **Batch runner race condition** — TOCTOU in `claimNextRunFallback()` allows duplicate run execution
6. **Auto-queue duplication** — Completed articles get re-evolved repeatedly

**Error Recovery & Database (from Round 2):**
7. **Budget reservation leak on retry** — Orphaned reservations cause phantom BudgetExceededError after 3-4 agent retries
8. **No SIGTERM handler** — Vercel kills at 300s with no checkpoint saved, run stuck as "running"
9. **ComparisonCache not serialized** — All comparisons re-run on resume (2-5x cost waste)
10. **Strategy aggregates RPC race** — No row lock in `update_strategy_aggregates`, concurrent runs corrupt aggregates
11. **No React error boundaries** — Any unhandled error crashes entire admin UI

The comparison/rating systems (OpenSkill, Swiss tournament, bias mitigation) are well-implemented with no critical bugs found. Agent implementations are clean with no TODO/FIXME markers. Test coverage is strong at the unit level (90+ files) but has critical gaps in integration/E2E coverage.

---

## Detailed Findings

### Category 1: Critical Bugs (Must Fix)

#### BUG-1: Strategy Config Not Propagated to Runs
- **File:** `src/lib/services/evolutionActions.ts:225-248`
- **Issue:** `queueEvolutionRunAction` only copies `enabledAgents` and `singleArticle` from strategy config to run config JSONB. Five critical fields are silently dropped: `iterations→maxIterations`, `generationModel`, `judgeModel`, `agentModels`, `budgetCaps`
- **Impact:** All production runs (trigger, cron, batch) use DEFAULT config instead of strategy config. Run 97fca15e expected 3 iterations @ $0.06, got 12 iterations with wrong models
- **Scope:** Affects `triggerEvolutionRunAction`, cron runner, batch runner. Local CLI and batch experiment unaffected (use direct config)
- **Note:** Current branch `fix/97fca15e` already addresses this

#### BUG-2: Off-by-One Iteration Counting
- **File:** `src/lib/evolution/core/pipeline.ts:865-1010`
- **Issue:** Pipeline for-loop calls `state.startNewIteration()` (increments counter) BEFORE `shouldStop()` checks `state.iteration >= maxIterations`. Final iteration enters loop, increments to N, hits shouldStop, breaks before running agents
- **Impact:** `maxIterations=N` executes only N-1 actual iterations. Checkpoint resume from iteration=2 with maxIterations=3 immediately stops
- **Related:** `supervisor.ts:233` — `shouldStop` check uses `state.iteration > this.cfg.maxIterations`
- **Note:** Current branch `fix/97fca15e` already addresses this

#### BUG-3: Semaphore Resource Leak
- **File:** `src/lib/services/llmSemaphore.ts:18-39`
- **Issue:** If LLM call throws before `.release()`, the semaphore slot is permanently leaked. No try/finally enforcement in the class API
- **Impact:** After enough errors, semaphore exhausts and all LLM calls hang forever
- **Fix:** Add `withSlot<T>(fn: () => Promise<T>): Promise<T>` method with try/finally

#### BUG-4: Cron Auth Bypass (Fail-Open)
- **Files:** `src/app/api/cron/evolution-runner/route.ts:16-21`, `evolution-watchdog/route.ts:15`, `content-quality-eval/route.ts:17`
- **Issue:** Auth check `if (cronSecret && ...)` allows all requests when `CRON_SECRET` env var is not set
- **Impact:** Publicly accessible cron endpoints in environments without CRON_SECRET
- **Fix:** Fail-closed — return 500 if CRON_SECRET is not configured

#### BUG-5: Batch Runner Race Condition (TOCTOU)
- **File:** `scripts/evolution-runner.ts:76-109`
- **Issue:** `claimNextRunFallback()` fetches pending run (SELECT), then attempts claim (UPDATE with `.eq('status', 'pending')`), but doesn't check if UPDATE actually modified a row
- **Impact:** Multiple runners can claim the same run, causing duplicate execution and wasted LLM spend
- **Fix:** Add `.select('id').single()` to verify update occurred, return null if race lost

#### BUG-6: Auto-Queue Duplication
- **File:** `src/app/api/cron/content-quality-eval/route.ts:155-159`
- **Issue:** Auto-queue checks for `pending/claimed/running` runs but not `completed`. Articles get re-queued after each evolution completes
- **Impact:** Same article evolved repeatedly, burning budget
- **Fix:** Add `'completed'` to status filter, or add time window check

---

### Category 2: High-Priority Issues

#### HIGH-1: Title Not Updated in applyWinnerAction
- **File:** `src/lib/services/evolutionActions.ts:470-473`
- **Issue:** Updates `explanations.content` but not `explanation_title`. If winning variant has different H1, title/content diverge
- **Documented:** `docs/evolution/architecture.md:194`

#### HIGH-2: Missing Transaction in applyWinnerAction
- **File:** `src/lib/services/evolutionActions.ts:423-512`
- **Issue:** Updates `content_history` (removed), `explanations.content`, and `evolution_variants.is_winner` in separate queries. Partial failure leaves inconsistent state

#### HIGH-3: Heartbeat Error Swallowing
- **File:** `src/app/api/cron/evolution-runner/route.ts:213-221`
- **Issue:** Heartbeat interval catches and swallows all errors. Repeated failures mean watchdog marks run as stale while runner thinks it's alive
- **Fix:** Add failure counter + circuit breaker (abort after 3 consecutive failures)

#### HIGH-4: ProximityAgent Pseudo-Embeddings in Production
- **File:** `src/lib/evolution/agents/proximityAgent.ts:137-140`
- **Issue:** Production mode uses character-based pseudo-embedding instead of real OpenAI embeddings. Creates systematically incorrect similarity scores
- **Fix:** Disable ProximityAgent in production until real embeddings integrated, or document limitation prominently

#### HIGH-5: ProximityAgent Memory Leak
- **File:** `src/lib/evolution/agents/proximityAgent.ts:11, 144-146`
- **Issue:** Embedding cache is instance-level and never auto-cleared. `clearCache()` only exposed for testing
- **Fix:** Clear cache at iteration boundaries or implement LRU eviction

#### HIGH-6: OutlineGenerationAgent Raw Outline Fallback
- **File:** `src/lib/evolution/agents/outlineGenerationAgent.ts:195-200`
- **Issue:** When expand step produces empty output, adds raw outline as variant text. Raw outline violates FORMAT_RULES and pollutes pool
- **Fix:** Return `success: false` instead

#### HIGH-7: IterativeEditingAgent Parse Failure = Quality Met
- **File:** `src/lib/evolution/agents/iterativeEditingAgent.ts:80-84`
- **Issue:** `qualityThresholdMet(currentCritique) && !openReview` exits early, but `openReview === null` from parse failure is indistinguishable from "no suggestions"
- **Fix:** Distinguish `null` (parse error) from `[]` (no suggestions)

#### HIGH-8: Integer Parsing Without Validation in CLI
- **File:** `scripts/evolution-runner.ts:13-21`
- **Issue:** `parseIntArg` accepts negative values (e.g., `--parallel -5`)
- **Fix:** Add min/max bounds validation

---

### Category 3: Medium-Priority Issues

#### MED-1: Supervisor Strategy Routing Gap (Documented)
- **Files:** `src/lib/evolution/agents/generationAgent.ts:11` (hardcoded STRATEGIES), `src/lib/evolution/core/supervisor.ts:194,214` (payload prepared but ignored)
- **Issue:** Supervisor prepares strategy payloads but GenerationAgent uses hardcoded `STRATEGIES` constant
- **Documented:** `docs/evolution/architecture.md:32-39`

#### MED-2: Tournament Mu vs Ordinal Scale Mismatch
- **File:** `src/lib/evolution/agents/tournament.ts:159-169`
- **Issue:** `needsMultiTurn()` uses `muDiff` but compares against `multiTurnThreshold` calibrated for Elo scale. The `/16` divisor is a heuristic approximation
- **Fix:** Use `getOrdinal()` for both sides

#### MED-3: Tournament Tiebreaker Incumbent Bias
- **File:** `src/lib/evolution/agents/tournament.ts:198-202`
- **Issue:** When tiebreaker returns TIE, winner chosen by ordinal (higher-rated wins). Creates systemic bias toward incumbents

#### MED-4: SectionEditRunner Hardcoded costUsd: 0
- **File:** `src/lib/evolution/section/sectionEditRunner.ts`
- **Issue:** Returns `costUsd: 0` despite multiple LLM calls. Misleading cost attribution

#### MED-5: Field Name Mismatch (iterations vs maxIterations)
- **Issue:** `StrategyConfig.iterations` vs `EvolutionRunConfig.maxIterations` — same concept, different names
- **Files:** `types.ts:469`, `strategyConfig.ts:16`
- **Mapping exists in `extractStrategyConfig()` and `run-batch.ts:125` but NOT in `queueEvolutionRunAction`

#### MED-6: Double Validation Logic
- **File:** `src/lib/services/evolutionActions.ts:151-152, 179-182`
- **Issue:** Same `!input.explanationId && !input.promptId` check duplicated. Second is dead code

#### MED-7: Watchdog Batch Update Race
- **File:** `src/app/api/cron/evolution-watchdog/route.ts:45-53`
- **Issue:** Marks all stale runs as failed in single UPDATE. If a run completes between SELECT and UPDATE, it gets wrongly marked as failed
- **Fix:** Add `.in('status', ['claimed', 'running'])` to UPDATE

#### MED-8: Cost Estimator Division by Zero
- **File:** `src/lib/evolution/core/costEstimator.ts:139`
- **Issue:** `textLength / baseline.avgTextLength` — if baseline has `avgTextLength = 0`, produces Infinity
- **Fix:** Guard with `baseline.avgTextLength > 0 ? ... : 1`

#### MED-9: Adaptive Allocation Not Wired
- **File:** `src/lib/evolution/core/adaptiveAllocation.ts:99-101, 199-201`
- **Issue:** ROI-based budget allocation fully implemented but not integrated into production pipeline

#### MED-10: Missing Budget Sum Rate Limiting
- **File:** `src/lib/services/evolutionActions.ts:86-90`
- **Issue:** Budget cap validation allows up to $100. No rate limiting on sum across pending runs

#### MED-11: Batch Insertion Without Transaction
- **File:** `src/app/api/cron/content-quality-eval/route.ts:168-175`
- **Issue:** Auto-queue inserts multiple runs without atomicity. Partial failure leaves inconsistent state

#### MED-12: E2E Admin Tests Skipped
- **File:** `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts:97`
- **Issue:** `adminTest.describe.skip` — all admin evolution E2E tests disabled

---

### Category 5: Database Layer Issues (Round 2)

#### DB-1: `update_strategy_aggregates` RPC Race Condition (CRITICAL)
- **File:** `supabase/migrations/20260205000005_add_evolution_strategy_configs.sql:45-80`
- **Issue:** SELECT current aggregates then UPDATE with new values — no row-level lock between them. Two parallel run completions for same strategy → lost updates on `run_count`, `avg_final_elo`, `total_cost_usd`
- **Fix:** Add `FOR UPDATE` to the SELECT

#### DB-2: Missing Index on `evolution_runs.status`
- **File:** `supabase/migrations/20260131000001_evolution_runs.sql`
- **Issue:** No composite index on `(status, created_at DESC)`. Admin UI filter queries at `evolutionActions.ts:339` do full table scans
- **Fix:** `CREATE INDEX idx_evolution_runs_status ON evolution_runs(status, created_at DESC)`

#### DB-3: No RLS Policies on Evolution Tables
- **Files:** All evolution migrations (`20260131000001` through `20260214000001`)
- **Issue:** No `ENABLE ROW LEVEL SECURITY` on any evolution table. Currently protected only by service client + `requireAdmin()`. Migration `20260131000010:8` mentions "ensure RLS policies restrict access" but none implemented
- **Risk:** Low (mitigated by server-side auth) but fails defense-in-depth

#### DB-4: N+1 in `persistAgentMetrics`
- **File:** `src/lib/evolution/core/pipeline.ts:253-274`
- **Issue:** Individual `upsert()` per agent (5-8 roundtrips). Should batch into single upsert

#### DB-5: N+1 in `feedHallOfFame`
- **File:** `src/lib/evolution/core/pipeline.ts:620-666`
- **Issue:** 6 sequential DB roundtrips (3 entries × 2 upserts). Should batch both operations

#### DB-6: Missing CHECK Constraint on `source` Column
- **File:** `supabase/migrations/20260131000008_evolution_runs_optional_explanation.sql:8`
- **Issue:** Column accepts arbitrary strings. Code at `evolutionActions.ts:218` sets dynamic values like `prompt:${input.promptId}` but no DB-level validation

#### DB-7: `costEstimator.ts` Silent Error Propagation
- **File:** `src/lib/evolution/core/costEstimator.ts:88-95`
- **Issue:** All DB errors (network, permissions) silently return `null`, same as "no baseline found". Real errors should throw

---

### Category 6: Error Flow & Recovery Issues (Round 2)

#### ERR-1: Budget Reservation Leak on Retry (CRITICAL)
- **File:** `src/lib/evolution/core/costTracker.ts:54-66`
- **Issue:** If `recordSpend()` is called without prior `reserveBudget()` (happens on agent retry), the reservation queue is empty and the original reservation is NEVER released. After 3-4 retries, `totalReserved` grows unbounded → phantom `BudgetExceededError`
- **Trace:** Retry flow at `pipeline.ts:1190-1201` does NOT roll back cost tracker state

#### ERR-2: No SIGTERM Handler in Cron Runner (CRITICAL)
- **File:** `src/app/api/cron/evolution-runner/route.ts`
- **Issue:** Zero signal handlers found in evolution code. When Vercel kills at 300s maxDuration, in-progress LLM calls are NOT awaited, no checkpoint saved, run status stays "running" until watchdog reclaims
- **Fix:** Add `process.on('SIGTERM')` handler that saves checkpoint and sets status to 'paused'

#### ERR-3: ComparisonCache Not Serialized in Checkpoints (HIGH)
- **File:** `src/lib/evolution/core/state.ts:79-103`
- **Issue:** `serializeState()` does NOT include `ctx.comparisonCache`. Cache grows to ~200 entries by iteration 10, all lost on pause/resume. All comparisons re-run on resume (2-5x cost waste)
- **Fix:** Add `comparisonCacheEntries` to `SerializedPipelineState`

#### ERR-4: Variant Persistence Silent Fail (HIGH)
- **File:** `src/lib/evolution/core/pipeline.ts:71-104`
- **Issue:** If `evolution_variants` upsert fails, error is logged as warning but NOT thrown. Run completes with status "completed" but admin UI shows empty pool. Variants only exist in checkpoint JSONB

#### ERR-5: LogBuffer Unbounded on DB Failure
- **File:** `src/lib/evolution/core/logger.ts:27-79`
- **Issue:** If Supabase connection fails, every `append()` adds to buffer but auto-flush silently fails. Buffer grows unbounded (~5MB over 500 iterations with DB down)
- **Fix:** Add max buffer size limit, drop oldest entries if flush fails

#### ERR-6: LLMRefusalError Not Caught by Agents
- **File:** `src/lib/evolution/core/llmClient.ts:30-31, 69-72`
- **Issue:** `LLMRefusalError` thrown on empty responses but no agent has `instanceof LLMRefusalError` check. Treated as transient error → retried indefinitely for content policy violations
- **Fix:** Add explicit refusal handling in agent base class

---

### Category 7: LLM Parsing & Format Validation Issues (Round 2)

#### PARSE-1: Greedy JSON Extraction (HIGH)
- **File:** `src/lib/evolution/core/jsonParser.ts:9-17`
- **Issue:** Regex `\{[\s\S]*\}` matches FIRST `{` to LAST `}`. If LLM outputs multiple JSON objects or prose after JSON, extraction fails or captures wrong content
- **Example:** `"Result: {"a":1} and {"b":2}"` extracts `{"a":1} and {"b":2}` → `JSON.parse` fails

#### PARSE-2: Template Injection via Triple-Quote Delimiter (HIGH)
- **Files:** `reflectionAgent.ts:22`, `iterativeEditingAgent.ts:427`, `debateAgent.ts:28,30,51,54,75,77`, `sectionEditRunner.ts:101`
- **Issue:** User text injected into prompts via `"""${text}"""`. If text contains `"""`, it breaks out of the delimiter, potentially allowing prompt injection
- **Fix:** Use unique sentinels like `<<<TEXT>>>` / `<<</TEXT>>>`

#### PARSE-3: No Context Window Size Check (HIGH)
- **Files:** All agents that build prompts with full article text
- **Issue:** No pre-call token estimation. For articles >10K chars, prompts can exceed DeepSeek's 64K context window → silent truncation or API error
- **Fix:** Add token estimation and truncation strategy before LLM calls

#### PARSE-4: `parseWinner` Ambiguous Heuristics
- **File:** `src/lib/evolution/comparison.ts:40-49`
- **Issue:** Overlapping match logic — `upper.startsWith('A')` matches "ACCEPT", "ACTUALLY B", "A TIE". Text containment checks can conflict with startsWith
- **Example:** "A is the winner. TEXT B is also good" returns 'A' (correct by accident but fragile)

#### PARSE-5: Format Validator H1 Position False Positive
- **File:** `src/lib/evolution/agents/formatValidator.ts:33-38`
- **Issue:** Rejects valid markdown with leading blank lines before H1. Checks `h1Lines[0] !== firstNonempty` but logic triggers even when H1 is on first non-empty line

#### PARSE-6: Code Block Stripping Deletes Valid Content
- **File:** `src/lib/evolution/agents/formatValidator.ts:47-48`
- **Issue:** Second regex `/```[\s\S]*$/g` for unclosed blocks also matches from last closed ``` to EOF, deleting valid content after the last code block

#### PARSE-7: Sentence Detection False Positives
- **File:** `src/lib/evolution/agents/formatValidator.ts:83`
- **Issue:** Regex counts abbreviations as sentence ends ("Dr. Smith" = 2 sentences). Also doesn't handle ellipses, Unicode punctuation, or Asian full-width punctuation

---

### Category 8: Frontend/Admin UI Issues (Round 2)

#### UI-1: No React Error Boundaries (CRITICAL)
- **Files:** All admin evolution pages (`/admin/quality/evolution/**`)
- **Issue:** No error boundary wrapping any evolution admin page. Unhandled React error crashes entire admin UI

#### UI-2: No Confirmation Dialog for `applyWinner` (CRITICAL)
- **File:** `src/app/.../page.tsx` (admin evolution page, line 710-730)
- **Issue:** `handleApplyWinner` overwrites production article content with no confirmation dialog. Accidental clicks irreversible

#### UI-3: No Optimistic Updates on Mutations (CRITICAL)
- **Files:** All mutation handlers in admin evolution pages
- **Issue:** Apply winner, rollback, trigger run — all show no immediate UI feedback for 2-3 seconds. Users double-click causing duplicate submissions

#### UI-4: VariantsTab Sparkline Key Collision
- **File:** `src/components/evolution/tabs/VariantsTab.tsx:56-71`
- **Issue:** Uses `shortId` (first 8 chars of variant ID) as React key. Hash collision → wrong Elo trend displayed

#### UI-5: LogsTab Auto-Scroll Overrides User Position
- **File:** `src/components/evolution/tabs/LogsTab.tsx:88-94`
- **Issue:** Auto-scrolls to bottom every log update. If user scrolls up to read, yanked back down. Missing "is user at bottom" check

#### UI-6: AutoRefreshProvider Visibility Race
- **File:** `src/components/evolution/AutoRefreshProvider.tsx:88-101`
- **Issue:** When tab becomes visible, calls `doRefresh` then `startPolling` without waiting. If refresh is slow, polling starts immediately → double-fetch

#### UI-7: BudgetTab Stale Closure
- **File:** `src/components/evolution/tabs/BudgetTab.tsx:98-104`
- **Issue:** `load` function in interval captures old `runId`. If user navigates between runs quickly, interval fetches wrong run's data

---

### Category 4: Verified Correct Patterns

The following systems were audited and found to be well-implemented:

- **Position bias mitigation** — 2-pass A/B reversal correctly implemented in `comparison.ts`, `diffComparison.ts`, `pairwiseRanker.ts`
- **OpenSkill rating system** — Proper Weng-Lin Bayesian wrapper with correct ordinal calculation (mu - 3*sigma)
- **Swiss pairing** — Info-theoretic pairing maximizing information gain, correctly implemented
- **Cache key generation** — Order-invariant SHA-256 hashing with length prefixes prevents collisions
- **CostTracker FIFO reservation** — Well-implemented budget enforcement
- **BeamSearch error handling** — Budget errors captured during allSettled, re-thrown after partial results processed
- **SectionDecompositionAgent budget reservation** — Upfront reservation before parallel fan-out
- **DebateAgent baseline exclusion** — Correctly requires 2+ non-baseline rated variants
- **PairwiseRanker concurrent rounds** — Forward/reverse via Promise.all, correctly independent

---

## Test Coverage Assessment

| Area | Unit | Integration | E2E | Gap Severity |
|------|:----:|:-----------:|:---:|:------------:|
| Full pipeline (EXPANSION→COMPETITION) | Yes | No | No | **HIGH** |
| Strategy config → run config propagation | No | No | No | **CRITICAL** |
| Max iterations enforcement | Yes (has bug) | No | No | **CRITICAL** |
| Checkpoint resume | Yes | No | No | HIGH |
| Concurrent run execution | No | Yes | No | MEDIUM |
| Admin UI workflows | No | No | No (skipped) | MEDIUM |
| Comparison/rating systems | Yes | Yes | No | LOW |
| Agent implementations | Yes | Partial | No | LOW |

**Stats:** 90+ unit test files, 9 integration test files, 2 E2E files (1 skipped), 9 integration suites auto-skip if evolution tables missing

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/reference.md
- docs/evolution/cost_optimization.md
- docs/evolution/architecture.md
- docs/evolution/strategy_experiments.md
- docs/evolution/agents/overview.md
- docs/evolution/agents/tree_search.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/agents/generation.md
- docs/evolution/agents/editing.md
- docs/evolution/agents/support.md

### Previous Research
- docs/planning/97fca15e_run_evolution_not_respecting_max_iterations_20260214/ (config propagation + off-by-one bugs)

## Code Files Read

### Core Infrastructure (~16 files)
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator (1318 lines)
- `src/lib/evolution/core/supervisor.ts` — Phase transitions (295 lines)
- `src/lib/evolution/core/state.ts` — Mutable state model (140 lines)
- `src/lib/evolution/core/costTracker.ts` — Budget enforcement (93 lines)
- `src/lib/evolution/core/diversityTracker.ts` — Pool health monitoring
- `src/lib/evolution/core/pool.ts` — Stratified opponent selection
- `src/lib/evolution/core/validation.ts` — State contract guards
- `src/lib/evolution/core/llmClient.ts` — LLM wrapper
- `src/lib/evolution/core/logger.ts` — DB-buffered logger
- `src/lib/evolution/core/featureFlags.ts` — Feature flag system
- `src/lib/evolution/core/errorClassification.ts` — Transient error detection
- `src/lib/evolution/core/budgetRedistribution.ts` — Agent budget scaling
- `src/lib/evolution/core/agentToggle.ts` — Agent dependency enforcement
- `src/lib/evolution/core/adaptiveAllocation.ts` — ROI-based allocation (unused)
- `src/lib/evolution/config.ts` — Default config + merge logic
- `src/lib/evolution/index.ts` — Barrel exports + factory functions
- `src/lib/evolution/types.ts` — Shared type definitions

### Agent Implementations (~15 files)
- `src/lib/evolution/agents/base.ts` — AgentBase abstract class
- `src/lib/evolution/agents/generationAgent.ts` — 3-strategy parallel generation
- `src/lib/evolution/agents/calibrationRanker.ts` — Pairwise calibration
- `src/lib/evolution/agents/tournament.ts` — Swiss-style tournament
- `src/lib/evolution/agents/evolvePool.ts` — Genetic evolution (mutation/crossover)
- `src/lib/evolution/agents/reflectionAgent.ts` — Dimensional critique
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Critique-driven edits
- `src/lib/evolution/agents/sectionDecompositionAgent.ts` — Section-level decomposition
- `src/lib/evolution/agents/debateAgent.ts` — 3-turn structured debate
- `src/lib/evolution/agents/outlineGenerationAgent.ts` — 6-step outline pipeline
- `src/lib/evolution/agents/metaReviewAgent.ts` — Strategy analysis (zero-cost)
- `src/lib/evolution/agents/proximityAgent.ts` — Diversity via embeddings
- `src/lib/evolution/agents/pairwiseRanker.ts` — Bias-mitigated comparison
- `src/lib/evolution/agents/formatValidator.ts` — Format enforcement
- `src/lib/evolution/section/sectionEditRunner.ts` — Per-section critique loop

### Comparison & Rating (~8 files)
- `src/lib/evolution/comparison.ts` — Standalone bias-mitigated comparison
- `src/lib/evolution/diffComparison.ts` — CriticMarkup diff comparison
- `src/lib/evolution/core/comparisonCache.ts` — Order-invariant cache
- `src/lib/evolution/core/rating.ts` — OpenSkill (Weng-Lin Bayesian) wrapper
- `src/lib/evolution/core/strategyConfig.ts` — Strategy config hashing
- `src/lib/evolution/core/costEstimator.ts` — Data-driven cost estimation
- `src/lib/evolution/flowRubric.ts` — Dimension definitions
- `src/lib/evolution/treeOfThought/beamSearch.ts` — Beam search core

### Integration Points (~10 files)
- `src/lib/services/evolutionActions.ts` — Queue/trigger/apply winner actions
- `src/lib/services/llmSemaphore.ts` — Concurrency control
- `scripts/evolution-runner.ts` — Batch runner
- `scripts/run-evolution-local.ts` — Local CLI
- `scripts/run-strategy-experiment.ts` — Strategy experiment runner
- `scripts/run-prompt-bank.ts` — Prompt bank runner
- `scripts/lib/hallOfFameUtils.ts` — Prompt bank integration
- `src/app/api/cron/evolution-runner/route.ts` — Cron runner endpoint
- `src/app/api/cron/evolution-watchdog/route.ts` — Stale run watchdog
- `src/app/api/cron/content-quality-eval/route.ts` — Auto-queue cron

### Test Files (~5 files sampled)
- `src/__tests__/integration/evolution-pipeline.integration.test.ts`
- `src/__tests__/integration/evolution-actions.integration.test.ts`
- `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts`
- `src/testing/utils/evolution-test-helpers.ts`
- Various `*.test.ts` files across agent implementations

### Database Layer (Round 2, ~17 files)
- `supabase/migrations/20260131000001_evolution_runs.sql` — Main schema
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` — Agent metrics
- `supabase/migrations/20260205000003_add_evolution_agent_cost_baselines.sql` — Cost baselines
- `supabase/migrations/20260205000005_add_evolution_strategy_configs.sql` — Strategy configs + RPC
- `supabase/migrations/20260207000002_prompt_fk_on_runs.sql` — Prompt FK
- `supabase/migrations/20260207000006_explorer_composite_indexes.sql` — Composite indexes
- `supabase/migrations/20260214000001_claim_evolution_run.sql` — Claim RPC
- All other evolution-related migration files

### Frontend/Admin UI (Round 2, ~15 files)
- `src/app/.../admin/quality/evolution/page.tsx` — Main evolution admin page
- `src/app/.../admin/evolution-dashboard/page.tsx` — Dashboard overview
- `src/app/.../admin/quality/evolution/run/[runId]/page.tsx` — Run detail
- `src/app/.../admin/quality/evolution/run/[runId]/compare/page.tsx` — Compare view
- `src/components/evolution/tabs/VariantsTab.tsx` — Variants table
- `src/components/evolution/tabs/LogsTab.tsx` — Log viewer
- `src/components/evolution/tabs/TimelineTab.tsx` — Timeline view
- `src/components/evolution/tabs/BudgetTab.tsx` — Budget chart
- `src/components/evolution/AutoRefreshProvider.tsx` — Auto-refresh logic
- `src/lib/services/evolutionVisualizationActions.ts` — Dashboard data
- `src/lib/services/evolutionBatchActions.ts` — Batch actions

### LLM Parsing & Format Validation (Round 2, ~8 files)
- `src/lib/evolution/core/jsonParser.ts` — JSON extraction from LLM output
- `src/lib/evolution/core/llmClient.ts` — Structured output handling
- `src/lib/evolution/agents/formatValidator.ts` — Prose format rules
- `src/lib/evolution/agents/formatRules.ts` — FORMAT_RULES prompt constant
- `src/lib/evolution/section/sectionFormatValidator.ts` — Section-level validation
- `src/lib/evolution/section/sectionParser.ts` — Section splitting
- `src/lib/evolution/flowRubric.ts` — Friction spot parsing
- All agent prompt construction functions

---

## Round 3 Findings (4 Parallel Deep-Dive Agents)

Round 3 used 4 specialized explore agents running in parallel, each focused on a different domain. Findings below are **new** — duplicates of Round 1/2 findings have been removed.

### Category 9: Core Infrastructure — New Findings

#### CORE-1: Strategy Rotation Index Out-of-Bounds (HIGH)
- **File:** `src/lib/evolution/core/supervisor.ts:156-161, 200`
- **Issue:** `transitionToCompetition()` sets `_strategyRotationIndex = -1`. On first COMPETITION iteration, `getCompetitionConfig()` accesses `GENERATION_STRATEGIES[this._strategyRotationIndex]` before increment happens — reads `GENERATION_STRATEGIES[-1]` which is `undefined`
- **Impact:** Crashes with undefined strategy on EXPANSION→COMPETITION transition
- **Fix:** Increment index before config access, or initialize to 0 instead of -1

#### CORE-2: Feature Flag Mutex Enforcement is One-Directional (MEDIUM)
- **File:** `src/lib/evolution/core/featureFlags.ts:86-89`
- **Issue:** `fetchEvolutionFeatureFlags()` forces `iterativeEditing=false` when `treeSearch=true`, but NOT the reverse. Inconsistent with bidirectional `MUTEX_AGENTS` validation in `budgetRedistribution.ts`
- **Impact:** Can enable both mutex agents simultaneously via flags
- **Fix:** Add reciprocal enforcement: if iterativeEditing enabled, force treeSearch false

#### CORE-3: getCalibrationOpponents Returns Fewer Than Requested (MEDIUM)
- **File:** `src/lib/evolution/core/pool.ts:27-93`
- **Issue:** When `n >= 5` but pool is small (e.g., 4 variants), the stratified sampling can yield only 3 opponents. Dedup at line 92 can't recover missing slots
- **Impact:** Calibration runs with fewer opponents than configured, reducing rating convergence
- **Fix:** Add fallback loop to pad opponents from available pool until `n` reached

#### CORE-4: Phase Transition Boundary Inconsistency (MEDIUM)
- **File:** `src/lib/evolution/core/supervisor.ts:112, 233`
- **Issue:** Phase detection uses `>=` at line 112 (`state.iteration >= expansionMaxIterations`) but stopping uses `>` at line 233 (`state.iteration > maxIterations`). Inconsistent boundary semantics
- **Impact:** EXPANSION may get one fewer iteration than expected; off-by-one in phase timing
- **Fix:** Use consistent comparison operator across both checks

#### CORE-5: Dual Agent Gating Mechanisms Contradict (MEDIUM)
- **File:** `src/lib/evolution/core/supervisor.ts:163-167`, `pipeline.ts:934, 976`
- **Issue:** `isEnabled()` returns `true` for all agents when `cfg.enabledAgents` is undefined. But pipeline also checks `ctx.featureFlags` independently. Two gates that can contradict: supervisor says "enabled" while feature flag says "disabled"
- **Impact:** Confusing config model; agents may run when feature flag intended to disable them
- **Fix:** Make `isEnabled()` also check feature flags, or always populate `enabledAgents` from flags

#### CORE-6: Pool Statistics Crash on Variants Without Ratings (LOW-MEDIUM)
- **File:** `src/lib/evolution/core/pool.ts:102-133`
- **Issue:** `poolStatistics()` computes ordinals from `state.ratings` but doesn't guard against zero-length ordinals array when pool has variants but no ratings yet
- **Impact:** `Math.min(...[])` returns `Infinity`, `Math.max(...[])` returns `-Infinity` — corrupted stats
- **Fix:** Guard: `if (ordinals.length === 0) return defaultStats;`

---

### Category 10: Agent Implementation — New Findings

#### AGENT-1: MetaReviewAgent `avg()` Division by Zero (MEDIUM)
- **File:** `src/lib/evolution/agents/metaReviewAgent.ts:255-257`
- **Issue:** `avg(arr)` returns `NaN` when `arr.length === 0` (no guard). NaN propagates through `_analyzeStrategies()` and `_findFailures()`, poisoning strategy ranking
- **Impact:** Successful strategies silently filtered out when comparison returns `false` for `NaN > avgOrd`
- **Fix:** `return arr.length === 0 ? 0 : arr.reduce((a,b) => a+b, 0) / arr.length;`

#### AGENT-2: EvolvePool `maxParentVersion` Empty Array (MEDIUM)
- **File:** `src/lib/evolution/agents/evolvePool.ts:218-236`
- **Issue:** `Math.max(...parents.filter(p => parentIds.includes(p.id)).map(p => p.version))` — if filter yields empty array, `Math.max()` returns `-Infinity`, version becomes `NaN`
- **Impact:** Corrupted pool variant versions
- **Fix:** Default to 0 if no eligible parents found

#### AGENT-3: Tournament Convergence Set Membership Failure (MEDIUM)
- **File:** `src/lib/evolution/agents/tournament.ts:374-385`
- **Issue:** `topKSet` contains Rating objects from sorted array. Filter uses `topKSet.has(r)` with reference equality — always false since sort creates new references
- **Impact:** Convergence check never recognizes top-K variants, causing tournaments to run longer than necessary
- **Fix:** Use variant ID set instead of Rating object set

#### AGENT-4: DiffComparison `parseToMdast` Biases Toward UNSURE (MEDIUM)
- **File:** `src/lib/evolution/diffComparison.ts:12-20, 47`
- **Issue:** `catch` block returns `null` for ALL errors (including import failures). Both ASTs null → `{ verdict: 'UNSURE', confidence: 0 }`. IterativeEditingAgent treats UNSURE as rejection → increments `consecutiveRejections`
- **Impact:** Import failures or transient errors prematurely terminate editing cycles
- **Fix:** Distinguish parse failures from import failures; re-throw fatal errors

#### AGENT-5: SectionDecompositionAgent No Bounds Check on Section Index (MEDIUM)
- **File:** `src/lib/evolution/agents/sectionDecompositionAgent.ts:120-122`
- **Issue:** `result.value.sectionIndex` from `runSectionEdit` used directly as key without validating it's within `sectionDetails` bounds
- **Impact:** Orphaned replacements at wrong positions → section misalignment in output
- **Fix:** Add `if (idx >= 0 && idx < sectionDetails.length)` guard

#### AGENT-6: DebateAgent Excludes Unrated Non-Baseline Variants (MEDIUM)
- **File:** `src/lib/evolution/agents/debateAgent.ts:198-204`
- **Issue:** `getTopByRating()` prioritizes rated variants. Unrated non-baseline variants skipped even though debating them could produce useful rating signals
- **Impact:** Debate agent fails unnecessarily when non-baseline candidates exist but haven't been rated yet
- **Fix:** Include unrated non-baseline variants in eligibility check

#### AGENT-7: CalibrationRanker Early Exit Despite Low Confidence (LOW)
- **File:** `src/lib/evolution/agents/calibrationRanker.ts:172-175`
- **Issue:** `allDecisive` checks `confidence >= 0.7` per match but doesn't aggregate. If 2/3 matches have 0.71 confidence and 1 has 0.99, early exit triggers despite weak aggregate signal
- **Impact:** Calibration may terminate prematurely with weak confidence ratings
- **Fix:** Also check average confidence threshold

#### AGENT-8: Tournament `swissPairing` Fallback With Pool < 2 (LOW)
- **File:** `src/lib/evolution/agents/tournament.ts:82-85`
- **Issue:** Fallback `eligible = withOrdinals.slice(0, 2)` with pool size 1 yields 1 element. Subsequent pairing logic assumes ≥2 candidates
- **Impact:** Tournament reports success with 0 matches instead of failing gracefully
- **Fix:** Return empty pairs early if `variants.length < 2`

#### AGENT-9: BeamSearch Stale Critique on Re-Critique Failure (LOW)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:235-266`
- **Issue:** When `runInlineCritique` returns `null` (parse failure), old critique is reused. Stale critique dimensions may not apply to revised text
- **Impact:** Beam search targets obsolete dimensions, wasting budget
- **Fix:** Flag critique as stale; optionally skip revision if critique outdated

#### AGENT-10: PairwiseRanker Missing dimensionScores Validation (LOW)
- **File:** `src/lib/evolution/agents/pairwiseRanker.ts:134-145`
- **Issue:** `normalizeReversedResult` calls `Object.entries(dimensionScores)` without null check. `parseStructuredResponse` can return `{}` but malformed LLM output may yield `null`
- **Impact:** Tournament matching crashes on malformed LLM responses
- **Fix:** Guard with `dimensionScores ?? {}` before `Object.entries()`

#### AGENT-11: MetaReviewAgent Unvalidated `iterationBorn` (LOW)
- **File:** `src/lib/evolution/agents/metaReviewAgent.ts:60-63`
- **Issue:** `Math.max(...top3.map(v => v.iterationBorn))` — if `iterationBorn` is undefined, returns NaN → propagates to telemetry JSON
- **Fix:** Default: `v.iterationBorn ?? state.iteration`

#### AGENT-12: IterativeEditingAgent Critique ID Ownership Ambiguity (LOW)
- **File:** `src/lib/evolution/agents/iterativeEditingAgent.ts:160-163`
- **Issue:** After edit acceptance, `runInlineCritique(editedText, current.id)` stores critique with new variant's ID, but next cycle reuses it as if belonging to current variant
- **Impact:** `allCritiques` may accumulate critiques with stale variant IDs

#### AGENT-13: Tournament `budgetPressureConfig` Boundary at 0.5 (LOW)
- **File:** `src/lib/evolution/agents/tournament.ts:20-28`
- **Issue:** At `pressure === 0.5` exactly, first condition `pressure < 0.5` is false → falls to medium tier. Boundary should use `<=`
- **Fix:** Use `pressure <= 0.5` for low-pressure tier

---

### Category 11: Scripts, Cron & Integration — New Findings

#### SCRIPT-1: Migration NOT NULL Constraint Conflict (CRITICAL)
- **File:** `supabase/migrations/20260207000008_enforce_not_null.sql:26-30`
- **Issue:** Migration enforces `ALTER COLUMN prompt_id SET NOT NULL` and `ALTER COLUMN strategy_config_id SET NOT NULL`, but `queueEvolutionRunAction` (evolutionActions.ts:230-231) creates runs with NULL for these columns when only `explanationId` provided
- **Impact:** Schema migration will fail in production if legacy runs exist without prompt_id/strategy_config_id
- **Fix:** Remove NOT NULL constraint, or ensure all code paths always populate both columns

#### SCRIPT-2: Missing NULL Check on Variant Content Before Apply (MEDIUM)
- **File:** `src/lib/services/evolutionActions.ts:470-473`
- **Issue:** `.update({ content: variant.variant_content })` doesn't validate that `variant_content` is non-null/non-empty before applying to production article
- **Impact:** Corrupted (empty) article content can be written to production
- **Fix:** Add `if (!variant.variant_content?.trim()) throw new Error('Empty variant content');`

#### SCRIPT-3: Error Message Truncation Loses Debug Context (MEDIUM)
- **File:** `scripts/evolution-runner.ts:225`
- **Issue:** Error message sliced to 2000 chars — stack traces and exception types truncated
- **Impact:** Production debugging harder when root cause info is in truncated portion
- **Fix:** Store full error in separate JSONB `error_detail` column

#### SCRIPT-4: Hard-Coded Stale Threshold in Watchdog (MEDIUM)
- **File:** `src/app/api/cron/evolution-watchdog/route.ts:8`
- **Issue:** `STALE_THRESHOLD_MINUTES = 10` is hard-coded. Infrastructure delays >10 min cause healthy runs to be killed
- **Fix:** Make configurable via env var; default to 15-20 min

#### SCRIPT-5: Missing Auto-Queue Article Validation (MEDIUM)
- **File:** `src/app/api/cron/content-quality-eval/route.ts:148-150`
- **Issue:** Auto-queue filters by `score < 0.4` but doesn't validate: score is 0-1 (could be NaN), article still exists, article is published
- **Impact:** May queue deleted/unpublished articles, causing pipeline failures
- **Fix:** Add `.eq('status', 'published')` and score bounds check

#### SCRIPT-6: Unchecked Promise in Post-Evolution Eval (MEDIUM)
- **File:** `src/lib/services/evolutionActions.ts:500-506`
- **Issue:** Post-evolution eval trigger uses `.catch()` that only logs — eval failure is silently swallowed after winner is already applied
- **Impact:** Admin dashboard shows incomplete quality data with no user feedback
- **Fix:** Store eval trigger error in run logs or return warning in response

#### SCRIPT-7: Prompt-Based Runs Can't Apply Winners (MEDIUM)
- **File:** `src/lib/services/evolutionActions.ts:452-462`
- **Issue:** Prompt-based runs have `explanation_id = null`. `applyWinnerAction` inserts into `content_history` (removed) which has NOT NULL constraint on `explanation_id`
- **Impact:** Winner application broken for non-explanation runs
- **Fix:** Skip content_history for prompt-based runs, or make explanation_id nullable

#### SCRIPT-8: Feature Flag Race in Cron Runner (LOW)
- **File:** `src/app/api/cron/evolution-runner/route.ts:75-92`
- **Issue:** Feature flags fetched AFTER run claim. If flag changes between claim and check, run is marked "completed" with "dry-run" despite being intended to execute
- **Fix:** Check feature flags BEFORE claiming run

#### SCRIPT-9: Dashboard Queries Fetch Full JSONB (LOW)
- **File:** `src/lib/services/evolutionVisualizationActions.ts:209`
- **Issue:** `.select('*')` fetches all fields including large JSONB (config, state_snapshot) for dashboard list view
- **Fix:** Select only necessary fields for list view

---

### Category 12: Frontend & Admin UI — New Findings

#### FE-1: Unsafe Type Assertions on Snapshot Data (HIGH)
- **File:** `src/lib/services/evolutionVisualizationActions.ts:474, 527, 713, 843, 922`
- **Issue:** Multiple `as SerializedPipelineState` casts without validation. Corrupted Supabase data will cause runtime errors on `snapshot.pool.map()` etc.
- **Fix:** Add zod schema validation on snapshot before casting

#### FE-2: Variants Tab Inconsistent Loading State (MEDIUM)
- **File:** `src/components/evolution/tabs/VariantsTab.tsx:29-51`
- **Issue:** Three parallel requests (variants, eloHistory, stepScores) with separate error handling. If variants fails but eloHistory succeeds, sparkline tries to render against empty variant data
- **Fix:** Treat any critical request failure as tab-wide error

#### FE-3: D3 Import Race in TreeTab (MEDIUM)
- **File:** `src/components/evolution/tabs/TreeTab.tsx:112-115`
- **Issue:** `renderTree` useCallback imports d3 dynamically. Fast double-renders can trigger concurrent imports before first completes
- **Fix:** Move d3 import to module level (SSR already disabled) or guard with ref flag

#### FE-4: Date Format Assumption in Dashboard (MEDIUM)
- **File:** `src/lib/services/evolutionVisualizationActions.ts:239, 252`
- **Issue:** Uses `created_at.substring(0, 10)` to extract date — assumes ISO format. Different timezone formats break date grouping for runsPerDay/dailySpend charts
- **Fix:** Use `new Date(created_at).toISOString().split('T')[0]`

#### FE-5: Missing URL Parameter Validation (MEDIUM)
- **File:** `src/app/admin/quality/evolution/run/[runId]/page.tsx:168`
- **Issue:** `runId` from params passed directly to server actions without UUID validation at page level
- **Fix:** Validate with UUID regex before passing to actions

#### FE-6: Accessibility — Missing Form Labels (MEDIUM)
- **File:** `src/app/admin/quality/evolution/page.tsx:248-260`
- **Issue:** Select dropdowns lack `htmlFor`/`id` association. Screen readers can't associate labels with inputs
- **Fix:** Add `id` to inputs and `htmlFor` to labels

#### FE-7: LogsTab Missing Pagination (MEDIUM)
- **File:** `src/components/evolution/tabs/LogsTab.tsx:58`
- **Issue:** Hardcodes `limit: 500` with no pagination. Large runs produce massive payloads
- **Fix:** Implement cursor-based pagination or virtual scrolling

#### FE-8: QueueDialog Validation Only On Submit (LOW)
- **File:** `src/app/admin/quality/evolution/page.tsx:487-497`
- **Issue:** Form validation only on submit — no inline feedback. Users don't know inputs are invalid until after clicking
- **Fix:** Add onBlur validation or disable submit when inputs invalid

#### FE-9: TimelineTab Unsafe String Split (LOW)
- **File:** `src/components/evolution/tabs/TimelineTab.tsx:214-216`
- **Issue:** Splits `firstKey` with hardcoded delimiter without format validation. Malformed key → `Number(undefined)` → NaN
- **Fix:** Add key format validation

#### FE-10: Missing Null Check Before Pool Access in Visualization (LOW)
- **File:** `src/lib/services/evolutionVisualizationActions.ts:804-813`
- **Issue:** Iterates `state.pool` without checking for undefined/null pool
- **Fix:** Add `if (!state.pool?.length) return { success: true, data: [] };`

---

### Category 13: Test Infrastructure — New Findings

#### TEST-1: E2E Tests Skipped Without Conditional Check (MEDIUM)
- **File:** `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts:97`
- **Issue:** Tests use `.skip` unconditionally. No runtime check for whether migrations have been applied — tests stay skipped forever
- **Fix:** Use conditional skip: `adminTest.skip.if(!TABLES_MIGRATED)`

#### TEST-2: Test Helpers Don't Validate Schema (LOW)
- **File:** `src/testing/utils/evolution-test-helpers.ts:159-184`
- **Issue:** `createTestEvolutionRun` inserts with minimal validation. Schema changes cause cryptic FK errors
- **Fix:** Add schema validation in factory functions

#### TEST-3: Test Cleanup Doesn't Handle Dependent Deletes (LOW)
- **File:** `src/testing/utils/evolution-test-helpers.ts:96-101`
- **Issue:** `evolution_strategy_configs` and `evolution_hall_of_fame_topics` aren't deleted "because shared". If test crashes, fixtures leak into next run
- **Fix:** Track per-test fixtures and clean up in afterEach

---

### Round 3 Summary

| Category | Critical | High | Medium | Low | Total |
|----------|:--------:|:----:|:------:|:---:|:-----:|
| Core Infrastructure | — | 1 | 4 | 1 | 6 |
| Agent Implementation | — | — | 6 | 7 | 13 |
| Scripts/Cron/Integration | 1 | — | 6 | 2 | 9 |
| Frontend/Admin UI | — | 1 | 6 | 3 | 10 |
| Test Infrastructure | — | — | 1 | 2 | 3 |
| **Total** | **1** | **2** | **23** | **15** | **41** |

### Cumulative Audit Totals (Rounds 1-3)

| Severity | Round 1-2 | Round 3 | Total |
|----------|:---------:|:-------:|:-----:|
| Critical | 11 | 1 | 12 |
| High | 14 | 2 | 16 |
| Medium | 19 | 23 | 42 |
| Low | — | 15 | 15 |
| **Total** | **44** | **41** | **85** |

---

## Round 4 Findings (4 Parallel Deep-Dive Agents)

Round 4 used 4 specialized explore agents focused on: (1) tree search & section editing, (2) configuration flow end-to-end, (3) cost & checkpoint systems, (4) strategy experiments & scripts. Findings below are **new** — duplicates of Round 1-3 findings removed.

### Category 14: Tree Search & Beam Search — New Findings

#### BEAM-1: Orphaned Tree Nodes on Generation Failure (HIGH)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:177-232`
- **Issue:** `createChildNode()` adds node to treeState BEFORE LLM generation. If generation rejects (non-BudgetExceededError), the node exists in the tree but has no corresponding text/candidate
- **Impact:** Tree state becomes inconsistent; traversal code expecting variant text for every node will fail
- **Fix:** Create childNode AFTER successful generation, or remove node on failure

#### BEAM-2: Cross-Scale Weakness Targeting Mixes Incompatible Dimensions (HIGH)
- **File:** `src/lib/evolution/flowRubric.ts:308-335`
- **Issue:** `getWeakestDimensionAcrossCritiques()` normalizes quality (1-10) and flow (0-5) scores to [0,1] then compares. Dimension names differ across systems ("clarity" vs "local_cohesion"), so weakest might come from wrong system
- **Impact:** Revision actions target wrong weakness — e.g., targets "clarity" (quality) when "local_cohesion" (flow) is actually weaker
- **Fix:** Track source field and prefer one system, or return multiple weakest dimensions

#### BEAM-3: Stale Parent Critique Fallback to Root (HIGH)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:128`
- **Issue:** When re-critique fails, falls back to `critiqueByNodeId.get(s.node.parentNodeId ?? '')`. With `parentNodeId = null` (depth 1), queries empty string `''` — never matches — falls to `rootCritique`. At depth 2+, member gets root's critique instead of parent's
- **Impact:** Dimension targeting misaligned — revisions target depth-0 weaknesses instead of actual parent's
- **Fix:** Explicitly use parent critique chain: `critiqueByNodeId.get(s.node.parentNodeId) ?? rootCritique`

#### BEAM-4: Depth-1 Candidates Ranked With Unmatched Critiques (MEDIUM)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:42-49`
- **Issue:** Re-critique only triggers `if (depth >= 2)`. Depth-1 candidates get ranked using rootCritique dimension scores, which don't reflect revised content
- **Impact:** Subsequent depth-2+ generation targets dimensions based on mismatched critiques
- **Fix:** Either re-critique at depth >= 1, or document that ranking is relative (all depth-1 share same base)

#### BEAM-5: `reCritiqueBeam` Returns Shorter Beam Silently (MEDIUM)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:263-265`
- **Issue:** `Promise.allSettled()` results filtered to only `fulfilled` — rejected members silently dropped. Returned beam can be shorter than input with no warning
- **Impact:** Generation happens with reduced beam width silently
- **Fix:** Log rejections and count

#### BEAM-6: Flow Critique Scale Not Validated (MEDIUM)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:182-188`
- **Issue:** `getFlowCritiqueForVariant()` expects `scale === '0-5'`. If flow critique uses different scale, `normalizeScore()` produces incorrect results
- **Fix:** Add explicit scale validation in `getWeakestDimensionAcrossCritiques()`

#### BEAM-7: No maxDepth Validation (MEDIUM)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:42`
- **Issue:** If `maxDepth < 1` (negative or NaN from config), loop never executes. Returns success with 0 depth, misleading consumers
- **Fix:** `if (config.maxDepth < 1) throw new Error('maxDepth must be >= 1')`

#### BEAM-8: Node Value Overwrite Loses Ranking Information (LOW)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:144-147`
- **Issue:** Final beam sets top node `value=1`, rest `value=0`, overwriting prior ranking info. `getBestLeaf()` may select a node with value=0
- **Fix:** Use ordinal-based values instead of binary

#### BEAM-9: Pruning Only Marks Rejected, Not All Non-Selected (LOW)
- **File:** `src/lib/evolution/treeOfThought/beamSearch.ts:114-120`
- **Issue:** Non-selected survivors remain unpruned in tree state, inflating tree size metrics
- **Fix:** Explicitly mark all non-selected as pruned at end of each depth

---

### Category 15: Section Editing Pipeline — New Findings

#### SEC-1: Section Stitcher Silently Ignores Out-of-Bounds Replacements (MEDIUM)
- **File:** `src/lib/evolution/section/sectionStitcher.ts:25-28`
- **Issue:** If `replacements.set(999, 'text')` with index out of bounds, replacement is silently not applied. No warning logged
- **Impact:** Section edits silently fail if decomposition agent computes wrong indices
- **Fix:** Check for unused replacements after stitching; log warning

#### SEC-2: No Diagnostic Logging for Format Validation Failure After Stitch (MEDIUM)
- **File:** `src/lib/evolution/agents/sectionDecompositionAgent.ts:141-154`
- **Issue:** After stitching, if `validateFormat()` fails, agent returns early but doesn't log WHICH sections caused the failure
- **Fix:** Validate each edited section individually before returning

#### SEC-3: Section Detail Tracking Silent Failure (MEDIUM)
- **File:** `src/lib/evolution/agents/sectionDecompositionAgent.ts:121-122`
- **Issue:** `sectionDetails.find(s => s.index === result.value.sectionIndex)` — if find returns undefined (index mismatch), `improved` flag never set. Execution detail shows `improved: false` for actually-improved sections
- **Fix:** Assert find succeeds or log warning

#### SEC-4: Section Edit Runner Doesn't Track Cycle Count (LOW)
- **File:** `src/lib/evolution/section/sectionEditRunner.ts:49-79`
- **Issue:** Edit loop returns `improved=true` but no metadata about which cycle succeeded or how many were tried
- **Fix:** Return `{ cyclesUsed: number }` for post-analysis

#### SEC-5: FORMAT_RULES Not Enforced Until Late Validation (LOW)
- **File:** `src/lib/evolution/agents/formatRules.ts:4-8`
- **Issue:** FORMAT_RULES injected into prompts as instructions, but violations aren't caught until `validateFormat()`. Wasted generation cycles when LLM ignores rules
- **Fix:** Add pre-flight format check before adding variant to pool

#### SEC-6: SectionEditResult `costUsd` Always Zero (LOW)
- **File:** `src/lib/evolution/section/sectionEditRunner.ts:81-86`
- **Issue:** `costUsd: 0` with comment "Cost tracked via costTracker, not per-call". Field creates false contract — consumers might assume it has data. Already documented as MED-4 but the interface issue is new
- **Fix:** Remove `costUsd` from interface or populate it

---

### Category 16: Configuration Flow — New Findings

#### CFG-1: budgetCaps Not Passed to Cost Estimator at Queue Time (CRITICAL)
- **File:** `src/lib/services/evolutionActions.ts:187-198`
- **Issue:** `estimateRunCostWithAgentModels` is called without `budgetCaps` from strategy config. Estimates use default budget distribution, not custom per-agent caps
- **Impact:** Cost estimates wrong for strategies with custom budget distributions — users get budget surprises at runtime
- **Fix:** Pass `budgetCaps` from strategyConfig to estimator

#### CFG-2: agentModels Not Integrated Into Cost Tracker (CRITICAL)
- **File:** `src/lib/evolution/core/costTracker.ts:16-23`
- **Issue:** `CostTrackerImpl` accepts `budgetCaps` but never receives `agentModels`. Agents with custom models (different pricing) reserve budget based on DEFAULT model costs
- **Impact:** Expensive custom models consume more budget than reserved, or cheap models waste reserved budget
- **Fix:** Pass `agentModels` to CostTracker for model-aware cost reservation

#### CFG-3: featureFlags Not Fully Propagated in Admin Trigger Path (CRITICAL)
- **File:** `src/lib/services/evolutionActions.ts:606-620`
- **Issue:** `fetchEvolutionFeatureFlags` IS called for admin triggers, but `supervisorConfigFromRunConfig` does NOT receive feature flags. Supervisor's `getPhaseConfig()` may not respect flags
- **Impact:** Feature flags ignored on manual admin-triggered runs — disabled agents still execute
- **Fix:** Pass featureFlags through to supervisor, or filter agents post-config

#### CFG-4: Empty enabledAgents Array Treated as Falsy (HIGH)
- **File:** `src/lib/services/evolutionActions.ts:286-297`
- **Issue:** `if (strategyConfig.enabledAgents)` — empty arrays `[]` are falsy in JavaScript. Strategy that explicitly disables all optional agents (enabledAgents=[]) silently reverts to "all enabled"
- **Impact:** Explicit agent disabling lost — runs use all agents when strategy intended none
- **Fix:** `if (strategyConfig.enabledAgents !== undefined)`

#### CFG-5: singleArticle Mode Not Enforced in EXPANSION Phase (HIGH)
- **File:** `src/lib/evolution/core/supervisor.ts:175-196`
- **Issue:** `getExpansionConfig()` sets `runGeneration: this.isEnabled('generation')` without checking `singleArticle`. But `getCompetitionConfig()` correctly adds `!this.cfg.singleArticle &&`
- **Impact:** Single-article mode during EXPANSION still creates new variants (population exploration) instead of sequential improvement only
- **Fix:** Add `!this.cfg.singleArticle &&` to line 183

#### CFG-6: Shallow Config Merge Loses Nested Overrides (HIGH)
- **File:** `src/lib/evolution/config.ts:42-52`
- **Issue:** Merge order `{...DEFAULT, ...overrides, ...nestedMerges}` — user passing `overrides = { plateau: {} }` (intentional empty) gets defaults since shallow spread replaces entire nested objects
- **Impact:** Users can't customize nested config to minimal/empty values — defaults always override
- **Fix:** Use deep merge with explicit undefined checks

#### CFG-7: budgetCaps Not in SupervisorConfig Interface (MEDIUM)
- **File:** `src/lib/evolution/core/supervisor.ts:44-69`
- **Issue:** `SupervisorConfig` lacks `budgetCaps`. Supervisor can't optimize phase transitions or agent scheduling based on per-agent budget constraints
- **Fix:** Include `budgetCaps` in SupervisorConfig

#### CFG-8: StrategyConfig Extraction Not Schema-Validated (MEDIUM)
- **File:** `src/lib/evolution/core/strategyConfig.ts:127-148`
- **Issue:** `extractStrategyConfig` accepts loose type, supplies defaults like `'deepseek-chat'` for missing `generationModel` without validating against `AllowedLLMModelType`. Invalid model names silently replaced
- **Fix:** Add Zod schema validation

#### CFG-9: Plateau Threshold Uses Undocumented Magic Number (MEDIUM)
- **File:** `src/lib/evolution/core/supervisor.ts:285-293`
- **Issue:** `plateauThresholdOrdinal = this.cfg.plateauThreshold * 6` — the `* 6` is unexplained. Ordinal ratings range ~0-100 but this assumes a specific scale
- **Impact:** Plateau detection triggers at wrong times, causing premature/delayed phase transitions
- **Fix:** Replace magic number with named constant; document scale assumption

#### CFG-10: Default Agent Models Not Aligned With Cost Estimator (MEDIUM)
- **File:** `src/lib/evolution/core/costEstimator.ts`
- **Issue:** When strategy doesn't specify `agentModels`, estimator defaults to `generationModel` for all agents. At runtime, agents use their own model selection logic (may differ). Estimates diverge from actuals
- **Fix:** Align default model selection between estimator and agent execution

---

### Category 17: Cost & Budget Systems — New Findings

#### COST-1: No Pre-Queue Budget Validation (CRITICAL)
- **File:** `src/lib/services/evolutionActions.ts:185-216`
- **Issue:** Cost estimates are calculated and stored at queue time but NEVER validated against budget cap. Run with estimated $2.50 but $1.00 cap is accepted, then fails mid-execution with BudgetExceededError
- **Impact:** Wastes LLM budget and leaves article stuck in "running" state
- **Fix:** After estimating, validate: `if (estimatedCost > budgetCap) throw new Error('Estimated cost exceeds budget')`

#### COST-2: Negative Cost Values Bypass Budget Enforcement (HIGH)
- **File:** `src/lib/evolution/core/costTracker.ts:54-56`
- **Issue:** `recordSpend()` accepts any number without validation. Negative cost (e.g., from pricing API bug) decreases `totalSpent`, unlocking budget
- **Fix:** `if (actualCost < 0) throw new Error('Negative cost not allowed')`

#### COST-3: Budget Redistribution Doesn't Validate Sum Conservation (HIGH)
- **File:** `src/lib/evolution/core/budgetRedistribution.ts:113-124`
- **Issue:** After scaling caps, no verification that `sum(activeCaps) * scaleFactor = originalManagedSum`. With empty `enabledAgents`, returned caps dict is `{}` — division-by-zero downstream
- **Fix:** Assert sum of all returned caps = 1.0

#### COST-4: Cost Estimation Ignores Agent-Specific Model Fallback (HIGH)
- **File:** `src/lib/evolution/core/costEstimator.ts:129-149, 168-171`
- **Issue:** `getModel()` has fallback logic (agent-specific → judgeModel → generationModel), but `estimateAgentCost()` takes model as flat argument. If agentModels.generation is undefined, estimate uses raw default instead of intended fallback
- **Impact:** Cost estimates can be 5x wrong (deepseek-chat @ $0.0003 vs gpt-4.1-mini @ $0.0016)
- **Fix:** Pass resolved model from fallback chain

#### COST-5: Missing Deserialization Validation on Resume (HIGH)
- **File:** `src/lib/evolution/core/pipeline.ts:849-855`
- **Issue:** On resume, `CostTracker` created fresh with `totalReserved=0`. If resume happens immediately after agent failure (before `recordSpend`), orphaned reservation from previous attempt is lost — allows over-budget spending
- **Fix:** Document assumption; add assertion `totalReserved must be 0 on resume`

#### COST-6: Checkpoint Doesn't Save Cost Tracker Reserved State (MEDIUM)
- **File:** `src/lib/evolution/core/state.ts:79-103`
- **Issue:** Checkpoints persist PipelineState but NOT CostTracker's `reservedByAgent` and `reservationQueues`. Resume mid-agent discards active reservation
- **Impact:** Budget enforcement becomes loose for resumed attempt during expensive agents
- **Fix:** Serialize reservation state

#### COST-7: Agent Cost Attribution Map Incomplete (MEDIUM)
- **File:** `src/lib/evolution/core/pipeline.ts:221-242`
- **Issue:** Hardcoded `STRATEGY_TO_AGENT` mapping doesn't include all strategy names. New strategies added to agents show "$0 cost" in admin dashboard
- **Fix:** Auto-populate from agent registries

#### COST-8: Baseline Cache No Per-Entry TTL (MEDIUM)
- **File:** `src/lib/evolution/core/costEstimator.ts:55-70`
- **Issue:** Cache TTL is global (5 min). Individual baseline entries could be hours old but still used because the cache itself is fresh
- **Fix:** Add per-entry timestamps

#### COST-9: Zero Budget Cap Allows Unlimited Spending (LOW)
- **File:** `src/lib/evolution/core/costTracker.ts:21-35`
- **Issue:** If `budgetCapUsd = 0` passed, first call with estimated cost 0 passes the gate. If `budgetCapUsd = Infinity`, budget enforcement is a no-op
- **Fix:** Validate at init: `if (budgetCapUsd <= 0 || !isFinite(budgetCapUsd)) throw`

#### COST-10: Cost Prediction Misleading for Early-Stopped Runs (LOW)
- **File:** `src/lib/evolution/core/costEstimator.ts:374-398`
- **Issue:** `deltaPercent` compares estimated (full iterations) vs actual (early stop). Shows -70% "error" for runs that correctly stopped early
- **Fix:** Compute delta relative to achievable cost given stop condition

#### COST-11: Floating-Point Rounding in Hall-of-Fame Cost Split (LOW)
- **File:** `src/lib/evolution/core/pipeline.ts:616-618`
- **Issue:** `perEntryCost = runCost / top3.length` — repeating decimals ($0.333...) accumulate rounding errors across many runs
- **Fix:** Truncate to 4 decimal places

---

### Category 18: Strategy Experiments & Scripts — New Findings

#### EXP-1: run-batch.ts No SIGINT/SIGTERM Handling (CRITICAL)
- **File:** `scripts/run-batch.ts:423-544`
- **Issue:** No signal handlers. Ctrl+C leaves orphaned evolution_batch_runs records as "running" forever, blocks recovery
- **Impact:** Orphaned DB records and inconsistent state after interrupted batches
- **Fix:** Add signal handlers; mark batch as "interrupted" on SIGTERM

#### EXP-2: run-batch.ts Missing Cleanup on Abort (HIGH)
- **File:** `scripts/run-batch.ts:97-110`
- **Issue:** Creates temporary "Batch Experiments" explanation records. If execution fails early, orphaned explanations and topics accumulate — no cleanup in finally block
- **Fix:** Track created IDs; delete on failure in try-finally

#### EXP-3: Mutable State Serialization in Batch execution_plan (HIGH)
- **File:** `scripts/run-batch.ts:390, 515, 526`
- **Issue:** `execution_plan` field updated with mutable `plan.runs` array during execution. Concurrent reads see inconsistent state (some runs completed, others pending)
- **Fix:** Store immutable snapshots or use separate progress tracking

#### EXP-4: run-batch.ts Resume Not Implemented (MEDIUM)
- **File:** `scripts/run-batch.ts:431-435`
- **Issue:** `--resume` flag accepted but returns placeholder message. Failed batches must restart from scratch, re-running completed runs
- **Fix:** Query evolution_batch_runs table, filter to pending/failed, execute remaining

#### EXP-5: Strategy Experiment --vary/--lock Conflict Not Validated (MEDIUM)
- **File:** `scripts/run-strategy-experiment.ts:99-117, 374`
- **Issue:** `--vary "iterations=3,5" --lock "iterations=8"` creates contradiction. Code silently uses lock value: `{...cliArgs.lock, ...combos[run.row-1]}` — lock overwrites vary
- **Fix:** Validate no overlap between vary keys and lock keys at parse time

#### EXP-6: No Fast-Fail on Consecutive Experiment Failures (MEDIUM)
- **File:** `scripts/run-strategy-experiment.ts:400-407`
- **Issue:** Script persists through all timeout failures without giving up. Bad config (wrong model name) causes all 8 runs to fail, wasting time
- **Fix:** Add consecutive failure counter; abort after 2-3 consecutive failures

#### EXP-7: Batch Cost Estimation Heuristic Diverges from Actuals (MEDIUM)
- **File:** `scripts/run-batch.ts:272-286`
- **Issue:** `estimatedTextLength = prompt.length * 100` — very rough heuristic. Actual costs often diverge significantly, causing budget under/over-utilization
- **Fix:** Recalibrate estimates after first run completes using actual cost-per-iteration

#### EXP-8: Hall-of-Fame Topic Upsert Race Condition (MEDIUM)
- **File:** `scripts/lib/hallOfFameUtils.ts:35-62`
- **Issue:** Retry loop only retries on error code `23505` (unique constraint). Different Supabase error codes not handled. Fallback `.ilike()` query may match soft-deleted topics
- **Fix:** More lenient retry; add `.is('deleted_at', null)` filter

#### EXP-9: Strategy Experiment State File Concurrent Access (LOW)
- **File:** `scripts/run-strategy-experiment.ts:165-169`
- **Issue:** Atomic file rename is good, but no lock prevents concurrent reads/writes. Two parallel CLI invocations can load same state, execute same run, overwrite each other's results
- **Fix:** Use lockfile with `fs.openSync('...', 'wx')` for exclusive creation

#### EXP-10: run-evolution-local.ts Hardcoded Default Model (LOW)
- **File:** `scripts/run-evolution-local.ts:163`
- **Issue:** Default model hardcoded to `deepseek-chat`. If user's API key is for different provider, script fails late with cryptic error
- **Fix:** Validate API key availability immediately after model selection

#### EXP-11: Strategy Experiment Array Index Without Bounds Check (LOW)
- **File:** `scripts/run-strategy-experiment.ts:372, 374`
- **Issue:** `design.runs[run.row - 1]` without bounds validation. Corrupted state file causes runtime crash
- **Fix:** Validate `run.row` against `design.runs.length`

---

### Round 4 Summary

| Category | Critical | High | Medium | Low | Total |
|----------|:--------:|:----:|:------:|:---:|:-----:|
| Tree Search & Beam Search | — | 3 | 4 | 2 | 9 |
| Section Editing Pipeline | — | — | 3 | 3 | 6 |
| Configuration Flow | 3 | 3 | 4 | — | 10 |
| Cost & Budget Systems | 1 | 4 | 3 | 3 | 11 |
| Strategy Experiments & Scripts | 1 | 2 | 4 | 4 | 11 |
| **Total** | **5** | **12** | **18** | **12** | **47** |

### Cumulative Audit Totals (Rounds 1-4)

| Severity | Round 1-2 | Round 3 | Round 4 | Total |
|----------|:---------:|:-------:|:-------:|:-----:|
| Critical | 11 | 1 | 5 | 17 |
| High | 14 | 2 | 12 | 28 |
| Medium | 19 | 23 | 18 | 60 |
| Low | — | 15 | 12 | 27 |
| **Total** | **44** | **41** | **47** | **132** |

---

## Round 5: Source Code Verification (4 Parallel Explore Agents)

Round 5 used 4 parallel explore agents to read actual source files and verify whether each finding from Rounds 1-4 still exists in the current codebase. Each agent covered a different domain: (1) core infrastructure & pipeline, (2) agent implementations & parsing, (3) configuration & cost systems, (4) frontend, scripts & beam search.

### Verification Summary

| Status | Count | Description |
|--------|:-----:|-------------|
| **CONFIRMED** | 61 | Bug/issue still present in codebase |
| **FIXED** | 10 | Already resolved in current code |
| **INVALID** | 5 | Finding was incorrect |
| **PARTIALLY VALID** | 2 | Finding partially correct with nuance |
| **Total verified** | 78 | ~59% of 132 findings spot-checked |

**Research accuracy rate: ~94%** (only 5 of 78 verified findings were outright invalid)

### Findings Verified as FIXED (10)

| ID | Finding | How Fixed |
|----|---------|-----------|
| BUG-3 | Semaphore Resource Leak | `llms.ts` wraps acquire/release in `try/finally` at call site |
| BUG-5 | Batch Runner Race Condition | Atomic `claim_evolution_run` RPC with `FOR UPDATE SKIP LOCKED` (migration 20260214000001) |
| CORE-6 | Pool Statistics Crash on Empty Ratings | Default `[0]` fallback array when `ratings.size === 0` |
| ERR-1 | Budget Reservation Leak on Retry | FIFO queue-based reservation system properly releases |
| ERR-2 | No SIGTERM Handler in Cron Runner | Platform-level: Vercel handles process lifecycle at `maxDuration` |
| ERR-5 | LogBuffer Unbounded on DB Failure | Buffer cleared via `splice(0)` before flush; items discarded on failure |
| UI-6 | AutoRefreshProvider Visibility Race | `doRefresh()` called synchronously before `startPolling()` |
| CFG-2 | agentModels Not in CostTracker | CostTracker properly receives `budgetCaps`; `agentModels` is estimation concern, not tracking |
| CFG-5 | singleArticle Not Enforced in EXPANSION | Intentional design: EXPANSION generates variants, COMPETITION enforces constraints |
| COST-4 | Cost Estimation Agent Model Fallback | `getModel()` properly implements `agentModels[agent] ?? (isJudge ? judgeModel : genModel)` |

### Findings Verified as INVALID (5)

| ID | Finding | Why Invalid |
|----|---------|-------------|
| BUG-6 | Auto-Queue Duplication | `.in('status', ['pending', 'claimed', 'running'])` correctly excludes completed runs |
| CORE-5 | Dual Agent Gating Contradicts | Single source of truth via `featureFlags.ts`; no contradiction |
| HIGH-1 | Title Not Updated in applyWinner | Title is separate from evolved content; not updating is correct behavior |
| HIGH-7 | Parse Failure = Quality Met | `qualityThresholdMet(null)` returns `false`; parse failure does NOT trigger threshold |
| CFG-4 | Empty enabledAgents Treated as Falsy | `Boolean([]) === true` in JavaScript; empty arrays pass the truthiness check correctly |

### Findings Verified as PARTIALLY VALID (2)

| ID | Finding | Nuance |
|----|---------|--------|
| CFG-3 | featureFlags Not Propagated | Flags ARE passed to `executeFullPipeline()` but NOT to `supervisorConfigFromRunConfig()` (which doesn't need them) |
| COST-2 | Negative Cost Bypass | `recordSpend()` accepts negatives theoretically, but all real callers pass `usage.estimatedCostUsd` which cannot be negative |

### Confirmed Findings by Priority (61 still present)

#### Critical (still present: 3)

| ID | Finding | File |
|----|---------|------|
| BUG-4 | Cron Auth Bypass (Fail-Open) | `evolution-runner/route.ts:19`, `evolution-watchdog/route.ts:15`, `content-quality-eval/route.ts:17` |
| SCRIPT-1 | Migration NOT NULL Constraint Conflict | `20260207000008_enforce_not_null.sql:26-30` vs `evolutionActions.ts` nullable code paths |
| COST-1 | No Pre-Queue Budget Validation | `evolutionActions.ts:185-216` — estimated cost never compared to budget cap |

#### High (still present: 14)

| ID | Finding | File |
|----|---------|------|
| CORE-1 | Strategy Rotation Index OOB | `supervisor.ts:160,200` — `GENERATION_STRATEGIES[-1]` = undefined |
| HIGH-2 | Missing Transaction in applyWinner | `evolutionActions.ts:423-512` — 5 queries without atomicity |
| HIGH-4 | ProximityAgent Pseudo-Embeddings | `proximityAgent.ts:137-140` — character-based fake embeddings in prod |
| HIGH-5 | ProximityAgent Memory Leak | `proximityAgent.ts:11` — unbounded embedding cache |
| HIGH-6 | OutlineGenerationAgent Raw Fallback | `outlineGenerationAgent.ts:195-200` — raw outline added as variant |
| PARSE-1 | Greedy JSON Extraction | `jsonParser.ts:10` — `\{[\s\S]*\}` matches first `{` to last `}` |
| PARSE-2 | Template Injection Triple-Quote | `debateAgent.ts:28,51,75`, `iterativeEditingAgent.ts:427` |
| COST-6 | Checkpoint Missing CostTracker State | `state.ts:79-103` — reservation state not serialized |
| UI-1 | No React Error Boundaries | All `/admin/quality/evolution/**` pages |
| UI-2 | No Confirmation for applyWinner | `page.tsx:710-730` — immediate server action, no confirm dialog |
| FE-1 | Unsafe Type Assertions on Snapshots | `evolutionVisualizationActions.ts:474,527,713,843,922` |
| SCRIPT-2 | NULL Variant Content Before Apply | `evolutionActions.ts:442-473` — no null check on `variant_content` |
| BEAM-1 | Orphaned Tree Nodes on Failure | `beamSearch.ts:177-232` — node added before LLM call |
| BEAM-3 | Stale Parent Critique Fallback | `beamSearch.ts:122-129` — falls back to root critique |

#### Medium (still present: 32)

| ID | Finding |
|----|---------|
| CORE-2 | Feature Flag Mutex One-Directional |
| CORE-3 | getCalibrationOpponents Returns Fewer |
| CORE-4 | Phase Transition Boundary Inconsistency |
| DB-1 | update_strategy_aggregates RPC Race |
| DB-4 | N+1 in persistAgentMetrics |
| DB-5 | N+1 in feedHallOfFame |
| ERR-3 | ComparisonCache Not Serialized |
| ERR-6 | LLMRefusalError Not Caught by Agents |
| CFG-6 | Shallow Config Merge Loses Nested |
| CFG-8 | StrategyConfig Not Schema-Validated (partial) |
| COST-3 | Budget Redistribution Sum Conservation |
| COST-5 | Missing Deserialization Validation |
| MED-9 | Adaptive Allocation Not Wired |
| AGENT-1 | MetaReviewAgent avg() Division by Zero |
| AGENT-2 | EvolvePool maxParentVersion Empty Array |
| AGENT-3 | Tournament Convergence Set Membership |
| AGENT-4 | DiffComparison Biases Toward UNSURE |
| AGENT-5 | SectionDecomposition No Bounds Check |
| AGENT-6 | DebateAgent Excludes Unrated Variants |
| PARSE-4 | parseWinner Ambiguous Heuristics |
| PARSE-5 | Format Validator H1 False Positive |
| PARSE-6 | Code Block Stripping Deletes Content |
| UI-3 | No Optimistic Updates on Mutations |
| UI-4 | VariantsTab Sparkline Key Collision |
| UI-5 | LogsTab Auto-Scroll Overrides Position |
| FE-7 | LogsTab Missing Pagination |
| SCRIPT-4 | Hard-Coded Stale Threshold |
| SCRIPT-7 | Prompt-Based Runs Can't Apply Winners |
| BEAM-2 | Cross-Scale Weakness Targeting |
| SEC-1 | Section Stitcher Ignores OOB Silently |
| SEC-2 | No Diagnostic Logging After Stitch |
| EXP-5 | Strategy --vary/--lock Conflict |

#### Low (still present: 12)

| ID | Finding |
|----|---------|
| CFG-1 | budgetCaps Not Passed to Estimator (low impact) |
| DB-2 | Missing Index on status Column |
| DB-7 | costEstimator Silent Error Propagation |
| MED-8 | Cost Estimator Division by Zero (unlikely) |
| AGENT-7 | CalibrationRanker Early Exit Low Confidence |
| AGENT-8 | Tournament swissPairing Pool < 2 |
| AGENT-9 | BeamSearch Stale Critique Re-Critique |
| AGENT-10 | PairwiseRanker dimensionScores Validation |
| FE-3 | D3 Import Race in TreeTab |
| FE-5 | Missing URL Parameter Validation |
| EXP-1 | run-batch.ts No Signal Handling |
| EXP-2 | run-batch.ts Missing Cleanup |
| EXP-4 | run-batch.ts Resume Not Implemented |

### Key Patterns Observed

1. **Call-site mitigations** — BUG-3 (semaphore leak) was fixed at the call site in `llms.ts` with `try/finally`, even though the `LLMSemaphore` class API itself remains unsafe. The class should still add a `withSlot()` method for defense-in-depth.

2. **Platform-level fixes** — ERR-2 (no SIGTERM handler) is moot because Vercel handles process lifecycle. The cron runner operates within an HTTP request, not as a long-running process.

3. **JavaScript semantics errors** — CFG-4 claimed empty arrays `[]` are falsy, but `Boolean([]) === true` in JavaScript. Research-phase LLMs can confuse language semantics across languages.

4. **Intentional design decisions** — CFG-5 (singleArticle in EXPANSION) is intentional: EXPANSION phase generates the variant pool, COMPETITION phase constrains it. BUG-6 (auto-queue duplication) correctly excludes completed runs.

5. **Most impactful confirmed bugs** — BUG-4 (cron auth bypass) is the highest-severity confirmed finding. COST-1 (no pre-queue budget validation) causes wasted LLM spend. CORE-1 (strategy index OOB) can crash runs during phase transition.
