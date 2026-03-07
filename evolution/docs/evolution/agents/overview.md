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
- `runId`: The evolution run ID (string)
- `comparisonCache`: Order-invariant SHA-256 cache for bias-mitigated comparison results (`core/comparisonCache.ts`, optional)

## Async Parallelism

All agents that make multiple independent LLM calls use `Promise.allSettled()` for concurrent execution with sequential state mutations:
- **GenerationAgent**: 3 strategy calls run in parallel
- **EvolutionAgent**: 3 evolution strategy calls run in parallel
- **ReflectionAgent**: Top-N critique calls run in parallel
- **CalibrationRanker**: Batched parallelism — first `minOpponents` in parallel, then remaining batch. Delegates to standalone `comparison.ts:compareWithBiasMitigation()` which internally uses sequential `run2PassReversal()` for forward+reverse bias rounds.
- **Tournament**: All Swiss-round pairs run in parallel within each round. Delegates to `PairwiseRanker.compareWithBiasMitigation()` which runs both forward+reverse passes **concurrently** via `Promise.all`.

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
| IterativeEditingAgent | `pool` (top 1 by ordinal), `allCritiques`, `ratings`, `matchHistory` (friction spots) | `pool` (critique_edit variants via `addToPool`) |
| SectionDecompositionAgent | `pool` (top 1 by ordinal), `allCritiques`, `ratings` | `pool` (section_decomposition variants via `addToPool`) |
| DebateAgent | `pool` (top 2 non-baseline by ordinal), `allCritiques` | `pool` (debate_synthesis variant via `addToPool`), `debateTranscripts` |
| TreeSearchAgent | `pool` (top by mu), `allCritiques`, `ratings`, `matchHistory` (friction spots) | `pool` (tree_search_* variant via `addToPool`), `treeSearchResults`, `treeSearchStates` |
| ProximityAgent | `pool`, `newEntrantsThisIteration` | `similarityMatrix`, `diversityScore` |
| OutlineGenerationAgent | `originalText`, config (`generationModel`, `judgeModel`) | `pool` (OutlineVariant with steps, outline, weakestStep) |
| MetaReviewAgent | `pool`, `ratings`, `diversityScore` | `metaFeedback` |
| FlowCritique* | `pool`, `allCritiques` (to check existing) | `allCritiques` (scale='0-5'), `dimensionScores` (flow: prefix) |

\* FlowCritique is a standalone pipeline function, not an `AgentBase` subclass. It is listed here because it participates in the `AGENT_EXECUTION_ORDER` and reads/writes the same state.

### State Lifecycle Notes

- `newEntrantsThisIteration`: Populated by `addToPool()` whenever a variant enters the pool. Cleared by `startNewIteration()` at the top of each iteration loop.
- `metaFeedback`: Written by MetaReviewAgent at end of COMPETITION iterations. Read by GenerationAgent, EvolutionAgent, and DebateAgent in the *next* iteration. All 4 fields are consumed: `priorityImprovements`, `overallAssessment`, `strategicDirection`, and `strengthsToPreserve` (formatted via shared `formatMetaFeedback()` in `utils/metaFeedback.ts`).
- `debateTranscripts`: Appended by DebateAgent after each debate (including partial transcripts on failure). Serialized to checkpoints for debugging and observability.
- All pool mutations go through `PipelineStateImpl.addToPool()`, which enforces deduplication via `poolIds` Set and initializes a default OpenSkill rating (`mu=25, sigma=8.333`).

## Transient Error Handling

Agents fall into two tiers for transient error resilience:

**Tier 1 — Internal protection** (catch transient errors within their own loops):
- `IterativeEditingAgent`: try-catch around each edit cycle; transient errors increment `consecutiveRejections` and `continue`. `BudgetExceededError` is re-thrown.
- `CalibrationRanker`: `Promise.allSettled` batches scan for `BudgetExceededError` and re-throw; other failures degrade gracefully (reduced match count).
- `TournamentAgent`: `Promise.allSettled` with `BudgetExceededError` scan (same pattern as CalibrationRanker).
- `DebateAgent`: try-catch per debate round.
- `GenerationAgent`: `Promise.allSettled` for parallel generation.

**Tier 2 — Pipeline-level retry** (rely on `runAgent()` in `pipeline.ts`):
- All other agents. If they throw a transient error, `runAgent` retries the agent once with exponential backoff. Non-transient errors and `BudgetExceededError` are not retried.

**Helper caller contracts** (do NOT catch errors — callers must handle failures):
- `compareWithDiff()` in `diffComparison.ts`: 2 sequential LLM calls, no catch.
- `compareWithBiasMitigation()` in `comparison.ts`: 2 sequential LLM calls, no catch.

Error classification uses `isTransientError()` in `core/errorClassification.ts`, which checks OpenAI SDK class hierarchy (`APIConnectionError`, `RateLimitError`, `InternalServerError`), message patterns (socket timeout, ECONNRESET, etc.), and `error.cause` chain walking.

## Format Validation

All generated variants must pass format validation before entering the pool. See [Reference — Format Enforcement](../reference.md#format-enforcement) for full rules and `FORMAT_VALIDATION_MODE` env var.

### Shared Utilities

**TextVariation factory** (`core/textVariationFactory.ts`): All agents use `createTextVariation()` instead of inline `TextVariation` construction. Eliminates duplication across 6 agents, ensures consistent UUID generation and field defaults.

**CritiqueBatch** (`core/critiqueBatch.ts`): Shared utility for running LLM critique calls on batches of items. Extracts the common build-prompt / call-LLM / parse-response / handle-errors pattern used by ReflectionAgent, IterativeEditingAgent's inline critique, and FlowCritique.

### Format Rules (`formatRules.ts`)

Shared prose-only format rules injected into all text-generation prompts:
- Exactly one H1 title on the first line
- At least one section heading (## or ###)
- No bullet points, numbered lists, or tables (outside code fences)
- At least 75% of paragraphs must have 2+ sentences

### Shared Format Validation Rules (`core/formatValidationRules.ts`)

Low-level validation helpers (e.g., `stripCodeBlocks`, `hasBulletPoints`, `checkParagraphSentenceCount`) extracted from duplicated logic in `formatValidator.ts` and `sectionFormatValidator.ts`. Both validators now import these shared rules rather than maintaining independent implementations.

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

## Execution Detail Tracking

All 12 `AgentBase` subclasses emit structured `executionDetail` on their `AgentResult` (FlowCritique is a standalone pipeline function, not an `AgentBase` subclass — see [Flow Critique](./flow_critique.md)). This captures per-invocation metrics that are more granular than the aggregate checkpoint data. Each agent has a dedicated `ExecutionDetail` interface (discriminated by `detailType` string literal) defined in `types.ts`.

The pipeline persists these details to the `evolution_agent_invocations` table (JSONB column) via `persistAgentInvocation()` in `pipeline.ts`. Details are capped at 100KB and truncated with `_truncated: true` if exceeded.

Frontend rendering uses `AgentExecutionDetailView` (`components/evolution/agentDetails/`) — a router component that delegates to 12 type-specific detail views via exhaustive switch on `detailType`. The TimelineTab lazy-loads execution details on expand click using `hasExecutionDetail` flag.

## Related Documentation

- [Architecture](../architecture.md) — Pipeline orchestration and phases
- [Rating & Comparison](../rating_and_comparison.md) — OpenSkill system, tournament details, bias mitigation
- [Generation Agents](./generation.md) — GenerationAgent, OutlineGenerationAgent
- [Editing Agents](./editing.md) — IterativeEditingAgent, SectionDecompositionAgent
- [Tree Search Agent](./tree_search.md) — Beam search revisions
- [Support Agents](./support.md) — Reflection, Debate, Evolution, Proximity, MetaReview
- [Flow Critique](./flow_critique.md) — Flow evaluation pass and cross-scale targeting
- [Reference](../reference.md) — Configuration, feature flags, budget caps
