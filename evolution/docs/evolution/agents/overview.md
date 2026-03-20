# V2 Operations Overview

V2 pipeline operations, execution model, format validation, and shared modules for the evolution pipeline.

## Operations Model

V2 replaces V1's 12-agent `AgentBase` framework with 3 flat async functions that run in a fixed loop every iteration:

```
for each iteration:
  generateVariants()  →  rankPool()  →  evolveVariants()
```

There is no `AgentBase` class, no `ExecutionContext`, no `PoolSupervisor`, and no phase transitions. Each operation is a plain function imported from `evolution/src/lib/v2/`.

## generateVariants() (`v2/generate.ts`)

Generates new text variants using 3 parallel LLM strategies via `Promise.allSettled()`:

| Strategy | Description |
|----------|-------------|
| `structural_transform` | Aggressively restructure text — reorder sections, invert structure, reorganize by theme/chronology |
| `lexical_simplify` | Simplify language — replace complex words, shorten sentences, remove jargon |
| `grounding_enhance` | Make text concrete — add examples, sensory details, real-world connections |

**Inputs**: Original text, iteration number, LLM client, config, optional feedback
**Outputs**: 0-3 validated `TextVariation` objects (format failures silently discarded)

Strategies are hardcoded in `STRATEGIES` constant. Each strategy builds a prompt with format rules injected and calls the generation model. If budget is exceeded mid-generation, `BudgetExceededWithPartialResults` preserves any successfully generated variants.

## rankPool() (`v2/rank.ts`)

Two-step ranking using OpenSkill Bayesian ratings:

### Step 1: Triage

Sequential calibration of new entrants (sigma >= `CALIBRATED_SIGMA_THRESHOLD` = 5.0) against stratified opponents:

- **Stratified opponent selection**: For n=5: 2 from top quartile, 2 from middle, 1 from bottom or fellow new entrants. Ensures new variants are tested against both strong and weak competitors.
- **Adaptive early exit**: After `MIN_TRIAGE_OPPONENTS` (2) matches, if all matches are decisive (confidence >= 0.7) and average confidence >= 0.8, skip remaining opponents. Reduces LLM calls ~40%.
- **Top-20% cutoff elimination**: Variants with `mu + 2σ < top20Cutoff` are excluded from fine-ranking.

### Step 2: Fine-Ranking (Swiss)

Swiss-style tournament among eligible contenders:

- **Eligibility**: `mu >= 3σ` OR in top-K by mu (default K=5)
- **Pair scoring**: `outcomeUncertainty × sigmaWeight` using Bradley-Terry logistic CDF
- **Selection**: Greedy by descending score, skipping already-played and already-used variants
- **Budget pressure**: low (≤50% spent → 40 max comparisons), medium (50-80% → 25), high (≥80% → 15)
- **Convergence**: All eligible sigmas below `DEFAULT_CONVERGENCE_SIGMA` for 2 consecutive rounds
- **Draw detection**: Comparison result with confidence < 0.3 treated as a draw

**Inputs**: Pool, ratings map, match counts, new entrant IDs, LLM client, config, budget fraction, comparison cache
**Outputs**: `RankResult` with matches, full rating snapshot, match count increments, convergence flag

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `CALIBRATED_SIGMA_THRESHOLD` | 5.0 | Skip triage for well-calibrated variants |
| `MIN_TRIAGE_OPPONENTS` | 2 | Minimum matches before early exit |
| `DECISIVE_CONFIDENCE` | 0.7 | Confidence threshold for decisive match |
| `AVG_CONFIDENCE_THRESHOLD` | 0.8 | Average confidence for early exit |
| `DEFAULT_CONVERGENCE_SIGMA` | 3.0 | Sigma threshold for convergence (from `core/rating.ts`) |

## evolveVariants() (`v2/evolve.ts`)

Creates new variants from top-rated parents via mutation and crossover:

| Strategy | Description | Trigger |
|----------|-------------|---------|
| `mutate_clarity` | Improve clarity — simplify sentences, precise word choices | Always (top parent) |
| `mutate_structure` | Improve structure — reorganize flow, strengthen transitions | Always (top parent) |
| `crossover` | Combine best elements of top 2 parents | When 2+ parents exist |
| `creative_exploration` | Bold, significantly different version | When `0 < diversityScore < 0.5` |

**Inputs**: Pool, ratings map, iteration, LLM client, config, optional feedback/diversity
**Outputs**: 0-4 validated `TextVariation` objects

Parents are selected by descending mu (top 2). All outputs pass format validation before entering the pool. `BudgetExceededError` propagates directly to caller.

## Format Validation

All generated variants must pass format validation before entering the pool:

### Format Rules (`agents/formatRules.ts`)

Shared prose-only format rules injected into all text-generation prompts via `FORMAT_RULES`:
- Exactly one H1 title on the first line
- At least one section heading (## or ###)
- No bullet points, numbered lists, or tables (outside code fences)
- At least 75% of paragraphs must have 2+ sentences

### Format Validator (`agents/formatValidator.ts`)

`validateFormat(text)` checks generated text against format rules. Both `generateVariants()` and `evolveVariants()` call this before adding variants to the pool. Invalid variants are silently discarded.

## Shared Modules (V1 Core Reused by V2)

V2 reuses several V1 utility modules unchanged:

| Module | Purpose | V2 Consumer |
|--------|---------|-------------|
| `core/rating.ts` | OpenSkill (Weng-Lin Bayesian) rating: `createRating`, `updateRating`, `updateDraw`, `toEloScale` | `rank.ts` |
| `comparison.ts` | `compareWithBiasMitigation()` — 2-pass reversal bias mitigation | `rank.ts` |
| `core/reversalComparison.ts` | Generic `run2PassReversal()` runner | `comparison.ts` |
| `core/textVariationFactory.ts` | `createTextVariation()` factory | `generate.ts`, `evolve.ts`, `evolve-article.ts` |
| `agents/formatValidator.ts` | `validateFormat()` for generated text | `generate.ts`, `evolve.ts` |
| `agents/formatRules.ts` | `FORMAT_RULES` constant | `generate.ts`, `evolve.ts`, `seed-article.ts` |
| `core/errorClassification.ts` | `isTransientError()` for retry decisions | `llm-client.ts` |

## Per-Operation Invocation Tracking

Each operation is tracked via a two-phase lifecycle in `evolution_agent_invocations`:

1. **`createInvocation(db, runId, iteration, operationName, executionOrder)`** — Insert row with UUID before operation executes
2. **`updateInvocation(db, invocationId, { cost_usd, success, execution_detail, error_message })`** — Write final metrics after completion

This replaces V1's `createAgentInvocation`/`updateAgentInvocation` pattern with a simpler interface.

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/v2/evolve-article.ts` | Main orchestrator: generate→rank→evolve loop |
| `evolution/src/lib/v2/generate.ts` | 3-strategy variant generation |
| `evolution/src/lib/v2/rank.ts` | Triage + Swiss fine-ranking |
| `evolution/src/lib/v2/evolve.ts` | Mutation, crossover, creative exploration |
| `evolution/src/lib/v2/runner.ts` | Run lifecycle: claim → resolve → evolve → persist |
| `evolution/src/lib/v2/types.ts` | V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig |
| `evolution/src/lib/v2/cost-tracker.ts` | Reserve-before-spend budget management |
| `evolution/src/lib/v2/llm-client.ts` | LLM wrapper with retry, cost tracking, pricing |
| `evolution/src/lib/v2/invocations.ts` | Per-operation invocation tracking |
| `evolution/src/lib/v2/finalize.ts` | Persist results in V1-compatible format |
| `evolution/src/lib/v2/arena.ts` | Arena entry loading and result sync |

## Related Documentation

- [Architecture](../architecture.md) — Pipeline orchestration and iteration loop
- [Rating & Comparison](../rating_and_comparison.md) — OpenSkill system, tournament details, bias mitigation
- [Reference](../reference.md) — Configuration, database schema, key files
