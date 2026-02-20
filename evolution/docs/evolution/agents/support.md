# Support Agents

Five agents that support the core generation/editing/ranking cycle: ReflectionAgent (critique), DebateAgent (structured debate), EvolutionAgent (genetic evolution), ProximityAgent (diversity tracking), and MetaReviewAgent (strategy analysis).

## ReflectionAgent

Critiques the top 3 variants across 5 fixed dimensions, producing structured feedback consumed by IterativeEditingAgent, DebateAgent, and EvolutionAgent.

### Dimensions

| Dimension | What It Measures |
|-----------|-----------------|
| Clarity | How clearly concepts are explained |
| Structure | Logical organization and flow |
| Engagement | Reader interest and hooks |
| Precision | Factual accuracy and specificity |
| Coherence | Internal consistency and smooth transitions |

### How It Works

- Selects top 3 variants by ordinal from the pool
- Runs parallel LLM critiques via `Promise.allSettled()` (one call per variant)
- Each critique returns per-dimension scores (1-10), good examples, bad examples, and improvement notes
- Results stored in `state.allCritiques` and `state.dimensionScores`

### Utility Functions

- `getCritiqueForVariant(variantId)` — Retrieve stored critique by variant ID
- `getWeakestDimension(critique)` — Return dimension with lowest score
- `getImprovementSuggestions(critique)` — Aggregate improvement notes across dimensions

### Config & Cost

- `numToCritique = 3` (hardcoded)
- `CRITIQUE_DIMENSIONS` constant (5 dimensions)
- Cost: ~$0.024/run (3 x $0.008 per critique)
- Budget cap: 5% ([details](../reference.md#budget-caps))
- Phase: COMPETITION only

### Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/agents/reflectionAgent.ts` | Agent implementation with parallel critiques |

## DebateAgent

Runs a structured 3-turn debate over the top 2 non-baseline variants, producing a synthesis variant that combines the best elements from both.

Inspired by Google DeepMind's AI Co-Scientist (arxiv 2502.18864).

### 4-Call Flow

1. **Advocate A** — Argues for Variant A's strengths and Variant B's weaknesses
2. **Advocate B** — Rebuts Advocate A, argues for Variant B, incorporating Advocate A's points
3. **Judge** — Synthesizes both arguments into a structured JSON verdict with specific recommendations
4. **Synthesis** — LLM generates an improved variant from the judge's recommendations

### How It Works

- Requires 2+ rated non-baseline variants (baselines with `original_baseline` strategy excluded)
- Uses `countRatedNonBaseline()` guard in `canExecute()`
- Consumes ReflectionAgent critiques via `formatCritiqueContext()` (optional — runs without critiques if none available)
- Produces a `debate_synthesis` variant with both debated variants as parents
- Appends debate transcript to `state.debateTranscripts` (including partial transcripts on failure)

### Config & Cost

- 4 sequential LLM calls per execution
- Budget cap: 5% ([details](../reference.md#budget-caps))
- Feature flag: `evolution_debate_enabled` (default: `true`). See [Reference — Feature Flags](../reference.md#feature-flags).
- Phase: COMPETITION only

### Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/agents/debateAgent.ts` | 4-call debate flow with JSON verdict parsing |

## EvolutionAgent (evolvePool)

Creates child variants from top parents via genetic evolution strategies: mutation, crossover, and creative exploration.

### Strategies

| Strategy | What It Does |
|----------|-------------|
| `mutate_clarity` | Takes one parent, rewrites for clarity and simplicity |
| `mutate_structure` | Takes one parent, reorganizes structure and flow |
| `crossover` | Combines two parents into a new variant (requires 2 parents) |

All 3 strategies run in parallel via `Promise.allSettled()`.

### Creative Exploration

A "wild card" mechanism to prevent pool homogenization:
- **Trigger**: 30% random chance (`CREATIVE_RANDOM_CHANCE = 0.3`) OR diversity < 0.5 (`CREATIVE_DIVERSITY_THRESHOLD`)
- **Effect**: Generates a variant with a completely different approach to the topic
- **Purpose**: Injects novelty when the pool is converging too quickly

### Outline Mutation

When the top variant is an `OutlineVariant`, the agent uses a 2-call mutation:
1. Mutate the outline structure (reorder/add/remove sections)
2. Re-expand the mutated outline into full prose

This preserves the step-level metadata for subsequent iterations.

### Stagnation Detection

- `isRatingStagnant()`: Detects when the top-3 variants by ordinal have been unchanged for 2 consecutive iterations (`CREATIVE_STAGNATION_ITERATIONS = 2`)
- When stagnant, forces creative exploration regardless of random chance
- `getDominantStrategies()`: Flags strategies appearing >1.5x the average count — used to bias generation toward underrepresented strategies

### Config & Cost

- Reads `pool` (top by ordinal), `metaFeedback`, `diversityScore`
- Requires `pool.length >= 1` and `ratings.size >= 1`; crossover requires 2 parents
- Budget cap: 10% ([details](../reference.md#budget-caps))
- Feature flag: `evolution_evolve_pool_enabled` (default: `true`). See [Reference — Feature Flags](../reference.md#feature-flags).
- Phase: COMPETITION only

### Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/agents/evolvePool.ts` | Genetic evolution with mutation, crossover, creative exploration, outline mutation |

## ProximityAgent

Computes diversity/similarity scoring via sparse pairwise cosine similarity matrix. Provides the `diversityScore` that drives phase transitions and creative exploration triggers.

### How It Works

- Computes embeddings for all pool variants
- Builds a sparse pairwise cosine similarity matrix (only new vs existing — avoids recomputing known pairs)
- `diversityScore = 1 - mean(top-10 pairwise similarities)`
- High diversity (close to 1.0) means variants are dissimilar; low diversity (close to 0.0) means convergence

### Embedding Modes

| Mode | Implementation | Used When |
|------|---------------|-----------|
| Test | MD5-based (deterministic, no API calls) | `testMode: true` in constructor |
| Production | Character frequency-based embedding | Default (OpenAI text-embedding-3-small deferred) |

### Config & Cost

- Requires `pool.length >= 2`
- Embedding cache prevents recomputation for unchanged variants
- Cost: ~$0.0001/embedding (negligible)
- Runs in both EXPANSION and COMPETITION phases

### Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/agents/proximityAgent.ts` | Sparse similarity matrix, diversity score computation, embedding cache |

## MetaReviewAgent

Pure computation agent (no LLM calls, $0 cost) that analyzes strategy performance and produces meta-feedback consumed by GenerationAgent and EvolutionAgent in subsequent iterations.

### 4 Analysis Functions

| Function | What It Does |
|----------|-------------|
| `_analyzeStrategies()` | Identifies strategies producing above-average ordinal variants |
| `_findWeaknesses()` | Finds patterns in bottom-quartile variants (recurring dimension weaknesses) |
| `_findFailures()` | Detects strategies with consistently negative parent→child ordinal deltas (threshold < -3) |
| `_prioritize()` | Applies pool gap rules to determine priority improvements |

### Priority Thresholds

- Diversity < 0.3 → "increase diversity" priority
- Ordinal range < 6 → "pool too homogeneous" priority
- Ordinal range > 30 → "outlier variants" priority
- Stagnation detected → "break stagnation" priority

### Output

`MetaFeedback` struct:
- `recurringWeaknesses`: Common weakness patterns across bottom performers
- `priorityImprovements`: Ordered list of recommended focus areas
- `successfulStrategies`: Strategies with above-average results
- `patternsToAvoid`: Strategies with consistently negative deltas

### Config & Cost

- $0 cost — pure computation, no LLM calls
- Reads `pool`, `ratings`, `diversityScore`
- Writes `metaFeedback` to state (consumed next iteration by GenerationAgent and EvolutionAgent)
- Phase: COMPETITION only (runs last in the agent sequence)

### Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/agents/metaReviewAgent.ts` | Strategy analysis, weakness detection, priority rules |

## Related Documentation

- [Architecture](../architecture.md) — Pipeline phases and agent execution order
- [Agent Overview](./overview.md) — Agent framework and interaction patterns
- [Editing Agents](./editing.md) — How IterativeEditingAgent consumes ReflectionAgent critiques
- [Generation Agents](./generation.md) — How GenerationAgent consumes MetaFeedback
- [Rating & Comparison](../rating_and_comparison.md) — OpenSkill ratings used for variant selection
- [Reference](../reference.md) — Feature flags, budget caps, configuration
