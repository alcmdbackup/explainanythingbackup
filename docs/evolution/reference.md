# Evolution Reference

Single source of truth for cross-cutting concerns shared across all evolution docs: configuration, feature flags, budget caps, database schema, key files, CLI commands, deployment, observability, and testing.

## Configuration

Default configuration (`DEFAULT_EVOLUTION_CONFIG` in `config.ts`):

```typescript
{
  maxIterations: 15,
  budgetCapUsd: 5.00,
  plateau: { window: 3, threshold: 0.02 },
  expansion: {
    minPool: 15,         // Minimum pool size to consider COMPETITION transition
    minIterations: 3,    // Minimum EXPANSION iterations (config exists, not enforced by supervisor)
    diversityThreshold: 0.25, // Diversity needed for COMPETITION transition
    maxIterations: 8,    // Safety cap — unconditionally transitions at this iteration
  },
  generation: { strategies: 3 },
  calibration: {
    opponents: 5,        // Used in COMPETITION; EXPANSION overrides to 3
    minOpponents: 2,     // Adaptive early exit: skip remaining after N consecutive decisive matches
  },
  budgetCaps: {          // Per-agent % of budgetCapUsd — intentionally sums to >1.0
    generation: 0.20,
    calibration: 0.15,
    tournament: 0.20,
    pairwise: 0.20,      // PairwiseRanker (called by Tournament for all LLM comparisons)
    evolution: 0.10,
    reflection: 0.05,
    debate: 0.05,
    iterativeEditing: 0.05,
    treeSearch: 0.10,
    outlineGeneration: 0.10,
    sectionDecomposition: 0.10,
    flowCritique: 0.05,
  },
  useEmbeddings: false,
  judgeModel: 'gpt-4.1-nano',    // Cheap model for A/B comparison judgments
  generationModel: 'gpt-4.1-mini', // Model for text generation tasks
}
```

Per-run overrides stored in `content_evolution_runs.config` (JSONB). Merged via `resolveConfig()` with deep spread for nested objects. When a run is queued with a linked strategy, `queueEvolutionRunAction` copies the following fields from the strategy config into the run's config JSONB as a snapshot: `iterations` → `maxIterations`, `generationModel`, `judgeModel`, `budgetCaps`. This ensures the run executes with the config it was queued with, even if the strategy is later edited.

### Auto-Clamping for Short Runs

`resolveConfig()` auto-clamps `expansion.maxIterations` when `maxIterations` is too small for the default expansion window. This prevents `PoolSupervisor.validateConfig()` from throwing when strategies specify low iteration counts (e.g., `maxIterations: 3`).

Formula: if `maxIterations <= expansion.maxIterations + plateau.window + 1`, clamp to `max(0, maxIterations - plateau.window - 1)`. A `console.warn` is emitted when clamping occurs.

Examples with defaults (`expansion.maxIterations=8`, `plateau.window=3`):
- `maxIterations: 3` → expansion clamped to 0 (EXPANSION skipped entirely)
- `maxIterations: 10` → expansion clamped to 6
- `maxIterations: 15` → no clamping (15 > 8 + 3 + 1 = 12)

**Note:** `maxIterations=N` means the pipeline executes exactly N agent iterations. The for-loop runs `i < maxIterations` iterations, and the `shouldStop()` safety check fires when `state.iteration > maxIterations` (not `>=`).

### Tiered Model Routing

The pipeline routes LLM calls to different models based on task complexity. Trivial A/B comparison judgments (`judgeModel`, default: `gpt-4.1-nano`) use a model 4x cheaper than text generation (`generationModel`, default: `gpt-4.1-mini`). The underlying `llmClient.ts` default model is `deepseek-chat` — agents override this via `judgeModel`/`generationModel` config fields passed as `LLMCompletionOptions`.

## Feature Flags

Six flags are managed by the evolution feature flag system (`core/featureFlags.ts`) and stored in the `feature_flags` table:

| Flag | Default | Effect |
|------|---------|--------|
| `evolution_tournament_enabled` | `true` | When `false`, CalibrationRanker used in COMPETITION instead of Tournament |
| `evolution_evolve_pool_enabled` | `true` | When `false`, EvolutionAgent skipped entirely |
| `evolution_dry_run_only` | `false` | When `true`, pipeline logs only — no LLM calls |
| `evolution_debate_enabled` | `true` | When `false`, DebateAgent skipped in COMPETITION phase |
| `evolution_iterative_editing_enabled` | `true` | When `false`, IterativeEditingAgent skipped in COMPETITION phase |
| `evolution_outline_generation_enabled` | `false` | When `true`, OutlineGenerationAgent runs in COMPETITION phase. See [Generation Agents](./agents/generation.md) |
| `evolution_tree_search_enabled` | `false` | When `true`, TreeSearchAgent runs in COMPETITION phase (mutually exclusive with IterativeEditingAgent) |
| `evolution_section_decomposition_enabled` | `true` | When `false`, SectionDecompositionAgent skipped in COMPETITION phase |

Additionally, the quality eval cron (`src/app/api/cron/content-quality-eval/route.ts`) checks a separate `evolution_pipeline_enabled` flag directly from the `feature_flags` table to gate auto-queuing of low-scoring articles. This flag is **not** part of the `EvolutionFeatureFlags` interface — it is read independently by the cron endpoint.

## Budget Caps

Per-agent budget caps as a percentage of total run budget (`budgetCapUsd`, default $5.00):

| Agent | Cap | Percentage |
|-------|-----|-----------|
| GenerationAgent | 0.20 | 20% |
| CalibrationRanker | 0.15 | 15% |
| Tournament | 0.20 | 20% |
| EvolutionAgent | 0.10 | 10% |
| ReflectionAgent | 0.05 | 5% |
| DebateAgent | 0.05 | 5% |
| IterativeEditingAgent | 0.05 | 5% |
| TreeSearchAgent | 0.10 | 10% |
| OutlineGenerationAgent | 0.10 | 10% |
| SectionDecompositionAgent | 0.10 | 10% |
| FlowCritiqueAgent | 0.05 | 5% |

Caps intentionally sum to >1.0 (1.15) because not all agents run every iteration.

### Budget Enforcement

The `CostTracker` (`core/costTracker.ts`) enforces budget at two levels:
- **Per-agent caps**: Configurable percentage of total budget (see table above)
- **Global cap**: Default $5.00 per run
- **Pre-call reservation with FIFO queue**: Budget is checked *before* every LLM call with a 30% safety margin. Reservations are tracked in a FIFO queue (`reservationQueue`) so concurrent parallel calls cannot all pass budget checks. When `recordSpend()` is called after an LLM response, the oldest reservation is dequeued and replaced with actual spend. `getAvailableBudget()` subtracts both spent and reserved amounts.
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
If ALL generated variants fail format validation in an iteration, the pool doesn't grow. The pipeline continues but may accumulate empty iterations. If diversity drops below 0.01 in COMPETITION, the degenerate state stop condition fires.

### Transient Error Handling
When an agent throws a transient error (socket timeout, ECONNRESET, 429, 5xx, OpenAI SDK `APIConnectionError`/`RateLimitError`/`InternalServerError`), the pipeline retries the agent once with exponential backoff (`1s × 2^attempt`). No state rollback on retry — partial pool mutations are safe due to `addToPool` dedup via `poolIds.has()` and uuid4 variant IDs. Classification logic lives in `core/errorClassification.ts:isTransientError()`.

Agents with **internal** protection (IterativeEditingAgent, CalibrationRanker) catch transient errors within their loops, treating them as soft rejections. The pipeline retry acts as a second defense layer for errors that escape agent-level handling.

Retry amplification: OpenAI SDK retries 3× internally (`maxRetries: 3` in `llms.ts`), then the pipeline retries the entire agent once — up to 8 total LLM attempts for a persistent transient error.

### Run Failure Marking (Defense-in-Depth)

Failed runs are marked at two layers to prevent zombie runs (stuck in 'running' forever):

1. **Pipeline layer** (`pipeline.ts:markRunFailed`): Called in the `executeFullPipeline` outer catch. Accepts `agentName: string | null` — when null, formats as "Pipeline error: ...". Sets `status='failed'`, `error_message` (truncated to 500 chars), and `completed_at`. Uses `.in('status', ['pending', 'claimed', 'running'])` guard to only transition non-terminal states (idempotent if both layers fire).

2. **Action layer** (`evolutionActions.ts:triggerEvolutionRunAction` catch): Inline DB update with identical status guard. Wrapped in its own try-catch so a DB error here never masks the original pipeline error.

### Budget Edge Cases
- Budget of $0: Stops immediately at the first `shouldStop()` check (available < $0.01).
- Budget exhausted mid-agent: `BudgetExceededError` thrown before the LLM call. Partial state checkpointed. Run paused.

### Short Articles
No minimum article length enforced. GenerationAgent checks `state.originalText.length > 0` but will attempt generation on very short text. Short articles produce short variants that may fail format validation (< 2 sentences per paragraph).

## Run Summary

At the end of `executeFullPipeline`, the pipeline builds an `EvolutionRunSummary` via `buildRunSummary()` and validates it with a Zod strict schema (`EvolutionRunSummarySchema`). The summary is persisted to `content_evolution_runs.run_summary` (JSONB) and exposed via `getEvolutionRunSummaryAction(runId)`.

Fields:
- `version`: Schema version (currently `1`)
- `stopReason`: Why the pipeline stopped (`'plateau'`, `'budget_exhausted'`, `'max_iterations'`, `'degenerate'`, `'completed'`)
- `finalPhase`: `'EXPANSION'` or `'COMPETITION'`
- `totalIterations`, `durationSeconds`
- `eloHistory`: Array of `{iteration, topElo, medianElo}` per iteration
- `diversityHistory`: Array of `{iteration, score}` per iteration
- `matchStats`: `{totalMatches, avgConfidence, tieRate}`
- `topVariants`: Top 5 variants by Elo with `{id, elo, strategy, isBaseline}`
- `baselineRank`, `baselineElo`: Where the original text ended up
- `strategyEffectiveness`: Record of strategy → `{count, avgElo}` for above-average strategies
- `metaFeedback`: Final `MetaFeedback` from the last MetaReviewAgent run

## Database Schema

| Table | Purpose |
|-------|---------|
| `content_evolution_runs` | Run lifecycle: status, phase, budget, iterations, heartbeat, timing, runner_id. `explanation_id` is nullable (allows CLI runs without an explanation, migration `20260131000008`). `source` column distinguishes origin: `'explanation'` for production runs, `'local:<filename>'` for CLI runs. `run_summary` JSONB column stores `EvolutionRunSummary` with GIN index (migration `20260131000010`) |
| `content_evolution_variants` | Persisted variants with elo_score (mapped from ordinal via `ordinalToEloScale`), generation, parent lineage, is_winner flag. `explanation_id` is nullable (migration `20260131000009`) |
| `evolution_checkpoints` | Full state snapshots (JSONB) keyed by run_id + iteration + last_agent |
| `feature_flags` | Four evolution flags seeded by migration `20260131000007` |
| `hall_of_fame_topics` | Prompt bank topics with unique case-insensitive prompt matching (migration `20260201000001`) |
| `hall_of_fame_entries` | Generated articles: content, generation_method (oneshot/evolution_winner/evolution_baseline), model, cost, optional evolution_run_id/variant_id |
| `hall_of_fame_comparisons` | Pairwise comparison records: entry_a, entry_b, winner, confidence, judge_model, dimension_scores |
| `hall_of_fame_elo` | Per-entry Elo ratings within a topic: elo_rating, elo_per_dollar, match_count |
| `evolution_run_logs` | Per-run structured log entries with cross-linking columns: `run_id`, `level`, `agent_name`, `iteration`, `variant_id`, `message`, `context` (JSONB). Indexed by run_id+created_at, iteration, agent_name, and level (migration `20260208000003`) |
| `evolution_agent_invocations` | Per-agent-per-iteration execution records with structured `execution_detail` (JSONB). Columns: `id`, `run_id` (FK), `iteration`, `agent_name`, `execution_order`, `success`, `cost_usd`, `skipped`, `execution_detail`. Unique on `(run_id, iteration, agent_name)`. GIN index on `execution_detail`. Used by Timeline and Explorer drill-down views (migration `20260212000001`) |

## Key Files

### Core Infrastructure (`src/lib/evolution/core/`)
| File | Purpose |
|------|---------|
| `pipeline.ts` | Pipeline orchestrator — `executeMinimalPipeline` (testing) and `executeFullPipeline` (production) |
| `supervisor.ts` | `PoolSupervisor` — EXPANSION→COMPETITION transitions, phase config, stopping conditions |
| `state.ts` | `PipelineStateImpl` — mutable state with append-only pool, serialization/deserialization for checkpoints |
| `rating.ts` | OpenSkill (Weng-Lin Bayesian) rating wrapper: `createRating`, `updateRating`, `updateDraw`, `getOrdinal`, `isConverged`, `eloToRating`, `ordinalToEloScale` |
| `jsonParser.ts` | Shared `extractJSON<T>()` utility for parsing JSON from LLM responses (used by reflectionAgent, debateAgent, iterativeEditingAgent, beamSearch) |
| `costTracker.ts` | `CostTrackerImpl` — per-agent budget attribution, pre-call reservation with optimistic locking and 30% margin |
| `comparisonCache.ts` | `ComparisonCache` — order-invariant SHA-256 cache for bias-mitigated comparison results |
| `pool.ts` | `PoolManager` — stratified opponent selection (ordinal quartile-based) and pool health statistics |
| `diversityTracker.ts` | `PoolDiversityTracker` — lineage dominance detection, strategy diversity analysis, trend computation |
| `validation.ts` | State contract guards: `validateStateContracts` checks phase prerequisites (ratings populated, matches exist, etc.) |
| `llmClient.ts` | `createEvolutionLLMClient` — wraps `callLLM` with budget enforcement and structured JSON output parsing |
| `logger.ts` | `createEvolutionLogger` (console-only) and `createDbEvolutionLogger` (console + DB buffer). `LogBuffer` batches writes to `evolution_run_logs` with auto-flush at 20 entries. Extracts `agent_name`, `iteration`, `variant_id` from freeform context |
| `featureFlags.ts` | Reads `feature_flags` table for tournament/evolvePool/dryRun/debate/iterativeEditing toggles with safe defaults |

### Shared Modules (`src/lib/evolution/`)
| File | Purpose |
|------|---------|
| `comparison.ts` | Standalone `compareWithBiasMitigation()` — 2-pass A/B reversal with order-invariant SHA-256 caching, `buildComparisonPrompt()`, `parseWinner()` |
| `config.ts` | `DEFAULT_EVOLUTION_CONFIG`, `ELO_CONSTANTS`, `K_SCHEDULE`, `resolveConfig()` for deep-merging per-run overrides |
| `types.ts` | All shared TypeScript types/interfaces (`TextVariation`, `PipelineState`, `ExecutionContext`, `EvolutionRunSummary`, etc.) |
| `index.ts` | Barrel export — public API re-exporting core, agents, and shared modules. Includes `createDefaultAgents()` (single source of truth for 12-agent construction), `preparePipelineRun()` (context factory consolidating config/state/logger/llmClient/agents), and `finalizePipelineRun()` (shared post-completion persistence: summary, variants, agent metrics, strategy config) |

### Agents (`src/lib/evolution/agents/`)
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
| `metaReviewAgent.ts` | Analyzes strategy performance via ordinal analysis, detects weaknesses (computation-only, no LLM calls) |
| `proximityAgent.ts` | Computes cosine similarity between variant embeddings, maintains sparse similarity matrix, derives pool diversity score |
| `formatRules.ts` | Shared prose-only format rules injected into all text-generation prompts |
| `formatValidator.ts` | Validates generated text against format rules; controlled by `FORMAT_VALIDATION_MODE` env var |

### Strategy Experiments (`src/lib/evolution/experiment/`)
| File | Purpose |
|------|---------|
| `factorial.ts` | L8 orthogonal array generation, factor-to-config mapping, full factorial for Round 2+ |
| `analysis.ts` | Main effects computation, interaction effects, factor ranking, recommendations |

### Experiment CLI (`scripts/`)
| File | Purpose |
|------|---------|
| `run-strategy-experiment.ts` | Experiment orchestrator: plan/run/analyze/status commands |

### Comparison (`src/lib/evolution/`)
| File | Purpose |
|------|---------|
| `comparison.ts` | Pairwise text comparison with position-bias mitigation (forward+reverse) |
| `diffComparison.ts` | CriticMarkup diff-based comparison with direction-reversal bias mitigation (used by IterativeEditingAgent) |

### Tree of Thought (`src/lib/evolution/treeOfThought/`)
| File | Purpose |
|------|---------|
| `types.ts` | TreeNode, RevisionAction, TreeSearchResult, TreeState, BeamSearchConfig types |
| `treeNode.ts` | Tree construction/traversal: createRootNode, createChildNode, getAncestors, getPath, getBestLeaf, pruneSubtree |
| `beamSearch.ts` | Core beam search algorithm with hybrid two-stage evaluation |
| `revisionActions.ts` | Action selection from critiques (forced action-type diversity), per-action-type prompt construction |
| `evaluator.ts` | Stage 1 parent-relative filter + Stage 2 sibling mini-tournament with local OpenSkill ratings |
| `index.ts` | Barrel exports |

### Section Decomposition (`src/lib/evolution/section/`)
| File | Purpose |
|------|---------|
| `sectionParser.ts` | `parseArticleIntoSections()` with regex H2 splitting and code block protection |
| `sectionStitcher.ts` | `stitchSections()` — reassembles edited sections into full article |
| `sectionEditRunner.ts` | Per-section critique-edit-judge loop with relaxed format validation |
| `sectionFormatValidator.ts` | Relaxed format validator (no H1 requirement for individual sections) |
| `types.ts` | Section-level types: `ParsedSection`, `SectionEditResult` |

### Agent Detail Views (`src/components/evolution/agentDetails/`)
| File | Purpose |
|------|---------|
| `AgentExecutionDetailView.tsx` | Router component — exhaustive switch on `detailType` delegates to 12 type-specific views |
| `shared.tsx` | Shared UI primitives: StatusBadge, DetailSection, Metric, CostDisplay, ShortId |
| `{Agent}Detail.tsx` | 12 type-specific detail views (GenerationDetail, CalibrationDetail, TournamentDetail, etc.) |
| `index.ts` | Barrel export |

### Integration Points (outside `src/lib/evolution/`)
| File | Purpose |
|------|---------|
| `src/lib/services/evolutionActions.ts` | 9 server actions: queue, trigger, get runs/variants/summary, apply winner, rollback, cost breakdown, history |
| `src/lib/services/evolutionBatchActions.ts` | Server action for dispatching parallel evolution batch runs via GitHub Actions workflow |
| `src/lib/services/llmSemaphore.ts` | Counting semaphore for throttling concurrent LLM API calls during parallel evolution runs |
| `src/lib/services/evolutionVisualizationActions.ts` | Timeline + invocation detail server actions: `getEvolutionRunTimelineAction`, `getAgentInvocationDetailAction`, `getIterationInvocationsAction`, `getAgentInvocationsForRunAction` |
| `src/app/admin/quality/evolution/page.tsx` | Admin UI: run management, variant preview, apply/rollback, cost/quality charts |
| `scripts/evolution-runner.ts` | Batch runner: claims pending runs, executes full pipeline, 60-second heartbeat, graceful SIGTERM/SIGINT shutdown |
| `scripts/run-evolution-local.ts` | Standalone CLI for running evolution on a local markdown file — bypasses Next.js imports, supports mock and real LLM modes, auto-persists to Supabase when env vars are available |
| `src/app/api/cron/evolution-runner/route.ts` | Background runner: polls for pending runs, executes full pipeline with all 9 agents, 30-second heartbeat |
| `src/app/api/cron/evolution-watchdog/route.ts` | Marks stale runs (heartbeat > 10min) as failed — runs every 15 minutes |
| `src/app/api/cron/content-quality-eval/route.ts` | Auto-queues articles scoring < 0.4 for evolution (max 5 per cron, budget $3.00 each) |
| `src/lib/services/contentQualityActions.ts` | `getEvolutionComparisonAction` — partitions quality scores into before/after by evolution timestamp |
| `scripts/run-prompt-bank.ts` | Batch generation across prompts x methods with coverage matrix, resume support, and evolution child process spawning |
| `scripts/run-prompt-bank-comparisons.ts` | Batch all-pairs comparisons for all prompt bank topics with bias mitigation and Elo updates |
| `scripts/run-hall-of-fame-comparison.ts` | Single-topic pairwise comparison CLI with leaderboard output |
| `scripts/add-to-hall-of-fame.ts` | Adds evolution run winner (and optionally baseline) to Hall of Fame |
| `scripts/lib/hallOfFameUtils.ts` | Shared Hall of Fame insertion logic: topic upsert, entry insert, Elo initialization, elo_per_dollar |
| `scripts/lib/oneshotGenerator.ts` | Shared oneshot article generation with multi-provider support (DeepSeek, OpenAI, Anthropic) |
| `src/config/promptBankConfig.ts` | Prompt bank configuration: 5 prompts (easy/medium/hard), 6 generation methods, comparison settings |
| `.github/workflows/evolution-batch.yml` | Weekly batch (Mondays 4am UTC), manual dispatch with `--parallel`, `--max-runs`, and `--dry-run` inputs |

## Usage

### Queuing and Running

```typescript
import {
  queueEvolutionRunAction,
  triggerEvolutionRunAction,
  getEvolutionVariantsAction,
  applyWinnerAction,
  rollbackEvolutionAction,
} from '@/lib/services/evolutionActions';

// 1. Queue a run (admin only)
const run = await queueEvolutionRunAction(explanationId, { budgetCapUsd: 3.0 });

// 2a. Wait for batch runner to pick it up (automatic, weekly via GitHub Actions)
// 2b. Or trigger inline execution (admin UI button)
await triggerEvolutionRunAction(run.id);

// 3. View ranked variants
const variants = await getEvolutionVariantsAction(run.id);
// Returns variants sorted by ordinal descending — variants[0] is the winner

// 4. Apply the winning variant to the article
await applyWinnerAction({
  explanationId,
  variantId: variants[0].id,
  runId: run.id,
});
// This replaces explanations.content, saves previous content to content_history,
// marks the variant as is_winner=true, and triggers a post-evolution quality eval.

// 5. Rollback if needed (requires historyId from content_history)
await rollbackEvolutionAction({ explanationId, historyId });
```

### Admin UI

The evolution dashboard entry point is `/admin/evolution-dashboard` (overview with stat cards and quick links to all sub-pages). The management page at `/admin/quality/evolution` provides:
- Filterable runs table (by status and date range)
- Variant panel showing rating-ranked variants with text preview
- Queue dialog for manually queuing runs
- **Batch Dispatch card**: Dispatch parallel batch execution via GitHub Actions with configurable parallel count, max runs, and dry-run toggle. Includes "Trigger All Pending" button.
- Apply Winner / Rollback buttons
- Cost breakdown chart by agent
- Quality comparison chart (before/after scores from Phase E evaluation)

## CLI Commands

### Batch Runner
```bash
# Local execution (sequential)
npx tsx scripts/evolution-runner.ts --max-runs 5
npx tsx scripts/evolution-runner.ts --dry-run  # Log-only mode

# Parallel execution (5 runs at a time, max 20 concurrent LLM calls)
npx tsx scripts/evolution-runner.ts --parallel 5 --max-runs 10
npx tsx scripts/evolution-runner.ts --parallel 3 --max-concurrent-llm 15

# GitHub Actions (automatic)
# .github/workflows/evolution-batch.yml — runs Mondays 4am UTC
# Manual dispatch with parallel, max-runs, and dry-run inputs
# Timeout: 7 hours, concurrency group prevents parallel workflow runs
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
| `GITHUB_TOKEN` | — | Fine-grained PAT with `actions:write` scope (required for dashboard batch dispatch) |
| `GITHUB_REPO` | `Minddojo/explainanything` | GitHub repository for workflow dispatch |

### Local CLI Runner
```bash
# Mock mode (no API keys needed)
npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --mock

# Real LLM mode (needs DEEPSEEK_API_KEY or OPENAI_API_KEY)
npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md

# Full agent suite with 5 iterations
npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --full --iterations 5

# With specific model
npx tsx scripts/run-evolution-local.ts --file any-markdown.md --model gpt-4.1-mini

# With bank checkpoints (snapshot intermediate iterations to Hall of Fame)
npx tsx scripts/run-evolution-local.ts --prompt "Explain quantum computing" --bank --bank-checkpoints "3,5,10"

# With outline-based generation enabled
npx tsx scripts/run-evolution-local.ts --file article.md --full --outline --iterations 5
```

Auto-persists to Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. Runs are tracked with `source='local:<filename>'` and `explanation_id=NULL`. Pass `--explanation-id N` to link a run to an existing explanation.

### Prompt-Based Seeding

```bash
# Generate seed article from prompt, then evolve it
npx tsx scripts/run-evolution-local.ts --prompt "Explain quantum computing" --seed-model gpt-4.1

# With bank auto-insertion (adds winner + baseline to Hall of Fame)
npx tsx scripts/run-evolution-local.ts --prompt "Explain quantum computing" --bank
```

How it works:
1. `--prompt` triggers `generateSeedArticle()` which generates a title and article content via LLM
2. `--seed-model` optionally specifies which model generates the seed (default: pipeline's `generationModel`)
3. `--prompt` is mutually exclusive with `--file` (one or the other)
4. When `--bank` is set, the pipeline winner and baseline are added to the Hall of Fame after completion
5. `--bank-checkpoints "3,5,10"` snapshots intermediate winners to the Hall of Fame

### Strategy Experiments
```bash
# Preview the L8 experiment plan for Round 1
npx tsx scripts/run-strategy-experiment.ts plan --round 1

# Execute all 8 screening runs
npx tsx scripts/run-strategy-experiment.ts run --round 1 \
  --prompt "Explain how blockchain technology works"

# Re-analyze completed results
npx tsx scripts/run-strategy-experiment.ts analyze --round 1

# Check experiment status
npx tsx scripts/run-strategy-experiment.ts status

# Round 2 refinement with custom factor levels
npx tsx scripts/run-strategy-experiment.ts plan --round 2 \
  --vary "iterations=3,5,8" --lock "genModel=deepseek-chat"

# Re-run failed rows
npx tsx scripts/run-strategy-experiment.ts run --round 1 \
  --prompt "Explain quantum computing" --retry-failed
```

Uses fractional factorial (Taguchi L8) design to test 5 pipeline factors in 8 runs. State persisted to `experiments/strategy-experiment.json` for resume on failure. See [Strategy Experiments](./strategy_experiments.md).

## Production Deployment

### Database Setup
1. Run evolution migrations (`20260131000001` through `20260131000010`, plus `20260201000001` for Hall of Fame, and `20260214000001` for `claim_evolution_run`)
2. The `claim_evolution_run(p_runner_id TEXT)` RPC function uses `FOR UPDATE SKIP LOCKED` for safe concurrent claiming. The batch runner also has a fallback using `UPDATE WHERE status='pending'` with optimistic locking if the RPC is not yet deployed

### Monitoring
- **Watchdog cron**: `/api/cron/evolution-watchdog` runs every 15 minutes, marks stale runs as failed
- **Stale run query**: `SELECT * FROM content_evolution_runs WHERE status='failed' AND error_message LIKE '%Stale%'`
- **Cost tracking**: `getEvolutionCostBreakdownAction` aggregates LLM costs by agent name
- **Quality impact**: `getEvolutionComparisonAction` computes before/after quality score deltas

## Observability

- **OpenTelemetry spans** (distributed tracing segments viewable in Grafana/Honeycomb): `evolution.pipeline.full`, `evolution.iteration`, `evolution.agent.{name}` — each carries attributes for cost, variant count, phase, and timing
- **Structured logging**: Every log entry includes `{subsystem: 'evolution', runId, agentName}` for filtering
- **DB heartbeat**: `last_heartbeat` column updated after each agent execution, monitored by watchdog cron
- **Cost attribution**: Per-agent spend tracked in `CostTracker`, surfaced in admin UI cost breakdown chart via `getEvolutionCostBreakdownAction`. Dashboard queries use `evolution_agent_invocations` table (joined by `run_id`) with cumulative `cost_usd` per agent — deltas between consecutive iterations give per-iteration spend. Accurate even for concurrent/paused runs (no time-window correlation needed).
- **Per-run DB logs**: `LogBuffer` writes structured log entries to `evolution_run_logs` table with cross-linking columns (agent_name, iteration, variant_id). Admin UI Logs tab (`LogsTab.tsx`) provides filterable, auto-refreshing log viewer with deep-link support via URL params (`?tab=logs&agent=X&iteration=N&variant=V`). Logs are flushed at pipeline end, on budget exceeded, and on agent failure.

## Testing

Unit tests exist for all agents and core modules:
- `agents/*.test.ts` — Agent execution with mock LLM clients (`createMockEvolutionLLMClient`)
- `core/*.test.ts` — State serialization, OpenSkill rating math, cost tracker, supervisor transitions, diversity tracker, feature flags
- `comparison.test.ts` — Bias-mitigated comparison, cache behavior, confidence scoring
- `scripts/run-evolution-local.test.ts` — CLI flag parsing, mock LLM mode, output format
- `src/__tests__/integration/evolution-actions.integration.test.ts` — Server action integration with real Supabase
- `src/__tests__/integration/evolution-infrastructure.integration.test.ts` — Core infrastructure integration
- `src/__tests__/integration/evolution-pipeline.integration.test.ts` — Full pipeline integration
- `src/__tests__/integration/evolution-visualization.integration.test.ts` — Visualization action integration
- `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts` — Admin UI E2E tests (Playwright)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` — Visualization E2E tests (Playwright)
- `src/testing/utils/evolution-test-helpers.ts` — Shared factories: `createMockEvolutionLLMClient`, `createTestEvolutionRun`, `createTestVariant`, `createTestCheckpoint`, `createTestLLMCallTracking`, `evolutionTablesExist`, `cleanupEvolutionData`

## Related Documentation

- [Architecture](./architecture.md) — Pipeline orchestration, phases, checkpoint/resume
- [Data Model](./data_model.md) — Core primitives (Prompt, Strategy, Run, Article)
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating system, bias mitigation
- [Agent Overview](./agents/overview.md) — Agent framework, interaction patterns
- [Generation Agents](./agents/generation.md) — GenerationAgent, OutlineGenerationAgent
- [Editing Agents](./agents/editing.md) — IterativeEditingAgent, SectionDecompositionAgent
- [Tree Search Agent](./agents/tree_search.md) — Beam search revisions
- [Support Agents](./agents/support.md) — Reflection, Debate, Evolution, Proximity, MetaReview
- [Hall of Fame](./hall_of_fame.md) — Cross-method comparison, Elo rating, prompt bank
- [Cost Optimization](./cost_optimization.md) — Cost tracking, adaptive allocation, Pareto
- [Visualization](./visualization.md) — Dashboard, components, server actions
- [Strategy Experiments](./strategy_experiments.md) — Factorial design for finding Elo-optimal configurations
