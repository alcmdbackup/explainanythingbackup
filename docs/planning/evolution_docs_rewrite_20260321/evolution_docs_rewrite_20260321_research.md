# Evolution Docs Rewrite Research

## Problem Statement
Set all of my current evolution docs to blank content, and then rewrite them from scratch to avoid bias.

## Requirements (from GH Issue #758)
Set all current evolution docs to blank content, then rewrite them from scratch to avoid bias.

## High Level Summary

Conducted 4 rounds of 4 parallel research agents (16 total) exploring the entire evolution codebase. The system is a V2 clean-slate rewrite (~263 files) implementing an autonomous content improvement pipeline using evolutionary algorithms with OpenSkill Bayesian rating, LLM-judged pairwise comparisons, and budget-aware execution.

Key findings organized by subsystem below.

---

## 1. Pipeline Core (evolve-article, generate, rank, evolve)

### Main Orchestrator: `evolve-article.ts`
- `evolveArticle(originalText, llmProvider, db, runId, config, options?)` → `EvolutionResult`
- Config validation: iterations 1-100, budgetUsd 0-50, non-empty model strings
- Defaults: strategiesPerRound=3, calibrationOpponents=5, tournamentTopK=5
- Local state: pool (TextVariation[]), ratings (Map<string, Rating>), matchCounts, allMatches, muHistory, diversityHistory, comparisonCache
- Baseline variant created at iteration 0 with strategy='baseline'
- Arena entries optionally prepended via `initialPool`

### Loop per iteration:
1. Kill detection via DB status check (failed/cancelled → break)
2. `generateVariants()` → up to 3 variants via parallel strategies
3. `rankPool()` → triage + Swiss fine-ranking
4. Record muHistory (top-K mu values)
5. `evolveVariants()` → mutation + crossover children
6. Budget check (BudgetExceededError breaks loop)

### Stop reasons: `iterations_complete`, `killed`, `converged`, `budget_exceeded`

### Winner selection: highest mu, tie-break lowest sigma, fallback baseline

### Phase execution wrapper: `executePhase<T>()` catches budget errors, records cost delta to invocations. Critical: check BudgetExceededWithPartialResults before BudgetExceededError (inheritance order).

### Generation: `generate.ts`
- 3 hardcoded strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance`
- Parallel via `Promise.allSettled()`, count = min(config.strategiesPerRound, 3)
- Each output validated via `validateFormat()`, invalid silently discarded
- BudgetExceededWithPartialResults preserves successful variants on mid-generation budget exceed

### Ranking: `rank.ts`
- **Triage** (phase 1): Sequential calibration of new entrants (sigma >= 5.0) against stratified opponents (2 top, 2 mid, 1 bottom for n=5). Adaptive early exit after MIN_TRIAGE_OPPONENTS=2 if all decisive (confidence >= 0.7) and avg confidence >= 0.8. Top-20% cutoff elimination: mu + 2σ < cutoff → excluded from fine-ranking.
- **Fine-ranking** (phase 2): Swiss-style tournament. Eligibility: mu >= 3σ OR in top-K. Pair scoring: outcomeUncertainty × sigmaWeight using Bradley-Terry logistic CDF (BETA = DEFAULT_SIGMA × √2 ≈ 11.8). Greedy pair selection, skip already-played. Budget pressure tiers: low (40 max), medium (25), high (15). Convergence: all eligible sigmas < 3.0 for 2 consecutive rounds.
- Draw detection: confidence < 0.3 → updateDraw()

### Evolution: `evolve.ts`
- Parents selected by descending mu (top 2)
- Operators: mutate_clarity, mutate_structure, crossover (2+ parents), creative_exploration (when 0 < diversityScore < 0.5)
- All outputs format-validated, invalid discarded silently

---

## 2. Rating & Comparison System

### OpenSkill (Weng-Lin Bayesian): `shared/rating.ts`
- `Rating = { mu: number; sigma: number }`
- Constants: DEFAULT_MU=25, DEFAULT_SIGMA=25/3≈8.333, DEFAULT_CONVERGENCE_SIGMA=3.0, ELO_SIGMA_SCALE=16
- `createRating()` → {mu: 25, sigma: 8.333}
- `updateRating(winner, loser)` → both sigmas decrease
- `updateDraw(a, b)` → ratings converge, both sigmas decrease
- `toEloScale(mu)` → 1200 + (mu - 25) * 16, clamped [0, 3000]
- `computeEloPerDollar(mu, cost)` → (toEloScale(mu) - 1200) / cost

### Bias-Mitigated Comparison: `comparison.ts`
- `compareWithBiasMitigation(textA, textB, callLLM, cache?)` → ComparisonResult
- 2-pass reversal: forward (A vs B) + reverse (B vs A) run in parallel via Promise.all
- `parseWinner()`: 4-level priority (exact match → phrase → keywords → first word)
- Confidence: both agree=1.0, one TIE=0.7, disagree=0.5, one null=0.3, both null=0.0
- Cache: order-invariant SHA-256 key, only caches confidence > 0.3

### Comparison Cache: `shared/comparisonCache.ts`
- LRU cache, MAX_CACHE_SIZE=500
- Order-invariant key from sorted text SHA-256 hashes
- Only caches valid results (winnerId !== null OR isDraw)
- Serializable via entries()/fromEntries() for checkpoint persistence

### Elo Attribution: `core/eloAttribution.ts`
- Per-variant: deltaMu = variant.mu - avg(parent.mu), gain = deltaMu × 16, ci = 1.96 × sigmaDelta × 16, zScore = deltaMu / sigmaDelta
- Agent-level: totalGain, avgGain, avgCi (root-sum-of-squares)
- Z-score thresholds: |z| < 1.0 grey, 1.0-2.0 amber, ≥ 2.0 green/red
- Persisted at finalization in evolution_variants.elo_attribution and evolution_agent_invocations.agent_attribution (JSONB)

---

## 3. Cost & Budget System

### Cost Tracker: `pipeline/cost-tracker.ts`
- Reserve-before-spend pattern, RESERVE_MARGIN=1.3 (30% safety buffer)
- `reserve(phase, estimatedCost)` → synchronous, throws BudgetExceededError if over budget
- `recordSpend(phase, actualCost, reservedAmount)` → deducts reservation, adds actual
- `release(phase, reservedAmount)` → returns margin on LLM failure
- Available budget: max(0, budgetUsd - totalSpent - totalReserved)
- reserve() is synchronous for Node.js single-threaded parallel safety

### LLM Client: `pipeline/llm-client.ts`
- Model pricing: gpt-4.1-nano ($0.10/$0.40), gpt-4.1-mini ($0.40/$1.60), deepseek-chat ($0.27/$1.10), etc.
- Fallback pricing: $15/$60 per 1M tokens (most expensive)
- Token estimation: chars / 4
- Output estimates: generation=1000, evolution=1000, ranking=100 tokens
- Retry: MAX_RETRIES=3, backoff [1s, 2s, 4s], PER_CALL_TIMEOUT=60s
- Budget errors NOT retried, transient errors retried

### Error Classification: `shared/errorClassification.ts`
- `isTransientError()`: OpenAI SDK types (APIConnectionError, RateLimitError, InternalServerError), socket errors, HTTP 429/408/500/502/503/504, message patterns

### Invocation Tracking: `pipeline/invocations.ts`
- Two-phase lifecycle: `createInvocation()` before, `updateInvocation()` after
- Per-operation cost attribution via cost delta
- DB errors swallowed, no-op if id is null

### Seed Article Generation: `pipeline/seed-article.ts`
- `generateSeedArticle(promptText, llm)` → SeedResult { title, content }
- 2 sequential LLM calls: title generation → article generation
- 60s timeout per call, uses raw provider (not V2 LLM client)
- Returns `# ${title}\n\n${articleContent}`

---

## 4. Data Model & Database

### V2 Schema (clean-slate migration 20260315000001)
Dropped all V1 tables and created 10 new tables:

1. **evolution_strategies** — name, label, config (JSONB), config_hash (UNIQUE), pipeline_type, status (active/archived), created_by, aggregate metrics (run_count, avg_final_elo, etc.)
2. **evolution_prompts** — prompt text, title, status (active/archived), case-insensitive unique index
3. **evolution_experiments** — name, prompt_id FK, status (draft/running/completed/cancelled/archived)
4. **evolution_runs** — explanation_id, prompt_id, experiment_id, strategy_id FKs, config JSONB, status (pending/claimed/running/completed/failed/cancelled), pipeline_version='v2', run_summary JSONB, last_heartbeat, archived
5. **evolution_variants** — run_id FK CASCADE, variant_content, elo_score (0-3000), generation, parent_variant_id, agent_name, match_count, is_winner
6. **evolution_agent_invocations** — run_id FK CASCADE, agent_name, iteration, execution_order, success, cost_usd, execution_detail JSONB, duration_ms
7. **evolution_run_logs** — run_id FK CASCADE, level, agent_name, iteration, variant_id, message, context JSONB
8. **evolution_arena_entries** — prompt_id FK, run_id FK, content, generation_method, mu/sigma/elo_rating/match_count (inline Bayesian ratings)
9. **evolution_arena_comparisons** — prompt_id FK, entry_a/entry_b FKs, winner (a/b/draw), confidence
10. **evolution_arena_batch_runs** — prompt_id FK, batch tracking

### RPCs:
- `claim_evolution_run(p_runner_id, p_run_id?)` — FOR UPDATE SKIP LOCKED atomic claiming
- `update_strategy_aggregates(p_strategy_id, p_cost_usd, p_final_elo)` — Welford-style aggregate update
- `sync_to_arena(p_prompt_id, p_run_id, p_entries, p_matches)` — atomic upsert entries + comparisons
- `cancel_experiment(p_experiment_id)` — cancel + bulk-fail runs
- `get_run_total_cost(p_run_id)` — SUM of invocation costs

### RLS: All tables deny-all by default with service_role bypass policy

### Strategy System:
- Hash dedup: SHA-256 of {generationModel, judgeModel, iterations}, 12-char prefix
- `upsertStrategy()` does INSERT ON CONFLICT for race safety
- strategy_id is NOT NULL on runs
- budget_cap_usd is per-run (not part of strategy hash)

### Run Status Machine: pending → claimed → running → completed/failed/cancelled

---

## 5. Arena System

### Pipeline Integration: `pipeline/arena.ts`
- `loadArenaEntries(promptId, db)` → loads non-archived entries with pre-seeded mu/sigma ratings, sets fromArena=true
- `syncToArena(runId, promptId, pool, ratings, matchHistory, db)` → filters !fromArena, upserts via sync_to_arena RPC
- `isArenaEntry()` type guard filters arena entries during persistence

### Arena Lifecycle:
1. Load at pipeline start (prompt-based runs only)
2. Participate naturally in ranking alongside new variants
3. Filtered out during variant persistence
4. New variants + match history synced back atomically

### Topic Management: archiving hides from UI/prompt selection but doesn't break in-progress runs

---

## 6. Experiment System

### State Machine: draft → running → completed/cancelled
- `createExperiment(name, promptId, db)` → creates in draft
- `addRunToExperiment(experimentId, config, db)` → auto-transitions draft→running on first run
- Cannot add runs to completed/cancelled experiments

### Manual Analysis: `computeManualAnalysis()` — per-run Elo/cost comparison table, no CIs

### Bootstrap CIs: `experimentMetrics.ts`
- `bootstrapMeanCI(values, iterations=1000)` — resamples with replacement, Normal(value, sigma) when sigma present
- `bootstrapPercentileCI(allRunRatings, percentile, iterations=1000)` — resamples runs and variant ratings
- 95% CI = [2.5th, 97.5th percentile]

### Metrics: totalVariants, medianElo, p90Elo, maxElo, cost, eloPer$, agentCost:*

---

## 7. Server Actions (54 total)

### Action Files:
- `experimentActionsV2.ts` — 7 actions (create, addRun, get, list, getPrompts, getStrategies, cancel)
- `evolutionActions.ts` — 11 actions (queue, list, archive, get, variants, summary, costs, logs, kill, listVariants)
- `strategyRegistryActionsV2.ts` — 7 actions (list, get, create, update, clone, archive, delete)
- `arenaActions.ts` — 13 actions (topics, entries, comparisons CRUD + prompt registry)
- `variantDetailActions.ts` — 5 actions (detail, parents, children, matchHistory, lineageChain)
- `invocationActions.ts` — 2 actions (list, detail)
- `evolutionVisualizationActions.ts` — 3 actions (dashboard, eloHistory, lineage)
- `costAnalytics.ts` — 5 actions (summary, daily, byModel, byUser, backfill)
- `evolutionRunnerCore.ts` — 1 core function (claimAndExecuteEvolutionRun)

### Pattern: All wrapped by `adminAction` factory (requireAdmin + withLogging + error handling → ActionResult<T>)

---

## 8. Admin UI (~66 pages/components)

### Routes:
- `/admin/evolution-dashboard` — MetricGrid + RunsTable, 15s auto-refresh
- `/admin/evolution/experiments` — list + detail (overview/analysis/runs tabs)
- `/admin/evolution/start-experiment` — 3-step wizard (setup → strategies → review)
- `/admin/evolution/runs` + `/runs/[runId]` — list + detail (metrics/elo/lineage/variants/logs tabs)
- `/admin/evolution/variants` + `/variants/[variantId]` — list + detail
- `/admin/evolution/strategies` — RegistryPage CRUD
- `/admin/evolution/prompts` — RegistryPage CRUD
- `/admin/evolution/invocations` + detail
- `/admin/evolution/arena` + `/arena/[topicId]` + `/arena/entries/[entryId]`

### Shared Components (evolution/src/components/evolution/):
- EntityListPage, EntityDetailTabs, EntityDetailHeader, EntityTable — config-driven patterns
- RegistryPage — CRUD orchestration with FormDialog + ConfirmDialog
- AutoRefreshProvider — 15s polling with tab visibility awareness
- LineageGraph — D3 DAG visualization
- MetricGrid, RunsTable, VariantCard, TextDiff, EloSparkline

---

## 9. Batch Runner & Deployment

### Production Runner: `evolution/scripts/evolution-runner.ts`
- CLI flags: --dry-run, --max-runs (default 10), --parallel (default 1), --max-concurrent-llm (default 20)
- Multi-target: staging + prod databases, round-robin claiming
- Parallel execution via Promise.allSettled with LLMSemaphore throttling
- Graceful shutdown on SIGTERM/SIGINT

### Local CLI: `evolution/scripts/run-evolution-local.ts`
- Flags: --file/--prompt, --mock, --iterations, --budget, --model, --judge-model
- Provider detection: mock, anthropic (claude-*), deepseek (deepseek-*), local (LOCAL_*), openai (default)
- Optional Supabase tracking if env vars present

### Systemd: evolution-runner.service + evolution-runner.timer
- Timer fires every 60s, 30-minute timeout, runs as evolution:evolution user

### Format Validation: `shared/formatValidator.ts` + `shared/formatRules.ts`
- Rules: single H1, section headings (##/###), no bullets/lists/tables, 75% paragraphs 2+ sentences
- MODE env var: "reject" (default), "warn", "off"

### LLM Semaphore: `src/lib/services/llmSemaphore.ts`
- FIFO counting semaphore, default 20 concurrent calls
- Singleton pattern with init/reset for testing

### LLM Spending Gate: `src/lib/services/llmSpendingGate.ts`
- Global daily/monthly caps with kill switch
- Fast-path cache (30s TTL), DB-atomic reservation near cap
- Categories: evolution vs non_evolution
- Fail-closed on DB errors

---

## 10. Testing Infrastructure

### Test Helpers:
- `evolution-test-helpers.ts` — DB factories (createTestEvolutionRun, createTestVariant, createTestStrategyConfig), mock factories (createMockEvolutionLLMClient, createMockCostTracker), VALID_VARIANT_TEXT constant, NOOP_SPAN
- `service-test-mocks.ts` — createSupabaseChainMock(), createTableAwareMock() for multi-table mocking
- `v2MockLlm.ts` — createV2MockLlm() with label/position/pair-based response routing

### Test Coverage: ~78 test files, ~350+ test cases
- Pipeline core: 18 files (~170 tests)
- Shared utilities: 10 files (~180 tests)
- Services: 10 files (~138 tests)
- Components: 32 test files (~200 tests)
- Integration: 1 file (evolution-run-costs)
- E2E: 1 file (admin-evolution-v2 smoke tests)

### Auto-skip: `evolutionTablesExist()` checks if tables are migrated before running integration tests

---

## 11. Main App Integration

### Module Isolation: `@evolution/*` path alias in tsconfig.json
### Admin Navigation: SidebarSwitcher toggles between AdminSidebar and EvolutionSidebar
### LLM Tracking: `callLLM()` in `src/lib/services/llms.ts` accepts `evolutionInvocationId` FK
### Spending: Separate `evolutionDailyCapUsd` category
### API Route: `POST /api/evolution/run` triggers `claimAndExecuteEvolutionRun()`
### Dashboard: Main admin page shows "Total Cost (30d)" from evolution cost analytics

---

## 12. Directory Structure (263 files total)

```
evolution/
├── src/ (170 files)
│   ├── components/evolution/ (67 files — UI components + tests)
│   ├── lib/ (88 files)
│   │   ├── pipeline/ (39 files — V2 core)
│   │   ├── shared/ (18 files — reused utilities)
│   │   ├── ops/ (4 files — watchdog, cleanup)
│   │   └── utils/ (6 files — formatters, URLs)
│   ├── services/ (16 files — server actions + tests)
│   ├── testing/ (4 files — test helpers)
│   ├── experiments/ (2 files — metrics)
│   └── config/ (2 files)
├── scripts/ (8 files — runners, backfill)
├── docs/evolution/ (17 files — current docs to rewrite)
└── deploy/ (2 files — systemd)

src/app/admin/evolution/ (66 files — admin UI pages)
```

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/vector_search_embedding.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/authentication_rls.md
- docs/docs_overall/debugging.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/state_management.md
- docs/feature_deep_dives/request_tracing_observability.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/curriculum.md

## Code Files Read (via 16 research agents)

### Round 1: Pipeline Core, Data Model, Rating, Cost/Budget
- evolution/src/lib/pipeline/evolve-article.ts
- evolution/src/lib/pipeline/generate.ts
- evolution/src/lib/pipeline/rank.ts
- evolution/src/lib/pipeline/evolve.ts
- evolution/src/lib/pipeline/types.ts
- evolution/src/lib/pipeline/runner.ts
- evolution/src/lib/pipeline/finalize.ts
- evolution/src/lib/pipeline/strategy.ts
- evolution/src/lib/pipeline/cost-tracker.ts
- evolution/src/lib/pipeline/llm-client.ts
- evolution/src/lib/pipeline/invocations.ts
- evolution/src/lib/pipeline/seed-article.ts
- evolution/src/lib/pipeline/errors.ts
- evolution/src/lib/shared/rating.ts
- evolution/src/lib/comparison.ts
- evolution/src/lib/shared/reversalComparison.ts
- evolution/src/lib/shared/comparisonCache.ts
- evolution/src/lib/core/eloAttribution.ts
- supabase/migrations/20260315000001_evolution_v2.sql
- supabase/migrations/20260320000001_rename_evolution_tables.sql
- supabase/migrations/20260321000001_evolution_service_role_rls.sql
- supabase/migrations/20260314000002_create_evolution_explanations.sql

### Round 2: Arena, Services, Admin UI, Deployment
- evolution/src/lib/pipeline/arena.ts
- evolution/src/services/experimentActionsV2.ts
- evolution/src/services/evolutionActions.ts
- evolution/src/services/strategyRegistryActionsV2.ts
- evolution/src/services/arenaActions.ts
- evolution/src/services/variantDetailActions.ts
- evolution/src/services/invocationActions.ts
- evolution/src/services/evolutionVisualizationActions.ts
- evolution/src/services/evolutionRunnerCore.ts
- evolution/src/services/adminAction.ts
- evolution/src/services/costAnalytics.ts
- evolution/src/services/shared.ts
- evolution/src/components/evolution/ (all 67 files)
- src/app/admin/evolution/ (all 66 files)
- evolution/scripts/evolution-runner.ts
- evolution/scripts/run-evolution-local.ts
- evolution/deploy/evolution-runner.service
- evolution/deploy/evolution-runner.timer

### Round 3: Experiments, Testing, Cost Analytics, Shared Utils
- evolution/src/lib/pipeline/experiments.ts
- evolution/src/experiments/evolution/experimentMetrics.ts
- evolution/src/experiments/evolution/analysis.ts
- evolution/src/testing/evolution-test-helpers.ts
- evolution/src/testing/service-test-mocks.ts
- evolution/src/testing/v2MockLlm.ts
- evolution/src/testing/executionDetailFixtures.ts
- evolution/src/lib/shared/formatValidator.ts
- evolution/src/lib/shared/formatRules.ts
- evolution/src/lib/shared/formatValidationRules.ts
- evolution/src/lib/shared/textVariationFactory.ts
- evolution/src/lib/shared/errorClassification.ts
- evolution/src/lib/shared/strategyConfig.ts
- evolution/src/lib/pipeline/prompts.ts
- evolution/src/lib/pipeline/run-logger.ts
- src/lib/services/llmSemaphore.ts
- src/lib/services/llmSpendingGate.ts
- src/config/llmPricing.ts

### Round 4: Migrations, Directory Structure, Integration, Content Resolution
- All supabase/migrations/*evolution* files (chronological)
- Complete evolution/ directory tree (263 files)
- src/app/admin/page.tsx (main admin integration)
- src/app/admin/costs/page.tsx (cost integration)
- src/app/api/evolution/run/route.ts (API endpoint)
- src/lib/services/llms.ts (LLM tracking integration)
- src/components/admin/SidebarSwitcher.tsx (navigation)
- src/components/admin/EvolutionSidebar.tsx (evolution nav)
