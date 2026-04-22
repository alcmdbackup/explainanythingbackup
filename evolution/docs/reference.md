# Evolution System Reference

Comprehensive reference for the Evolution pipeline codebase: file inventory, configuration, CLI scripts, infrastructure mechanisms, testing patterns, admin UI routes, error classes, and RLS policies.

For conceptual overviews see [Architecture](architecture.md); for database schema see [Data Model](data_model.md); for cost details see [Cost Optimization](cost_optimization.md).

---

## Key Files by Layer

### Pipeline (`evolution/src/lib/pipeline/`)

The core pipeline implements the generate-rank-evolve loop and all supporting infrastructure. The call chain flows: `claimAndExecuteRun` (claimAndExecuteRun.ts) calls the internal `executePipeline()`, which calls `evolveArticle` (loop/runIterationLoop.ts), iterating through `generate` / `rank` / `evolve` phases per iteration, then `finalizeRun` persists results.

| File | Purpose |
|------|---------|
| `claimAndExecuteRun.ts` | `claimAndExecuteRun` — top-level orchestrator and single public entry point. Claims a pending run via RPC, starts 30s heartbeat, builds run context (resolves content from `explanations` or `evolution_prompts` table, or generates seed article), loads strategy config, constructs `EvolutionConfig`, calls `evolveArticle`, then `finalizeRun` and `syncToArena`. Accepts optional `db` for multi-DB batch runners and optional `dryRun` flag. Exports `ClaimedRun`, `RunnerOptions`, `RunnerResult` types. |
| `loop/runIterationLoop.ts` | `evolveArticle` — main loop entry point. Validates `EvolutionConfig` constraints (see Configuration section), creates cost tracker and run logger, then iterates over `config.iterationConfigs[]`: dispatches generate or swiss agents per iteration with per-iteration budget tracking via `createIterationBudgetTracker`. Returns `EvolutionResult` with winner, pool, ratings, match history, cost, stop reason, iterationResults[], and convergence metrics (eloHistory, diversityHistory). |
| `generate.ts` | Text generation phase; produces new variants from 24 available tactics (3 core + 21 extended) using the configured generation model. When `generationGuidance` is set on the strategy config, uses weighted random tactic selection via `selectTacticWeighted()`; otherwise falls back to deterministic 3-tactic behavior. FORMAT_RULES are injected into the generation prompt. |
| `rank.ts` | Ranking phase; runs two-stage comparison: (1) calibration against N opponents for initial seeding, (2) Swiss-style tournament among top-K candidates. Updates `Rating {elo, uncertainty}` after each match (OpenSkill internally). |
| `evolve.ts` | Evolution phase; creates offspring variants by combining/mutating top-ranked parents. Uses the generation model with evolution-specific prompts that include parent text and critique feedback. |
| `finalize.ts` | `finalizeRun` — post-loop cleanup: persists final variants to `evolution_variants`, ratings and match history to their respective tables, updates the run row with `completed` status, total cost, iteration count, and stop reason. |
| `arena.ts` | `syncToArena` / `loadArenaEntries` / `isArenaEntry` — marks the winning variant (and optionally runner-up) as `synced_to_arena=true` in `evolution_variants` for cross-run arena competition. Arena entries are keyed by topic (derived from prompt). See [Arena](arena.md). |
| `cost-tracker.ts` | `createCostTracker` — per-run budget tracker using a reserve-before-spend pattern. `reserve()` is synchronous (critical for parallel safety under Node.js event loop). Applies a 1.3x margin on reservations. `recordSpend()` settles actual cost. `release()` frees reservation on failure. Throws `BudgetExceededError` when `spent + reserved + margined > budgetUsd`. |
| `run-logger.ts` | `createRunLogger` — structured logging adapter; writes iteration-level log rows to `evolution_run_logs` with phase, message, and optional metadata JSON. |
| `invocations.ts` | `createInvocation` / `updateInvocation` — records individual LLM calls to `evolution_invocations` with prompt text, response, model, token counts, cost, and latency for post-hoc cost auditing. |
| `infra/createEvolutionLLMClient.ts` | `createEvolutionLLMClient` — LLM abstraction with built-in retry (3 attempts, exponential backoff: 1s/2s/4s), 20-second per-call timeout, and cost tracker integration. SDK-level retries are disabled (`maxRetries: 0`) so this retry loop is the sole retry layer — worst-case 87s per call. Supports model pricing for `gpt-4.1-nano`, `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `deepseek-chat`, `claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001`. Falls back to most-expensive pricing ($15/$60 per 1M tokens) for unknown models. **Reservation** uses chars/4 as token approximation; **actual spend** uses real `usage.prompt_tokens`/`usage.completion_tokens` from the provider via `calculateLLMCost` (same helper `llmCallTracking` uses). Built per-invocation inside `Agent.run()` using the per-invocation `AgentCostScope` so parallel dispatch doesn't bleed sibling costs. |
| `seed-article.ts` | `generateSeedArticle` — produces the initial "generation 0" variant from the source prompt when no existing explanation content is available. Returns `SeedResult` with the generated text and cost. |
| `strategy.ts` | `hashStrategyConfig` / `upsertStrategy` / `labelStrategyConfig` — strategy fingerprinting via deterministic JSON hash (includes `iterationConfigs[]`); upserts to `evolution_strategies` table with deduplication. Located at `setup/findOrCreateStrategy.ts`. |
| `experiments.ts` | `createExperiment` / `addRunToExperiment` / `computeExperimentMetrics` — experiment grouping for A/B analysis. Returns `ExperimentMetrics` with aggregate Elo, cost, and convergence stats per strategy arm. |
| `prompts.ts` | Prompt template construction for generation and evolution phases; injects FORMAT_RULES and strategy-specific instructions. |
| `errors.ts` | `BudgetExceededWithPartialResults` — extends `BudgetExceededError` for mid-generation budget breaches with salvageable output. Carries `partialVariants: Variant[]` so the pipeline can finalize with whatever was produced before the budget ran out. |
| `types.ts` | V2-specific types: `EvolutionConfig` (run configuration with `iterationConfigs[]`), `EvolutionResult` (pipeline output including winner, pool, ratings, matchHistory, totalCost, iterationsRun, stopReason, iterationResults[], eloHistory, diversityHistory, matchCounts), `IterationResult` (per-iteration stop reason, budget allocated/spent, variants/matches), `IterationStopReason`, `V2Match` (winnerId/loserId/result/confidence/judgeModel/reversed), `StrategyConfig` (generationModel, judgeModel, iterationConfigs, budgetUsd, generationGuidance). |

### Core (`evolution/src/lib/core/`)

The core layer defines abstract base classes for entities and agents, the central metric catalog, and the entity registry. Subclasses in `entities/` and `agents/` implement concrete domain objects.

| File | Purpose |
|------|---------|
| `Entity.ts` | Abstract entity base class with generic CRUD (`list`, `getById`, `executeAction`), metric propagation (`propagateMetricsToParents`, `markParentMetricsStale`), and entity-aware logging via `createLogger`. |
| `Agent.ts` | Abstract agent base class with `run()`/`execute()` template method. `run()` wraps execution with budget-error handling, invocation tracking, cost attribution, duration tracking, and detail validation via safeParse. Builds a per-invocation `EvolutionLLMClient` from `ctx.rawProvider` + the scope when `usesLLM=true` (default; `MergeRatingsAgent` overrides to `false`), injecting it into `input.llm` before calling `execute`. `cost_usd` uses `scope.getOwnSpent()` as the authoritative source. |
| `metricCatalog.ts` | Central metric definitions (25 metrics) organized by timing phase (during_execution, at_finalization, at_propagation). Exports `METRIC_CATALOG` and `METRIC_FORMATTERS` for consistent formatting across UI. |
| `entityRegistry.ts` | Lazy-init entity registry mapping `EntityType` to singleton entity instances. Provides `getEntity(type)` lookup helper used by CRUD routing and metric propagation. Merges agent-specific `invocationMetrics` from `agentRegistry.ts` into `InvocationEntity` at init. |
| `agentRegistry.ts` | Lazy agent class registry; exports `getAgentClasses()` returning all concrete Agent subclasses. Used by `entityRegistry.ts` to collect and merge agent-declared `invocationMetrics` without creating circular imports. |
| `agentMetrics.ts` | Agent-specific metric compute functions (e.g. `format_rejection_rate` for GenerationAgent, `total_comparisons` for RankingAgent). Kept separate from `metricCatalog.ts` so agent metrics can reference agent implementation details. |
| `tactics/index.ts` | Tactic registry: exports `TACTIC_PALETTE` (color map for all 24 tactics + special variant types), tactic metadata, and tactic name constants. Moved from `VariantCard.tsx`. |
| `tactics/generateTactics.ts` | Tactic generation logic: builds the list of available tactics with prompt templates per tactic. |
| `tactics/selectTacticWeighted.ts` | Weighted random tactic selection from `generationGuidance` config. Builds a cumulative distribution and draws tactics per slot. |
| `tactics/types.ts` | Tactic type definitions: `Tactic`, tactic category enums, tactic metadata types. |
| `detailViewConfigs.ts` | Pure-data detail view configs (`DETAIL_VIEW_CONFIGS`) mapping agent names to `DetailFieldDef[]` arrays. Consumed by `ConfigDrivenDetailRenderer` to render invocation detail panels without per-agent custom components. |
| `entities/` | 6 entity subclasses: `RunEntity`, `StrategyEntity`, `ExperimentEntity`, `VariantEntity`, `InvocationEntity`, `PromptEntity`. Each declares parents, children, metrics, list columns, filters, actions, and detail tabs. |
| `agents/` | 2 agent subclasses: `GenerationAgent` (text generation phase), `RankingAgent` (triage + Swiss ranking phase). Each implements `execute()` and declares `detailViewConfig` and optional `invocationMetrics`. |

### Shared (`evolution/src/lib/shared/`)

Utilities shared between the pipeline, services, and UI layers. These modules have no V2-specific dependencies and can be consumed by any layer.

| File | Purpose |
|------|---------|
| `rating.ts` | Elo-scale rating system. `createRating()` returns `{elo: 1200, uncertainty: 400/3 ≈ 133.33}`. `updateRating(winner, loser)` and `updateDraw(a, b)` return updated pairs. `isConverged(rating, threshold?)` checks `uncertainty < DEFAULT_CONVERGENCE_UNCERTAINTY` (threshold is Elo-scale). `toDisplayElo(elo)` clamps to `[0, 3000]` for UI. `dbToRating(mu, sigma)` / `ratingToDb(r)` bridge the unchanged `evolution_variants.mu`/`sigma` DB columns. A private `toEloScale()` helper is retained internally. `computeEloPerDollar(elo, cost)` measures cost-efficiency. Constants: `DEFAULT_ELO=1200`, `DEFAULT_UNCERTAINTY=400/3`, `DEFAULT_CONVERGENCE_UNCERTAINTY=72`, `BETA_ELO=DEFAULT_UNCERTAINTY * sqrt(2)`. Internally wraps the `openskill` (Weng-Lin Bayesian) library via the `computeRatings.ts` adapter. See [Rating and Comparison](rating_and_comparison.md). |
| `computeRatings.ts` | `formatElo(elo)` — formats Elo values as rounded integers for display. `stripMarkdownTitle(text)` — removes leading markdown heading syntax from content strings for clean display in tables and previews. |
| `reversalComparison.ts` | `run2PassReversal` — runs the same comparison twice with prompt order reversed (A vs B, then B vs A) to detect and mitigate position bias. Accepts `ReversalConfig` for controlling tie-breaking and confidence thresholds. |
| `comparisonCache.ts` | `ComparisonCache` — in-memory LRU cache for pairwise comparison results keyed by `(variantIdA, variantIdB)`. Prevents redundant LLM comparison calls within a run. Max size controlled by `MAX_CACHE_SIZE` constant. Exports `CachedMatch` type. |
| `formatValidator.ts` | `validateFormat` — checks generated text against FORMAT_RULES. Returns `FormatResult` with pass/fail and violation details. Reads `FORMAT_VALIDATION_MODE` env var at call time: `reject` (default) throws on violation, `warn` logs but passes, `off` skips validation entirely. |
| `formatValidationRules.ts` | Individual validation rule definitions: no bullet points (`- ` or `* `), no numbered lists (`1. `), no tables (`|`), paragraph structure (min 2 sentences), heading hierarchy (H1 title required, body uses H2/H3). |
| `formatRules.ts` | `FORMAT_RULES` constant — the prose-only format instructions string injected into all generation and evolution prompts. Defined as a template literal with clear delimiters. |
| `selectWinner.ts` | `selectWinner(pool, ratings)` — unified winner determination. Highest `elo` wins, lowest `uncertainty` tiebreak. Unrated variants get `elo=-Infinity`. Returns `SelectWinnerResult = {winnerId, elo, uncertainty}`. Replaces duplicated inline logic in `runIterationLoop.ts` and `persistRunResults.ts`. |
| `textVariationFactory.ts` | `createVariant` — factory for constructing `Variant` objects with UUID-based ID generation, parent tracking, generation metadata, and strategy attribution. |
| `errorClassification.ts` | `isTransientError` — classifies errors as transient (network timeouts, rate limits, 5xx responses) vs permanent (auth failures, invalid requests, content policy violations) for the retry logic in `llm-client.ts`. |
| `strategyConfig.ts` | `labelStrategyConfig` / `defaultStrategyName` — generates human-readable labels from strategy config objects (e.g., "gpt-4.1-mini / 5 iter / $2.00"). Exports `StrategyConfig` and `StrategyConfigRow` types. |
| `seedArticle.ts` | Shared seed article utilities for constructing the initial input article. |
| `validation.ts` | Pipeline state invariant checks: `validateStateContracts(state, phase)` checks phase-specific requirements (e.g., ratings exist after calibration, matchHistory after tournament, critiques after review). `validateStateIntegrity(state)` checks structural consistency (pool/poolIds sync, parent references, rating keys). `validatePoolAppendOnly(before, after)` ensures no variants were removed. |

### Comparison (`evolution/src/lib/`)

| File | Purpose |
|------|---------|
| `comparison.ts` | `buildComparisonPrompt` / `parseWinner` / `compareWithBiasMitigation` — core pairwise comparison logic |

### Ops (`evolution/src/lib/ops/`)

| File | Purpose |
|------|---------|
| `watchdog.ts` | `runWatchdog` — detects stale runs (no heartbeat for N minutes) and marks them failed |
| `orphanedReservations.ts` | Cleans up orphaned budget reservations from crashed runners |

### Services (`evolution/src/services/`)

Server actions and the server-side runner core. All server actions use Next.js `'use server'` and access Supabase via `service_role` client. They are consumed by the admin UI pages.

| File | Purpose |
|------|---------|
| `claimAndExecuteRun.ts` | `claimAndExecuteRun` — server-side runner entry point. Calls `claim_evolution_run` RPC (concurrent limit enforced server-side via advisory lock), starts 30s heartbeat, calls `executePipeline()` internally which orchestrates the full pipeline lifecycle. Handles errors and marks run failed on unrecoverable exceptions. Uses a system UUID (`00000000-0000-4000-8000-000000000001`) for LLM call tracking. Accepts optional `db` (SupabaseClient) and `dryRun` (boolean) options. |
| `evolutionActions.ts` | Server actions for run management: create new runs, list runs with status/pagination filtering, cancel in-progress runs, retry failed runs, fetch run summaries. |
| `evolutionVisualizationActions.ts` | Server actions powering the Elo charts and convergence visualizations: `eloHistory` time series, diversity trend data, per-iteration cost breakdowns, rating distribution histograms. |
| `arenaActions.ts` | Server actions for the arena subsystem: list arena topics, fetch leaderboard rankings for a topic, get arena entry details with comparison history. Arena entries are now `evolution_variants` rows with `synced_to_arena=true` (the `evolution_arena_entries` table was consolidated into `evolution_variants` in migration `20260321000002`). |
| `variantDetailActions.ts` | Server actions for variant inspection: full variant text with metadata, parent lineage chain, match history (wins/losses/draws), text diffs between parent and child. |
| `experimentActionsV2.ts` | Server actions for experiment management: create experiments with strategy arms, list experiments, fetch experiment detail with per-arm metrics, add/remove runs from experiments. |
| `strategyRegistryActionsV2.ts` | Server actions for the strategy registry: CRUD operations on strategy configurations, list with filtering, fetch strategy usage statistics (run count, avg Elo). |
| `invocationActions.ts` | Server actions for LLM invocation auditing: list invocations with model/run filtering, fetch invocation detail (full prompt, response, token counts, cost, latency). |
| `adminAction.ts` | Shared admin utilities: authentication guards ensuring admin role, pagination parameter parsing and validation. |
| `shared.ts` | Common service utilities: Supabase `service_role` client construction, error message formatting, database query error handling patterns. |
| `costAnalytics.ts` | Cost analytics aggregation: per-model cost breakdown, daily/weekly spend trends, cost-per-iteration averages, budget utilization percentages. |
| `entityActions.ts` | Generic entity action dispatcher. Exports `executeEntityAction` server action. Input: `{ entityType, entityId, actionKey, payload? }`. Validates entity type against the entity registry, UUID format for entityId, and action key against the entity's declared actions. Uses `adminAction` wrapper for auth. Delegates to `Entity.executeAction` on the resolved entity instance. |

### Schemas (`evolution/src/lib/schemas.ts`)

Zod schemas for all 10 DB entity tables (InsertSchema + FullDbSchema pairs) and internal pipeline types (Variant, V2Match, Critique, MetaFeedback, EvolutionResult, AgentExecutionDetail discriminated union, etc.). Core types like `Variant`, `Critique`, `MetaFeedback`, and `V2Match` are now derived from these Zod schemas via `z.infer<>`.

### Types (`evolution/src/lib/types.ts`)

Central type definitions shared across all layers. Key exports include `Variant`, `ExecutionContext`, `ReadonlyPipelineState`, `EvolutionRunStatus`, `Match`, `Critique`, `MetaFeedback`, `EvolutionLLMClient`, `EvolutionLogger`, `CostTracker`, `BudgetExceededError`, `LLMRefusalError`, `BASELINE_STRATEGY`, and `PIPELINE_TYPES`.

---

## Barrel File Exports

### `evolution/src/lib/index.ts`

Public API for the evolution subsystem. Re-exports from:
- **Types**: `Variant`, `ExecutionContext`, `ReadonlyPipelineState`, `EvolutionRunStatus`, `Match`, `Critique`, `MetaFeedback`, `EvolutionLLMClient`, `EvolutionLogger`, `CostTracker`, `BudgetExceededError`, `LLMRefusalError`, and schemas
- **Rating**: `createRating`, `updateRating`, `updateDraw`, `isConverged`, `toDisplayElo`, `dbToRating`, `ratingToDb`, `computeEloPerDollar`, constants (`DEFAULT_ELO`, `DEFAULT_UNCERTAINTY`, `DEFAULT_CONVERGENCE_UNCERTAINTY`, `BETA_ELO`)
- **Comparison**: `buildComparisonPrompt`, `parseWinner`, `compareWithBiasMitigation`, `ComparisonCache`
- **Shared utilities**: `isTransientError`, `createVariant`, `validateFormat`, `FORMAT_RULES`, `labelStrategyConfig`, `run2PassReversal`

### `evolution/src/lib/pipeline/index.ts`

V2 pipeline barrel. Re-exports everything from `lib/index.ts` plus V2-specific exports:
- **V2 types**: `V2Match`, `EvolutionConfig`, `EvolutionResult`, `StrategyConfig`
- **Pipeline functions**: `claimAndExecuteRun`, `evolveArticle`, `generateSeedArticle`, `finalizeRun`
- **Infrastructure**: `createCostTracker`, `createEvolutionLLMClient`, `createInvocation`, `updateInvocation`, `createRunLogger`
- **Strategy**: `hashStrategyConfig`, `labelStrategyConfig`, `upsertStrategy`
- **Arena**: `loadArenaEntries`, `syncToArena`, `isArenaEntry`
- **Experiments**: `createExperiment`, `addRunToExperiment`, `computeExperimentMetrics`
- **Errors**: `BudgetExceededWithPartialResults`

### `evolution/src/components/evolution/index.ts`

UI component barrel for the admin dashboard. Exports 20+ components:
- **Primitives** (`primitives/`): `StatusBadge`, `EvolutionBreadcrumb`, `MetricGrid`, `EmptyState`, `NotFoundCard`
- **Tables** (`tables/`): `EntityTable`, `RunsTable`, `TableSkeleton`
- **Sections** (`sections/`): `EntityDetailHeader`, `EntityDetailTabs`, `useTabState`, `InputArticleSection`, `VariantDetailPanel`
- **Visualizations** (`visualizations/`): `LineageGraph`, `TextDiff`, `VariantCard`
- **Dialogs** (`dialogs/`): `FormDialog`, `ConfirmDialog`
- **Context** (`context/`): `AutoRefreshProvider`, `useAutoRefresh`
- **Page shells** (root): `EntityListPage`, `EntityDetailPageClient`, `EvolutionErrorBoundary`

---

## Configuration

### EvolutionConfig Validation

Validated at the entry point of `evolveArticle()` in `evolution/src/lib/pipeline/loop/runIterationLoop.ts`.

| Field | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| `iterationConfigs` | `IterationConfig[]` | 1 -- 20 entries, budgetPercent sum = 100 | Required | Ordered iteration sequence. Each: `{ agentType: 'generate'|'swiss', budgetPercent: 1-100, maxAgents?: 1-100 }`. First must be `generate`. |
| `budgetUsd` | `number` | > 0, ≤ 50 | Required | Total budget cap in USD. Per-iteration amounts: `(budgetPercent / 100) * budgetUsd` |
| `judgeModel` | `string` | Non-empty | Required | Model for pairwise comparison calls |
| `generationModel` | `string` | Non-empty | Required | Model for text generation calls |
| `strategiesPerRound` | `number?` | ≥ 1 | 3 | Tactics applied per iteration |
| `calibrationOpponents` | `number?` | ≥ 1 | 5 | Opponents in triage/calibration comparisons |
| `tournamentTopK` | `number?` | ≥ 1 | 5 | Top-K variants for tournament fine-ranking |

Validation throws plain `Error` with a descriptive message on constraint violation.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVOLUTION_MAX_CONCURRENT_RUNS` | `5` | Maximum runs executing simultaneously; checked before claim |
| `EVOLUTION_STALENESS_THRESHOLD_MINUTES` | `10` | Minutes without heartbeat before watchdog marks a run failed |
| `FORMAT_VALIDATION_MODE` | `reject` | Format validation behavior: `reject` (throw on violation), `warn` (log only), `off` (skip) |
| `OPENAI_API_KEY` | -- | OpenAI API key for GPT models |
| `DEEPSEEK_API_KEY` | -- | DeepSeek API key |
| `ANTHROPIC_API_KEY` | -- | Anthropic API key for Claude models |
| `LOCAL_LLM_BASE_URL` | `http://localhost:11434/v1` | Base URL for local LLM endpoints (Ollama-compatible) |
| `EVOLUTION_LOG_LEVEL` | `info` | Minimum log level for EntityLogger output: `debug`, `info`, `warn`, `error`. Controls pipeline log volume. |
| `EVOLUTION_REUSE_SEED_RATING` | `true` | When `true` (default), runs against a prompt with a persisted seed reuse the seed row's UUID and `mu`/`sigma` rating; post-run rating updates flow back to the seed row via optimistic-concurrency UPDATE. Set to `false` to revert to the legacy behavior (fresh baseline UUID + default rating + new arena INSERT per run). Acts as a runtime kill-switch for the seed-reuse routing without redeploying. Read once at `buildRunContext.resolveContent` per run. |
| `COST_CALIBRATION_ENABLED` | `false` | When `'true'`, consult `evolution_cost_calibration` values for cost estimates; otherwise the hardcoded `EMPIRICAL_OUTPUT_CHARS` / `OUTPUT_TOKEN_ESTIMATES` constants remain authoritative. Sub-minute kill switch if the refresh job ever produces bad data. |
| `COST_CALIBRATION_TTL_MS` | `300000` | In-memory cache TTL for `costCalibrationLoader`. Past TTL, the next reader triggers a promise-coalesced DB refresh. |
| `COST_CALIBRATION_SAMPLE_DAYS` | `14` | Window in days for `refreshCostCalibration.ts` aggregation of historical `evolution_agent_invocations`. |

### EntityLogger

**File:** `evolution/src/lib/pipeline/infra/createEntityLogger.ts`

The `EntityLogger` interface provides structured logging throughout the evolution pipeline. Each log entry is persisted to `evolution_run_logs` with a level, message, phase name, and optional context metadata.

```typescript
interface EntityLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}
```

**Known `phaseName` values** used across the pipeline:

| Phase Name | Source |
|------------|--------|
| `config_validation` | Config validation at run start |
| `initialization` | Pipeline initialization |
| `loop` | Main evolution loop orchestration |
| `generation` | Variant generation phase |
| `ranking` | Calibration and tournament ranking |
| `convergence` | Convergence checks |
| `budget` | Budget events (reserve, spend, overrun, thresholds) |
| `winner_determination` | Final winner selection |
| `evolution_complete` | Run completion |
| `setup` | Strategy and config setup |
| `seed_setup` | Seed article generation |
| `finalize` | Post-loop finalization |
| `arena` | Arena sync |
| `kill_check` | Kill switch / cancellation checks |

**Context conventions:**

| Key | Type | Description |
|-----|------|-------------|
| `iteration` | `number` | Current iteration number (1-based) |
| `phaseName` | `string` | Pipeline phase (see table above) |
| `variantId` | `string` | UUID of a specific variant, when applicable |

Additional custom fields may be included depending on the phase (e.g., `budgetFraction`, `strategyName`, `eloRating`).

### FORMAT_RULES

The `FORMAT_RULES` constant (defined in `evolution/src/lib/shared/formatRules.ts`) is injected into all generation and evolution prompts. It enforces prose-only output:

- Start with a single H1 title (`# Title` syntax)
- Use `##` or `###` headings for sections
- Write complete paragraphs (two or more sentences, separated by blank lines)
- No bullet points, numbered lists, or tables

The `formatValidator` checks output against these rules. Behavior is controlled by `FORMAT_VALIDATION_MODE`.

### LLM Model Pricing

The V2 LLM client (`evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`) uses hard-coded pricing for cost estimation. Cost is calculated as `chars/4` to approximate token count.

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| `gpt-4.1-nano` | $0.10 | $0.40 |
| `gpt-4.1-mini` | $0.40 | $1.60 |
| `gpt-4.1` | $2.00 | $8.00 |
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `deepseek-chat` | $0.27 | $1.10 |
| `claude-sonnet-4-20250514` | $3.00 | $15.00 |
| `claude-haiku-4-5-20251001` | $0.80 | $4.00 |
| Unknown models (fallback) | $15.00 | $60.00 |

The fallback pricing uses the most expensive possible rates as a safety measure. Unknown models log a warning at runtime.

### LLM Client Retry Policy

The V2 LLM client retries transient errors (as classified by `isTransientError`) with exponential backoff:

| Attempt | Backoff |
|---------|---------|
| 1st retry | 1,000 ms |
| 2nd retry | 2,000 ms |
| 3rd retry | 4,000 ms |

Maximum 3 retries. Per-call timeout is 20 seconds. SDK-level retries are disabled (`maxRetries: 0`) so the evolution client's retry loop is the sole retry layer — worst-case 87 seconds per call. Budget is reserved before each attempt and released on failure, so retries do not double-count cost. Non-transient errors (auth failures, content policy, budget exceeded) are thrown immediately without retry.

---

## Key Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Type generation | `npm run db:types` | Regenerate `src/lib/database.types.ts` from staging DB (requires `SUPABASE_ACCESS_TOKEN`) |
| Tactic sync | `npx ts-node evolution/scripts/syncSystemTactics.ts` | Upserts all 24 system-defined tactics into the `evolution_tactics` DB table, ensuring DB rows match the code-defined tactic registry |

## CI Type Generation

The CI pipeline automatically regenerates database types on every PR:

1. **deploy-migrations** — applies new migration files to staging (if any changed)
2. **generate-types** — runs `supabase gen types` against staging, auto-commits if changed
3. **typecheck** — checks out latest commit (including auto-committed types), runs `tsc`

Destructive DDL (`DROP TABLE`, `RENAME COLUMN`, `TRUNCATE`, `DELETE FROM`) is blocked by a CI guardrail. `DROP FUNCTION/VIEW IF EXISTS` is allowlisted (standard RPC replacement).

---

## CLI Scripts

### `evolution/scripts/evolution-runner-v2.ts`

V2 batch runner designed for continuous operation. Polls for pending runs, claims and executes them with configurable parallelism.

| Flag | Description |
|------|-------------|
| `--parallel N` | Number of parallel run slots (concurrent pipeline executions) |
| `--max-runs N` | Exit after completing N runs (0 = unlimited) |
| `--max-concurrent-llm N` | Limit concurrent LLM API calls across all parallel runs |

Uses `claim_evolution_run` RPC for atomic claim. Each claimed run gets its own heartbeat interval.

### `evolution/scripts/evolution-runner.ts`

Multi-database runner that round-robins between staging and production Supabase instances. Designed for environments where both databases share the same run queue schema.

| Flag | Description |
|------|-------------|
| `--dry-run` | Log what would be claimed without executing |

Falls back to a manual claim query if the `claim_evolution_run` RPC is not available.

### `evolution/scripts/run-evolution-local.ts`

Standalone local runner for development and testing. Runs a single evolution pipeline execution without requiring a database-queued run.

| Flag | Description |
|------|-------------|
| `--file <path>` | Input article file path |
| `--prompt <text>` | Source prompt text (alternative to file) |
| `--mock` | Use mock LLM client (no API calls) |
| `--model <name>` | Override generation and judge model |

When `--mock` is not specified and no cloud API keys are set, falls back to `LOCAL_LLM_BASE_URL`.

---

## Claiming Mechanism

Run claiming is handled by the `claim_evolution_run` Postgres RPC (see [Data Model](data_model.md) for full schema).

**Claim flow** (`claimAndExecuteRun.ts` and batch scripts):

1. Check concurrent run count: query `evolution_runs` where status is `claimed` or `running`. If count >= `EVOLUTION_MAX_CONCURRENT_RUNS`, skip.
2. Call `claim_evolution_run(p_runner_id, p_run_id?)` RPC.
3. The RPC uses `FOR UPDATE SKIP LOCKED` to atomically select and lock the oldest eligible run.

**Ordering**: FIFO by `created_at`, with `continuation_pending` status runs prioritized over `pending` runs. This ensures interrupted runs that need continuation are picked up first.

**Concurrency safety**: `FOR UPDATE SKIP LOCKED` means multiple runners calling `claim_evolution_run` simultaneously will never claim the same run. A runner that finds all pending rows already locked by other transactions receives an empty result and backs off.

**Signature**: `claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)` -- when `p_run_id` is provided, only that specific run is claimed (used for targeted retries from the admin UI).

**Post-claim state**: The claimed run's status is atomically updated to `claimed`, `runner_id` is set to the claiming runner's ID, and `last_heartbeat` is set to `now()`. The runner then transitions the status to `running` once pipeline execution begins.

**Failure modes**: If the RPC returns an error, the runner logs it and returns `{claimed: false}`. If the concurrent count check fails, the runner also returns without claiming. Both the `claimAndExecuteRun.ts` function and the batch scripts in `evolution/scripts/` implement this same flow.

---

## Heartbeat and Stale Detection

### Heartbeat

Once a run is claimed, the runner starts a **30-second heartbeat interval** that updates `last_heartbeat` on the run row. This proves the runner process is alive. The heartbeat is cleared when the run completes (success or failure) or when the runner process shuts down cleanly.

Implementation: `claimAndExecuteRun.ts` uses `setInterval` with a 30-second period. The interval is stored and cleared in a `try/finally` block.

### Watchdog

The watchdog (`evolution/src/lib/ops/watchdog.ts`) scans for runs in `claimed` or `running` status whose `last_heartbeat` is older than the staleness threshold (default: 10 minutes, configurable via `EVOLUTION_STALENESS_THRESHOLD_MINUTES`).

Stale runs are marked `failed` with an error message indicating abandonment (likely runner crash). The `runner_id` is cleared to allow re-claim.

> **Warning:** The watchdog exists as a standalone function at `evolution/src/lib/ops/watchdog.ts` but is NOT wired into the batch runner. It must be called separately -- either via a cron job, admin action, or manual invocation. Without an active watchdog, crashed runs remain in `claimed`/`running` status indefinitely.

---

## Error Classes

| Class | Module | Extends | Description |
|-------|--------|---------|-------------|
| `BudgetExceededError` | `evolution/src/lib/types.ts` | `Error` | Per-run budget cap exceeded. Carries `agentName`, `spent`, `reserved`, `cap` fields. Stops entire run. |
| `IterationBudgetExceededError` | `evolution/src/lib/pipeline/infra/trackBudget.ts` | `BudgetExceededError` | Per-iteration budget exhausted. Carries `iterationIndex`. Stops only the current iteration; loop advances to next `iterationConfig`. |
| `BudgetExceededWithPartialResults` | `evolution/src/lib/pipeline/errors.ts` | `BudgetExceededError` | Budget exceeded mid-generation with some variants already produced. Carries `partialVariants: Variant[]`. |
| `GlobalBudgetExceededError` | `src/lib/errors/serviceError.ts` | `ServiceError` | System-wide monthly/daily LLM cost cap exceeded. Carries structured details (category, daily totals, caps). |
| `LLMKillSwitchError` | `src/lib/errors/serviceError.ts` | `ServiceError` | Kill switch enabled in `llm_cost_config`. Blocks all LLM calls immediately. No constructor parameters. |
| `LLMRefusalError` | `evolution/src/lib/types.ts` | `Error` | LLM refused to generate content (safety filter, content policy). |

**Error handling priority in runners:**
1. Catch `LLMKillSwitchError` -- abort immediately, do not retry
2. Catch `GlobalBudgetExceededError` -- log cap details, mark run `failed`
3. Catch `BudgetExceededWithPartialResults` -- salvage partial variants, finalize with what was produced
4. Catch `BudgetExceededError` -- mark run `failed` with budget details
5. Transient errors (classified by `isTransientError`) -- retry with backoff

---

## RLS Policies

All evolution tables use Row-Level Security with a **deny-all default**:

```sql
CREATE POLICY deny_all ON <table> FOR ALL USING (false) WITH CHECK (false);
```

Two override policies provide access:

| Policy | Migration | Role | Access | Purpose |
|--------|-----------|------|--------|---------|
| `service_role_all` | `20260321000001` | `service_role` | Full CRUD | Batch runner, server actions, E2E test seeds |
| `readonly_select` | `20260318000001` | `readonly_local` | SELECT only | `npm run query:prod` / `query:staging` debugging; skips gracefully when role does not exist |

### Recent Schema Migrations

| Migration | Description |
|-----------|-------------|
| `20260321000002` | Consolidated `evolution_arena_entries` into `evolution_variants` (added `synced_to_arena` flag) |
| `20260322000001` | Fresh schema documentation migration (staging) |
| `20260322000002` | Prod convergence migration |

The `anon` and `authenticated` roles are blocked entirely. All evolution data access goes through `service_role` (server-side Supabase client). Empty query results in the browser are likely caused by the deny-all policy.

See [Data Model - RLS Policies](data_model.md#rls-policies) for migration details.

---

## Admin UI Pages

The admin UI is a Next.js App Router application. All pages are under `src/app/admin/`.

| Route | Page File | Purpose |
|-------|-----------|---------|
| `/admin/evolution-dashboard` | `evolution-dashboard/page.tsx` | Aggregate metrics dashboard; auto-refresh every 15 seconds |
| `/admin/evolution/runs` | `evolution/runs/page.tsx` | Runs list with status filtering (pending, running, completed, failed) |
| `/admin/evolution/runs/[runId]` | `evolution/runs/[runId]/page.tsx` | Run detail with tabs: Overview, Elo, Lineage, Variants, Logs |
| `/admin/evolution/experiments` | `evolution/experiments/page.tsx` | Experiment list |
| `/admin/evolution/experiments/[experimentId]` | `evolution/experiments/[experimentId]/page.tsx` | Experiment detail with tabs: Overview, Analysis, Runs |
| `/admin/evolution/start-experiment` | `evolution/start-experiment/page.tsx` | 3-step experiment creation wizard |
| `/admin/evolution/arena` | `evolution/arena/page.tsx` | Arena topics list |
| `/admin/evolution/arena/[topicId]` | `evolution/arena/[topicId]/page.tsx` | Arena leaderboard for a topic |
| `/admin/evolution/arena/entries/[entryId]` | `evolution/arena/entries/[entryId]/page.tsx` | Arena entry detail (backed by `evolution_variants` with `synced_to_arena=true`) |
| `/admin/evolution/variants` | `evolution/variants/page.tsx` | Paginated variant list |
| `/admin/evolution/variants/[variantId]` | `evolution/variants/[variantId]/page.tsx` | Variant detail (text, lineage, match history) |
| `/admin/evolution/prompts` | `evolution/prompts/page.tsx` | Prompt registry CRUD |
| `/admin/evolution/prompts/[promptId]` | `evolution/prompts/[promptId]/page.tsx` | Prompt detail |
| `/admin/evolution/strategies` | `evolution/strategies/page.tsx` | Strategy registry CRUD |
| `/admin/evolution/strategies/new` | `evolution/strategies/new/page.tsx` | 2-step strategy creation wizard with iteration builder |
| `/admin/evolution/strategies/[strategyId]` | `evolution/strategies/[strategyId]/page.tsx` | Strategy detail |
| `/admin/evolution/tactics` | `evolution/tactics/page.tsx` | Tactic registry list (all 24 tactics with per-tactic performance stats) |
| `/admin/evolution/tactics/[tacticId]` | `evolution/tactics/[tacticId]/page.tsx` | Tactic detail with prompt-level performance breakdown via `TacticPromptPerformanceTable` |
| `/admin/evolution/invocations` | `evolution/invocations/page.tsx` | LLM invocation list (cost auditing) |
| `/admin/evolution/invocations/[invocationId]` | `evolution/invocations/[invocationId]/page.tsx` | Invocation detail (prompt, response, tokens, cost, execution detail via `ConfigDrivenDetailRenderer`) |

### API Routes

| Route | Method | File | Purpose |
|-------|--------|------|---------|
| `/api/evolution/run` | POST | `src/app/api/evolution/run/route.ts` | Trigger evolution pipeline run. Admin-only. Accepts `{ targetRunId?: string }`, returns `RunnerResult`. `maxDuration=300`. |

Additional files:

| Route | Page File | Purpose |
|-------|-----------|---------|
| (layout) | `evolution/layout.tsx` | Shared evolution layout with sidebar navigation wrapping all `/admin/evolution/*` routes |
| (not-found) | `evolution/not-found.tsx` | Custom 404 page for unmatched evolution routes |
| (loading) | `evolution/*/loading.tsx` | Per-route loading skeletons reusing `TableSkeleton` |

Total: 19 pages (17 list/detail pairs + dashboard + experiment wizard + strategy wizard) + 1 API route.

**`ConfigDrivenDetailRenderer`** (`src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx`) — renders the agent-specific execution detail section on the invocation detail page. Reads field definitions from `DETAIL_VIEW_CONFIGS` (keyed by agent name) and renders each field generically, eliminating the need for a custom component per agent type.

All pages use the shared UI components from `evolution/src/components/evolution/index.ts`. Common patterns include `EntityListPage` for list views with filtering (supports both controlled and self-managed modes with `loadData`), `EntityDetailTabs` for detail views with tabbed navigation, and `AutoRefreshProvider` for real-time polling. The dashboard uses a 15-second auto-refresh interval; other pages refresh on user navigation.

Navigation uses `EvolutionBreadcrumb` for consistent breadcrumb trails. Status is shown via `EvolutionStatusBadge` which color-codes run states (pending=gray, running=blue, completed=green, failed=red).

---

## Testing Infrastructure

### Test File Counts

| Layer | Test Files | Location |
|-------|-----------|----------|
| Pipeline | 18 | `evolution/src/lib/pipeline/*.test.ts` |
| Shared | 10 | `evolution/src/lib/shared/*.test.ts` |
| Services | 10 | `evolution/src/services/*.test.ts` |
| Ops | 2 | `evolution/src/lib/ops/*.test.ts` |

### E2E Tests

Playwright specs in `src/__tests__/e2e/specs/09-admin/`:

| Spec | Coverage |
|------|----------|
| `admin-evolution-v2.spec.ts` | Dashboard, runs list, run detail, experiment pages |
| `admin-arena.spec.ts` | Arena topics, leaderboards, entry detail, seed panel (2026-04-21) + variant-ID column |
| `admin-evolution-run-pipeline.spec.ts` | Full pipeline lifecycle: seed → run → metrics → arena sync → UI rendering (11 tests, real LLM calls) |
| `admin-evolution-experiment-wizard-e2e.spec.ts` | Wizard creation with seeded data: form fill → submit → list → detail (4 tests) |

### Integration Tests (real DB)

| Spec | Coverage |
|------|----------|
| `src/__tests__/integration/evolution-pool-source-same-run.integration.test.ts` | Bug 2 regression (2026-04-21): verifies that pool-mode iterations draw parents only from same-run variants, with arena entries excluded at the `resolveParent` call site. Uses `loadArenaEntries` against a real DB + `resolveParent` with a pre-filtered pool. |

### Key Mock Patterns

Defined in `evolution/src/testing/`. These mocks are used across pipeline, shared, and service test files.

| Mock | File | Purpose |
|------|------|---------|
| `createV2MockLlm` | `v2MockLlm.ts` | Fake LLM client implementing `EvolutionLLMClient` interface. Returns deterministic responses by default; supports per-call overrides via a response queue. Tracks all calls for assertion (prompt, model, label). Used by pipeline tests (`generate.test.ts`, `evolve.test.ts`, `rank.test.ts`, `compose.test.ts`). |
| `createSupabaseChainMock` | `service-test-mocks.ts` | Chainable mock that simulates the Supabase query builder pattern (`.from().select().eq().order().limit()`). Returns configurable data/error payloads. Tracks the chain of method calls for assertion. |
| `createTableAwareMock` | `service-test-mocks.ts` | Extended Supabase mock that routes `.from(tableName)` calls to per-table fixture data. Supports multiple tables in a single test. Used by service action tests that query multiple tables in sequence. |

### Test Helpers

Defined in `evolution/src/testing/evolution-test-helpers.ts`. Factory functions for constructing valid test data without boilerplate.

| Helper | Purpose |
|--------|---------|
| `createTestStrategyConfig` | Builds a valid `StrategyConfig` with sensible defaults (gpt-4.1-mini, 3 iterations, $1 budget). Accepts partial overrides. |
| `createTestPrompt` | Builds a test prompt metadata object with auto-generated ID and placeholder text. |
| `createTestEvolutionRun` | Builds a complete evolution run DB row with all required fields (id, status, strategy_id, budget, timestamps). Accepts partial overrides for testing specific states. |
| `createTestVariant` | Builds a `Variant` with auto-generated UUID, placeholder content, empty parentIds, and generation 0. Accepts content and parentIds overrides. |

### Running Tests

```bash
# Unit tests (pipeline + shared + services)
cd evolution && npx vitest run

# Single file
cd evolution && npx vitest run src/lib/pipeline/rank.test.ts

# E2E (starts servers automatically)
npm run test:e2e -- --grep "evolution"
```

---

## Testing Conventions

### `[TEST]` Prefix

Test data factories in `evolution-test-helpers.ts` prefix names and titles with `[TEST]` (e.g., `[TEST] strategy_...`, `[TEST] Prompt ...`). This allows the admin UI to hide test rows by default using a server-side `NOT ILIKE '%[TEST]%'` filter. All evolution list pages (Prompts, Strategies, Experiments, Arena Topics) include a "Hide test content" checkbox, checked by default.

### Property-Based Tests (fast-check)

Property-based tests using `fast-check@^3` validate invariants of pure functions against randomly generated inputs. These tests use `jest.unmock('openskill')` to test against the real rating library (Jest config mocks openskill by default).

| Test File | Invariants Tested |
|-----------|-------------------|
| `computeRatings.property.test.ts` | Sigma decrease, finite outputs, draw symmetry, Elo monotonicity, aggregation shape |
| `trackBudget.property.test.ts` | Budget invariant, reserve margin, phase accumulation, release restoration |
| `enforceVariantFormat.property.test.ts` | stripCodeBlocks idempotency, validateFormat edge cases, extractParagraphs invariants |

### CleanupOptions

`cleanupEvolutionData(supabase, options)` accepts a `CleanupOptions` object with optional arrays: `explanationIds`, `runIds`, `strategyIds`, `promptIds`. It deletes in FK-safe order (invocations, variants, runs, strategies, prompts) and silently ignores errors so test cleanup never throws.

---

## ESLint Rules

| Rule | Purpose |
|------|---------|
| `no-duplicate-column-labels` | Prevents duplicate column label strings in entity table definitions. Catches copy-paste errors where two columns share the same header text. |

---

## Cross-References

| Topic | Document |
|-------|----------|
| System architecture and data flow | [Architecture](architecture.md) |
| Database schema, RPCs, migrations | [Data Model](data_model.md) |
| Elo rating (with uncertainty) and comparison system | [Rating and Comparison](rating_and_comparison.md) |
| Cost tracking and budget enforcement | [Cost Optimization](cost_optimization.md) |
| Strategies, experiments, and A/B testing | [Strategies & Experiments](strategies_and_experiments.md) |
| Arena cross-run competition | [Arena](arena.md) |
| Agent roles and pipeline phases | [Agents Overview](agents/overview.md) |
| Curriculum and prompt design | [Curriculum](curriculum.md) |
| Visualization and charts | [Visualization](visualization.md) |
| Minicomputer deployment | [Minicomputer Deployment](minicomputer_deployment.md) |
| Metrics system | [Metrics](metrics.md) |
