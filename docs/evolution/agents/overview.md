# Agent Overview

Agent framework, execution model, interaction patterns, format validation, and ranking agents for the evolution pipeline.

## Agent Framework

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

## Async Parallelism

All agents that make multiple independent LLM calls use `Promise.allSettled()` for concurrent execution with sequential state mutations:
- **GenerationAgent**: 3 strategy calls run in parallel
- **EvolutionAgent**: 3 evolution strategy calls run in parallel
- **ReflectionAgent**: Top-N critique calls run in parallel
- **CalibrationRanker**: Batched parallelism — first `minOpponents` in parallel, then remaining batch. Each comparison's forward+reverse bias rounds also run concurrently via `Promise.all`.
- **Tournament**: All Swiss-round pairs run in parallel within each round. Each comparison's forward+reverse bias rounds also run concurrently via `Promise.all`.

State mutations (pool additions, rating updates) happen sequentially after all promises resolve. `BudgetExceededError` is explicitly re-thrown from rejected `Promise.allSettled` results to ensure proper pipeline error handling.

## Agent Interaction Pattern

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
| TreeSearchAgent | `pool` (top by mu), `allCritiques`, `ratings` | `pool` (tree_search_* variant via `addToPool`), `treeSearchResults`, `treeSearchStates` |
| ProximityAgent | `pool`, `newEntrantsThisIteration` | `similarityMatrix`, `diversityScore` |
| OutlineGenerationAgent | `originalText`, config (`generationModel`, `judgeModel`) | `pool` (OutlineVariant with steps, outline, weakestStep) |
| MetaReviewAgent | `pool`, `ratings`, `diversityScore` | `metaFeedback` |

### State Lifecycle Notes

- `newEntrantsThisIteration`: Populated by `addToPool()` whenever a variant enters the pool. Cleared by `startNewIteration()` at the top of each iteration loop.
- `metaFeedback`: Written by MetaReviewAgent at end of COMPETITION iterations. Read by GenerationAgent and EvolutionAgent in the *next* iteration to steer prompt construction.
- `debateTranscripts`: Appended by DebateAgent after each debate (including partial transcripts on failure). Serialized to checkpoints for debugging and observability.
- All pool mutations go through `PipelineStateImpl.addToPool()`, which enforces deduplication via `poolIds` Set and initializes a default OpenSkill rating (`mu=25, sigma=8.333`).

## Format Validation

All generated variants must pass format validation before entering the pool. See [Reference — Format Enforcement](../reference.md#format-enforcement) for full rules and `FORMAT_VALIDATION_MODE` env var.

### Format Rules (`formatRules.ts`)

Shared prose-only format rules injected into all text-generation prompts:
- Exactly one H1 title on the first line
- At least one section heading (## or ###)
- No bullet points, numbered lists, or tables (outside code fences)
- At least 75% of paragraphs must have 2+ sentences

### Format Validator (`formatValidator.ts`)

Validates generated text against format rules. Agents that produce text (GenerationAgent, EvolutionAgent, IterativeEditingAgent, SectionDecompositionAgent, DebateAgent, OutlineGenerationAgent) call `validateFormat()` before adding variants to the pool.

Agent docs link to this section via: "validated via [format rules](./overview.md#format-validation)"

## Ranking Agents

Two ranking agents handle different pipeline phases:

### CalibrationRanker (`calibrationRanker.ts`)

Pairwise comparison for **new entrants only** against stratified opponents:
- Uses [Stratified Opponent Selection](../rating_and_comparison.md#stratified-opponent-selection) for balanced testing
- [Adaptive early exit](../rating_and_comparison.md#adaptive-calibration) reduces LLM calls ~40%
- Default: 3 opponents in EXPANSION, 5 in COMPETITION
- Uses `compareWithBiasMitigation()` with position-bias mitigation

### Tournament (`tournament.ts`)

Swiss-style tournament for **all pool variants**:
- [Info-theoretic pairing](../rating_and_comparison.md#swiss-style-tournament-info-theoretic-pairing) maximizes information gain
- Budget-adaptive depth (fewer rounds when budget is tight)
- Multi-turn tiebreakers for top-quartile close matches
- Sigma-based convergence detection (stops when all sigmas < threshold)

Which ranking agent runs is controlled by `evolution_tournament_enabled` feature flag (default: `true`). See [Reference — Feature Flags](../reference.md#feature-flags).

## Related Documentation

- [Architecture](../architecture.md) — Pipeline orchestration and phases
- [Rating & Comparison](../rating_and_comparison.md) — OpenSkill system, tournament details, bias mitigation
- [Generation Agents](./generation.md) — GenerationAgent, OutlineGenerationAgent
- [Editing Agents](./editing.md) — IterativeEditingAgent, SectionDecompositionAgent
- [Tree Search Agent](./tree_search.md) — Beam search revisions
- [Support Agents](./support.md) — Reflection, Debate, Evolution, Proximity, MetaReview
- [Reference](../reference.md) — Configuration, feature flags, budget caps
