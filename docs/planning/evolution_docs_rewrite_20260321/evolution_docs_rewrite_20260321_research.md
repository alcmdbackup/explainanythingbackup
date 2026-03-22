# Evolution Docs Rewrite Research

Research compiled from 36 agents across 9 rounds of parallel exploration.

---

## Round 1: Core Systems

### 1.1 Pipeline Architecture

**Entry Points:**
- `/src/app/api/evolution/run/route.ts` — HTTP API endpoint (admin-only POST)
- `/evolution/scripts/evolution-runner-v2.ts` — CLI batch runner for parallel execution
- `/evolution/src/services/evolutionRunnerCore.ts` — Core runner logic (`claimAndExecuteEvolutionRun`)

**Execution Flow:**
1. Admin POSTs to /api/evolution/run (with optional runId)
2. API calls `claimAndExecuteEvolutionRun()` from evolutionRunnerCore.ts
3. Calls `claim_evolution_run` RPC to claim pending/target run (FOR UPDATE SKIP LOCKED)
4. On successful claim, calls `executeV2Run()` from pipeline/runner.ts
5. executeV2Run orchestrates: content resolution → arena loading → pipeline execution via `evolveArticle()` → finalization → arena sync

**3-Operation Loop** (`evolveArticle()` in `evolve-article.ts`):
```
for iter = 1 to config.iterations:
  1. Kill detection (check DB status at iteration boundary)
  2. GENERATE: generateVariants() — 3 strategies in parallel
  3. RANK: rankPool() — triage + Swiss fine-ranking
  4. EVOLVE: evolveVariants() — mutation + crossover
```

**Stop Reasons (EvolutionResult.stopReason):**
- `iterations_complete` — all iterations finished
- `converged` — 2 consecutive rounds with all sigmas < 3.0
- `budget_exceeded` — cost tracker reserve/spend exceeded cap
- `killed` — run marked as failed/cancelled in DB

**Kill Mechanism:**
- `isRunKilled()` checks `evolution_runs.status` for `'failed'` or `'cancelled'`
- Check happens at ITERATION BOUNDARY (not mid-iteration)

**Convergence Detection** (rank.ts lines 484-506):
- `DEFAULT_CONVERGENCE_SIGMA = 3.0`
- All eligible variants must have sigma < 3.0
- Must have 2 CONSECUTIVE converged rounds
- "Eligible" = not eliminated AND (mu >= 3*sigma OR in topK)

**Budget Tracking** (cost-tracker.ts):
- Reserve-before-spend pattern with 1.3x safety margin
- `reserve(phase, estimatedCost)` — synchronous, throws BudgetExceededError
- `recordSpend(phase, actualCost, reservedAmount)` — deduct reservation, add actual
- `release(phase, reservedAmount)` — release failed reservation
- Budget pressure tiers: low (<50%): 40 comparisons, medium (50-80%): 25, high (80%+): 15

**Runner Lifecycle:**
- States: pending → claimed → running → completed/failed
- Heartbeat: 30s interval updates `last_heartbeat`
- Finalization: builds run_summary, upserts variants, updates strategy aggregates, auto-completes experiment

**Key Files:**
| File | Function | Purpose |
|------|----------|---------|
| runner.ts | `executeV2Run()` | Run execution orchestrator |
| evolve-article.ts | `evolveArticle()` | Main loop & pipeline orchestrator |
| evolve-article.ts | `executePhase()` | Phase executor with budget error handling |
| generate.ts | `generateVariants()` | Generate 3 variants per strategy |
| rank.ts | `rankPool()` | Triage + Swiss fine-ranking |
| evolve.ts | `evolveVariants()` | Mutation + crossover |
| finalize.ts | `finalizeRun()` | Persist results to DB |
| arena.ts | `loadArenaEntries()`, `syncToArena()` | Arena integration |
| cost-tracker.ts | `createCostTracker()` | Budget reserve-before-spend |
| run-logger.ts | `createRunLogger()` | Structured logging |

---

### 1.2 Data Model & Database Schema

**Core Entities (Post-Migration 20260320):**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `evolution_strategies` (was strategy_configs) | Strategy library | id, name, config JSONB, config_hash UNIQUE, status, aggregates |
| `evolution_prompts` (was arena_topics) | Question/topic pool | id, prompt, title, status, deleted_at |
| `evolution_experiments` | Multi-run experiments | id, name, prompt_id FK, status, config JSONB |
| `evolution_runs` | Individual runs | id, prompt_id, strategy_id, experiment_id, status, run_summary JSONB, budget_cap_usd |
| `evolution_variants` | Generated text variants | id, run_id FK CASCADE, variant_content, elo_score, generation, agent_name, is_winner, parent_variant_id |
| `evolution_agent_invocations` | Per-agent execution | id, run_id FK CASCADE, agent_name, iteration, cost_usd, execution_detail JSONB |
| `evolution_run_logs` | Structured logs | id BIGSERIAL, run_id FK, level, agent_name, iteration, message, context JSONB |
| `evolution_arena_entries` | Persistent arena pool | id, prompt_id FK, content, mu, sigma, elo_rating, match_count, generation_method |
| `evolution_arena_comparisons` | Arena match history | id, prompt_id FK, entry_a, entry_b, winner, confidence, run_id |
| `evolution_budget_events` | Cost audit trail | id, run_id FK, event_type, amount_usd, total_spent_usd |

**Recent Schema Changes:**
- **20260315000001**: V2 clean-slate migration — dropped ALL V1 tables and recreated 10 tables
- **20260320000001**: Table renames: `evolution_arena_topics` → `evolution_prompts`, `evolution_strategy_configs` → `evolution_strategies`; column renames: `strategy_config_id` → `strategy_id`, `topic_id` → `prompt_id`; dropped `difficulty_tier`, `domain_tags` from prompts
- **20260321000001**: RLS policies — deny_all default + service_role_all bypass on all tables
- **20260319000001**: Cost helpers — `get_run_total_cost(UUID)` function, `evolution_run_costs` view

**RPC Functions:**
1. `claim_evolution_run(p_runner_id, p_run_id DEFAULT NULL)` — atomic claim with FOR UPDATE SKIP LOCKED
2. `update_strategy_aggregates(p_strategy_id, p_cost_usd, p_final_elo)` — updates run_count, totals, avg_final_elo
3. `sync_to_arena(p_prompt_id, p_run_id, p_entries, p_matches)` — upserts entries + comparisons (max 200/1000)
4. `cancel_experiment(p_experiment_id)` — cancels experiment + fails all pending/running runs
5. `get_run_total_cost(p_run_id)` — sum invocation costs

**Key TypeScript Types** (evolution/src/lib/types.ts):
- `TextVariation`: id, text, version, parentIds, strategy, createdAt, iterationBorn, costUsd, fromArena
- `Rating`: { mu: number; sigma: number } — OpenSkill Bayesian
- `Match/V2Match`: variationA/B, winner, confidence, judgeModel
- `EvolutionRunSummary` (V3): version, stopReason, totalIterations, muHistory, matchStats, topVariants, strategyEffectiveness
- `EvolutionConfig`: iterations, budgetUsd, judgeModel, generationModel, strategiesPerRound?, calibrationOpponents?, tournamentTopK?
- `EvolutionResult`: winner, pool, ratings, matchHistory, totalCost, iterationsRun, stopReason, muHistory, diversityHistory

**Rating System:**
- OpenSkill (Weng-Lin Bayesian): DEFAULT_MU=25, DEFAULT_SIGMA=8.333, CONVERGENCE_SIGMA=3.0
- Elo scale: `1200 + (mu - 25) * 16`, clamped [0, 3000]
- Functions: `createRating()`, `updateRating(winner, loser)`, `updateDraw(a, b)`, `isConverged(r)`

---

### 1.3 Rating, Ranking & Arena

**Two-Phase Ranking:**

**Phase 1: Triage (new entrant calibration)**
- Filters new entrants with sigma >= 5.0
- Stratified opponents: 2 top, 2 mid, 1 bottom/new (for n=5)
- Early exit: ≥2 decisive matches (conf ≥ 0.7) AND avg confidence ≥ 0.8
- Elimination: mu + 2*sigma < top 20% cutoff

**Phase 2: Swiss Fine-Ranking**
- Eligible: not eliminated AND (mu ≥ 3*sigma OR in top-K)
- Bradley-Terry pairing: `pWin = 1/(1 + exp(-(muA - muB)/BETA))` where BETA = sigma*√2
- Pair score: outcomeUncertainty × avgSigma (greedy selection)
- Max 20 Swiss rounds; convergence check every round
- Budget-tier-controlled max comparisons (40/25/15)

**Bias Mitigation (2-Pass A/B Reversal):**
- Forward pass: compare(A, B); Reverse pass: compare(B, A)
- Confidence: 1.0 (both agree), 0.7 (one TIE), 0.5 (disagree → TIE), 0.3 (partial failure), 0.0 (total failure)
- Cache: order-invariant SHA-256 key, only caches confidence > 0.3

**parseWinner() Priority:**
1. Exact token: "A", "B", "TIE"
2. Phrase: "TEXT A"/"TEXT B" (non-ambiguous)
3. Keywords: "TIE", "DRAW", "EQUAL"
4. First word: "A.", "B." (strict)
5. null (unparseable)

**Arena System:**
- `loadArenaEntries(promptId)`: loads non-archived entries, marks `fromArena=true`, presets ratings
- `syncToArena(runId, promptId, pool, ratings, matchHistory)`: upserts non-arena variants + match history via RPC
- Arena entries participate in ranking but are NOT persisted to evolution_variants

---

### 1.4 Operations (Agents)

**generateVariants()** — 3 parallel strategies:
1. **structural_transform**: aggressive restructuring (reorder, merge, split sections)
2. **lexical_simplify**: simplify language, remove jargon
3. **grounding_enhance**: add examples, make concrete

- Runs via `Promise.allSettled()`; validated outputs only; invalid silently discarded
- Supports `BudgetExceededWithPartialResults` for mid-generation budget exhaustion

**rankPool()** — triage + Swiss fine-ranking:
- Returns `RankResult`: matches[], ratingUpdates (full snapshot), matchCountIncrements (deltas), converged
- Draw logic: confidence < 0.3 OR winnerId === loserId → treated as draw
- Comparison callback: wraps LLM completion with error handling

**evolveVariants()** — mutation + crossover on top 2 parents:
1. **mutate_clarity**: simplify sentences, improve precision (parent 0)
2. **mutate_structure**: reorganize flow, transitions (parent 0)
3. **crossover**: combine structural + stylistic elements (if 2+ parents)
4. **creative_exploration**: bold different version (if 0 < diversityScore < 0.5)

**Format Validation** (formatValidator.ts):
- H1 title (exactly one, first line)
- Section headings (at least one ## or ###)
- No bullet points, numbered lists, or tables
- Paragraph sentences (2+ per paragraph, 25% tolerance)
- Modes: `FORMAT_VALIDATION_MODE` env var — "reject" (default), "warn", "off"

---

## Round 2: Supporting Systems

### 2.1 Experiments & Strategy System

**Experiment Lifecycle:** draft → running → completed/cancelled
- `createExperimentAction(name, promptId)` → experiment row
- `addRunToExperimentAction(experimentId, {strategy_id, budget_cap_usd})` → pending run; auto-transitions draft→running
- Auto-completion: experiment set to completed when run finalizes (if status='running')

**Strategy System:**
- `V2StrategyConfig`: { generationModel, judgeModel, iterations, strategiesPerRound?, budgetUsd? }
- Hash: SHA-256 of {generationModel, judgeModel, iterations} → 12-char hex (budgetUsd excluded)
- Auto-label: "Gen: {model} | Judge: {model} | {iters} iters | Budget: ${budget}"
- Upsert by hash: INSERT ... ON CONFLICT (race-safe)
- Aggregates: run_count, total_cost_usd, avg_final_elo, best/worst_final_elo, avg_elo_per_dollar

**Experiment UI (ExperimentForm):**
- Step 1: Setup (name, prompt, budget per run)
- Step 2: Strategies (multi-select, runs per strategy)
- Step 3: Review (validate, $10 max total)

**ExperimentMetrics:**
```typescript
{ maxElo, totalCost, runs: [{ runId, elo, cost, eloPerDollar }] }
```

**Bootstrap Confidence Intervals** (experimentMetrics.ts):
- `bootstrapMeanCI()`: 1000 iterations, Normal(value, sigma) resampling, 95% CI
- `bootstrapPercentileCI()`: resample runs + within-run variants from Normal(mu, sigma)
- Routes: median/p90/max Elo → percentile CI; cost/totalVariants → mean CI

---

### 2.2 Cost Optimization & Analytics

**V2 Cost Tracker (cost-tracker.ts):**
- Reserve-before-spend with 1.3x margin
- Synchronous `reserve()` for Node.js event loop safety
- Per-phase costs: generation, ranking, evolution
- Budget tiers scale ranking comparisons

**LLM Pricing (src/config/llmPricing.ts):**
| Model | Input/1M | Output/1M |
|-------|----------|-----------|
| gpt-4.1-nano | $0.10 | $0.40 |
| gpt-4.1-mini | $0.40 | $1.60 |
| gpt-4.1 | $2.00 | $8.00 |
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| deepseek-chat | $0.14 | $0.28 |
| claude-sonnet-4 | $3.00 | $15.00 |
| claude-haiku-4-5 | $0.80 | $4.00 |
| Unknown (fallback) | $15.00 | $60.00 |

**Token Estimation:** 1 token ≈ 4 chars; output estimates: generation 1000, evolution 1000, ranking 100 tokens

**Cost Analytics (costAnalytics.ts):**
- `getCostSummaryAction(filters)` — totalCost, totalCalls, avgCostPerCall
- `getDailyCostsAction()` — daily breakdown from `daily_llm_costs` view
- `getCostByModelAction()` — per-model token/cost breakdown
- `getCostByUserAction()` — top spenders

**Cost Aggregation:**
- `get_run_total_cost(UUID)` RPC → sum(cost_usd) from invocations
- `evolution_run_costs` view → aggregated by run_id
- Covering index: `idx_invocations_run_cost` on (run_id, cost_usd)

---

### 2.3 Admin UI & Visualization

**15 Admin Pages:**
1. `/admin/evolution-dashboard` — aggregate metrics, auto-refresh 15s
2. `/admin/evolution/runs` — runs list with status filtering
3. `/admin/evolution/runs/[runId]` — detail with tabs: Overview, Elo, Lineage, Variants, Logs
4. `/admin/evolution/experiments` — experiment list
5. `/admin/evolution/experiments/[experimentId]` — tabs: Overview, Analysis, Runs
6. `/admin/evolution/start-experiment` — 3-step creation wizard
7. `/admin/evolution/arena` — arena topics list
8. `/admin/evolution/arena/[topicId]` — leaderboard (Elo, Mu, Sigma, Matches, Cost)
9. `/admin/evolution/arena/entries/[entryId]` — entry detail
10. `/admin/evolution/variants` — paginated variant list
11. `/admin/evolution/variants/[variantId]` — variant detail
12. `/admin/evolution/prompts` — CRUD for evolution_prompts
13. `/admin/evolution/strategies` — CRUD for evolution_strategies
14. `/admin/evolution/invocations` — invocation list
15. `/admin/evolution/invocations/[invocationId]` — invocation detail

**Key Shared Components:**
- EntityDetailHeader, EntityDetailTabs, EntityTable, EntityListPage
- MetricGrid (2-5 columns, multiple variants)
- RunsTable, RegistryPage, FormDialog, ConfirmDialog
- EloTab (SVG line chart), LineageTab (D3 DAG), MetricsTab
- EvolutionStatusBadge, AutoRefreshProvider

**Server Actions (8 service files, 30+ actions):**
- evolutionActions.ts — run/variant CRUD (queueRun, getRuns, kill, archive, getCostBreakdown, getLogs)
- evolutionVisualizationActions.ts — dashboard/elo/lineage data
- arenaActions.ts — arena topics + prompt registry
- variantDetailActions.ts — variant deep dive (parents, children, lineage, match history)
- experimentActionsV2.ts — experiment lifecycle
- strategyRegistryActionsV2.ts — strategy CRUD
- invocationActions.ts — invocation listing
- adminAction.ts — auth + logging factory wrapping all actions

---

### 2.4 Deployment, CLI & Runner Infrastructure

**CLI Scripts:**
1. `evolution-runner-v2.ts` — V2 batch runner; `--parallel N`, `--max-runs N`, `--max-concurrent-llm N`
2. `evolution-runner.ts` — multi-database runner (staging + prod round-robin); `--dry-run` support
3. `run-evolution-local.ts` — standalone local CLI; `--file`, `--prompt`, `--mock`, `--model`

**Claiming Mechanism:**
- PostgreSQL `claim_evolution_run(p_runner_id, p_run_id)` with FOR UPDATE SKIP LOCKED
- FIFO ordering (oldest pending first)
- Continuation priority (continuation_pending before pending, V1 legacy)
- Concurrent run limit: `EVOLUTION_MAX_CONCURRENT_RUNS` (default 5)

**Heartbeat:** 30s interval → `last_heartbeat` column; watchdog detects stale after 10 min

**Watchdog** (evolution/src/lib/ops/watchdog.ts):
- Finds runs in claimed/running with stale heartbeat
- Marks as failed with structured error message
- Configurable threshold: `EVOLUTION_STALENESS_THRESHOLD_MINUTES` (default 10)

**API Route:** `POST /api/evolution/run` — admin-only, max 800s duration, optional `{ runId }` targeting

**Environment Variables:**
| Variable | Purpose | Default |
|----------|---------|---------|
| EVOLUTION_MAX_CONCURRENT_RUNS | Max parallel runs | 5 |
| EVOLUTION_STALENESS_THRESHOLD_MINUTES | Stale detection timeout | 10 |
| OPENAI_API_KEY | OpenAI API | — |
| DEEPSEEK_API_KEY | DeepSeek API | — |
| ANTHROPIC_API_KEY | Claude API | — |
| LOCAL_LLM_BASE_URL | Ollama endpoint | localhost:11434/v1 |

---

## Round 3: Deep Dives

### 3.1 Format Validation & Prompt Construction

**FORMAT_RULES (injected into all generation/evolution prompts):**
```
=== OUTPUT FORMAT RULES (MANDATORY — violations cause rejection) ===
Start with a single H1 title using the Markdown "# Title" syntax. Use Markdown
headings at the ## or ### level to introduce each new section or topic shift.
Write in complete paragraphs of two or more sentences each, separated by blank
lines. Never use bullet points, numbered lists, or tables anywhere in the output.
Every block of body text must be a full paragraph.
===================================================================
```

**Validation Rules (formatValidationRules.ts):**
- Bullet: `/^\s*[-*+]\s/m`
- Numbered list: `/^\s*\d+[.)]\s/m`
- Table: `/^\|.+\|/m`
- Horizontal rule: `/^\s*[-*_](\s*[-*_]){2,}\s*$/m`
- Code blocks stripped before checking (matched pairs first, then trailing unclosed fences)

**Prompt Templates:**

Generation prompts (generate.ts):
- `structural_transform`: "AGGRESSIVELY restructure... reimagine organization from scratch"
- `lexical_simplify`: "Replace complex words... improve accessibility"
- `grounding_enhance`: "Add specific examples... strengthen real-world connection"

Evolution prompts (evolve.ts):
- `clarity` mutation: "Simplify complex sentences, remove ambiguous phrasing"
- `structure` mutation: "Reorganize for better flow, strengthen transitions"
- `crossover`: "Combine best structural + stylistic elements of two parents"
- `creative_exploration`: "SIGNIFICANTLY DIFFERENT version... take creative risks" (conditional)

Comparison prompt (comparison.ts):
- Evaluates clarity, structure, engagement, grammar, effectiveness
- Responds with only "A", "B", or "TIE"

Seed article (seed-article.ts):
- Call 1: title generation (60s timeout)
- Call 2: article generation with FORMAT_RULES (60s timeout)
- Output: `# ${title}\n\n${articleContent}`

**Feedback Section (optional in prompts):**
```
## Feedback
Weakest dimension: ${dimension}
Suggestions:
- ${suggestion1}
- ${suggestion2}
```

---

### 3.2 LLM Client & Provider Abstraction

**createV2LLMClient()** wraps any provider implementing `{ complete(prompt, label, opts?) }`

**Retry Logic:**
- MAX_RETRIES = 3; exponential backoff: 1s → 2s → 4s
- Per-call timeout: 60s via Promise.race()
- BudgetExceededError NEVER retried
- Transient errors retried (network, rate limit)

**Error Classification (errorClassification.ts):**
- OpenAI SDK: APIConnectionError, RateLimitError, InternalServerError
- Network messages: socket timeout, econnreset, econnrefused, etimedout, fetch failed
- HTTP status codes: 429, 408, 500, 502, 503, 504
- Cause chain walking for wrapped errors

**Model Selection:**
- Generation phase: `config.generationModel`
- Ranking phase: `config.judgeModel`
- Evolution phase: default model (typically generationModel)
- Override per-call via `options.model`

**Provider Examples (run-evolution-local.ts):**
- Mock: templated responses for testing
- OpenAI: standard SDK
- DeepSeek: OpenAI SDK with baseURL override
- Anthropic: @anthropic-ai/sdk with max_tokens=8192
- Ollama: OpenAI SDK with localhost endpoint

---

### 3.3 Run Logger & Invocation Tracking

**RunLogger** (run-logger.ts):
- Fire-and-forget writes to `evolution_run_logs` table
- Levels: info, warn, error, debug
- DB errors swallowed (console.warn only)
- Context fields: phaseName → agent_name, iteration, variantId + custom JSONB

**Invocation Tracking** (invocations.ts):
- `createInvocation(db, runId, iteration, phaseName, executionOrder)` → UUID | null
- `updateInvocation(db, id, { cost_usd, success, execution_detail, error_message })` → void
- Null-safe: no-op if creation failed
- UNIQUE constraint: (run_id, iteration, agent_name)

**Budget Event Logging:**
- Optional BudgetEventLogger attached to CostTracker
- Events: reserve, spend, release_ok, release_failed
- Full audit trail with invocation UUID and iteration context

**Log Indexes:**
1. `idx_run_logs_run_id(run_id, created_at DESC)` — all logs newest first
2. `idx_run_logs_iteration(run_id, iteration)` — group by iteration
3. `idx_run_logs_agent(run_id, agent_name)` — filter by agent
4. `idx_run_logs_variant(run_id, variant_id)` — variant-specific
5. `idx_run_logs_level(run_id, level)` — error filtering

---

### 3.4 Migration Timeline

**Phase 1: V1 Schema (Jan 31 - Feb 5):** Initial tables for runs, variants, checkpoints, agent metrics, batch runs, strategy configs

**Phase 2: Features (Feb 11 - Feb 21):** Run logs, agent invocations, claim RPC, apply winner RPC, table renames (content_evolution_* → evolution_*), dropped columns

**Phase 3: Experiments & Arena (Feb 22 - Mar 5):** Experiment tables, arena rename (hall_of_fame → arena), sync_to_arena RPC

**Phase 4: V2 Clean Slate (Mar 15 - Mar 21):**
- **20260315000001**: DROPPED all V1 objects; created 10 fresh tables, 4 RPCs, 16 indexes, default-deny RLS
- **20260318000001**: readonly_local SELECT policies
- **20260318000002**: Backfilled budget_cap_usd, enforced NOT NULL on strategy_id, dropped config column
- **20260319000001**: Cost helper function + view
- **20260320000001**: Entity renames (strategy_configs→strategies, arena_topics→prompts, FK column renames)
- **20260321000001**: Explicit service_role_all RLS bypass

---

## Round 4: Specialized Areas

### 4.1 Testing Infrastructure

**Unit Tests (evolution/src/lib/pipeline/*.test.ts):** 18 test files covering rank, finalize, evolve-article, arena, llm-client, cost-tracker, runner, generate, compose, experiments, evolve, invocations, strategy, run-logger, seed-article, types, executePhase

**Shared Library Tests:** 10 files covering rating, comparison, validation, textVariationFactory, errorClassification, formatValidator, comparisonCache, reversalComparison

**Service Tests:** 8 files covering evolutionRunnerCore, experimentActionsV2, variantDetailActions, arenaActions, evolutionActions, costAnalytics, strategyRegistryActionsV2

**Component Tests:** 25 component + 13 page tests under evolution/src/components/ and src/app/admin/evolution/

**E2E:** Playwright smoke tests for dashboard, runs, strategies, arena pages

**Integration:** evolution-run-costs.integration.test.ts with real DB, FK-safe cleanup

**Key Mock Patterns:**
- `createV2MockLlm()` — label-based and positional responses
- `createSupabaseChainMock()` — fluent Supabase query chain mocking
- `createTableAwareMock()` — sequential .from() call mocking
- Test helpers: createTestStrategyConfig, createTestPrompt, createTestEvolutionRun, createTestVariant

---

### 4.2 Entity Diagram & Type Hierarchy

**Entity Relationships:**
```
EXPERIMENT → PROMPT (1:1)
EXPERIMENT → RUN (1:N)
STRATEGY → RUN (1:N, NOT NULL)
RUN → PROMPT (N:1)
RUN → VARIANT (1:N, CASCADE)
RUN → INVOCATION (1:N, CASCADE)
RUN → LOG (1:N, CASCADE)
VARIANT → VARIANT (self-ref, parent_variant_id)
PROMPT → ARENA_ENTRY (1:N, CASCADE)
PROMPT → ARENA_COMPARISON (1:N, CASCADE)
```

**Type Hierarchy:**
- `TextVariation` → `OutlineVariant` (extends with steps array)
- `Rating = { mu, sigma }` (OpenSkill)
- `Match` (V1, detailed) → `V2Match` (minimal: winnerId, loserId, result, confidence)
- `EvolutionRunSummary` V1 → V2 → V3 (auto-migrate on parse)
- `ReadonlyPipelineState` (V1 agent contract) — V2 doesn't use, uses local mutable state
- `SerializedPipelineState` (checkpoint format, V2 doesn't checkpoint)
- `AgentExecutionDetail` (union of 11 agent-specific detail types)
- `ExecutionContext` (payload + state + llm + logger + costTracker)

---

### 4.3 Watchdog & Operations

**Watchdog** (evolution/src/lib/ops/watchdog.ts):
- Detection: claimed/running runs with last_heartbeat older than threshold
- Action: mark as failed with "Run abandoned: no heartbeat for X minutes"
- Returns: WatchdogResult { staleRunsFound, markedFailed[] }

**Admin Operations:**
- killEvolutionRunAction: pending/claimed/running → failed ("Manually killed by admin")
- archiveRunAction / unarchiveRunAction: toggle archived boolean
- cancelExperimentAction: cancel experiment + bulk-fail runs via RPC

**Concurrent Run Limits:**
- Checked before claiming: `activeCount >= maxConcurrent` → reject
- Query: count runs in claimed/running status

**Error Recovery:**
- Pipeline errors → markRunFailed with truncated message (2000 chars)
- DB errors in heartbeat/kill-check → logged but don't halt
- Arena load/sync failures → warned but don't fail run

---

### 4.4 Seed Article & Content Resolution

**Content Resolution (runner.ts):**
- Path A (explanation_id): direct DB read from explanations.content
- Path B (prompt_id): 2-stage LLM seed generation (title + article)
- Priority: explanation_id checked first

**Seed Generation (seed-article.ts):**
1. Title generation (60s timeout): "generate a concise, descriptive title"
2. Article generation (60s timeout): "Write a clear, comprehensive explanation" with FORMAT_RULES
3. Output: `# ${title}\n\n${articleContent}` (800-1500 words target)

**Pool Initialization:**
1. Baseline variant (strategy='baseline', version=0)
2. Arena entries (if prompt_id): loaded with pre-seeded ratings, marked fromArena=true

**Winner Determination:**
1. Primary: highest mu
2. Tiebreaker: lowest sigma
3. Fallback: pool[0] (baseline)

**Finalization:**
1. Filter out arena entries (fromArena=true)
2. Build run_summary V3
3. Upsert variants with elo_score = toEloScale(mu)
4. Update strategy aggregates via RPC
5. Auto-complete experiment (if applicable)
6. Sync to arena (if prompt_id): upsert non-arena variants + match history

---

## Round 5: Final Details

### 5.1 Diversity & Convergence

**Diversity Score:** DECLARED BUT NOT IMPLEMENTED in V2
- `diversityHistory` initialized as empty array, never populated
- `diversityScore` always defaults to 1.0 when passed to evolveVariants
- Creative exploration trigger (0 < diversity < 0.5) never fires correctly
- Expected: pairwise text similarity calculation after ranking

**Pool Management:**
- Append-only: variants NEVER removed
- Growth rate: ~5-6 variants/iteration (3 generated + 2-3 evolved)
- After N iterations: 1 baseline + arena entries + 5-6*N variants
- Elimination only prevents further comparisons (variant stays in pool)

**muHistory:**
- One entry per iteration (after ranking)
- Top-K mu values (K = tournamentTopK, default 5)
- Sorted descending by skill estimate
- Persisted in run_summary for visualization

---

### 5.2 Error Classes & Spending Gate

**Error Hierarchy:**
- `BudgetExceededError(agentName, spent, reserved, cap)` — per-run budget
- `BudgetExceededWithPartialResults(partialVariants, originalError)` — extends above with salvaged variants
- `GlobalBudgetExceededError(message)` — system-wide daily/monthly caps
- `LLMKillSwitchError()` — emergency stop all LLM calls
- CRITICAL: check BudgetExceededWithPartialResults BEFORE BudgetExceededError (subclass check order)

**LLM Spending Gate (src/lib/services/llmSpendingGate.ts):**
1. Kill switch check (5s cache TTL) → LLMKillSwitchError
2. Category routing: 'evolution_*' → evolution, else → non_evolution
3. Fast path: cached spending well below cap (10% headroom, 30s TTL) → return
4. Near-cap: DB reservation via `check_and_reserve_llm_budget` RPC
5. Monthly cap check (60s cache TTL) → GlobalBudgetExceededError
6. Post-call: `reconcileAfterCall()` in finally block (non-fatal)
7. Cleanup: `cleanupOrphanedReservations()` for crashed processes

**Two-Layer Budget:**
- Layer 1: Local per-run (V2CostTracker) — synchronous, per-phase
- Layer 2: Global daily/monthly (LLMSpendingGate) — DB-backed with cache
- Both must pass before LLM call proceeds

---

### 5.3 Pipeline State & Composition

**V2 State Pattern:** Monolithic orchestrator with local mutable state
- `pool: TextVariation[]` — grows with push()
- `ratings: Map<string, Rating>` — updated via set()
- `matchCounts: Map<string, number>` — accumulated deltas
- `allMatches: V2Match[]` — appended per ranking phase

**Phase Execution (executePhase helper):**
1. Success → `{ success: true, result }`
2. BudgetExceededWithPartialResults → `{ success: false, budgetExceeded: true, partialVariants }`
3. BudgetExceededError → `{ success: false, budgetExceeded: true }`
4. Other errors → re-thrown

**Key Design:** V2 is a monolithic orchestrator pattern. `evolveArticle()` maintains all state directly and calls pure phase functions. This differs from V1's supervisor-agent architecture with PipelineAction composition.

---

### 5.4 Old Docs Gap Analysis

**CRITICAL gaps (must address in rewrite):**
- `evolution_explanations` table not documented
- Clean-slate V2 migration (20260315) implications not explained
- RLS policies (deny-all + service_role bypass) not documented
- `evolution_budget_events` audit log table missing from schema docs
- Seed article generation (2 LLM calls) not documented in architecture
- FORMAT_VALIDATION_MODE env var modes not mentioned
- Arena entry pre-seeding with ratings not detailed

**HIGH priority gaps:**
- Table/column renames (20260320) need consolidated explanation
- Budget pressure tiers need full documentation
- executePhase wrapper and BudgetExceededWithPartialResults not explained
- Bootstrap CI computation for experiment metrics needs detail
- Watchdog/ops modules exist but are NOT wired into batch runner

**MEDIUM priority gaps:**
- ComparisonCache confidence threshold behavior needs clarification
- Entity diagram exists but not referenced in docs
- Cost accuracy dashboard and calibration UI not documented
- Archive/unarchive functionality missing from docs
- Multi-target (staging+prod) batch runner not documented

**Per-document priority:**
| Document | Priority | Main Gaps |
|----------|----------|-----------|
| architecture.md | HIGH | evolution_explanations, arena pre-seeding, seed generation, RLS, format modes |
| data_model.md | CRITICAL | clean-slate migration, RLS, budget_events, arena_batch_runs |
| rating_and_comparison.md | MEDIUM | cache behavior, ELO_SCALE, incremental cost tracking |
| arena.md | MEDIUM | table renames, batch_runs, inline ratings, elo_per_dollar |
| agents/overview.md | HIGH | FORMAT_VALIDATION_MODE, executePhase, partial results, seed gen |
| cost_optimization.md | HIGH | budget_events, release(), margin detail, cost prediction |
| reference.md | CRITICAL | RLS, ops NOT wired, budget_events, archive status, env vars |
| visualization.md | MEDIUM | entity diagram, CostAccuracyPanel, archive UI, CIs |
| strategy_experiments.md | MEDIUM | auto-transition, manual analysis, bootstrap CIs |
| experimental_framework.md | MEDIUM | uncertainty propagation, percentile algorithm |
| minicomputer_deployment.md | LOW | multi-target, runner flags, systemd timeout |
| curriculum.md | MEDIUM | new tables, budget events, archive, RLS |

---

## Round 6: Architecture Deep Dives

### 6.1 V1 vs V2 Differences

**V1 Architecture (Deleted):**
- Supervisor → Agent Pool → Reducer pattern with 11+ specialized agents
- Agents: treeSearch, sectionDecomposition, debate, proximity, metaReview, outlineGeneration, flowCritique, iterativeEditing, reflection, generation, ranking
- State managed via immutable PipelineAction objects applied by reducer
- Checkpoint/resume system with `evolution_checkpoints` table and `supervisorState`
- Phases: EXPANSION (0-3) → COMPETITION (4+) tracked in supervisorState

**V2 Architecture (Current):**
- Monolithic orchestrator in `evolveArticle()` with 3 pure phase functions
- Direct mutable state (pool.push, ratings.set) — no action objects, no reducer
- No checkpoints, no resumption — all-or-nothing atomic execution
- No phases — linear generate→rank→evolve loop

**Legacy Code Still in Codebase:**
- Type stubs: PipelineAction, SectionEvolutionState, TreeSearchResult, TreeState (types.ts lines 10-14)
- AgentName union still declares all 11 old agent names
- 8 unused AgentExecutionDetail interfaces (IterativeEditing, Reflection, Debate, etc.)
- Checkpoint serialization types (SerializedCheckpoint, supervisorState fields)
- Validation functions (validateStateContracts, validatePoolAppendOnly) — defined but NEVER CALLED in V2
- Scripts marked @ts-nocheck: evolution-runner.ts, run-evolution-local.ts

**Run Summary Migration:** V1 (Elo-based) → V2 (ordinal-based) → V3 (mu-based)
- V1/V2 auto-transform on read via Zod union schema
- Formula: `mu = elo_or_ordinal + 3 * DEFAULT_SIGMA` (≈ + 25)
- diversityHistory always empty in V2; metaFeedback always null

---

### 6.2 Admin Action Patterns

**adminAction Factory** (evolution/src/services/adminAction.ts):
- Arity detection: handler.length distinguishes zero-arg vs single-arg handlers
- Auth: `requireAdmin()` → queries admin_users table → returns user.id
- Supabase: creates service-role client (bypasses RLS)
- Error handling: catches all errors → ActionResult<T> with categorized ErrorResponse
- Middleware: withLogging (input/output sanitization) + serverReadRequestId (Sentry context)

**ActionResult<T>:** `{ success: boolean; data: T | null; error: ErrorResponse | null }`

**Pagination Pattern:** `.range(offset, offset + limit - 1)` with `{ count: 'exact' }`; max 200 items

**Enrichment Pattern:** Fetch list → extract IDs → batch-fetch related data via `.in()` → merge into Map

---

### 6.3 Shared Component Architecture

**Key Patterns:**
- **EntityListPage**: title, filters, EntityTable, pagination (sliding window, MAX_VISIBLE_PAGES=7)
- **EntityDetailHeader**: inline rename (edit mode toggle), status badge, cross-links, action slots
- **EntityDetailTabs + useTabState**: URL-synced tabs via `?tab=<id>`, legacy tab map redirect
- **RegistryPage**: config-driven CRUD (ColumnDef, RowAction, FormDialog, ConfirmDialog)
- **MetricGrid**: variants (default/card/bordered), CI display `[lower, upper]`, low-sample asterisk
- **RunsTable**: budget visualization (color-coded progress bar), cost warning indicators
- **LineageGraph**: D3 DAG, dynamic import (SSR-disabled), layers by iterationBorn, STRATEGY_PALETTE colors
- **AutoRefreshProvider**: interval-based refreshKey, visibility pausing, completion trigger
- **EntityDetailPageClient**: config-driven detail shell (loadData → header + tabs + content)

---

### 6.4 Integration with Main App

**Monorepo Structure:** evolution/ is NOT a separate package; shares package.json and tsconfig.json
- Path alias: `@evolution/*` → `./evolution/src/*` (tsconfig.json + next.config.ts turbopack)
- Admin pages mounted at `/src/app/admin/evolution/*`
- EvolutionSidebar groups: Overview, Entities, Results

**LLM Integration:**
- Runner creates adapter wrapping main `callLLM()` function
- call_source: `'evolution_<label>'` (triggers evolution category in spending gate)
- System user: `'00000000-0000-4000-8000-000000000001'`
- LLM calls tracked in main `llmCallTracking` table with evolution_invocation_id FK

**Data Links:**
- `evolution_runs.explanation_id` → main `explanations` table
- Winner application back to explanations: NOT implemented in V2 (V1 RPC `apply_evolution_winner` dropped)

---

## Round 7: Detailed Mechanics

### 7.1 Config Validation & Defaults

**Validation Ranges (evolve-article.ts validateConfig):**
| Field | Range | Default |
|-------|-------|---------|
| iterations | 1-100 | — (required) |
| budgetUsd | >0, ≤50 | 1.0 (from run.budget_cap_usd) |
| judgeModel | non-empty string | — (required) |
| generationModel | non-empty string | — (required) |
| strategiesPerRound | ≥1 if defined | 3 |
| calibrationOpponents | ≥1 if defined | 5 (hardcoded in runner.ts) |
| tournamentTopK | ≥1 if defined | 5 (hardcoded in runner.ts) |

**Config Construction Flow:**
1. Load V2StrategyConfig from evolution_strategies.config (JSONB)
2. Extract: generationModel, judgeModel, iterations (required)
3. Build EvolutionConfig: merge with run.budget_cap_usd (default $1.00) + defaults for optional fields

---

### 7.2 Variant Lineage Tracking

**In-Memory vs Database:**
- TextVariation: `parentIds: string[]` (array, supports crossover with 2 parents)
- DB: `parent_variant_id UUID` (single parent only — parentIds[0])
- **Second parent silently dropped** at finalize.ts:160

**Generation Phase:** parentIds=[], version=0 (fresh start)
**Evolution Phase:** parentIds=[top1.id, top2.id], version=max(parent versions)+1
**Arena Entries:** parentIds=[], fromArena=true, iterationBorn=0
**Baseline:** parentIds=[], strategy='baseline', version=0

**Lineage Visualization:**
- getEvolutionRunLineageAction → flat LineageNode[] with single parentId
- LineageTab builds edges from parent pointers
- LineageGraph layers by iterationBorn, renders D3 DAG

**Lineage Traversal:** getVariantLineageChainAction walks parent_variant_id chain (max 10 hops, cycle detection)

---

### 7.3 Comparison Cache System

**Two Cache Implementations:**
1. **ComparisonCache** (class, comparisonCache.ts): SHA-256 hash-based keys, LRU eviction (MAX_CACHE_SIZE=500), supports serialization
2. **Map<string, ComparisonResult>** (in evolve-article.ts): plain Map passed to rankPool, uses separate key generation

**Order-Invariant Keys:** Sort text pair hashes lexicographically → same key regardless of comparison order

**Cache Acceptance:** Only stores results where winnerId !== null OR isDraw === true; rejects error states for retry

**Confidence Threshold:** Only caches confidence > 0.3 in comparison.ts (partial/total failures excluded)

**Lifetime:** Per-run (created at iteration 0, persists across all iterations, not serialized between runs)

---

### 7.4 Experiment Metrics System

**Per-Run Metrics (computeRunMetrics):**
- Queries evolution_variants for Elo scores, evolution_agent_invocations for costs
- Computes: totalVariants, medianElo, p90Elo, maxElo, cost, eloPer$ = (maxElo-1200)/cost
- Per-agent costs: agentCost:<agent_name>

**Bootstrap CIs:**
- bootstrapMeanCI: 1000 iterations, Normal(value, sigma) resampling via Box-Muller, 95% CI [2.5th, 97.5th percentile]
- bootstrapPercentileCI: resample runs + within-run variants, propagate mu+sigma*z uncertainty to Elo scale
- Single observation: returns ci=null; ≥2: computes 95% CI

**V2 ExperimentMetrics (simplified, used in UI):**
- `{ maxElo, totalCost, runs: [{ runId, elo, cost, eloPerDollar }] }`
- Displayed in ExperimentAnalysisCard: summary cards + per-run table sorted by Elo

---

## Round 8: Supporting Systems

### 8.1 Run Summary Versions

**V3 (Current):** version: 3, mu-based, muHistory[], matchStats, topVariants[]{id, strategy, mu, isBaseline}, strategyEffectiveness, metaFeedback: null

**V2 (Legacy):** ordinalHistory, baselineOrdinal, topVariants[].ordinal, strategyEffectiveness[].avgOrdinal
**V1 (Legacy):** eloHistory, baselineElo, topVariants[].elo, strategyEffectiveness[].avgElo

**Migration:** Zod union schema tries V3 first, falls back to V2/V1 with .transform() converting to V3
- Formula: `mu = elo_or_ordinal + 3 * V2_DEFAULT_SIGMA` (≈ + 25)
- Transparent to consumers — always returns V3 shape
- No database mutation — transform on read only

**Zod Validation Limits:** max 100 history entries, max 10 topVariants, max 200 char strings

---

### 8.2 Strategy Effectiveness Tracking

**Run-Level:** finalize.ts computes strategyEffectiveness via Welford's online mean
- Groups variants by strategy, computes running avgMu

**Strategy-Level:** update_strategy_aggregates RPC (Welford's algorithm with FOR UPDATE locking):
- Inputs: strategy_id, cost_usd, final_elo
- Updates: run_count++, total_cost_usd+=cost, avg_final_elo (running mean), best/worst_final_elo, stddev_final_elo (via elo_sum_sq_diff M2 accumulator)
- avg_elo_per_dollar = (avg_final_elo - 1200) / total_cost_usd
- 5s statement_timeout to prevent deadlock

---

### 8.3 LLM Spending Gate Schema

**Tables:**
- `llm_cost_config`: key (PK), value JSONB ({"value": number|boolean}), updated_at, updated_by
  - Keys: daily_cap_usd ($50), evolution_daily_cap_usd ($25), monthly_cap_usd ($500), kill_switch_enabled (false)
- `daily_cost_rollups`: (date, category) PK, total_cost_usd, reserved_usd, call_count
  - Populated by AFTER INSERT trigger on llmCallTracking table

**RPCs:**
- `check_and_reserve_llm_budget(category, estimated_cost)` → JSONB {allowed, daily_total, daily_cap, reserved}
  - Uses FOR UPDATE row-level lock on daily_cost_rollups
  - Checks total_cost_usd + reserved_usd + estimated_cost against category cap
- `reconcile_llm_reservation(category, reserved)` → void: decrements reserved_usd (GREATEST(0, ...))
- `reset_orphaned_reservations()` → void: resets all reserved_usd to 0 for today

---

### 8.4 Recommended Doc Structure

**12 documents in 5 tiers:**

**Tier 1 (Foundation):** README.md, architecture.md, data_model.md, rating_and_comparison.md
**Tier 2 (Operations):** agents/overview.md, arena.md
**Tier 3 (Administration):** strategy_experiments.md, experimental_framework.md, cost_optimization.md
**Tier 4 (Deployment):** reference.md, minicomputer_deployment.md
**Tier 5 (Learning):** curriculum.md
**Supporting:** entity_diagram.md (keep as-is)

**Writing Priority:**
1. HIGH: data_model.md, architecture.md, agents/overview.md, cost_optimization.md
2. MEDIUM: rating_and_comparison.md, strategy_experiments.md, experimental_framework.md, reference.md
3. LOWER: arena.md, minicomputer_deployment.md, curriculum.md, README.md (finalize last)

**Target Lengths:** README 300-400w, architecture 2500-3500w, data_model 2800-3500w, reference 3500-4500w, others 1500-3000w
