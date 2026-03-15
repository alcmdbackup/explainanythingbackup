# Evolution Reference

Single source of truth for cross-cutting concerns shared across all evolution docs: configuration, feature flags, budget caps, database schema, key files, CLI commands, deployment, observability, and testing.

## Configuration

Default configuration (`DEFAULT_EVOLUTION_CONFIG` in `config.ts`):

```typescript
{
  maxIterations: 50,
  budgetCapUsd: 5.00,              // Hard-capped to MAX_RUN_BUDGET_USD ($1.00) at runtime
  expansion: {
    minPool: 15,         // Minimum pool size to consider COMPETITION transition
    diversityThreshold: 0.25, // Diversity needed for COMPETITION transition
    maxIterations: 8,    // Safety cap — unconditionally transitions at this iteration
  },
  generation: { strategies: 3 },
  tournament: { topK: 5 },       // Top K variants always eligible for tournament pairing
  calibration: {
    opponents: 5,        // Used in COMPETITION; EXPANSION overrides to 3
    minOpponents: 2,     // Adaptive early exit: skip remaining after N consecutive decisive matches
  },
  // budgetCaps: DEPRECATED — per-agent budget caps are no longer in DEFAULT_EVOLUTION_CONFIG.
  // Per-agent tracking still exists in CostTracker for analytics/ROI metrics, but is NOT enforced at runtime.
  // Budget enforcement is global-only: totalSpent + totalReserved + estimate <= budgetCapUsd.
  judgeModel: 'gpt-4.1-nano',    // Cheap model for A/B comparison judgments
  generationModel: 'gpt-4.1-mini', // Model for text generation tasks
}
```

**Hard budget caps** (in `config.ts`):
- `MAX_RUN_BUDGET_USD = $1.00` — absolute per-run hard cap (overrides `budgetCapUsd` if higher)
- `MAX_EXPERIMENT_BUDGET_USD = $10.00` — absolute per-experiment hard cap

Per-run overrides stored in `evolution_runs.config` (JSONB). Merged via `resolveConfig()` with deep spread for nested objects. When a run is queued with a linked strategy, `queueEvolutionRunAction` copies the following fields from the strategy config into the run's config JSONB as a snapshot: `iterations` → `maxIterations`, `generationModel`, `judgeModel`, `budgetCaps`, `budgetCapUsd`. This ensures the run executes with the config it was queued with, even if the strategy is later edited.

### Auto-Clamping for Short Runs

`resolveConfig()` auto-clamps `expansion.maxIterations` when `maxIterations` is too small for the default expansion window. This prevents `validateRunConfig()` from throwing when strategies specify low iteration counts (e.g., `maxIterations: 3`).

Formula: if `maxIterations <= expansion.maxIterations + 1`, clamp to `max(0, maxIterations - 1)`. A `console.warn` is emitted when clamping occurs.

Examples with defaults (`expansion.maxIterations=8`):
- `maxIterations: 3` → expansion clamped to 2
- `maxIterations: 8` → expansion clamped to 7
- `maxIterations: 10` → no clamping (10 > 8 + 1 = 9)

**Note:** `maxIterations=N` means the pipeline executes exactly N agent iterations. The for-loop runs `i < maxIterations` iterations, and the `shouldStop()` safety check fires when `state.iteration > maxIterations` (not `>=`).

### Continuation-Passing

These are `FullPipelineOptions` fields (passed to `executeFullPipeline`), not part of `EvolutionRunConfig`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDurationMs` | `number?` | `undefined` | Wall-clock budget per invocation (ms). Pipeline yields when approaching this limit. |
| `continuationCount` | `number?` | `0` | Number of prior continuations. Guards against infinite loops (max 10). |
| `supervisorResume` | `SupervisorResumeState?` | `undefined` | Restored supervisor state (phase, mu/diversity history) for checkpoint resume. |

See [Architecture — Pipeline Continuation](./architecture.md#pipeline-continuation--vercel-timeouts) for the full continuation flow.

### Tiered Model Routing

The pipeline routes LLM calls to different models based on task complexity. Trivial A/B comparison judgments (`judgeModel`, default: `gpt-4.1-nano`) use a model 4x cheaper than text generation (`generationModel`, default: `gpt-4.1-mini`). The underlying `llmClient.ts` default model is `deepseek-chat` — agents override this via `judgeModel`/`generationModel` config fields passed as `LLMCompletionOptions`.

### Task-Type Cost Estimation

`LLMCompletionOptions.taskType` controls how `estimateTokenCost()` estimates output tokens for budget reservation:

| `taskType` | Output estimate | Use case |
|------------|-----------------|----------|
| `'comparison'` | Fixed 150 tokens | A/B judgments that produce short verdicts (~10-150 tokens) |
| `'generation'` or `undefined` | Empirical ratio from baselines, or 50% of input tokens (fallback) | Text generation, critique, and other open-ended output |

**Empirical output ratios:** At pipeline start, `preloadOutputRatios()` fetches historical completion/prompt token ratios from `evolution_agent_cost_baselines` and caches them in memory. When `agentName` is provided (automatically by `budgetedCallLLM`), `estimateTokenCost()` uses the empirical ratio instead of the 0.5 heuristic. This prevents budget underestimation for models like gpt-5.2 that produce 5-7x more output than input.

Without taskType discrimination, comparison calls with expensive models (e.g., `claude-sonnet-4` at $15/1M output) would reserve ~250x more budget than needed, causing false "Budget exceeded" errors. All comparison callers (PairwiseRanker, CalibrationRanker, BeamSearch comparison closures, IterativeEditingAgent diff judge, SectionEditRunner judge) pass `taskType: 'comparison'`.

### Pre-Run Cost Estimation

`estimateRunCostWithAgentModels()` in `costEstimator.ts` estimates per-agent costs before a run starts. It supports:
- **`enabledAgents` filtering**: When `enabledAgents` is provided, only required agents (`generation`, `calibration`, `tournament`, `proximity`) and explicitly enabled optional agents are estimated. When undefined, all agents are estimated (backward compat).
- **`singleArticle` mode**: Agents in `SINGLE_ARTICLE_DISABLED` (`generation`, `outlineGeneration`, `evolution`) are skipped.
- **11 agent estimates**: `generation` (3 calls/iter), `evolution` (3 calls/comp-iter), `reflection` (3), `debate` (4), `iterativeEditing` (6), `calibration` (18 exp + 30 comp), `tournament` (50), `treeSearch` (~33 gen + ~33 judge), `outlineGeneration` (3 gen + 3 judge), `sectionDecomposition` (~10 gen + ~10 judge), `flowCritique` (~15 judge). `proximity` and `metaReview` make zero LLM calls.

### Agent Name Routing for Tournament Comparisons

Tournament calls PairwiseRanker methods for all LLM comparisons. To attribute costs to the correct budget cap, PairwiseRanker's comparison methods accept an optional `agentNameOverride` parameter. Tournament passes `this.name` (`'tournament'`) so costs route to the tournament budget cap rather than PairwiseRanker's own `'pairwise'` cap. `'pairwise'` is intentionally excluded from `MANAGED_AGENTS` in `budgetRedistribution.ts` because all its LLM calls are made on behalf of other agents.

## Agent Enablement

All optional agents are now controlled via `enabledAgents` in the strategy config (DB-stored per-strategy). No env vars are needed. The `getActiveAgents()` function in `supervisor.ts` computes the ordered list of agents to run each iteration based on phase, `enabledAgents`, and `singleArticle` mode.

Additionally, the quality eval cron (`src/app/api/cron/content-quality-eval/route.ts`) checks a separate `evolution_pipeline_enabled` flag directly from the `feature_flags` table to gate auto-queuing of low-scoring articles. (Note: cron routes remain in the main `src/` tree.) This flag is independent of the pipeline agent gating.

## Budget Caps (Deprecated)

> **Deprecated:** Per-agent budget caps (`budgetCaps` in `EvolutionRunConfig`) are marked `@deprecated` in `types.ts` and are no longer included in `DEFAULT_EVOLUTION_CONFIG`. Per-agent tracking still exists in `CostTracker.spentByAgent` for analytics/ROI metrics, but is **not enforced** at runtime. Budget enforcement is global-only.

### Budget Enforcement

The `CostTracker` (`core/costTracker.ts`) enforces budget at one level:
- **Global cap**: `budgetCapUsd` (default $5.00, hard-capped to MAX_RUN_BUDGET_USD = $1.00)
- **Pre-call reservation with FIFO queue**: Budget is checked *before* every LLM call with a 30% safety margin. Reservations are tracked in a FIFO queue (`reservationQueue`) so concurrent parallel calls cannot all pass budget checks. When `recordSpend(agentName, cost, invocationId?)` is called after an LLM response, the oldest reservation is dequeued and replaced with actual spend. When an `invocationId` is provided, cost is also accumulated in a per-invocation map (`getInvocationCost(invocationId)`), enabling incremental cost attribution per agent invocation. `getAvailableBudget()` subtracts both spent and reserved amounts.
- **Checkpoint restore**: When resuming from continuation, `CostTracker.restoreSpent(amount)` sets the `totalSpent` baseline from the checkpoint without touching per-agent tracking or reservations. The factory `createCostTrackerFromCheckpoint(config, restoredTotalSpent)` creates a pre-loaded tracker. This ensures budget enforcement is accurate across continuation boundaries.
- **Pause, not fail**: `BudgetExceededError` pauses the run (status='paused') rather than marking it failed. An admin can increase the budget and resume from the last checkpoint. `BudgetExceededError` is re-thrown through `Promise.allSettled` rejection handling in all agents to ensure propagation to the pipeline orchestrator.

## Format Enforcement

All generated variants must pass `validateFormat()` (`agents/formatValidator.ts`):
- Exactly one H1 title on the first line
- At least one section heading (## or ###)
- No bullet points, numbered lists, or tables (outside code fences)
- At least 75% of paragraphs must have 2+ sentences

Controlled by `FORMAT_VALIDATION_MODE` env var:
- `"reject"` (default): Variants failing validation are discarded
- `"warn"`: Validation issues logged but variant accepted — useful during development
- `"off"`: No validation — testing only

## Edge Cases & Guards

### Minimum Pool Size
- **CalibrationRanker**: Requires `pool.length >= 2` (`canExecute` guard). Skipped on first iteration if GenerationAgent produced < 2 variants.
- **Tournament**: Requires `pool.length >= 2`.
- **EvolutionAgent**: Requires `pool.length >= 1` and `ratings.size >= 1`. Crossover requires 2 parents — falls back to mutation if only 1 parent available.
- **DebateAgent**: Requires 2+ non-baseline variants with ratings. Baselines (`original_baseline` strategy) are excluded from both `canExecute` and parent selection.
- **ProximityAgent**: Requires `pool.length >= 2`.

### Format Validation Failures
If ALL generated variants fail format validation in an iteration, the pool doesn't grow. The pipeline continues but may accumulate empty iterations until budget or max iterations is reached.

### Transient Error Handling
When an agent throws a transient error (socket timeout, ECONNRESET, 429, 5xx, OpenAI SDK `APIConnectionError`/`RateLimitError`/`InternalServerError`), the pipeline retries the agent once with exponential backoff (`1s × 2^attempt`). No state rollback on retry — partial pool mutations are safe due to `addToPool` dedup via `poolIds.has()` and uuid4 variant IDs. Classification logic lives in `core/errorClassification.ts:isTransientError()`.

Agents with **internal** protection (IterativeEditingAgent, CalibrationRanker) catch transient errors within their loops, treating them as soft rejections. The pipeline retry acts as a second defense layer for errors that escape agent-level handling.

Retry amplification: OpenAI SDK retries 3× internally (`maxRetries: 3` in `llms.ts`), then the pipeline retries the entire agent once — up to 8 total LLM attempts for a persistent transient error.

### Run Failure Marking (Defense-in-Depth)

Failed runs are marked at two layers to prevent zombie runs (stuck in 'running' forever):

1. **Pipeline layer** (`pipeline.ts:markRunFailed`): Called in the `executeFullPipeline` outer catch. Accepts `agentName: string | null` — when null, formats as "Pipeline error: ...". Sets `status='failed'`, `error_message` (truncated to 500 chars), and `completed_at`. Uses `.in('status', ['pending', 'claimed', 'running'])` guard to only transition non-terminal states (idempotent if both layers fire).

2. **Route layer** (`route.ts` response handler): Maps `claimAndExecuteEvolutionRun` result errors to 500 responses with `{ claimed, error }` payload.

### Budget Edge Cases
- Budget of $0: Stops immediately at the first `shouldStop()` check (available < $0.01).
- Budget exhausted mid-agent: `BudgetExceededError` thrown before the LLM call. Partial state checkpointed. Run paused.

### Short Articles
No minimum article length enforced. GenerationAgent checks `state.originalText.length > 0` but will attempt generation on very short text. Short articles produce short variants that may fail format validation (< 2 sentences per paragraph).

## Run Summary

At the end of `executeFullPipeline`, the pipeline builds an `EvolutionRunSummary` via `buildRunSummary()` and validates it with a Zod strict schema (`EvolutionRunSummarySchema`). The summary is persisted to `evolution_runs.run_summary` (JSONB) and exposed via `getEvolutionRunSummaryAction(runId)`.

Fields:
- `version`: Schema version (currently `3`)
- `stopReason`: Why the pipeline stopped (`'quality_threshold'`, `'budget_exhausted'`, `'max_iterations'`, `'completed'`, `'killed'`)
- `finalPhase`: `'EXPANSION'` or `'COMPETITION'`
- `totalIterations`, `durationSeconds`
- `muHistory`: Flat `number[]` — top variant's mu after each iteration
- `diversityHistory`: Flat `number[]` — raw diversity score per iteration (supervisor pushes one score per iteration)
- `matchStats`: `{totalMatches, avgConfidence, decisiveRate}`
- `topVariants`: Top 5 variants by mu with `{id, mu, strategy, isBaseline}`
- `baselineRank`, `baselineMu`: Where the original text ended up
- `avgMu`: Average mu across all variants
- `strategyEffectiveness`: Record of strategy → `{count, avgMu}` for above-average strategies
- `metaFeedback`: Final `MetaFeedback` from the last MetaReviewAgent run

## Database Schema

| Table | Purpose |
|-------|---------|
| `evolution_runs` | Run lifecycle: status (pending/claimed/running/completed/failed/paused/continuation_pending), phase, budget, iterations, heartbeat, timing, runner_id. `explanation_id` is nullable (allows CLI runs without an explanation, migration `20260131000008`). `source` column distinguishes origin: `'explanation'` for production runs, `'local:<filename>'` for CLI runs. `run_summary` JSONB column stores `EvolutionRunSummary` with GIN index (migration `20260131000010`). `continuation_count` INT NOT NULL DEFAULT 0: number of times this run has been resumed from checkpoint |
| `evolution_variants` | Persisted variants with elo_score (mapped from mu via `toEloScale`), generation, parent lineage, is_winner flag, `elo_attribution` JSONB (creator-based attribution). `explanation_id` is nullable (migration `20260131000009`) |
| `evolution_checkpoints` | Full state snapshots (JSONB) keyed by run_id + iteration + last_agent. Pruned after completion to keep one checkpoint per iteration for completed/failed runs (~13x storage reduction) |
| `feature_flags` | Evolution pipeline enabled flag (checked by quality eval cron). Agent-level flags moved to env vars |
| `evolution_arena_topics` | Prompt bank topics with unique case-insensitive prompt matching (migration `20260201000001`) |
| `evolution_arena_entries` | Generated articles: content, generation_method (oneshot/evolution_winner/evolution_baseline), model, cost, optional evolution_run_id/variant_id |
| `evolution_arena_comparisons` | Pairwise comparison records: entry_a, entry_b, winner, confidence, judge_model, dimension_scores |
| `evolution_arena_elo` | Per-entry OpenSkill ratings within a topic: mu, sigma, elo_rating (derived via `toEloScale`), elo_per_dollar, match_count |
| `evolution_run_logs` | Per-run structured log entries with cross-linking columns: `run_id`, `level`, `agent_name`, `iteration`, `variant_id`, `message`, `context` (JSONB). Indexed by run_id+created_at, iteration, agent_name, and level (migration `20260208000003`) |
| `evolution_agent_invocations` | Per-agent-per-iteration execution records with structured `execution_detail` (JSONB) and `agent_attribution` JSONB (creator-based agent-level attribution). Columns: `id`, `run_id` (FK), `iteration`, `agent_name`, `execution_order`, `success`, `cost_usd` (incremental per-invocation, not cumulative), `skipped`, `execution_detail`, `agent_attribution`. Unique on `(run_id, iteration, agent_name)`. GIN index on `execution_detail`. `execution_detail._diffMetrics` stores per-agent diff metrics (variants added, matches played, Elo changes, etc.) used by the Timeline tab. Used by Timeline and Explorer drill-down views (migration `20260212000001`). Two-phase lifecycle: `createAgentInvocation()` inserts a row before agent execution (returns UUID), `updateAgentInvocation()` writes final cost/status/detail after completion. The invocation UUID is used as FK by `llmCallTracking.evolution_invocation_id` to link individual LLM calls to their parent agent invocation |

## Key Files

### Core Infrastructure (`evolution/src/lib/core/`)
| File | Purpose |
|------|---------|
| `pipeline.ts` | Pipeline orchestrator — `executeMinimalPipeline` (testing) and `executeFullPipeline` (production). Also contains `finalizePipelineRun()` (includes checkpoint pruning) and `pruneCheckpoints()`. Persistence, metrics, and utilities extracted to dedicated modules |
| `supervisor.ts` | `PoolSupervisor` — EXPANSION→COMPETITION transitions, phase config, stopping conditions |
| `state.ts` | `PipelineStateImpl` — mutable state with append-only pool, serialization/deserialization for checkpoints |
| `rating.ts` | OpenSkill (Weng-Lin Bayesian) rating wrapper: `createRating`, `updateRating`, `updateDraw`, `isConverged`, `eloToRating`, `toEloScale` |
| `jsonParser.ts` | Shared `extractJSON<T>()` utility for parsing JSON from LLM responses (used by reflectionAgent, debateAgent, iterativeEditingAgent, beamSearch) |
| `costTracker.ts` | `CostTrackerImpl` — per-agent budget attribution, pre-call reservation with optimistic locking and 30% margin, per-invocation cost accumulation via `getInvocationCost(invocationId)`, `releaseReservation(agentName)` for cleanup on LLM failure, `setEventLogger(logger)` for audit trail |
| `comparisonCache.ts` | `ComparisonCache` — order-invariant SHA-256 cache for bias-mitigated comparison results |
| `pool.ts` | `PoolManager` — stratified opponent selection (mu quartile-based) and pool health statistics |
| `diversityTracker.ts` | `PoolDiversityTracker` — lineage dominance detection, strategy diversity analysis, trend computation |
| `validation.ts` | State contract guards: `validateStateContracts` checks phase prerequisites (ratings populated, matches exist, etc.) |
| `llmClient.ts` | `createEvolutionLLMClient` — wraps `callLLM` with budget enforcement and structured JSON output parsing. `createScopedLLMClient` — wraps a base client with a fixed `invocationId` injected into every LLM call for per-invocation cost attribution |
| `logger.ts` | `createEvolutionLogger` (console-only) and `createDbEvolutionLogger` (console + DB buffer). `LogBuffer` batches writes to `evolution_run_logs` with auto-flush at 20 entries. Extracts `agent_name`, `iteration`, `variant_id` from freeform context |
| `budgetRedistribution.ts` | Agent classification (`REQUIRED_AGENTS`, `OPTIONAL_AGENTS`), `enabledAgents` validation |
| `arenaIntegration.ts` | Extracted from pipeline.ts: Arena topic/entry linking and variant feeding |
| `metricsWriter.ts` | Extracted from pipeline.ts: strategy config linking, cost prediction, per-agent cost metrics |
| `persistence.ts` | Extracted from pipeline.ts: checkpoint upsert, variant persistence, run status transitions, `computeAndPersistAttribution()` |
| `eloAttribution.ts` | Creator-based Elo attribution: `computeEloAttribution`, `aggregateByAgent`, `buildParentRatingResolver` |
| `pipelineUtilities.ts` | Extracted from pipeline.ts: two-phase agent invocation persistence (`createAgentInvocation`/`updateAgentInvocation`), execution detail truncation, and diff metrics computation |
| `textVariationFactory.ts` | Shared `createTextVariation()` factory eliminating duplication across 6 agents |
| `critiqueBatch.ts` | Shared utility for running LLM critique call batches (ReflectionAgent, IterativeEditingAgent, FlowCritique) |
| `reversalComparison.ts` | Generic 2-pass reversal runner shared by comparison.ts and diffComparison.ts |
| `formatValidationRules.ts` | Shared format validation rules used by both formatValidator and sectionFormatValidator |
| `agentToggle.ts` | Pure toggle utility for UI agent checkbox state |
| `configValidation.ts` | Config validation (`validateStrategyConfig`, `validateRunConfig`, `isTestEntry`) |
| `costEstimator.ts` | Data-driven pre-run cost predictions with per-agent estimates |
| `errorClassification.ts` | `isTransientError()` — classifies transient vs permanent LLM errors |
| `seedArticle.ts` | `generateSeedArticle()` for prompt-based runs |
| `strategyConfig.ts` | `hashStrategyConfig()`, `labelStrategyConfig()`, `normalizeEnabledAgents()`. `StrategyConfig` interface includes optional `budgetCapUsd?: number` (per-run budget cap, excluded from config hash) |

### Shared Modules (`evolution/src/lib/`)
| File | Purpose |
|------|---------|
| `comparison.ts` | Standalone `compareWithBiasMitigation()` — 2-pass A/B reversal with order-invariant SHA-256 caching, `buildComparisonPrompt()`, `parseWinner()` |
| `config.ts` | `DEFAULT_EVOLUTION_CONFIG`, `RATING_CONSTANTS`, `resolveConfig()` for deep-merging per-run overrides |
| `types.ts` | All shared TypeScript types/interfaces (`TextVariation`, `PipelineState`, `ExecutionContext`, `EvolutionRunSummary`, etc.) |
| `index.ts` | Barrel export — public API re-exporting core, agents, and shared modules. Includes `createDefaultAgents()` (single source of truth for 12-agent construction), `preparePipelineRun()` (context factory consolidating config/state/logger/llmClient/agents), and `prepareResumedPipelineRun()` (checkpoint-resume context: restores state, cost tracker, comparison cache, and supervisor state from checkpoint). Note: `finalizePipelineRun()` lives in `pipeline.ts` and is not re-exported from index.ts |
| `flowRubric.ts` | Flow dimensions, prompt builders, parsers, `normalizeScore()`, `CROSS_SCALE_MARGIN`, cross-scale targeting |

### Utils (`evolution/src/lib/utils/`)
| File | Purpose |
|------|---------|
| `evolutionUrls.ts` | URL builders: `buildRunUrl`, `buildVariantDetailUrl`, `buildInvocationUrl`, `buildArenaTopicUrl`, etc. |
| `formatters.ts` | Shared formatting utilities |
| `frictionSpots.ts` | Friction spot extraction from match history |
| `metaFeedback.ts` | Shared `formatMetaFeedback()` for consuming MetaReviewAgent output |

### Agents (`evolution/src/lib/agents/`)
| File | Purpose |
|------|---------|
| `base.ts` | Abstract `AgentBase` class defining execute/estimateCost/canExecute contract |
| `generationAgent.ts` | Creates 3 variants per iteration using structural_transform, lexical_simplify, grounding_enhance strategies |
| `calibrationRanker.ts` | Pairwise comparison for new entrants against stratified opponents with position-bias mitigation |
| `pairwiseRanker.ts` | Full pairwise comparison with simple (A/B/TIE) and structured (5-dimension scoring) modes |
| `tournament.ts` | Swiss-style tournament — budget-adaptive depth, multi-turn tiebreakers for top-quartile close matches, sigma-based convergence detection |
| `evolvePool.ts` | Genetic evolution — mutation (clarity/structure), crossover (two parents), creative exploration (30% wild card) |
| `reflectionAgent.ts` | Dimensional critique of top 3 variants: per-dimension scores 1-10, good/bad examples, improvement notes |
| `iterativeEditingAgent.ts` | Critique-driven surgical edits on top variant with blind diff-based LLM judge and direction-reversal bias mitigation |
| `treeSearchAgent.ts` | Beam search tree-of-thought revisions with hybrid two-stage evaluation |
| `sectionDecompositionAgent.ts` | Decomposes top variant into H2 sections, applies parallel critique-edit-judge loops per section, stitches results |
| `debateAgent.ts` | Structured 3-turn debate over top 2 non-baseline variants, produces synthesis variant |
| `outlineGenerationAgent.ts` | Outline-based generation: 6-call pipeline with per-step scoring |
| `metaReviewAgent.ts` | Analyzes strategy performance via mu-based analysis, detects weaknesses (computation-only, no LLM calls) |
| `proximityAgent.ts` | Computes cosine similarity between variant embeddings, maintains sparse similarity matrix, derives pool diversity score |
| `formatRules.ts` | Shared prose-only format rules injected into all text-generation prompts |
| `formatValidator.ts` | Validates generated text against format rules; controlled by `FORMAT_VALIDATION_MODE` env var |

### Strategy Experiments (`evolution/src/experiments/evolution/`)
| File | Purpose |
|------|---------|
| `analysis.ts` | Per-run Elo/cost comparison for manual experiments |

### Comparison (`evolution/src/lib/`)
| File | Purpose |
|------|---------|
| `comparison.ts` | Pairwise text comparison with position-bias mitigation (forward+reverse) |
| `diffComparison.ts` | CriticMarkup diff-based comparison with direction-reversal bias mitigation (used by IterativeEditingAgent) |

### Tree of Thought (`evolution/src/lib/treeOfThought/`)
| File | Purpose |
|------|---------|
| `types.ts` | TreeNode, RevisionAction, TreeSearchResult, TreeState, BeamSearchConfig types |
| `treeNode.ts` | Tree construction/traversal: createRootNode, createChildNode, getAncestors, getPath, getBestLeaf, pruneSubtree |
| `beamSearch.ts` | Core beam search algorithm with hybrid two-stage evaluation |
| `revisionActions.ts` | Action selection from critiques (forced action-type diversity), per-action-type prompt construction |
| `evaluator.ts` | Stage 1 parent-relative filter + Stage 2 sibling mini-tournament with local OpenSkill ratings |
| `index.ts` | Barrel exports |

### Section Decomposition (`evolution/src/lib/section/`)
| File | Purpose |
|------|---------|
| `sectionParser.ts` | `parseArticleIntoSections()` with regex H2 splitting and code block protection |
| `sectionStitcher.ts` | `stitchSections()` — reassembles edited sections into full article |
| `sectionEditRunner.ts` | Per-section critique-edit-judge loop with relaxed format validation |
| `sectionFormatValidator.ts` | Relaxed format validator (no H1 requirement for individual sections) |
| `types.ts` | Section-level types: `ParsedSection`, `SectionEditResult` |

### Agent Detail Views (`evolution/src/components/evolution/agentDetails/`)
| File | Purpose |
|------|---------|
| `AgentExecutionDetailView.tsx` | Router component — exhaustive switch on `detailType` delegates to 12 type-specific views |
| `shared.tsx` | Shared UI primitives: StatusBadge, DetailSection, Metric, CostDisplay, ShortId |
| `{Agent}Detail.tsx` | 12 type-specific detail views (GenerationDetail, CalibrationDetail, TournamentDetail, etc.) |
| `index.ts` | Barrel export |

### Integration Points (outside `evolution/src/lib/`)
| File | Purpose |
|------|---------|
| `evolution/src/services/evolutionActions.ts` | 10 server actions: estimateRunCost, queueEvolutionRun, getEvolutionRuns, getEvolutionRunById, getEvolutionVariants, getEvolutionRunSummary, getEvolutionCostBreakdown, getEvolutionRunLogs, killEvolutionRun, listVariants |
| `evolution/src/services/evolutionRunClient.ts` | Client-side fetch wrapper for the unified evolution run endpoint with retry logic |
| `src/lib/services/llmSemaphore.ts` | Counting semaphore for throttling concurrent LLM API calls during parallel evolution runs |
| `evolution/src/services/evolutionVisualizationActions.ts` | 14 server actions for timeline, invocation detail, run detail, and summary data |
| `evolution/src/services/variantDetailActions.ts` | 5 server actions for variant detail page (full detail, parents, children, match history, lineage chain) |
| `evolution/src/services/arenaActions.ts` | 15 server actions for Arena CRUD and comparison |
| `evolution/src/services/costAnalyticsActions.ts` | 1 action: `getStrategyAccuracyAction` — per-strategy cost estimation accuracy stats |
| `evolution/src/services/eloBudgetActions.ts` | 2 server actions: `getStrategyRunsAction` (run history per strategy) and `getStrategiesPeakStatsAction` (batch-fetch best p90/max Elo across completed runs per strategy). `StrategyRunEntry` includes `p90Elo` and `maxElo` fields (populated via `compute_run_variant_stats` RPC for completed runs, null otherwise) |
| `evolution/src/services/experimentActions.ts` | 10 server actions for manual experiment lifecycle. Includes `getRunMetricsAction(runId)` wrapping `computeRunMetrics()` for the run detail Metrics tab |
| `evolution/src/services/experimentHelpers.ts` | Shared helpers (`extractTopElo`) |
| `evolution/src/services/experimentReportPrompt.ts` | Report prompt builder and model config |
| `evolution/src/services/promptRegistryActions.ts` | 7 server actions for prompt CRUD |
| `evolution/src/services/strategyRegistryActions.ts` | 8 server actions for strategy CRUD |
| `evolution/src/services/strategyResolution.ts` | Atomic strategy resolution (INSERT-first upsert) |
| `evolution/src/services/evolutionRunnerCore.ts` | Shared runner core for admin triggers |
| `evolution/src/lib/ops/watchdog.ts` | Stale run detection and checkpoint recovery |
| `evolution/src/lib/ops/experimentDriver.ts` | Experiment lifecycle state machine |
| `evolution/src/lib/ops/orphanedReservations.ts` | Orphaned LLM budget reservation cleanup |
| `evolution/src/lib/utils/evolutionUrls.ts` | URL builders: `buildRunUrl`, `buildExplanationUrl`, `buildArticleUrl`, `buildVariantDetailUrl`, `buildInvocationUrl`, `buildArenaTopicUrl`, `buildStrategyUrl`, `buildExperimentUrl` |
| `src/app/admin/evolution/variants/[variantId]/page.tsx` | Variant detail page: full metadata, content, lineage, match history |
| `src/app/admin/evolution/invocations/[invocationId]/page.tsx` | Invocation detail page: agent execution deep-dive with before/after text diffs, Elo deltas. Invocations list includes "View" link column for direct navigation. |
| `src/app/admin/evolution/runs/page.tsx` | Admin UI: run management, variant preview, apply/rollback, cost/quality charts |
| `evolution/scripts/evolution-runner.ts` | Batch runner: runs housekeeping (watchdog, experiment driver, orphaned reservations), claims pending runs, executes full pipeline, 60-second heartbeat, graceful SIGTERM/SIGINT shutdown |
| `evolution/scripts/run-evolution-local.ts` | Standalone CLI for running evolution on a local markdown file — bypasses Next.js imports, supports mock and real LLM modes, auto-persists to Supabase when env vars are available |
| `src/app/api/evolution/run/route.ts` | POST-only admin trigger endpoint with optional targetRunId |
| `src/app/api/cron/content-quality-eval/route.ts` | Auto-queues articles scoring < 0.4 for evolution (max 5 per cron, budget $3.00 each) |
| `src/lib/services/contentQualityActions.ts` | `getEvolutionComparisonAction` — partitions quality scores into before/after by evolution timestamp |
| `evolution/scripts/run-prompt-bank.ts` | Batch generation across prompts x methods with coverage matrix, resume support, and evolution child process spawning |
| `evolution/scripts/run-prompt-bank-comparisons.ts` | Batch all-pairs comparisons for all prompt bank topics with bias mitigation and Elo updates |
| `evolution/scripts/run-arena-comparison.ts` | Single-topic pairwise comparison CLI with leaderboard output |
| `evolution/scripts/add-to-arena.ts` | Adds evolution run winner (and optionally baseline) to Arena |
| `evolution/scripts/lib/arenaUtils.ts` | Shared Arena insertion logic: topic upsert, entry insert, Elo initialization, elo_per_dollar |
| `evolution/scripts/lib/oneshotGenerator.ts` | Shared oneshot article generation with multi-provider support (DeepSeek, OpenAI, Anthropic) |
| `evolution/src/config/promptBankConfig.ts` | Prompt bank configuration: 5 prompts (easy/medium/hard), 6 generation methods, comparison settings |

## Usage

### Queuing and Running

```typescript
import {
  queueEvolutionRunAction,
  getEvolutionVariantsAction,
  applyWinnerAction,
  rollbackEvolutionAction,
} from '@/evolution/src/services/evolutionActions';
import { triggerEvolutionRun } from '@/evolution/src/services/evolutionRunClient';

// 1. Queue a run (admin only)
const run = await queueEvolutionRunAction(explanationId, { budgetCapUsd: 3.0 });

// 2a. Wait for batch runner to pick it up (automatic)
// 2b. Or trigger via unified endpoint (admin UI button)
await triggerEvolutionRun(run.id);

// 3. View ranked variants
const variants = await getEvolutionVariantsAction(run.id);
// Returns variants sorted by mu descending — variants[0] is the winner

// 4. Apply the winning variant to the article
await applyWinnerAction({
  explanationId,
  variantId: variants[0].id,
  runId: run.id,
});
// This replaces explanations.content and marks the variant as is_winner=true.
```

### Admin UI

The evolution dashboard entry point is `/admin/evolution-dashboard` (overview with stat cards and quick links to all sub-pages). The management page at `/admin/evolution/runs` provides:
- Filterable runs table (by status and date range)
- Variant panel showing rating-ranked variants with text preview
- Queue dialog for manually queuing runs
- **Trigger button**: Triggers a single evolution run via the Vercel POST endpoint (useful for ad-hoc runs from the admin UI).
- Apply Winner / Rollback buttons
- Cost breakdown chart by agent
- Quality comparison chart (before/after scores from Phase E evaluation)

## CLI Commands

### Batch Runner
```bash
# Local execution (sequential)
npx tsx evolution/scripts/evolution-runner.ts --max-runs 5
npx tsx evolution/scripts/evolution-runner.ts --dry-run  # Log-only mode

# Parallel execution (5 runs at a time, max 20 concurrent LLM calls)
npx tsx evolution/scripts/evolution-runner.ts --parallel 5 --max-runs 10
npx tsx evolution/scripts/evolution-runner.ts --parallel 3 --max-concurrent-llm 15

```

| Flag | Default | Description |
|------|---------|-------------|
| `--max-runs N` | 10 | Maximum total runs to process |
| `--parallel N` | 1 | Number of runs to execute concurrently per batch |
| `--max-concurrent-llm N` | 20 | Maximum concurrent LLM API calls across all parallel runs |
| `--dry-run` | false | Log-only mode — no LLM calls or DB writes |

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVOLUTION_MAX_CONCURRENT_LLM` | 20 | Maximum concurrent LLM API calls for evolution pipelines (used by the in-process semaphore) |

### Minicomputer Deployment

The batch runner is deployed on a local minicomputer as a systemd timer. Prerequisites:
- Node.js 20+, npm dependencies installed (`npm ci`)
- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY` (or `OPENAI_API_KEY`)

Systemd files are in `evolution/deploy/`:
- `evolution-runner.service` — Type=oneshot unit that runs the batch runner
- `evolution-runner.timer` — 1-minute interval timer

Setup:
```bash
sudo cp evolution/deploy/evolution-runner.service /etc/systemd/system/
sudo cp evolution/deploy/evolution-runner.timer /etc/systemd/system/
# Edit /etc/systemd/system/evolution-runner.service:
#   - Update WorkingDirectory, EnvironmentFile paths to match your install
#   - Update User/Group to match your service account
#   - Update Environment=PATH to include your Node.js bin directory (e.g. nvm path)
#   - Optionally create .env.evolution-prod with prod-specific overrides (loaded after .env.local)
sudo systemctl daemon-reload
sudo systemctl enable --now evolution-runner.timer
```

Monitoring:
```bash
systemctl status evolution-runner.timer   # Timer status
journalctl -u evolution-runner.service -f  # Live logs
```

### Local CLI Runner
```bash
# Mock mode (no API keys needed)
npx tsx evolution/scripts/run-evolution-local.ts --file evolution/docs/sample_content/filler_words.md --mock

# Real LLM mode (needs DEEPSEEK_API_KEY or OPENAI_API_KEY)
npx tsx evolution/scripts/run-evolution-local.ts --file evolution/docs/sample_content/filler_words.md

# Full agent suite with 5 iterations
npx tsx evolution/scripts/run-evolution-local.ts --file evolution/docs/sample_content/filler_words.md --full --iterations 5

# With specific model
npx tsx evolution/scripts/run-evolution-local.ts --file any-markdown.md --model gpt-4.1-mini

# With bank checkpoints (snapshot intermediate iterations to Arena)
npx tsx evolution/scripts/run-evolution-local.ts --prompt "Explain quantum computing" --bank --bank-checkpoints "3,5,10"

# With outline-based generation enabled
npx tsx evolution/scripts/run-evolution-local.ts --file article.md --full --outline --iterations 5

# Single-article mode (no population, iterative improvement only)
npx tsx evolution/scripts/run-evolution-local.ts --file article.md --single --iterations 5

# Custom budget and output path
npx tsx evolution/scripts/run-evolution-local.ts --file article.md --full --budget 3.00 --output results.json

# Custom judge model
npx tsx evolution/scripts/run-evolution-local.ts --file article.md --full --judge-model gpt-4.1-nano

# Select specific optional agents
npx tsx evolution/scripts/run-evolution-local.ts --file article.md --full --enabled-agents "reflection,iterativeEditing,debate"
```

| Flag | Default | Description |
|------|---------|-------------|
| `--file <path>` | — | Markdown file to evolve (required unless `--prompt`) |
| `--prompt <text>` | — | Topic prompt — generates seed article (required unless `--file`) |
| `--seed-model <name>` | same as `--model` | Model for seed article generation |
| `--mock` | false | Use mock LLM (no API keys needed) |
| `--full` | false | Run full agent suite (default: minimal) |
| `--single` | false | Single-article mode: sequential improvement, no population search |
| `--iterations <n>` | 3 | Number of iterations |
| `--budget <n>` | 5.00 | Budget cap in USD |
| `--output <path>` | auto-generated | Output JSON path |
| `--explanation-id <n>` | null | Link run to an explanation in DB |
| `--model <name>` | deepseek-chat | LLM model for generation |
| `--judge-model <name>` | from config | Override judge model for comparison/tournament |
| `--enabled-agents <list>` | all | Comma-separated optional agent names to enable |
| `--outline` | false | Enable outline-based generation agent |
| `--bank` | false | Add winner + baseline to Arena |
| `--bank-checkpoints <list>` | — | Comma-separated iteration numbers to snapshot |

Auto-persists to Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. Runs are tracked with `source='local:<filename>'` and `explanation_id=NULL`.

### Prompt-Based Seeding

```bash
# Generate seed article from prompt, then evolve it
npx tsx evolution/scripts/run-evolution-local.ts --prompt "Explain quantum computing" --seed-model gpt-4.1

# With bank auto-insertion (adds winner + baseline to Arena)
npx tsx evolution/scripts/run-evolution-local.ts --prompt "Explain quantum computing" --bank
```

How it works:
1. `--prompt` triggers `generateSeedArticle()` which generates a title and article content via LLM
2. `--seed-model` optionally specifies which model generates the seed (default: pipeline's `generationModel`)
3. `--prompt` is mutually exclusive with `--file` (one or the other)
4. When `--bank` is set, the pipeline winner and baseline are added to the Arena after completion
5. `--bank-checkpoints "3,5,10"` snapshots intermediate winners to the Arena

### Strategy Experiments
Experiments are managed via the admin UI at `/admin/evolution/experiments` and `/admin/evolution/start-experiment`. The manual experiment system allows creating experiments with individually configured runs. See [Strategy Experiments](./strategy_experiments.md).

### Experiment Metrics Backfill
```bash
# Preview what would be computed (dry-run, default)
npx tsx evolution/scripts/backfill-experiment-metrics.ts

# Write metrics_v2 to all completed experiments
npx tsx evolution/scripts/backfill-experiment-metrics.ts --run
```

## Production Deployment

### Database Setup
1. Run evolution migrations (`20260131000001` through `20260131000010`, plus `20260201000001` for Arena, `20260214000001` for `claim_evolution_run`, `20260221000001` for `p_run_id` targeting, `20260222000001` to fix the overload ambiguity, `20260222100001` for `llmCallTracking.evolution_invocation_id` FK, `20260222100002` for the partial index on `evolution_invocation_id`, `20260224000001` to fix the arena upsert index, `20260226000001` for elo_attribution columns, and `20260226000002` for elo_attribution index)
2. The `claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)` RPC function uses `FOR UPDATE SKIP LOCKED` for safe concurrent claiming. When `p_run_id` is provided, it targets that specific run; when omitted, it claims the oldest pending/continuation run (FIFO). The batch runner also has a fallback using `UPDATE WHERE status='pending'` with optimistic locking if the RPC is not yet deployed

### Migration Deployment
- **`--include-all` flag**: `supabase db push --include-all` is used in CI to tolerate out-of-order migration timestamps from parallel branches. Without it, migrations with timestamps before the last applied migration are rejected.
- **Auto-rename Action**: `.github/workflows/migration-reorder.yml` automatically renames migration files in PRs whose timestamps precede main's latest, preventing ordering conflicts.
- **Branch protection**: "Require branches to be up to date before merging" must be enabled on `main` so the auto-rename Action re-runs after competing PRs merge.

### Monitoring
- **Watchdog**: Runs in batch runner housekeeping phase (`evolution/src/lib/ops/watchdog.ts`). Stale `running` runs (heartbeat > 10 min): recovers to `continuation_pending` if checkpoint exists, otherwise marks `failed`. Stale `continuation_pending` (> 30 min): marks `failed` with "abandoned" message
- **Stale run query**: `SELECT * FROM evolution_runs WHERE status='failed' AND error_message LIKE '%Stale%'`
- **Cost tracking**: `getEvolutionCostBreakdownAction` aggregates LLM costs by agent name
- **Quality impact**: `getEvolutionComparisonAction` computes before/after quality score deltas

## Observability

- **OpenTelemetry spans** (distributed tracing segments viewable in Grafana/Honeycomb): `evolution.pipeline.full`, `evolution.iteration`, `evolution.agent.{name}` — each carries attributes for cost, variant count, phase, and timing
- **Structured logging**: Every log entry includes `{subsystem: 'evolution', runId, agentName}` for filtering
- **DB heartbeat**: `last_heartbeat` column updated after each agent execution, monitored by watchdog in batch runner housekeeping
- **Cost attribution**: Per-agent spend tracked in `CostTracker` with per-invocation accumulation, surfaced in admin UI cost breakdown chart via `getEvolutionCostBreakdownAction`. Dashboard queries use `evolution_agent_invocations` table (joined by `run_id`) where `cost_usd` is incremental per-invocation (not cumulative). Individual LLM calls are linked to their parent invocation via `llmCallTracking.evolution_invocation_id` FK. Accurate even for concurrent/paused runs (no time-window correlation needed).
- **Per-run DB logs**: `LogBuffer` writes structured log entries to `evolution_run_logs` table with cross-linking columns (agent_name, iteration, variant_id). Admin UI Logs tab (`LogsTab.tsx`) provides filterable, auto-refreshing log viewer with deep-link support via URL params (`?tab=logs&agent=X&iteration=N&variant=V`). Logs are flushed at pipeline end, on budget exceeded, and on agent failure.

## Testing

Unit tests exist for all agents and core modules:
- `agents/*.test.ts` — Agent execution with mock LLM clients (`createMockEvolutionLLMClient`)
- `core/*.test.ts` — State serialization, OpenSkill rating math, cost tracker, supervisor transitions, diversity tracker, feature flags
- `comparison.test.ts` — Bias-mitigated comparison, cache behavior, confidence scoring
- `evolution/scripts/run-evolution-local.test.ts` — CLI flag parsing, mock LLM mode, output format
- `src/__tests__/integration/evolution-actions.integration.test.ts` — Server action integration with real Supabase
- `src/__tests__/integration/evolution-infrastructure.integration.test.ts` — Core infrastructure integration
- `src/__tests__/integration/evolution-pipeline.integration.test.ts` — Full pipeline integration
- `src/__tests__/integration/evolution-visualization.integration.test.ts` — Visualization action integration
- `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts` — Admin UI E2E tests (Playwright)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` — Visualization E2E tests (Playwright)
- `src/__tests__/e2e/specs/09-admin/admin-article-variant-detail.spec.ts` — Variant detail E2E tests (Playwright)
- `evolution/src/testing/evolution-test-helpers.ts` — Shared factories: `createMockEvolutionLLMClient`, `createTestEvolutionRun`, `createTestVariant`, `createTestCheckpoint`, `createTestLLMCallTracking`, `evolutionTablesExist`, `cleanupEvolutionData`

## Related Documentation

- [Architecture](./architecture.md) — Pipeline orchestration, phases, checkpoint/resume
- [Data Model](./data_model.md) — Core primitives (Prompt, Strategy, Run, Article)
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating system, bias mitigation
- [Agent Overview](./agents/overview.md) — Agent framework, interaction patterns
- [Generation Agents](./agents/generation.md) — GenerationAgent, OutlineGenerationAgent
- [Editing Agents](./agents/editing.md) — IterativeEditingAgent, SectionDecompositionAgent
- [Tree Search Agent](./agents/tree_search.md) — Beam search revisions
- [Support Agents](./agents/support.md) — Reflection, Debate, Evolution, Proximity, MetaReview
- [Arena](./arena.md) — Cross-method comparison, Elo rating, prompt bank
- [Cost Optimization](./cost_optimization.md) — Cost tracking, Pareto analysis
- [Visualization](./visualization.md) — Dashboard, components, server actions
- [Strategy Experiments](./strategy_experiments.md) — Manual experiment system for comparing pipeline configurations
