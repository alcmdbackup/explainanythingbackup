# Evolution Pipeline

## Overview

The evolution pipeline is an autonomous content improvement system that iteratively generates, competes, and refines text variations of existing articles using LLM-driven agents. It operates as a self-contained subsystem under `src/lib/evolution/` with its own agent framework, Elo rating system, budget enforcement, and checkpoint/resume capability.

The pipeline uses an evolutionary algorithm metaphor: a pool of text variants competes via LLM-judged pairwise comparisons, top performers reproduce via mutation and crossover, and the population converges toward higher quality through iterative selection pressure.

```
Article Text → EXPANSION phase (grow pool) → COMPETITION phase (refine pool) → Winner Applied
                 │                              │
                 ├─ GenerationAgent              ├─ GenerationAgent (focused strategy)
                 ├─ CalibrationRanker            ├─ ReflectionAgent (critique top 3)
                 ├─ ProximityAgent               ├─ DebateAgent (structured 3-turn debate)
                 │                              ├─ EvolutionAgent (mutate/crossover)
                 │                              ├─ CalibrationRanker or Tournament
                 │                              ├─ ProximityAgent (diversity tracking)
                 │                              └─ MetaReviewAgent (meta-feedback)
```

## Key Concepts

### Elo Rating System
A rating system originally from chess where competitors gain or lose points based on head-to-head outcomes. A variant that beats a higher-rated opponent gains more points than one that beats a lower-rated opponent. The system converges over many matches to reflect true relative quality. In this pipeline, every text variant starts at Elo 1200 and gains/loses points through pairwise LLM-judged comparisons.

### Swiss-Style Tournament (Info-Theoretic Pairing)
A pairing strategy that maximizes information gain per comparison. Instead of greedy adjacent matching after Elo sort, candidate pairs are scored by three factors: (1) **outcome uncertainty** — how close to 50/50 the expected result is (from Elo expected score), (2) **sigma proxy** — `1/√(min(matchCount,20)+1)`, giving priority to under-tested variants whose ratings are still uncertain, and (3) **top-K boost** — a 1.5x multiplier when both variants are in the top third of the pool, since accurate ranking at the top matters most. Pairs are selected greedily by descending score, skipping already-played and already-used variants. This produces ~35-45% fewer rounds to converge compared to the prior adjacent-matching approach.

### Stratified Opponent Selection
For calibrating new entrants, opponents are drawn from different Elo tiers rather than randomly. For n=5 opponents: 2 from the top quartile, 2 from the middle, and 1 from the bottom or fellow new entrants. This ensures a new variant is tested against both strong and weak competitors, producing a more accurate initial rating.

### Tiered Model Routing
The pipeline routes LLM calls to different models based on task complexity. Trivial A/B comparison judgments (`judgeModel`, default: `gpt-4.1-nano`) use a model 4x cheaper than text generation (`generationModel`, default: `gpt-4.1-mini`). The underlying `llmClient.ts` default model is `deepseek-chat` — agents override this via `judgeModel`/`generationModel` config fields passed as `LLMCompletionOptions`.

### LLM Response Cache (ComparisonCache)
Bias-mitigated comparison results are cached in-memory using SHA-256 order-invariant keys (`core/comparisonCache.ts`). Caching occurs at the `compareWithBiasMitigation()` level — not at `comparePair()` — to preserve the full forward+reverse bias mitigation protocol. Only valid results (confidence >= 0.5) are cached; partial failures (null winner, low confidence) are excluded to allow retry on the next encounter. The cache persists across iterations within a single run for cross-iteration deduplication.

### Position Bias in LLM-as-Judge
LLMs exhibit a well-documented tendency to favor whichever text appears first in a comparison prompt. To mitigate this, every pairwise comparison runs twice with reversed presentation order (A-vs-B, then B-vs-A) **concurrently via `Promise.all`** — the two calls are independent and halve wall-clock time per comparison. If both rounds agree on a winner, the result gets full confidence. If they disagree, the result is treated as a low-confidence draw.

### Adaptive Calibration
Calibration uses a batched parallelism strategy with early exit. The first batch of `minOpponents` (default: 2) opponents runs in parallel. If all matches are decisive (confidence >= 0.7), the entrant's rating is considered well-established and remaining opponents are skipped. Otherwise, remaining opponents run in a second parallel batch. This reduces LLM calls by ~40% for clear-cut variants while maintaining accuracy for borderline cases.

### Append-Only Pool
Variants are never removed from the pool during a run. Low-performing variants naturally sink in Elo and become less likely to be selected as parents for evolution. However, they remain available because they may contain novel structural or stylistic elements useful for future crossover operations.

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
// Returns variants sorted by Elo descending — variants[0] is the winner

// 4. Apply the winning variant to the article
await applyWinnerAction({
  explanationId,
  variantId: variants[0].id,
  runId: run.id,
});
// This replaces explanations.content, saves previous content to content_history,
// marks the variant as is_winner=true, and triggers a post-evolution quality eval.

// 5. Rollback if needed
await rollbackEvolutionAction(explanationId, run.id);
```

### Admin UI

The evolution admin page lives at `/admin/quality/evolution` and provides:
- Summary cards (total runs, completion rate, total/avg cost)
- Filterable runs table (by status and date range)
- Variant panel showing Elo-ranked variants with text preview
- Queue dialog for manually queuing runs
- Apply Winner / Rollback buttons
- Cost breakdown chart by agent
- Quality comparison chart (before/after scores from Phase E evaluation)

## Architecture

### Two-Phase Pipeline

The pipeline uses a **PoolSupervisor** (`core/supervisor.ts`) that manages a one-way phase transition:

**EXPANSION** (iterations 0–N): Build a diverse pool of variants
- GenerationAgent creates 3 variants per iteration using three strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance`. **When diversity is low** (below `expansion.diversityThreshold`), all 3 variants use the same strategy (`structural_transform`) to rapidly fill the pool.
- CalibrationRanker runs pairwise comparisons for new entrants against stratified opponents (3 opponents per entrant in this phase).
- ProximityAgent computes diversity score (1 − mean pairwise cosine similarity of top 10 variants).

**Transition** to COMPETITION occurs when **(pool size >= 15 AND diversity >= 0.25) OR iteration >= 8**. The iteration-8 safety cap ensures COMPETITION always starts even if diversity remains low. Transition is **one-way** and locked once triggered — the pipeline never returns to EXPANSION.

**COMPETITION** (iterations N+1 to max): Refine the best variants
- GenerationAgent creates 1 variant using a rotating single strategy per iteration (cycles through the three strategies).
- ReflectionAgent critiques top 3 variants across 5 dimensions: clarity, structure, engagement, precision, coherence. Produces per-dimension scores (1–10), examples, and notes.
- DebateAgent selects the top 2 non-baseline variants by Elo and runs a structured 3-turn debate: Advocate A argues for Variant A, Advocate B rebuts and argues for Variant B, a Judge synthesizes recommendations into JSON. A fourth LLM call generates an improved variant from the judge's recommendations. Consumes ReflectionAgent critiques as optional context. Produces a `debate_synthesis` variant with both debated variants as parents. Gated by `debateEnabled` feature flag. Inspired by Google DeepMind's AI Co-Scientist (arxiv 2502.18864).
- EvolutionAgent creates children from top parents via mutation (clarity/structure), crossover (combine two parents), and creative exploration (30% random chance or when diversity is low — generates a "wild card" variant with completely different approach to prevent pool homogenization).
- Ranking agent: **Tournament** (Swiss-style, default) or **CalibrationRanker** (if `evolution_tournament_enabled` flag is false). Uses 5 opponents per entrant in this phase.
- ProximityAgent continues diversity monitoring.
- MetaReviewAgent analyzes which strategies produce above-average Elo variants, identifies weaknesses in bottom-quartile performers, and flags strategies with consistently negative parent-to-child Elo deltas. This meta-feedback is consumed by GenerationAgent and EvolutionAgent in subsequent iterations to guide prompt construction. No LLM calls — pure computation.

### Two Pipeline Modes

- **`executeFullPipeline`**: Production path. Uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint after each agent, convergence detection, and supervisor state persistence.
- **`executeMinimalPipeline`**: Simplified single-pass mode with no phase transitions. Runs a flat list of agents once. Used for testing and simple one-shot runs.

### Agent Framework

The pipeline orchestrates its phases through specialized agents. Each agent encapsulates one operation (generation, ranking, evolution, etc.) and follows a common execution model.

All agents extend `AgentBase` (`agents/base.ts`):

```typescript
abstract class AgentBase {
  abstract readonly name: string;
  abstract execute(ctx: ExecutionContext): Promise<AgentResult>;
  abstract estimateCost(payload: AgentPayload): number;
  abstract canExecute(state: PipelineState): boolean;
}
```

Every agent receives an `ExecutionContext` containing:
- `payload`: Original text, title, explanation ID, run config
- `state`: Mutable `PipelineState` (pool, Elo ratings, match history, critiques, diversity)
- `llmClient`: Budget-enforced LLM client wrapping `callLLM` (`core/llmClient.ts`)
- `logger`: Structured logger with `{subsystem: 'evolution', runId}` context (`core/logger.ts`)
- `costTracker`: Per-agent and global budget enforcement (`core/costTracker.ts`)
- `comparisonCache`: Order-invariant SHA-256 cache for bias-mitigated comparison results (`core/comparisonCache.ts`)

### Async Parallelism

All agents that make multiple independent LLM calls use `Promise.allSettled()` for concurrent execution with sequential state mutations:
- **GenerationAgent**: 3 strategy calls run in parallel
- **EvolutionAgent**: 3 evolution strategy calls run in parallel
- **ReflectionAgent**: Top-N critique calls run in parallel
- **CalibrationRanker**: Batched parallelism — first `minOpponents` in parallel, then remaining batch. Each comparison's forward+reverse bias rounds also run concurrently via `Promise.all`.
- **Tournament**: All Swiss-round pairs run in parallel within each round. Each comparison's forward+reverse bias rounds also run concurrently via `Promise.all`.

State mutations (pool additions, Elo updates) happen sequentially after all promises resolve. `BudgetExceededError` is explicitly re-thrown from rejected `Promise.allSettled` results to ensure proper pipeline error handling.

### Elo Rating System

Variants are ranked using an Elo rating system (`core/elo.ts`) — a probabilistic rating where higher-rated variants are expected to win against lower-rated ones, and upsets cause larger rating swings:

- **Initial rating**: 1200
- **Floor**: 800 (prevents negative spiral where a variant loses so many points it can never recover)
- **Adaptive K-factor**: Controls how much ratings change per match. K=48 for <5 matches (rapid initial calibration), K=32 for 5–15 matches, K=16 for 15+ matches (stability after many games)
- **Confidence-weighted updates**: When position-bias mitigation produces disagreement between rounds, the confidence score (0.0–1.0) blends the Elo update toward a draw. Full agreement = confidence 1.0 = decisive update. Full disagreement = confidence 0.5 = half-strength update.

### Budget Enforcement

The `CostTracker` (`core/costTracker.ts`) enforces budget at two levels:
- **Per-agent caps**: Configurable percentage of total budget (default: generation 25%, calibration 20%, tournament 25%, evolution 20%, reflection 5%, debate 5%). See Configuration for values.
- **Global cap**: Default $5.00 per run
- **Pre-call reservation with optimistic locking**: Budget is checked *before* every LLM call with a 30% safety margin. Reserved amounts are tracked separately from actual spend (`reservedByAgent` + `totalReserved`) so concurrent parallel calls cannot all pass budget checks. When `recordSpend()` is called after an LLM response, the reservation is released and replaced with actual spend.
- **Pause, not fail**: `BudgetExceededError` pauses the run (status='paused') rather than marking it failed. An admin can increase the budget and resume from the last checkpoint. `BudgetExceededError` is re-thrown through `Promise.allSettled` rejection handling in all agents to ensure propagation to the pipeline orchestrator.

### Checkpoint, Resume, and Error Recovery

State is checkpointed to `evolution_checkpoints` table after every agent execution:
- Full pipeline state serialized to JSON (pool, Elo ratings, match history, critiques, diversity, meta-feedback)
- Supervisor resume state preserved (phase, strategy rotation index, Elo/diversity history)
- Heartbeat updates to `content_evolution_runs` after every agent step

**Error recovery paths:**

| Failure Mode | Pipeline Behavior | Recovery |
|---|---|---|
| Agent throws error | Partial state checkpointed, run marked `failed` | Variants generated before failure are preserved. Queue a new run to retry. |
| Budget exceeded | Run marked `paused`, not `failed` | Admin can increase budget. Batch runner or trigger action loads latest checkpoint and resumes. |
| Runner crashes (no heartbeat) | Watchdog cron marks run `failed` after 10 minutes | Queue a new run. Checkpoint data may allow manual investigation. |
| All variants rejected by format validator | Pool doesn't grow for that iteration | Pipeline continues but may hit degenerate state stop (diversity < 0.01). |

**Resume mechanism**: The batch runner and `triggerEvolutionRunAction` both support loading the latest checkpoint from `evolution_checkpoints.state_snapshot`, deserializing `PipelineState`, and restoring `supervisorState` (phase, rotation index, history) to continue from the next scheduled agent.

### Stopping Conditions

The PoolSupervisor evaluates four stopping conditions at the start of each iteration:

1. **Quality plateau** (COMPETITION only): If the top variant's Elo improves by less than `threshold × 100` Elo points (default: 2 points) over the last `window` iterations (default: 3), the pool has converged and further iterations are unlikely to find improvements.
2. **Budget exhausted**: If available budget drops below $0.01, stop immediately.
3. **Max iterations**: Hard cap at `maxIterations` (default: 15).
4. **Degenerate state**: If diversity score drops below 0.01 during a plateau check, the pool has collapsed to near-identical variants — continuing would waste budget.

### Format Enforcement

All generated variants must pass `validateFormat()` (`agents/formatValidator.ts`):
- Exactly one H1 title on the first line
- At least one section heading (## or ###)
- No bullet points, numbered lists, or tables (outside code fences)
- At least 75% of paragraphs must have 2+ sentences

Controlled by `FORMAT_VALIDATION_MODE` env var:
- `"reject"` (default): Variants failing validation are discarded
- `"warn"`: Validation issues logged but variant accepted — useful during development
- `"off"`: No validation — testing only

## Data Flow

### Full Pipeline Execution

```
1. Run Queued (admin UI or auto-queue cron for articles scoring < 0.4)
   └─ Insert into content_evolution_runs (status='pending')

2. Runner Claims Run (batch script or admin trigger)
   └─ Atomic claim via claim_evolution_run() RPC (fallback: UPDATE WHERE status='pending')
   └─ Initialize: PipelineStateImpl, CostTracker, LLMClient, Logger, Agents

3. Pipeline Loop (up to maxIterations=15)
   ├─ state.startNewIteration() → clears newEntrantsThisIteration
   ├─ Supervisor.beginIteration() → detect/lock phase
   ├─ Supervisor.getPhaseConfig() → which agents run this iteration
   ├─ Supervisor.shouldStop() → check plateau/budget/iterations/degenerate
   │
   ├─ [EXPANSION]
   │   ├─ GenerationAgent → 3 new variants (all strategies, or same strategy if low diversity)
   │   ├─ CalibrationRanker → new entrants vs 3 stratified opponents
   │   └─ ProximityAgent → diversity score update
   │
   ├─ [COMPETITION]
   │   ├─ GenerationAgent → 1 variant (rotating strategy)
   │   ├─ ReflectionAgent → critique top 3 variants (5 dimensions)
   │   ├─ DebateAgent → 3-turn debate on top 2 → synthesis variant
   │   ├─ EvolutionAgent → mutate_clarity, mutate_structure, crossover, creative_exploration
   │   ├─ Tournament or CalibrationRanker → ranking with 5 opponents per entrant
   │   ├─ ProximityAgent → diversity score update
   │   └─ MetaReviewAgent → meta-feedback for next iteration
   │
   └─ Checkpoint after each agent + supervisor state at end-of-iteration

4. Stopping Conditions (checked at iteration start)
   ├─ Quality plateau (top Elo change < 2 points over 3 iterations)
   ├─ Budget exhausted (available < $0.01)
   ├─ Max iterations reached (default: 15)
   └─ Degenerate state (diversity < 0.01 during plateau)

5. Winner Application (admin action via applyWinnerAction)
   ├─ Replaces entire explanations.content column (including H1 title)
   ├─ Previous content saved to content_history (source='evolution_pipeline')
   ├─ Variant marked is_winner=true in content_evolution_variants
   └─ Triggers post-evolution quality eval (fire-and-forget)

   Note: explanation_title column is NOT updated — only content changes.
   This can cause title mismatches if the winning variant's H1 differs.
```

### Agent Interaction Pattern

Each agent reads from and writes to the shared mutable `PipelineState`:

| Agent | Reads | Writes |
|-------|-------|--------|
| GenerationAgent | `originalText`, `metaFeedback` | `pool` (new variants via `addToPool`) |
| CalibrationRanker | `newEntrantsThisIteration`, `pool`, `config.calibration.opponents` | `eloRatings`, `matchCounts`, `matchHistory` |
| Tournament | `pool`, `eloRatings`, `matchCounts`, `config.budgetCapUsd`, `config.calibration.opponents` | `eloRatings`, `matchCounts`, `matchHistory` |
| EvolutionAgent | `pool` (top by Elo), `metaFeedback`, `diversityScore` | `pool` (child variants via `addToPool`) |
| ReflectionAgent | `pool` (top 3 by Elo) | `allCritiques`, `dimensionScores` |
| DebateAgent | `pool` (top 2 non-baseline by Elo), `allCritiques` | `pool` (debate_synthesis variant via `addToPool`), `debateTranscripts` |
| ProximityAgent | `pool`, `newEntrantsThisIteration` | `similarityMatrix`, `diversityScore` |
| MetaReviewAgent | `pool`, `eloRatings`, `diversityScore` | `metaFeedback` |

**State lifecycle notes:**
- `newEntrantsThisIteration`: Populated by `addToPool()` whenever a variant enters the pool. Cleared by `startNewIteration()` at the top of each iteration loop.
- `metaFeedback`: Written by MetaReviewAgent at end of COMPETITION iterations. Read by GenerationAgent and EvolutionAgent in the *next* iteration to steer prompt construction.
- `debateTranscripts`: Appended by DebateAgent after each debate (including partial transcripts on failure). Serialized to checkpoints for debugging and observability.
- All pool mutations go through `PipelineStateImpl.addToPool()`, which enforces deduplication via `poolIds` Set and initializes Elo to 1200.

## Edge Cases & Guards

### Minimum Pool Size
- **CalibrationRanker**: Requires `pool.length >= 2` (`canExecute` guard). Skipped on first iteration if GenerationAgent produced < 2 variants.
- **Tournament**: Requires `pool.length >= 2`.
- **EvolutionAgent**: Requires `pool.length >= 1` and `eloRatings.size >= 1`. Crossover requires 2 parents — falls back to mutation if only 1 parent available.
- **DebateAgent**: Requires 2+ non-baseline variants with Elo ratings. Baselines (`original_baseline` strategy) are excluded from both `canExecute` and parent selection.
- **ProximityAgent**: Requires `pool.length >= 2`.

### Format Validation Failures
If ALL generated variants fail format validation in an iteration, the pool doesn't grow. The pipeline continues but may accumulate empty iterations. If diversity drops below 0.01 in COMPETITION, the degenerate state stop condition fires.

### Budget Edge Cases
- Budget of $0: Stops immediately at the first `shouldStop()` check (available < $0.01).
- Budget exhausted mid-agent: `BudgetExceededError` thrown before the LLM call. Partial state checkpointed. Run paused.

### Short Articles
No minimum article length enforced. GenerationAgent checks `state.originalText.length > 0` but will attempt generation on very short text. Short articles produce short variants that may fail format validation (< 2 sentences per paragraph).

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
  budgetCaps: {          // Per-agent % of budgetCapUsd — see Budget Enforcement
    generation: 0.25,
    calibration: 0.20,
    tournament: 0.25,
    evolution: 0.20,
    reflection: 0.05,
    debate: 0.05,
  },
  useEmbeddings: false,
  judgeModel: 'gpt-4.1-nano',    // Cheap model for A/B comparison judgments
  generationModel: 'gpt-4.1-mini', // Model for text generation tasks
}
```

Per-run overrides stored in `content_evolution_runs.config` (JSONB). Merged via `resolveConfig()` with deep spread for nested objects.

## Feature Flags

Four flags are managed by the evolution feature flag system (`core/featureFlags.ts`) and stored in the `feature_flags` table:

| Flag | Default | Effect |
|------|---------|--------|
| `evolution_tournament_enabled` | `true` | When `false`, CalibrationRanker used in COMPETITION instead of Tournament |
| `evolution_evolve_pool_enabled` | `true` | When `false`, EvolutionAgent skipped entirely |
| `evolution_dry_run_only` | `false` | When `true`, pipeline logs only — no LLM calls |
| `evolution_debate_enabled` | `true` | When `false`, DebateAgent skipped in COMPETITION phase |

Additionally, the quality eval cron (`src/app/api/cron/content-quality-eval/route.ts`) checks a separate `evolution_pipeline_enabled` flag directly from the `feature_flags` table to gate auto-queuing of low-scoring articles. This flag is **not** part of the `EvolutionFeatureFlags` interface — it is read independently by the cron endpoint.

## Key Files

### Core Infrastructure (`src/lib/evolution/core/`)
| File | Purpose |
|------|---------|
| `pipeline.ts` | Pipeline orchestrator — `executeMinimalPipeline` (testing) and `executeFullPipeline` (production) |
| `supervisor.ts` | `PoolSupervisor` — EXPANSION→COMPETITION transitions, phase config, stopping conditions |
| `state.ts` | `PipelineStateImpl` — mutable state with append-only pool, serialization/deserialization for checkpoints |
| `elo.ts` | Stateless Elo rating functions: `updateEloRatings`, `updateEloDraw`, `updateEloWithConfidence` |
| `costTracker.ts` | `CostTrackerImpl` — per-agent budget attribution, pre-call reservation with optimistic locking and 30% margin |
| `comparisonCache.ts` | `ComparisonCache` — order-invariant SHA-256 cache for bias-mitigated comparison results |
| `pool.ts` | `PoolManager` — stratified opponent selection (Elo quartile-based) and pool health statistics |
| `diversityTracker.ts` | `PoolDiversityTracker` — lineage dominance detection, strategy diversity analysis, trend computation |
| `validation.ts` | State contract guards: `validateStateContracts` checks phase prerequisites (Elo populated, matches exist, etc.) |
| `llmClient.ts` | `createEvolutionLLMClient` — wraps `callLLM` with budget enforcement and structured JSON output parsing |
| `logger.ts` | `createEvolutionLogger` — factory adding `{subsystem: 'evolution', runId}` to all log entries |
| `featureFlags.ts` | Reads `feature_flags` table for tournament/evolvePool/dryRun/debate toggles with safe defaults |

### Agents (`src/lib/evolution/agents/`)
| File | Purpose |
|------|---------|
| `base.ts` | Abstract `AgentBase` class defining execute/estimateCost/canExecute contract |
| `generationAgent.ts` | Creates 3 variants per iteration using structural_transform, lexical_simplify, grounding_enhance strategies |
| `calibrationRanker.ts` | Pairwise comparison for new entrants against stratified opponents with position-bias mitigation |
| `pairwiseRanker.ts` | Full pairwise comparison with simple (A/B/TIE) and structured (5-dimension scoring) modes |
| `tournament.ts` | Swiss-style tournament — budget-adaptive depth, multi-turn tiebreakers for top-quartile close matches, convergence detection |
| `evolvePool.ts` | Genetic evolution — mutation (clarity/structure), crossover (two parents), creative exploration (30% wild card) |
| `reflectionAgent.ts` | Dimensional critique of top 3 variants: per-dimension scores 1–10, good/bad examples, improvement notes |
| `debateAgent.ts` | Structured 3-turn debate (Advocate A / Advocate B / Judge) over top 2 non-baseline variants by Elo, produces `debate_synthesis` variant. 4 sequential LLM calls. Consumes ReflectionAgent critiques. COMPETITION only. |
| `metaReviewAgent.ts` | Analyzes strategy performance, detects weaknesses in bottom-quartile variants, recommends priority improvements (computation-only, no LLM calls) |
| `proximityAgent.ts` | Computes cosine similarity between variant embeddings, maintains sparse similarity matrix, derives pool diversity score |
| `formatRules.ts` | Shared prose-only format rules injected into all text-generation prompts |
| `formatValidator.ts` | Validates generated text against format rules; controlled by `FORMAT_VALIDATION_MODE` env var |

### Integration Points (outside `src/lib/evolution/`)
| File | Purpose |
|------|---------|
| `src/lib/services/evolutionActions.ts` | 8 server actions: queue, trigger, get runs/variants, apply winner, rollback, cost breakdown, history |
| `src/app/admin/quality/evolution/page.tsx` | Admin UI: run management, variant preview, apply/rollback, cost/quality charts |
| `scripts/evolution-runner.ts` | Batch runner: claims pending runs, executes full pipeline, 60-second heartbeat, graceful SIGTERM/SIGINT shutdown |
| `scripts/run-evolution-local.ts` | Standalone CLI for running evolution on a local markdown file — bypasses Next.js imports, supports mock and real LLM modes, auto-persists to Supabase when env vars are available. Preserves pipeline-generated variant UUIDs and `parent_variant_id` on insert so dashboard IDs match CLI output. Writes each LLM call to `llmCallTracking` for budget tab visualization. |
| `src/app/api/cron/evolution-watchdog/route.ts` | Marks stale runs (heartbeat > 10min) as failed — runs every 15 minutes |
| `src/app/api/cron/content-quality-eval/route.ts` | Auto-queues articles scoring < 0.4 for evolution (max 5 per cron, budget $3.00 each) |
| `src/lib/services/contentQualityActions.ts` | `getEvolutionComparisonAction` — partitions quality scores into before/after by evolution timestamp |
| `.github/workflows/evolution-batch.yml` | Weekly batch (Mondays 4am UTC), manual dispatch with `--max-runs` and `--dry-run` inputs |

### Database Tables
| Table | Purpose |
|-------|---------|
| `content_evolution_runs` | Run lifecycle: status, phase, budget, iterations, heartbeat, timing, runner_id. `explanation_id` is nullable (allows CLI runs without an explanation). `source` column distinguishes origin: `'explanation'` for production runs, `'local:<filename>'` for CLI runs (migration `20260131000008`) |
| `content_evolution_variants` | Persisted variants with Elo scores, generation, parent lineage, is_winner flag |
| `evolution_checkpoints` | Full state snapshots (JSONB) keyed by run_id + iteration + last_agent |
| `feature_flags` | Three evolution flags seeded by migration `20260131000007` |

## Observability

- **OpenTelemetry spans** (distributed tracing segments viewable in Grafana/Honeycomb): `evolution.pipeline.full`, `evolution.iteration`, `evolution.agent.{name}` — each carries attributes for cost, variant count, phase, and timing
- **Structured logging**: Every log entry includes `{subsystem: 'evolution', runId, agentName}` for filtering
- **DB heartbeat**: `last_heartbeat` column updated after each agent execution, monitored by watchdog cron
- **Cost attribution**: Per-agent spend tracked in `CostTracker`, surfaced in admin UI cost breakdown chart via `getEvolutionCostBreakdownAction`. CLI runs also write to `llmCallTracking` with `call_source = 'evolution_{agentName}'` so the budget tab's burn curve and agent breakdown charts work for local runs.

## Production Deployment

### Database Setup
1. Run evolution migrations (`20260131000001` through `20260131000008`)
2. The `claim_evolution_run` RPC function is referenced but not yet created — the batch runner has a fallback using `UPDATE WHERE status='pending'` with optimistic locking

### Batch Runner
```bash
# Local execution
npx tsx scripts/evolution-runner.ts --max-runs 5
npx tsx scripts/evolution-runner.ts --dry-run  # Log-only mode

# GitHub Actions (automatic)
# .github/workflows/evolution-batch.yml — runs Mondays 4am UTC
# Manual dispatch available with max-runs and dry-run inputs
# Timeout: 7 hours, concurrency group prevents parallel runs
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables.

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
```

Auto-persists to Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. Runs are tracked with `source='local:<filename>'` and `explanation_id=NULL`. Pass `--explanation-id N` to link a run to an existing explanation.

### Monitoring
- **Watchdog cron**: `/api/cron/evolution-watchdog` runs every 15 minutes, marks stale runs as failed
- **Stale run query**: `SELECT * FROM content_evolution_runs WHERE status='failed' AND error_message LIKE '%Stale%'`
- **Cost tracking**: `getEvolutionCostBreakdownAction` aggregates LLM costs by agent name
- **Quality impact**: `getEvolutionComparisonAction` computes before/after quality score deltas

## Testing

Unit tests exist for all agents and core modules:
- `agents/*.test.ts` — Agent execution with mock LLM clients (`createMockEvolutionLLMClient`)
- `core/*.test.ts` — State serialization, Elo math, cost tracker, supervisor transitions, diversity tracker, feature flags
- `src/__tests__/integration/evolution-actions.integration.test.ts` — Full action integration tests with real Supabase (auto-skips if evolution tables not migrated)
- `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts` — Admin UI E2E tests (Playwright)
- `src/testing/utils/evolution-test-helpers.ts` — Shared factories: `createMockEvolutionLLMClient`, `createTestEvolutionRun`, `createTestVariant`, `evolutionTablesExist`, `cleanupEvolutionData`

## Related Documentation

- [Search & Generation Pipeline](./search_generation_pipeline.md) — Compare pipeline orchestration patterns; evolution operates on articles produced by this pipeline
- [Testing Setup](./testing_setup.md) — Running evolution unit and integration tests; mock patterns
- [Admin Panel](./admin_panel.md) — Evolution UI walkthrough at `/admin/quality/evolution`
- [Metrics & Analytics](./metrics_analytics.md) — Cost tracking and LLM call attribution
- [Request Tracing & Observability](./request_tracing_observability.md) — OpenTelemetry span details for debugging evolution runs
