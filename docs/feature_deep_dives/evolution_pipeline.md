# Evolution Pipeline

## Overview

The evolution pipeline is an autonomous content improvement system that iteratively generates, competes, and refines text variations of existing articles using LLM-driven agents. It operates as a self-contained subsystem under `src/lib/evolution/` with its own agent framework, OpenSkill Bayesian rating system, budget enforcement, and checkpoint/resume capability.

The pipeline uses an evolutionary algorithm metaphor: a pool of text variants competes via LLM-judged pairwise comparisons, top performers reproduce via mutation and crossover, and the population converges toward higher quality through iterative selection pressure.

```
Article Text → EXPANSION phase (grow pool) → COMPETITION phase (refine pool) → Winner Applied
                 │                              │
                 ├─ GenerationAgent              ├─ GenerationAgent (focused strategy)
                 ├─ CalibrationRanker            ├─ OutlineGenerationAgent* (outline→expand→polish)
                 ├─ ProximityAgent               ├─ ReflectionAgent (critique top 3)
                 │                              ├─ IterativeEditingAgent (critique→edit→judge)
                 │                              ├─ SectionDecompositionAgent (H2 section-level edits)
                 │                              ├─ DebateAgent (structured 3-turn debate)
                 │                              ├─ EvolutionAgent (mutate/crossover)
                 │                              ├─ CalibrationRanker or Tournament
                 │                              ├─ ProximityAgent (diversity tracking)
                 │                              └─ MetaReviewAgent (meta-feedback)
```
\* OutlineGenerationAgent gated by `evolution_outline_generation_enabled` feature flag (default: `false`). See [Outline-Based Generation](./outline_based_generation_editing.md).

## Key Concepts

### OpenSkill Bayesian Rating System
Variants are rated using an OpenSkill (Weng-Lin Bayesian) rating system (`core/rating.ts`) where each variant has a `{mu, sigma}` pair: `mu` is the estimated skill and `sigma` is the uncertainty. New variants start at `mu=25, sigma=8.333`. After each pairwise comparison, the winner's `mu` increases and the loser's decreases, while both sigmas shrink (uncertainty decreases). The **ordinal** (`mu - 3*sigma`) provides a conservative skill estimate used for ranking — it penalizes variants with few matches (high sigma). The system converges when all sigmas fall below a threshold (default: 3.0). For backward compatibility with the existing `elo_score` DB column (0-3000 range), ordinal values are mapped via `ordinalToEloScale()`.

### Swiss-Style Tournament (Info-Theoretic Pairing)
A pairing strategy that maximizes information gain per comparison. Instead of greedy adjacent matching after ordinal sort, candidate pairs are scored by three factors: (1) **outcome uncertainty** — how close to 50/50 the expected result is (from ordinal gap), (2) **sigma** — the real Bayesian uncertainty from the rating, giving priority to under-tested variants whose ratings are still uncertain, and (3) **top-K boost** — a 1.5x multiplier when both variants are in the top third of the pool, since accurate ranking at the top matters most. Pairs are selected greedily by descending score, skipping already-played and already-used variants. Convergence is sigma-based: the tournament stops when all variant sigmas fall below the convergence threshold (default: 3.0).

### Stratified Opponent Selection
For calibrating new entrants, opponents are drawn from different ordinal tiers rather than randomly. For n=5 opponents: 2 from the top quartile, 2 from the middle, and 1 from the bottom or fellow new entrants. This ensures a new variant is tested against both strong and weak competitors, producing a more accurate initial rating.

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
- Apply Winner / Rollback buttons
- Cost breakdown chart by agent
- Quality comparison chart (before/after scores from Phase E evaluation)

## Architecture

### Two-Phase Pipeline

The pipeline uses a **PoolSupervisor** (`core/supervisor.ts`) that manages a one-way phase transition:

**EXPANSION** (iterations 0–N): Build a diverse pool of variants
- GenerationAgent creates 3 variants per iteration using three strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance`. **Note:** The supervisor prepares a strategy payload that collapses to a single strategy when diversity is low, but the current `GenerationAgent` implementation always uses its own hardcoded `STRATEGIES` constant — the supervisor's strategy routing is not yet consumed.
- CalibrationRanker runs pairwise comparisons for new entrants against stratified opponents (3 opponents per entrant in this phase).
- ProximityAgent computes diversity score (1 − mean pairwise cosine similarity of top 10 variants).

**Transition** to COMPETITION occurs when **(pool size >= 15 AND diversity >= 0.25) OR iteration >= 8**. The iteration-8 safety cap ensures COMPETITION always starts even if diversity remains low. Transition is **one-way** and locked once triggered — the pipeline never returns to EXPANSION.

**COMPETITION** (iterations N+1 to max): Refine the best variants
- GenerationAgent creates 3 variants per iteration (same as EXPANSION). **Note:** The supervisor prepares a rotating single-strategy payload for COMPETITION, but the current `GenerationAgent` does not consume it — it always generates all 3 strategies. This is a known gap between the supervisor's design intent and the agent's implementation.
- OutlineGenerationAgent (if enabled) creates 1 outline-based variant via a 6-call pipeline: outline → score → expand → score → polish → score → verify. Each step scored independently (0-1). Produces `OutlineVariant` with step-level metadata. Gated by `outlineGenerationEnabled` feature flag. See [Outline-Based Generation](./outline_based_generation_editing.md).
- ReflectionAgent critiques top 3 variants across 5 dimensions: clarity, structure, engagement, precision, coherence. Produces per-dimension scores (1–10), examples, and notes.
- IterativeEditingAgent takes the top variant by ordinal, identifies weaknesses from ReflectionAgent critiques and open-ended review, generates surgical edits, and gates each edit via blind diff-based LLM comparison with direction-reversal bias mitigation. Only edits that pass the blind judge are added to the pool. Gated by `iterativeEditingEnabled` feature flag. See [Iterative Editing Agent](./iterative_editing_agent.md) for details.
- DebateAgent selects the top 2 non-baseline variants by ordinal and runs a structured 3-turn debate: Advocate A argues for Variant A, Advocate B rebuts and argues for Variant B, a Judge synthesizes recommendations into JSON. A fourth LLM call generates an improved variant from the judge's recommendations. Consumes ReflectionAgent critiques as optional context. Produces a `debate_synthesis` variant with both debated variants as parents. Gated by `debateEnabled` feature flag. Inspired by Google DeepMind's AI Co-Scientist (arxiv 2502.18864).
- EvolutionAgent creates children from top parents via mutation (clarity/structure), crossover (combine two parents), and creative exploration (30% random chance or when diversity < 0.5 — generates a "wild card" variant with completely different approach to prevent pool homogenization).
- Ranking agent: **Tournament** (Swiss-style, default) or **CalibrationRanker** (if `evolution_tournament_enabled` flag is false). Uses 5 opponents per entrant in this phase.
- ProximityAgent continues diversity monitoring.
- MetaReviewAgent analyzes which strategies produce above-average ordinal variants, identifies weaknesses in bottom-quartile performers, and flags strategies with consistently negative parent-to-child ordinal deltas. This meta-feedback is consumed by GenerationAgent and EvolutionAgent in subsequent iterations to guide prompt construction. No LLM calls — pure computation.

### Two Pipeline Modes

- **`executeFullPipeline`**: Production path. Uses PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint after each agent, convergence detection, and supervisor state persistence. Used by admin trigger, cron runner, batch runner, standalone runner, and local CLI `--full` mode. All callsites use `createDefaultAgents()` for consistent 12-agent construction and `finalizePipelineRun()` for shared post-completion persistence.
- **`executeMinimalPipeline`**: Simplified single-pass mode with no phase transitions. Runs a caller-provided list of agents once. Used for testing, custom agent sequences, and the local CLI runner (`run-evolution-local.ts`) default mode (generation + calibration only).

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
- `state`: Mutable `PipelineState` (pool, OpenSkill ratings, match history, critiques, diversity)
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

State mutations (pool additions, rating updates) happen sequentially after all promises resolve. `BudgetExceededError` is explicitly re-thrown from rejected `Promise.allSettled` results to ensure proper pipeline error handling.

### Rating Updates

Rating updates use the OpenSkill pairwise functions (`core/rating.ts`):

- **`updateRating(winner, loser)`**: Updates both ratings after a decisive match. Winner's mu increases, loser's decreases, both sigmas shrink.
- **`updateDraw(a, b)`**: Updates both ratings toward each other (used for low-confidence comparisons).
- **Confidence-weighted updates**: When position-bias mitigation produces disagreement between rounds, the confidence score determines whether `updateRating` (confidence >= 0.7) or `updateDraw` (confidence < 0.7) is applied. Full agreement = decisive update. Disagreement = draw.
- **Sigma-based convergence**: Unlike Elo's fixed K-factor, OpenSkill automatically adjusts update magnitude via sigma decay. High-sigma (uncertain) variants see larger updates; low-sigma (well-tested) variants see smaller updates.

### Budget Enforcement

The `CostTracker` (`core/costTracker.ts`) enforces budget at two levels:
- **Per-agent caps**: Configurable percentage of total budget (default: generation 20%, calibration 15%, tournament 20%, evolution 10%, reflection 5%, debate 5%, iterativeEditing 5%, treeSearch 10%, outlineGeneration 10%, sectionDecomposition 10%). Per-agent caps intentionally sum to >1.0 (1.10) because not all agents run every iteration. See Configuration for values.
- **Global cap**: Default $5.00 per run
- **Pre-call reservation with FIFO queue**: Budget is checked *before* every LLM call with a 30% safety margin. Reservations are tracked in a FIFO queue (`reservationQueue`) so concurrent parallel calls cannot all pass budget checks. When `recordSpend()` is called after an LLM response, the oldest reservation is dequeued and replaced with actual spend. `getAvailableBudget()` subtracts both spent and reserved amounts.
- **Pause, not fail**: `BudgetExceededError` pauses the run (status='paused') rather than marking it failed. An admin can increase the budget and resume from the last checkpoint. `BudgetExceededError` is re-thrown through `Promise.allSettled` rejection handling in all agents to ensure propagation to the pipeline orchestrator.

### Checkpoint, Resume, and Error Recovery

State is checkpointed to `evolution_checkpoints` table after every agent execution:
- Full pipeline state serialized to JSON (pool, ratings, match history, critiques, diversity, meta-feedback)
- Supervisor resume state preserved (phase, strategy rotation index, ordinal/diversity history). **Note:** `ordinalHistory` and `diversityHistory` are cleared when EXPANSION→COMPETITION transition occurs, so these arrays only track COMPETITION phase metrics.
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

1. **Quality plateau** (COMPETITION only): If the top variant's ordinal improves by less than `threshold × 6` ordinal points (default: 0.12) over the last `window` iterations (default: 3), the pool has converged and further iterations are unlikely to find improvements.
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
   └─ Insert baseline variant (original text at Elo 1200)

3. Pipeline Loop (up to maxIterations=15)
   ├─ state.startNewIteration() → clears newEntrantsThisIteration
   ├─ Supervisor.beginIteration() → detect/lock phase
   ├─ Supervisor.getPhaseConfig() → which agents run this iteration
   ├─ Supervisor.shouldStop() → check plateau/budget/iterations/degenerate
   │
   ├─ [EXPANSION]
   │   ├─ GenerationAgent → 3 new variants (all 3 strategies)
   │   ├─ CalibrationRanker → new entrants vs 3 stratified opponents
   │   └─ ProximityAgent → diversity score update
   │
   ├─ [COMPETITION]
   │   ├─ GenerationAgent → 3 new variants (all 3 strategies)
   │   ├─ OutlineGenerationAgent* → 1 outline variant (6-call pipeline, step scores)
   │   ├─ ReflectionAgent → critique top 3 variants (5 dimensions)
   │   ├─ IterativeEditingAgent → critique→edit→judge on top variant → accepted edits
   │   ├─ SectionDecompositionAgent → parse H2 sections, parallel edit, stitch → stitched variant
   │   ├─ DebateAgent → 3-turn debate on top 2 → synthesis variant
   │   ├─ EvolutionAgent → mutate_clarity, mutate_structure, crossover, creative_exploration
   │   ├─ Tournament or CalibrationRanker → ranking with 5 opponents per entrant
   │   ├─ ProximityAgent → diversity score update
   │   └─ MetaReviewAgent → meta-feedback for next iteration
   │
   └─ Checkpoint after each agent + supervisor state at end-of-iteration

4. Stopping Conditions (checked at iteration start)
   ├─ Quality plateau (top ordinal change < 0.12 over 3 iterations)
   ├─ Budget exhausted (available < $0.01)
   ├─ Max iterations reached (default: 15)
   └─ Degenerate state (diversity < 0.01 during plateau)

5. Pipeline Completion
   ├─ Build EvolutionRunSummary via buildRunSummary()
   ├─ Validate with Zod schema (non-fatal — null on failure)
   ├─ Persist run_summary to content_evolution_runs (JSONB)
   └─ Persist all variants to content_evolution_variants for admin UI

6. Winner Application (admin action via applyWinnerAction)
   ├─ Replaces entire explanations.content column (including H1 title)
   ├─ Previous content saved to content_history (source='evolution_pipeline')
   ├─ Variant marked is_winner=true in content_evolution_variants
   └─ Triggers post-evolution quality eval (fire-and-forget, gated by
      content_quality_eval_enabled feature flag — silently skips if disabled)

   Note: explanation_title column is NOT updated — only content changes.
   This can cause title mismatches if the winning variant's H1 differs.
```

### Agent Interaction Pattern

Each agent reads from and writes to the shared mutable `PipelineState`:

| Agent | Reads | Writes |
|-------|-------|--------|
| GenerationAgent | `originalText`, `metaFeedback` | `pool` (new variants via `addToPool`) |
| CalibrationRanker | `newEntrantsThisIteration`, `pool`, `config.calibration.opponents` | `ratings`, `matchCounts`, `matchHistory` |
| Tournament | `pool`, `ratings`, `matchCounts`, `config.budgetCapUsd`, `config.calibration.opponents` | `ratings`, `matchCounts`, `matchHistory` |
| EvolutionAgent | `pool` (top by ordinal), `metaFeedback`, `diversityScore` | `pool` (child variants via `addToPool`) |
| ReflectionAgent | `pool` (top 3 by ordinal) | `allCritiques`, `dimensionScores` |
| IterativeEditingAgent | `pool` (top 1 by ordinal), `allCritiques`, `ratings` | `pool` (critique_edit variants via `addToPool`) |
| SectionDecompositionAgent | `pool` (top 1 by ordinal), `allCritiques`, `ratings` | `pool` (section_edited variants via `addToPool`), `sectionState` |
| DebateAgent | `pool` (top 2 non-baseline by ordinal), `allCritiques` | `pool` (debate_synthesis variant via `addToPool`), `debateTranscripts` |
| TreeSearchAgent | `pool` (top by μ), `allCritiques`, `ratings` | `pool` (tree_search_* variant via `addToPool`), `treeSearchResults`, `treeSearchStates` |
| ProximityAgent | `pool`, `newEntrantsThisIteration` | `similarityMatrix`, `diversityScore` |
| OutlineGenerationAgent | `originalText`, config (`generationModel`, `judgeModel`) | `pool` (OutlineVariant with steps, outline, weakestStep) |
| MetaReviewAgent | `pool`, `ratings`, `diversityScore` | `metaFeedback` |

**State lifecycle notes:**
- `newEntrantsThisIteration`: Populated by `addToPool()` whenever a variant enters the pool. Cleared by `startNewIteration()` at the top of each iteration loop.
- `metaFeedback`: Written by MetaReviewAgent at end of COMPETITION iterations. Read by GenerationAgent and EvolutionAgent in the *next* iteration to steer prompt construction.
- `debateTranscripts`: Appended by DebateAgent after each debate (including partial transcripts on failure). Serialized to checkpoints for debugging and observability.
- All pool mutations go through `PipelineStateImpl.addToPool()`, which enforces deduplication via `poolIds` Set and initializes a default OpenSkill rating (`mu=25, sigma=8.333`).

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

## Edge Cases & Guards

### Minimum Pool Size
- **CalibrationRanker**: Requires `pool.length >= 2` (`canExecute` guard). Skipped on first iteration if GenerationAgent produced < 2 variants.
- **Tournament**: Requires `pool.length >= 2`.
- **EvolutionAgent**: Requires `pool.length >= 1` and `ratings.size >= 1`. Crossover requires 2 parents — falls back to mutation if only 1 parent available.
- **DebateAgent**: Requires 2+ non-baseline variants with ratings. Baselines (`original_baseline` strategy) are excluded from both `canExecute` and parent selection.
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
  budgetCaps: {          // Per-agent % of budgetCapUsd — intentionally sums to >1.0
    generation: 0.20,
    calibration: 0.15,
    tournament: 0.20,
    evolution: 0.10,
    reflection: 0.05,
    debate: 0.05,
    iterativeEditing: 0.05,
    treeSearch: 0.10,
    outlineGeneration: 0.10,
    sectionDecomposition: 0.10,
  },
  useEmbeddings: false,
  judgeModel: 'gpt-4.1-nano',    // Cheap model for A/B comparison judgments
  generationModel: 'gpt-4.1-mini', // Model for text generation tasks
}
```

Per-run overrides stored in `content_evolution_runs.config` (JSONB). Merged via `resolveConfig()` with deep spread for nested objects.

## Feature Flags

Six flags are managed by the evolution feature flag system (`core/featureFlags.ts`) and stored in the `feature_flags` table:

| Flag | Default | Effect |
|------|---------|--------|
| `evolution_tournament_enabled` | `true` | When `false`, CalibrationRanker used in COMPETITION instead of Tournament |
| `evolution_evolve_pool_enabled` | `true` | When `false`, EvolutionAgent skipped entirely |
| `evolution_dry_run_only` | `false` | When `true`, pipeline logs only — no LLM calls |
| `evolution_debate_enabled` | `true` | When `false`, DebateAgent skipped in COMPETITION phase |
| `evolution_iterative_editing_enabled` | `true` | When `false`, IterativeEditingAgent skipped in COMPETITION phase |
| `evolution_outline_generation_enabled` | `false` | When `true`, OutlineGenerationAgent runs in COMPETITION phase. See [Outline-Based Generation](./outline_based_generation_editing.md) |
| `evolution_tree_search_enabled` | `false` | When `true`, TreeSearchAgent runs in COMPETITION phase (mutually exclusive with IterativeEditingAgent) |
| `evolution_section_decomposition_enabled` | `true` | When `false`, SectionDecompositionAgent skipped in COMPETITION phase |

Additionally, the quality eval cron (`src/app/api/cron/content-quality-eval/route.ts`) checks a separate `evolution_pipeline_enabled` flag directly from the `feature_flags` table to gate auto-queuing of low-scoring articles. This flag is **not** part of the `EvolutionFeatureFlags` interface — it is read independently by the cron endpoint.

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
| `logger.ts` | `createEvolutionLogger` — factory adding `{subsystem: 'evolution', runId}` to all log entries |
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
| `reflectionAgent.ts` | Dimensional critique of top 3 variants: per-dimension scores 1–10, good/bad examples, improvement notes |
| `iterativeEditingAgent.ts` | Critique-driven surgical edits on top variant with blind diff-based LLM judge and direction-reversal bias mitigation. Produces `critique_edit_*` variants. Consumes ReflectionAgent critiques. COMPETITION only. |
| `treeSearchAgent.ts` | Beam search tree-of-thought revisions. Explores K×B×D revision candidates across multiple dimensions, hybrid two-stage evaluation (parent-relative diff filter + sibling mini-tournament). Produces `tree_search_*` variants. Mutually exclusive with IterativeEditingAgent. COMPETITION only. See [tree_of_thought_revisions.md](./tree_of_thought_revisions.md). |
| `sectionDecompositionAgent.ts` | Decomposes top variant into H2 sections, applies parallel critique→edit→judge loops per section, stitches results. Produces `section_edited_*` variants. Consumes ReflectionAgent critiques. COMPETITION only. See also `section/*.ts` utilities. |
| `debateAgent.ts` | Structured 3-turn debate (Advocate A / Advocate B / Judge) over top 2 non-baseline variants by ordinal, produces `debate_synthesis` variant. 4 sequential LLM calls. Consumes ReflectionAgent critiques. COMPETITION only. |
| `outlineGenerationAgent.ts` | Outline-based generation: 6-call pipeline (outline → score → expand → score → polish → score) with per-step scoring. Produces `OutlineVariant` with step metadata. See [Outline-Based Generation](./outline_based_generation_editing.md) |
| `metaReviewAgent.ts` | Analyzes strategy performance via ordinal analysis, detects weaknesses in bottom-quartile variants, recommends priority improvements (computation-only, no LLM calls) |
| `proximityAgent.ts` | Computes cosine similarity between variant embeddings, maintains sparse similarity matrix, derives pool diversity score |
| `formatRules.ts` | Shared prose-only format rules injected into all text-generation prompts |
| `formatValidator.ts` | Validates generated text against format rules; controlled by `FORMAT_VALIDATION_MODE` env var |

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

### Integration Points (outside `src/lib/evolution/`)
| File | Purpose |
|------|---------|
| `src/lib/services/evolutionActions.ts` | 9 server actions: queue, trigger, get runs/variants/summary, apply winner, rollback, cost breakdown, history |
| `src/app/admin/quality/evolution/page.tsx` | Admin UI: run management, variant preview, apply/rollback, cost/quality charts |
| `scripts/evolution-runner.ts` | Batch runner: claims pending runs, executes full pipeline, 60-second heartbeat, graceful SIGTERM/SIGINT shutdown |
| `scripts/run-evolution-local.ts` | Standalone CLI for running evolution on a local markdown file — bypasses Next.js imports, supports mock and real LLM modes, auto-persists to Supabase when env vars are available. Preserves pipeline-generated variant UUIDs and `parent_variant_id` on insert so dashboard IDs match CLI output. Writes each LLM call to `llmCallTracking` for budget tab visualization. |
| `src/app/api/cron/evolution-runner/route.ts` | Background runner: polls for pending runs, executes full pipeline with all 9 agents, 30-second heartbeat. Requires Vercel cron config or external trigger to activate. |
| `src/app/api/cron/evolution-watchdog/route.ts` | Marks stale runs (heartbeat > 10min) as failed — runs every 15 minutes |
| `src/app/api/cron/content-quality-eval/route.ts` | Auto-queues articles scoring < 0.4 for evolution (max 5 per cron, budget $3.00 each) |
| `src/lib/services/contentQualityActions.ts` | `getEvolutionComparisonAction` — partitions quality scores into before/after by evolution timestamp |
| `scripts/run-prompt-bank.ts` | Batch generation across prompts × methods with coverage matrix, resume support, and evolution child process spawning |
| `scripts/run-prompt-bank-comparisons.ts` | Batch all-pairs comparisons for all prompt bank topics with bias mitigation and Elo updates |
| `scripts/run-bank-comparison.ts` | Single-topic pairwise comparison CLI with leaderboard output |
| `scripts/add-to-bank.ts` | Adds evolution run winner (and optionally baseline) to article bank |
| `scripts/lib/bankUtils.ts` | Shared article bank insertion logic: topic upsert, entry insert, Elo initialization, elo_per_dollar |
| `scripts/lib/oneshotGenerator.ts` | Shared oneshot article generation with multi-provider support (DeepSeek, OpenAI, Anthropic) |
| `src/config/promptBankConfig.ts` | Prompt bank configuration: 5 prompts (easy/medium/hard), 6 generation methods (3 oneshot + 1 minimal evolution + 1 outline evolution + 1 tree-search evolution), comparison settings |
| `.github/workflows/evolution-batch.yml` | Weekly batch (Mondays 4am UTC), manual dispatch with `--max-runs` and `--dry-run` inputs |

### Database Tables
| Table | Purpose |
|-------|---------|
| `content_evolution_runs` | Run lifecycle: status, phase, budget, iterations, heartbeat, timing, runner_id. `explanation_id` is nullable (allows CLI runs without an explanation, migration `20260131000008`). `source` column distinguishes origin: `'explanation'` for production runs, `'local:<filename>'` for CLI runs. `run_summary` JSONB column stores `EvolutionRunSummary` with GIN index (migration `20260131000010`) |
| `content_evolution_variants` | Persisted variants with elo_score (mapped from ordinal via `ordinalToEloScale`), generation, parent lineage, is_winner flag. `explanation_id` is nullable (migration `20260131000009`) |
| `evolution_checkpoints` | Full state snapshots (JSONB) keyed by run_id + iteration + last_agent |
| `feature_flags` | Four evolution flags seeded by migration `20260131000007` |
| `article_bank_topics` | Prompt bank topics with unique case-insensitive prompt matching (migration `20260201000001`) |
| `article_bank_entries` | Generated articles: content, generation_method (oneshot/evolution_winner/evolution_baseline), model, cost, optional evolution_run_id/variant_id |
| `article_bank_comparisons` | Pairwise comparison records: entry_a, entry_b, winner, confidence, judge_model, dimension_scores |
| `article_bank_elo` | Per-entry Elo ratings within a topic: elo_rating, elo_per_dollar, match_count |

## Observability

- **OpenTelemetry spans** (distributed tracing segments viewable in Grafana/Honeycomb): `evolution.pipeline.full`, `evolution.iteration`, `evolution.agent.{name}` — each carries attributes for cost, variant count, phase, and timing
- **Structured logging**: Every log entry includes `{subsystem: 'evolution', runId, agentName}` for filtering
- **DB heartbeat**: `last_heartbeat` column updated after each agent execution, monitored by watchdog cron
- **Cost attribution**: Per-agent spend tracked in `CostTracker`, surfaced in admin UI cost breakdown chart via `getEvolutionCostBreakdownAction`. CLI runs also write to `llmCallTracking` with `call_source = 'evolution_{agentName}'` so the budget tab's burn curve and agent breakdown charts work for local runs.

## Production Deployment

### Database Setup
1. Run evolution migrations (`20260131000001` through `20260131000010`, plus `20260201000001` for article bank)
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

# With bank checkpoints (snapshot intermediate iterations to article bank)
npx tsx scripts/run-evolution-local.ts --prompt "Explain quantum computing" --bank --bank-checkpoints "3,5,10"

# With outline-based generation enabled
npx tsx scripts/run-evolution-local.ts --file article.md --full --outline --iterations 5
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

## Prompt-Based Seeding

The evolution pipeline supports starting from a text prompt instead of an existing article file. This enables the **Comparison Infrastructure** workflow where articles are generated from scratch and then evolved.

### Usage

```bash
# Generate seed article from prompt, then evolve it
npx tsx scripts/run-evolution-local.ts --prompt "Explain quantum computing" --seed-model gpt-4.1

# With bank auto-insertion (adds winner + baseline to article bank)
npx tsx scripts/run-evolution-local.ts --prompt "Explain quantum computing" --bank
```

### How It Works

1. `--prompt` flag triggers `generateSeedArticle()` which:
   - Generates a title via `createTitlePrompt` → LLM call
   - Generates article content via `createExplanationPrompt` → LLM call
   - Returns the generated article as the `originalText` for the pipeline
2. `--seed-model` optionally specifies which model generates the seed (default: pipeline's `generationModel`)
3. The `--prompt` flag is mutually exclusive with `--file` (one or the other, not both)
4. When `--bank` is also set, the pipeline winner and baseline are added to the article bank after completion
5. `--bank-checkpoints "3,5,10"` snapshots intermediate iteration winners to the article bank, enabling comparison of evolution quality at different stages. Automatically extends `--iterations` to the max checkpoint value. Prevents duplicate insertion if the final iteration matches a checkpoint.

### Article Bank Integration

The `--bank` flag on both `generate-article.ts` (1-shot) and `run-evolution-local.ts` (pipeline) adds results to the persistent article bank for cross-method comparison. See [Comparison Infrastructure](./comparison_infrastructure.md) for the full bank system.

## Related Documentation

- [Search & Generation Pipeline](./search_generation_pipeline.md) — Compare pipeline orchestration patterns; evolution operates on articles produced by this pipeline
- [Testing Setup](./testing_setup.md) — Running evolution unit and integration tests; mock patterns
- [Admin Panel](./admin_panel.md) — Evolution UI walkthrough at `/admin/quality/evolution`
- [Metrics & Analytics](./metrics_analytics.md) — Cost tracking and LLM call attribution
- [Request Tracing & Observability](./request_tracing_observability.md) — OpenTelemetry span details for debugging evolution runs
- [Outline-Based Generation](./outline_based_generation_editing.md) — Step-level scoring, outline agent, step-targeted mutations
