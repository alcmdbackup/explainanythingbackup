# Recommended Improvements Evolution Pipeline Research

**Date**: 2026-01-31T21:43:55Z
**Branch**: feat/recommended_improvements_evolution_pipeline_20260131
**Git Commit**: 48cf34e16a0d06238e5b02d3a1ec82134e59d80a

## Problem Statement

The evolution pipeline (`src/lib/evolution/`) runs all LLM calls sequentially, uses a single model for both generation and trivial comparisons, always runs position-bias mitigation (doubling comparison calls), and has no caching layer. A set of 7 improvements has been proposed in `recommended_improvements.md`. This research maps each recommendation to the actual TypeScript codebase, identifies exact files/lines affected, surfaces implementation constraints, and flags discrepancies.

## High Level Summary

The evolution pipeline is a well-structured TypeScript module with 7 agents, a 2-phase supervisor (EXPANSION→COMPETITION), checkpoint/resume support, and 14 test files. All LLM calls go through `EvolutionLLMClient` which wraps `callOpenAIModel` from `lib/services/llms.ts`. The pipeline is **synchronous** — agents run sequentially via `for` loops, comparisons run one-at-a-time. There is **no caching** of comparison results. The `LLMCompletionOptions.model` parameter already exists but is never used by agents.

Key findings:

1. **Async parallelism (#1)**: Already `async/await` throughout but all loops are sequential `for...of`. Converting to `Promise.all` is straightforward. No `asyncio` needed — this is TypeScript, not Python.

2. **Tiered model routing (#2)**: The `LLMCompletionOptions.model` param already exists in `types.ts:122-125`. Agents just need to pass `{ model: 'gpt-4.1-nano' }`. The codebase already uses `lighter_model` (gpt-4.1-nano) in 4 other services. **Lowest effort, highest impact.**

3. **Conditional bias mitigation (#3)**: `PairwiseRanker` already parses `CONFIDENCE: high/medium/low` via `parseStructuredResponse()`. CalibrationRanker has its own simpler bias mitigation that lacks confidence parsing.

4. **Agent-level parallelism (#4)**: Deep state mutation analysis reveals Reflection/Evolution/Proximity write to non-overlapping fields, but `addToPool()` in Evolution mutates 5 fields simultaneously. Safe parallelism requires collecting Evolution results, then applying mutations after `Promise.all`.

5. **LLM response cache (#5)**: No comparison caching exists. Pool is append-only (texts immutable), making hash-based caching safe. `matchHistory` is an append-only log with no pair-indexed lookup.

6. **Adaptive calibration (#6)**: Supervisor already differentiates opponents (3 in EXPANSION, 5 in COMPETITION). Further adaptation within the calibration loop is straightforward.

7. **Batch API (#7)**: `callOpenAIModel` uses standard `chat.completions.create`. Requires fundamentally different flow. Defer.

---

## Detailed Findings

### Architecture Overview

```
src/lib/evolution/
├── types.ts           # Shared interfaces: TextVariation, ExecutionContext, EvolutionLLMClient
├── config.ts          # Defaults: 15 iterations, $5 budget, 5 calibration opponents
├── index.ts           # Public API re-exports
├── agents/
│   ├── base.ts        # Abstract AgentBase: execute(), estimateCost(), canExecute()
│   ├── generationAgent.ts    # 3-strategy text generation (sequential loop)
│   ├── calibrationRanker.ts  # Pairwise calibration with bias mitigation
│   ├── pairwiseRanker.ts     # A/B comparison, structured + simple modes
│   ├── tournament.ts         # Swiss-style tournament, budget-adaptive depth
│   ├── evolvePool.ts         # Mutation + crossover + creative exploration
│   ├── reflectionAgent.ts    # Dimensional critique per variant
│   ├── proximityAgent.ts     # Diversity tracking with embedding cache
│   ├── metaReviewAgent.ts    # Pure analysis, no LLM calls, cost=0
│   ├── formatRules.ts        # Markdown format rules for generated text
│   └── formatValidator.ts    # Validates output format (H1, headings, no lists)
└── core/
    ├── llmClient.ts       # Wraps callOpenAIModel with budget + model passthrough
    ├── pipeline.ts        # Minimal + full pipeline orchestrators
    ├── supervisor.ts      # EXPANSION→COMPETITION phase transitions
    ├── pool.ts            # Stratified opponent selection, pool health
    ├── state.ts           # PipelineStateImpl, serialize/deserialize
    ├── elo.ts             # Adaptive K-factor Elo rating system
    ├── costTracker.ts     # Per-agent budget with 30% safety margin
    ├── diversityTracker.ts # Pool diversity monitoring
    ├── featureFlags.ts    # Tournament/evolvePool/dryRun flags
    ├── logger.ts          # Evolution-specific structured logger
    └── validation.ts      # State contract validation
```

### Pipeline Execution Flow

**Full pipeline** (`pipeline.ts:164-323`): `executeFullPipeline()` uses `PoolSupervisor` for phase-aware iteration.

Per iteration in COMPETITION phase:
```
Generation → Reflection → Evolution → Calibration/Tournament → Proximity → Meta-review
```

Each agent is called sequentially via `runAgent()` (`pipeline.ts:326-378`) with OTel tracing, error handling, and checkpoint persistence after each agent completes.

### LLM Client & Model Routing Infrastructure

**`llmClient.ts:36-98`**: `createEvolutionLLMClient()` returns an object implementing `EvolutionLLMClient` interface with two methods:

- `complete(prompt, agentName, options?)`: Line 43 resolves `options?.model ?? default_model`
- `completeStructured(prompt, schema, schemaName, agentName, options?)`: Line 75 same pattern

Both delegate to `callOpenAIModel()` from `llms.ts` which accepts the model as a required parameter.

**Cost estimation** (`llmClient.ts:10-20`): Pre-call heuristic assumes gpt-4.1-mini pricing (`costPer1MInput: 0.0004`, `costPer1MOutput: 0.0016`), 4 chars/token, 50% output ratio. This is used for budget pre-flights only; actual cost is calculated post-call using `calculateLLMCost()` from `src/config/llmPricing.ts`.

**Existing model routing in the broader codebase:**

| Service | Model Used | File |
|---------|-----------|------|
| Content quality scoring | `lighter_model` (gpt-4.1-nano) | `contentQualityCompare.ts:56` |
| Explanation summaries | `lighter_model` (gpt-4.1-nano) | `explanationSummarizer.ts:75` |
| Source summarization | `lighter_model` (gpt-4.1-nano) | `sourceSummarizer.ts:72` |
| Content quality eval | `lighter_model` (gpt-4.1-nano) | `contentQualityEval.ts:64` |
| Tag evaluation | `default_model` (gpt-4.1-mini) | `tagEvaluation.ts:52` |
| All evolution agents | `default_model` (gpt-4.1-mini) | `evolution/agents/*.ts` |

The pattern of using `lighter_model` for cost-sensitive tasks is established precedent.

### LLM Pricing

**`src/config/llmPricing.ts`**: Centralized pricing table with 50+ models.

Key models for evolution pipeline:

| Model | Input/1M | Output/1M | Cost Ratio |
|-------|----------|-----------|------------|
| `gpt-4.1-mini` (current) | $0.40 | $1.60 | 1x |
| `gpt-4.1-nano` (candidate) | $0.10 | $0.40 | **4x cheaper** |
| `gpt-5-nano` | $0.05 | $0.40 | **8x cheaper input** |

### State Mutation Analysis

**`PipelineStateImpl`** (`state.ts:14-68`): Central mutable state shared by all agents.

**`addToPool()` mutations** (state.ts:37-46): Modifies 5 fields atomically:
1. `pool.push(variation)` — array append
2. `poolIds.add(variation.id)` — Set membership
3. `newEntrantsThisIteration.push(variation.id)` — tracking array
4. `eloRatings.set(id, 1200)` — initial rating (guarded by `has()`)
5. `matchCounts.set(id, 0)` — initial count (guarded by `has()`)

**Agent state access pattern:**

| Agent | Reads | Writes |
|-------|-------|--------|
| Generation | `originalText`, `metaFeedback`, `iteration` | `pool` (via addToPool) |
| Evolution | `pool`, `eloRatings`, `metaFeedback`, `diversityScore` | `pool` (via addToPool) |
| Reflection | `pool` (getTopByElo) | `allCritiques`, `dimensionScores` |
| Proximity | `newEntrantsThisIteration`, `pool` | `similarityMatrix`, `diversityScore` |
| Calibration | `newEntrantsThisIteration`, `pool`, `eloRatings`, `matchCounts` | `matchHistory`, `eloRatings`, `matchCounts` |
| Tournament | `pool`, `eloRatings`, `matchCounts` | `matchHistory`, `eloRatings`, `matchCounts` |
| Meta-review | `pool`, `eloRatings`, `diversityScore`, `iteration` | `metaFeedback` |

**Parallelism safety:**
- Reflection + Evolution + Proximity: Write to **non-overlapping fields** (critiques vs pool vs similarity)
- **BUT**: Evolution's `addToPool()` writes to `pool` + `newEntrantsThisIteration` which Proximity reads
- **Risk**: Proximity reads `newEntrantsThisIteration` at start, Evolution appends to it during execution
- **Mitigation**: Snapshot `newEntrantsThisIteration` before starting parallel agents, or run Evolution before Proximity

### Comparison & Bias Mitigation Patterns

**CalibrationRanker** (`calibrationRanker.ts:64-107`): Own `compareWithBiasMitigation()` using **simple A/B/TIE prompt** (no confidence signal). Always runs 2 calls per comparison. Each entrant faces all opponents sequentially.

**PairwiseRanker** (`pairwiseRanker.ts:196-252`): `compareWithBiasMitigation()` with optional **structured mode** that returns per-dimension scores and `CONFIDENCE: high/medium/low`. Confidence values: high→1.0, medium→0.7, low→0.5.

**Tournament** (`tournament.ts:128-162`): Delegates to `PairwiseRanker.compareWithBiasMitigation()`. Adds optional **multi-turn tiebreaker** (3rd call) for top-quartile close matches. Budget-adaptive: reduces debate depth under pressure.

**Current call counts per COMPETITION iteration (3 entrants, 5 opponents):**
- Calibration: 3 entrants × 5 opponents × 2 calls = **30 LLM calls**
- Tournament: ~24 comparisons × 2 calls × 1.2 (multi-turn) ≈ **58 LLM calls**
- Generation: 1 strategy × 1 call = **1 LLM call**
- Evolution: 3 strategies + 30% creative = **~4 LLM calls**
- Reflection: 3 variants × 1 call = **3 LLM calls**
- **Total: ~96 calls per iteration**, 88 of which are comparisons (92%)

### Caching Patterns

**Existing caches in evolution pipeline:**

| Cache | Structure | Scope | File |
|-------|-----------|-------|------|
| `embeddingCache` | `Map<varId, number[]>` | Per-agent instance | `proximityAgent.ts:11` |
| `completedPairs` | `Set<normalizedPairId>` | Per-tournament execution | `tournament.ts:185` |
| `eloRatings` | `Map<varId, number>` | Pipeline state | `state.ts:21` |

**Missing:** No comparison result cache. `matchHistory` is append-only (`Match[]`) with no indexed lookup by pair. Re-matching the same pair requires a new LLM call.

**Immutability guarantee:** `TextVariation.text` is never modified after creation (append-only pool with UUID deduplication). This makes content-hash-based caching safe.

### Test Coverage

**14 test files** covering all agents and core modules:

- **Agent tests (8)**: generationAgent, calibrationRanker (via tournament tests), pairwiseRanker, tournament, evolvePool, reflectionAgent, proximityAgent, metaReviewAgent, formatValidator
- **Core tests (6)**: state, elo, supervisor, costTracker, diversityTracker, featureFlags

**Key test patterns:**
- Uniform mock LLM: `jest.fn().mockImplementation()` with cycling response arrays
- `compareWithBiasMitigation` tested for: full agreement (confidence=1.0), partial agreement (0.7), complete disagreement (0.5), partial failure (0.3)
- Swiss pairing tested for pair avoidance and Elo-proximity matching
- Math.random override pattern for creative exploration testing

### Feature Flags

**`featureFlags.ts`**: Three flags fetched from `feature_flags` DB table:
- `tournamentEnabled` → use Tournament vs CalibrationRanker in COMPETITION
- `evolvePoolEnabled` → enable/disable EvolutionAgent
- `dryRunOnly` → log-only mode

These could be extended for new features (e.g., `conditionalBiasMitigation`, `tieredModelRouting`).

---

## Recommendation-to-Code Mapping

### #1: Parallelize LLM Calls (Promise.all)

| Agent | Sequential Loop | Independent Items | State Mutation After |
|-------|----------------|-------------------|---------------------|
| Generation | `generationAgent.ts:76-105` | 3 strategies | `addToPool()` per variant |
| Calibration | `calibrationRanker.ts:136-159` | N opponents per entrant | `matchHistory.push()`, Elo update |
| Tournament | `tournament.ts:211-234` | Swiss pairs per round | `matchHistory.push()`, Elo update |
| Evolution | `evolvePool.ts:173-213` | 3 strategies + creative | `addToPool()` per variant |
| Reflection | `reflectionAgent.ts:119-139` | 3 top variants | `allCritiques.push()`, `dimensionScores` |

**Pattern:** Replace `for...of` with `Promise.all(items.map(async (item) => { ... }))`, collect results, mutate state after resolution.

**Constraint:** `addToPool()` is not thread-safe (checks `poolIds.has()` then pushes). Must batch-collect variants, then add sequentially.

### #2: Tiered Model Routing

**Infrastructure already exists.** Changes needed:

1. `config.ts`: Add `judgeModel` and `generationModel` to `EvolutionRunConfig`
2. `calibrationRanker.ts:56`: Pass `{ model: config.judgeModel }` to `complete()`
3. `pairwiseRanker.ts:185`: Same
4. `evolvePool.ts:189,229`: Keep default (quality model) for generation
5. `generationAgent.ts:81`: Keep default for generation
6. `reflectionAgent.ts:124`: Keep default for critique

**Cost estimation fix:** `estimateTokenCost()` in `llmClient.ts:13-14` hardcodes gpt-4.1-mini pricing. Should use actual model pricing if model differs.

### #3: Conditional Position-Bias Mitigation

**PairwiseRanker** (`pairwiseRanker.ts:206-209`):
- Round 1 already runs. Check `r1.confidence` before Round 2.
- If `confidence === 1.0` (structured high), return immediately with round-1 result.

**CalibrationRanker** (`calibrationRanker.ts:71-74`):
- Currently uses simple prompt (no confidence).
- Option A: Switch to structured prompt with CONFIDENCE field.
- Option B: Use `PairwiseRanker.compareWithBiasMitigation()` directly instead of own implementation (eliminates code duplication).

### #4: Agent-Level Parallelism

**Safe parallel schedule (from state mutation analysis):**
```
Step 1: Generation (writes pool, newEntrantsThisIteration)
Step 2: Reflection || Evolution (collect variants, don't addToPool yet)
Step 3: Apply Evolution variants to pool (sequential addToPool)
Step 4: Proximity (needs final newEntrantsThisIteration)
Step 5: Calibration/Tournament (needs all new entrants + Elo state)
Step 6: Meta-review (reads everything)
```

Note: Original recommendation suggested Reflection+Evolution+Proximity in parallel. State analysis reveals Proximity depends on the final `newEntrantsThisIteration` which Evolution modifies. Revised schedule runs Proximity after Evolution's pool mutations are applied.

### #5: LLM Response Cache

**Cache key:** `hash(sort([textA, textB]) + promptType)` where promptType is "simple" or "structured".

**Existing pattern to follow:** `ProximityAgent.embeddingCache` (Map<string, number[]>).

**Integration points:**
- `PairwiseRanker.comparePair()` at line 185 — check cache before LLM call
- `CalibrationRanker.comparePair()` at line 56 — same
- Cache passed via `ExecutionContext` or attached to `EvolutionLLMClient`

### #6: Adaptive Calibration Opponents

**Current flow** (`calibrationRanker.ts:124-159`):
```
for each entrant:
  opponents = getCalibrationOpponents(entrantId, config.calibration.opponents)
  for each opponent:
    match = compareWithBiasMitigation(...)
    updateElo(...)
```

**Adaptation:** After first match, check `match.confidence`. If `=== 1.0`, truncate opponent list.

**Supervisor context:** `supervisor.ts:163` sets `opponentsPerEntrant: 3` in EXPANSION. Could be further reduced to 2 for decisive matches.

### #7: Batch API (Defer)

Not feasible without major architectural changes. The pipeline's synchronous iteration model expects immediate results. A batch mode would need a completely different execution path (queue → poll → process). Low priority.

---

## Discrepancies Between Recommendations and Codebase

1. **Language mismatch:** Recommendations reference `asyncio`, `.py` files, `AsyncOpenAI`. Codebase is TypeScript using `Promise.all()`.

2. **Line numbers:** Python line references don't match TypeScript files.

3. **Model suggestions:** Recommendations cite `claude-haiku-3.5`, `gemini-3-flash`, `deepseek-v3`. The `allowedLLMModelSchema` only permits OpenAI models. Using non-OpenAI models would require schema changes and multi-provider LLM client.

4. **"SQLite for crash resilience":** Project uses Supabase/PostgreSQL.

5. **CalibrationRanker "30 serial calls":** Confirmed accurate: 3 entrants × 5 opponents × 2 bias-mitigation calls = 30.

6. **Agent parallel schedule:** Recommendation says [Reflection, Evolution, Proximity] in parallel. State analysis shows Proximity depends on Evolution's `newEntrantsThisIteration` writes. Revised: run Reflection||Evolution, apply pool mutations, then Proximity.

---

## Priority Assessment

| # | Recommendation | Lines Changed | Risk | Impact | Depends On |
|---|---------------|--------------|------|--------|-----------|
| 2 | Tiered model routing | ~15 | Very low | **High** (4x cheaper comparisons) | None |
| 3 | Conditional bias mitigation | ~40 | Low | **Medium** (40% fewer calls) | None |
| 5 | LLM response cache | ~80 (new file) | Low | **Medium** (eliminates repeats) | None |
| 6 | Adaptive calibration | ~35 | Low | **Medium** (40-60% fewer cal calls) | #3 (confidence signal) |
| 1 | Async parallelism | ~120 across 5 agents | Medium | **High** (3-5x throughput) | None |
| 4 | Agent-level parallelism | ~50 in pipeline.ts | Medium | **Medium** (2x iteration speed) | #1 (conceptually) |
| 7 | Batch API | ~200+ (new infra) | High | **Medium** (50% cost, latency) | Defer |

**Recommended order:** #2 → #3 → #5 → #6 → #1 → #4 → #7 (defer)

---

## Documents Read

- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- `docs/planning/recommended_improvements_evolution_pipeline_20260131/recommended_improvements.md`

## Code Files Read

**Evolution pipeline (21 files):**
- `src/lib/evolution/types.ts` — shared interfaces (TextVariation, ExecutionContext, EvolutionLLMClient)
- `src/lib/evolution/config.ts` — defaults: 15 iterations, $5 budget, 5 calibration opponents, Elo constants
- `src/lib/evolution/index.ts` — public API re-exports
- `src/lib/evolution/core/llmClient.ts` — LLM client with budget enforcement, model passthrough
- `src/lib/evolution/core/pipeline.ts` — minimal + full pipeline orchestrators
- `src/lib/evolution/core/supervisor.ts` — EXPANSION→COMPETITION phase transitions
- `src/lib/evolution/core/pool.ts` — stratified opponent selection, pool health
- `src/lib/evolution/core/state.ts` — PipelineStateImpl, serialize/deserialize
- `src/lib/evolution/core/elo.ts` — adaptive K-factor Elo system
- `src/lib/evolution/core/costTracker.ts` — per-agent budget with 30% margin
- `src/lib/evolution/core/diversityTracker.ts` — pool diversity monitoring
- `src/lib/evolution/core/featureFlags.ts` — tournament/evolvePool/dryRun flags
- `src/lib/evolution/core/logger.ts` — structured logger
- `src/lib/evolution/core/validation.ts` — state contract validation
- `src/lib/evolution/agents/base.ts` — abstract AgentBase
- `src/lib/evolution/agents/generationAgent.ts` — 3-strategy text generation
- `src/lib/evolution/agents/calibrationRanker.ts` — pairwise calibration with bias mitigation
- `src/lib/evolution/agents/pairwiseRanker.ts` — A/B comparison, structured + simple modes
- `src/lib/evolution/agents/tournament.ts` — Swiss-style tournament
- `src/lib/evolution/agents/evolvePool.ts` — mutation + crossover + creative exploration
- `src/lib/evolution/agents/reflectionAgent.ts` — dimensional critique
- `src/lib/evolution/agents/proximityAgent.ts` — diversity tracking with embedding cache
- `src/lib/evolution/agents/metaReviewAgent.ts` — pure analysis, no LLM
- `src/lib/evolution/agents/formatRules.ts` — format rule constants
- `src/lib/evolution/agents/formatValidator.ts` — output format validation

**Supporting files:**
- `src/lib/services/llms.ts` — callOpenAIModel wrapper
- `src/lib/schemas/schemas.ts` — AllowedLLMModelType enum
- `src/config/llmPricing.ts` — centralized pricing table (50+ models)
- `src/lib/services/contentQualityCompare.ts` — lighter_model usage pattern
- `src/lib/services/explanationSummarizer.ts` — lighter_model usage pattern
- `src/lib/services/sourceSummarizer.ts` — lighter_model usage pattern
- `src/lib/services/contentQualityEval.ts` — lighter_model usage pattern
- `src/lib/services/costAnalytics.ts` — cost aggregation service

**Test files (14):**
- `src/lib/evolution/agents/pairwiseRanker.test.ts`
- `src/lib/evolution/agents/generationAgent.test.ts`
- `src/lib/evolution/agents/tournament.test.ts`
- `src/lib/evolution/agents/evolvePool.test.ts`
- `src/lib/evolution/agents/reflectionAgent.test.ts`
- `src/lib/evolution/agents/metaReviewAgent.test.ts`
- `src/lib/evolution/agents/proximityAgent.test.ts`
- `src/lib/evolution/agents/formatValidator.test.ts`
- `src/lib/evolution/core/state.test.ts`
- `src/lib/evolution/core/elo.test.ts`
- `src/lib/evolution/core/supervisor.test.ts`
- `src/lib/evolution/core/costTracker.test.ts`
- `src/lib/evolution/core/diversityTracker.test.ts`
- `src/lib/evolution/core/featureFlags.test.ts`
