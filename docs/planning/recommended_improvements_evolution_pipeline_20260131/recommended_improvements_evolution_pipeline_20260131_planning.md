# Recommended Improvements Evolution Pipeline Plan

## Background

The evolution pipeline (`src/lib/evolution/`) evolves text explanations through iterative generation, comparison, and selection using LLM calls orchestrated by a 2-phase supervisor (EXPANSION→COMPETITION). A set of 7 performance/cost improvements has been proposed in `recommended_improvements.md`. Research mapped all 7 recommendations to the TypeScript codebase and found that ~92% of LLM calls per iteration are comparisons, the model routing infrastructure already exists but is unused by agents, and the original parallel schedule has unsafe state mutation conflicts.

## Problem

The pipeline runs all LLM calls sequentially and uses `gpt-4.1-mini` ($0.40/M input) for trivial A/B comparisons that only need to output "A", "B", or "TIE". Every comparison runs twice for position-bias mitigation, doubling cost. There is no caching of comparison results, so re-matched pairs incur full LLM cost again. A typical COMPETITION iteration makes ~96 LLM calls, 88 of which are comparisons — the dominant cost and latency driver.

## Options Considered

Seven improvements were evaluated. After mapping to the codebase:

1. **Implement all 7** — Too large, #7 (Batch API) requires fundamental architecture changes
2. **Just #2 (tiered routing)** — Quick win but leaves other easy gains on table
3. **#2 + #3 + #5 + #6 (cost-focused, skip parallelism)** — Maximum cost reduction with minimal risk, defer throughput gains
4. **#2 + #3 + #5 + #6 + #1 (cost + throughput)** — Adds async parallelism for throughput; medium effort
5. **All except #7** — Includes agent-level parallelism (#4) which has state mutation risks

**Selected: Modified Option 4** — Implements #2, #5, #6, and #1 in priority order. Defers #3 (conditional bias mitigation), #4 (agent-level parallelism), and #7 (batch API). Each phase is independently testable and deployable.

## Phased Execution Plan

### Phase 1: Tiered Model Routing (#2)

**Goal:** Route comparison calls to `gpt-4.1-nano` (4x cheaper) while keeping generation calls on `gpt-4.1-mini`.

**Files to modify:**
- `src/lib/evolution/config.ts` — add `judgeModel` and `generationModel` to `EvolutionRunConfig`
- `src/lib/evolution/types.ts` — add optional model fields to `EvolutionRunConfig` interface (`judgeModel?: AllowedLLMModelType`, `generationModel?: AllowedLLMModelType`)
- `src/lib/evolution/agents/calibrationRanker.ts:56` — pass `{ model: ctx.payload.config.judgeModel }` to `complete()`
- `src/lib/evolution/agents/pairwiseRanker.ts:185` — same pattern
- `src/lib/evolution/core/llmClient.ts:13-14` — update `estimateTokenCost()` to accept model param for accurate cost estimation

**Config changes:**
```typescript
// config.ts additions
judgeModel: 'gpt-4.1-nano' as AllowedLLMModelType,
generationModel: 'gpt-4.1-mini' as AllowedLLMModelType,
```

**Key code change pattern (calibrationRanker.ts:56):**
```typescript
// Before:
const response = await ctx.llmClient.complete(prompt, this.name);
// After:
const response = await ctx.llmClient.complete(prompt, this.name, {
  model: ctx.payload.config.judgeModel,
});
```

**Tests to create/update:**
- **Create** `calibrationRanker.test.ts` (does not exist yet) — verify model option passed to mock LLM
- `pairwiseRanker.test.ts` — verify model passthrough
- `tournament.test.ts` — verify inherits from PairwiseRanker
- **Create** `config.test.ts` (does not exist yet) — verify `resolveConfig()` merges `judgeModel`/`generationModel` overrides correctly, verify partial overrides preserve defaults

**Verification:** Run existing test suite, then manually check LLM call tracking in DB confirms `gpt-4.1-nano` model for comparison calls on staging.

**Estimated lines changed:** ~20

---

### Phase 2: LLM Response Cache (#5)

**Goal:** Cache comparison results keyed on content hash to eliminate redundant LLM calls when the same pair is re-matched across iterations.

**Files to create:**
- `src/lib/evolution/core/comparisonCache.ts` — new module

**Files to modify:**
- `src/lib/evolution/agents/pairwiseRanker.ts` — wrap `compareWithBiasMitigation()` with cache lookup
- `src/lib/evolution/agents/calibrationRanker.ts` — wrap `compareWithBiasMitigation()` with cache lookup
- `src/lib/evolution/types.ts` — add `comparisonCache?: ComparisonCache` to `ExecutionContext`
- `src/lib/evolution/core/pipeline.ts` — instantiate cache and pass via context

**Cache design:**
```typescript
// comparisonCache.ts
import { createHash } from 'crypto';

interface CachedMatch {
  winnerId: string | null;
  loserId: string | null;
  confidence: number;
  isDraw: boolean;
}

export class ComparisonCache {
  private cache = new Map<string, CachedMatch>();

  // Key is order-invariant (sorted pair) — safe at compareWithBiasMitigation level
  // because the full bias-mitigated result is what we cache, not individual comparisons
  private makeKey(textA: string, textB: string, structured: boolean): string {
    const sorted = [textA, textB].sort();
    // Length-prefix to avoid delimiter collisions
    const payload = `${sorted[0].length}:${sorted[0]}|${sorted[1].length}:${sorted[1]}|${structured}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  get(textA: string, textB: string, structured: boolean): CachedMatch | undefined {
    return this.cache.get(this.makeKey(textA, textB, structured));
  }

  // Only cache valid results (winner resolved or explicit draw)
  set(textA: string, textB: string, structured: boolean, result: CachedMatch): void {
    if (result.winnerId !== null || result.isDraw) {
      this.cache.set(this.makeKey(textA, textB, structured), result);
    }
    // Skip caching error/null results to allow retry on next encounter
  }

  get size(): number { return this.cache.size; }
  clear(): void { this.cache.clear(); }
}
```

**IMPORTANT: Cache at `compareWithBiasMitigation()` level, NOT `comparePair()`.** Caching at `comparePair()` with order-invariant keys would make the reverse bias-mitigation call (B-vs-A) a false cache hit, returning the same result as (A-vs-B) and defeating position-bias mitigation entirely. The cache must wrap the full bias-mitigated Match result — the output of both forward + reverse calls.

**Integration in PairwiseRanker.compareWithBiasMitigation():**
```typescript
async compareWithBiasMitigation(ctx, idA, textA, idB, textB, structured) {
  // Check cache first (order-invariant — safe because we cache the full bias-mitigated result)
  if (ctx.comparisonCache) {
    const cached = ctx.comparisonCache.get(textA, textB, structured);
    if (cached) {
      ctx.logger.debug('Cache hit for bias-mitigated comparison', { structured });
      return cached;
    }
  }

  // Existing bias mitigation logic (forward + reverse LLM calls)...
  const match = { winnerId, loserId, confidence, isDraw };

  // Store in cache (only valid results — error/null results are NOT cached)
  ctx.comparisonCache?.set(textA, textB, structured, match);
  return match;
}
```

**Same pattern for CalibrationRanker.compareWithBiasMitigation()** — wraps the existing forward+reverse call logic.

**Tests to create:**
- `src/lib/evolution/core/comparisonCache.test.ts` — key generation, hit/miss, sorted-pair symmetry, size tracking, error result rejection (null winner not cached)
- `pairwiseRanker.test.ts` — new test: second `compareWithBiasMitigation()` with same texts returns cached result (mock LLM called twice for first, zero for second)
- `pairwiseRanker.test.ts` — new test: failed comparison (null winner) is NOT cached, subsequent call retries LLM

**Estimated lines changed:** ~80 (new file + wiring)

---

### Phase 3: Adaptive Calibration Opponents (#6)

**Goal:** Reduce calibration opponents for decisive matches — stop early when the outcome is clear.

**Confidence source:** CalibrationRanker's `compareWithBiasMitigation()` already returns agreement-based confidence derived from forward/reverse call agreement: 1.0 (both agree on winner), 0.7 (one wins + one draw), 0.5 (both draw), 0.3 (one draw + one reversal), 0.0 (full disagreement). No prompt or parsing changes needed. The early-exit threshold should use `>= 0.7` (partial agreement or better) rather than `>= 0.9` since 0.9 is never produced by the agreement scale.

**Files to modify:**
- `src/lib/evolution/agents/calibrationRanker.ts:124-159` — add early-exit logic in opponent loop
- `src/lib/evolution/config.ts` — add `calibration.minOpponents` config (default: 2)

**Key code change (calibrationRanker.ts inner loop):**
```typescript
let consecutiveDecisive = 0;
const minOpponents = ctx.payload.config.calibration.minOpponents ?? 2;

for (const oppId of opponentIds) {
  // ... existing comparison logic ...

  // Adaptive early exit: if first N matches are decisive, stop early
  if (match.confidence >= 0.7) {
    consecutiveDecisive++;
  } else {
    consecutiveDecisive = 0;
  }

  if (consecutiveDecisive >= minOpponents && matches.length >= minOpponents) {
    logger.debug('Adaptive calibration: early exit', {
      entrantId, matchesPlayed: matches.length, consecutiveDecisive,
    });
    break;
  }
}
```

**Config addition:**
```typescript
calibration: { opponents: 5, minOpponents: 2 },
```

**Tests to create/update:**
- `calibrationRanker.test.ts` (created in Phase 1) — new test: 2 consecutive decisive matches (confidence >= 0.7) → exits with 2 opponents
- `calibrationRanker.test.ts` — new test: mixed confidence → uses all 5 opponents
- `config.test.ts` (created in Phase 1) — verify `resolveConfig()` merges partial `calibration: { minOpponents }` without losing existing `opponents` value

**Estimated lines changed:** ~35

---

### Phase 4: Async Parallelism Within Agents (#1)

**Goal:** Replace sequential `for...of` loops with `Promise.all` within each agent for 3-5x throughput.

**Files to modify:**
- `src/lib/evolution/agents/generationAgent.ts:76-105`
- `src/lib/evolution/agents/evolvePool.ts:173-213`
- `src/lib/evolution/agents/reflectionAgent.ts:119-139`
- `src/lib/evolution/agents/calibrationRanker.ts:136-159` (opponent loop per entrant)
- `src/lib/evolution/agents/tournament.ts:211-234` (pairs within a round)

**Pattern for each agent:**
```typescript
// Before (generationAgent.ts):
for (const strategy of STRATEGIES) {
  const generatedText = await llmClient.complete(prompt, this.name);
  // ... validate, create variation
  state.addToPool(variation);
}

// After:
const results = await Promise.allSettled(
  STRATEGIES.map(async (strategy) => {
    const prompt = buildPrompt(strategy, text, feedback);
    const generatedText = await llmClient.complete(prompt, this.name);
    const fmtResult = validateFormat(generatedText);
    if (!fmtResult.valid) return null;
    return { text: generatedText.trim(), strategy };
  })
);

// Mutate state sequentially after all promises resolve
for (const result of results) {
  if (result.status === 'fulfilled' && result.value) {
    const variation: TextVariation = {
      id: uuidv4(),
      text: result.value.text,
      version: state.iteration + 1,
      parentIds: [],
      strategy: result.value.strategy,
      createdAt: Date.now() / 1000,
      iterationBorn: state.iteration,
    };
    state.addToPool(variation);
  }
}
```

**Calibration parallelism — batched with adaptive exit (compatible with Phase 3):**

Phase 3 adds sequential early-exit after `minOpponents` decisive matches. Full `Promise.allSettled` over all opponents would fire all calls upfront, defeating early exit. Instead, use batched parallelism: run `minOpponents` opponents concurrently, check for early exit, then optionally continue with remaining opponents.

```typescript
// Batched parallelism: run minOpponents concurrently, then decide
const minOpp = ctx.payload.config.calibration.minOpponents ?? 2;
const firstBatch = opponentIds.slice(0, minOpp);
const remainingBatch = opponentIds.slice(minOpp);

// Run first batch in parallel
const firstResults = await Promise.allSettled(
  firstBatch.map(async (oppId) => {
    const oppVar = varLookup.get(oppId);
    if (!oppVar) return null;
    return this.pairwise.compareWithBiasMitigation(
      ctx, entrantId, entrantVar.text, oppId, oppVar.text, true
    );
  })
);

// Check for early exit: all decisive?
const allDecisive = firstResults
  .filter(r => r.status === 'fulfilled' && r.value)
  .every(r => r.value.confidence >= 0.7);

if (!allDecisive && remainingBatch.length > 0) {
  // Run remaining opponents in parallel
  const moreResults = await Promise.allSettled(
    remainingBatch.map(async (oppId) => { /* same pattern */ })
  );
  // Merge results
}

// Apply Elo updates sequentially after all batches complete
```

**Tournament parallelism — Swiss pairs within a round:**
```typescript
const matchResults = await Promise.allSettled(
  pairs.map(async ([varA, varB]) => {
    return this.runComparison(ctx, varA, varB, useMultiTurn, structured);
  })
);
// Apply Elo updates sequentially
```

**Critical constraints:**
- `state.addToPool()` and Elo updates must remain sequential after Promise.all resolves. Collect results first, mutate second.
- `costTracker.reserveBudget()` is NOT concurrency-safe: it reads `totalSpent`, checks against cap, but does not atomically increment. Under `Promise.all`, N concurrent calls can all pass the budget check before any LLM call completes, then all call `recordSpend`, exceeding the budget cap. **Fix:** Add optimistic reservation — increment `totalSpent` in `reserveBudget()` by the estimated cost, then reconcile the delta in `recordSpend()`. This ensures the budget check is atomic even under concurrent access.

**Tests to update:**
- All agent tests — verify same outcomes with parallel execution
- New concurrency ordering test: mock LLM with `jest.fn().mockImplementation(() => new Promise(r => setTimeout(r, Math.random() * 50)))` to simulate variable-latency responses. Assert that state mutations (pool additions, Elo updates) only happen after all promises resolve by checking mutation timestamps or call order on mocks.
- `costTracker.test.ts` — new test: simulate N concurrent `reserveBudget()` calls, verify total reserved does not exceed budget cap + safety margin

**Estimated lines changed:** ~120 across 5 agents

---

## Testing

### Unit Tests (per phase)

| Phase | Tests to Modify | Tests to Create |
|-------|----------------|-----------------|
| 1 | `pairwiseRanker.test.ts`, `tournament.test.ts` | `calibrationRanker.test.ts` (new), `config.test.ts` (new) |
| 2 | `pairwiseRanker.test.ts`, `calibrationRanker.test.ts` | `comparisonCache.test.ts` (new), error-rejection + bias-safety tests |
| 3 | `calibrationRanker.test.ts`, `config.test.ts` | Adaptive exit tests, partial config merge tests |
| 4 | All 5 agent test files, `costTracker.test.ts` | Concurrent ordering tests (random-delay mocks), budget reservation tests |

### Integration Tests

- After each phase: run existing `npm run test:unit` to verify no regressions
- After Phase 1: verify LLM call tracking in DB shows `gpt-4.1-nano` for comparison calls
- After Phase 4: run pipeline end-to-end and compare Elo distributions to baseline

### Manual Verification (Staging)

- Run a full evolution pipeline on staging after each phase
- Compare cost per iteration (should decrease with each phase)
- Verify Elo ranking quality is preserved (top variant Elo should be similar ± noise)
- Check `daily_llm_costs` view for model-specific cost breakdowns

## Rollback & Quality Gates

Each phase is independently deployable. If a phase degrades quality, revert the specific config/code change without affecting other phases.

**Quality gate (run on staging after each phase):**
1. Run a full evolution pipeline (15 iterations) on a standard test topic
2. Compare top-3 variant Elo scores to baseline run — accept if within ±50 Elo points (typical inter-run noise)
3. Compare cost per iteration to baseline — Phase 1 should show ~4x reduction in comparison costs, Phase 2 should show cache hit rate > 0% by iteration 3+, Phase 3 should show fewer calibration calls for decisive matches
4. Check `daily_llm_costs` view for unexpected cost spikes

**Rollback procedure per phase:**
- **Phase 1:** Revert `judgeModel` to `gpt-4.1-mini` in config.ts (one-line change). All agents fall back to default model.
- **Phase 2:** Remove `comparisonCache` from `ExecutionContext` instantiation in pipeline.ts. Cache lookups are already guarded by `if (ctx.comparisonCache)`, so agents degrade gracefully to uncached behavior.
- **Phase 3:** Set `calibration.minOpponents` to equal `calibration.opponents` (5) in config.ts. This disables early exit without removing any code.
- **Phase 4:** Replace `Promise.allSettled` calls with original sequential `for...of` loops. Each agent's parallelism is self-contained.

**Feature flags:** The codebase has `featureFlags.ts` with DB-backed toggles. Consider gating Phases 1-3 behind feature flags for gradual rollout, especially Phase 1 (model routing) which could surface quality differences between nano and mini models.

## Documentation Updates

- `docs/feature_deep_dives/search_generation_pipeline.md` — add section on evolution pipeline optimization (model routing, caching, adaptive calibration)
- `docs/docs_overall/architecture.md` — update evolution pipeline description if agent interaction pattern changes
- `.claude/doc-mapping.json` — already updated with evolution pattern mappings

---

## Appendix: Deferred Improvements

### Deferred: Conditional Position-Bias Mitigation (#3)

**Status:** Deferred — revisit after Phases 1-4 are deployed and cost savings measured.

**Goal:** Run the reverse comparison (B-vs-A) only when the first comparison is uncertain, cutting ~40% of comparison LLM calls.

**Rationale for deferral:** Requires careful tuning of the confidence threshold and risk assessment of bias creep. The tiered routing (Phase 1) already delivers the largest cost reduction. This can be layered on later with real production data to validate that skipping the reverse call doesn't degrade ranking quality.

**Implementation sketch:**
- In `PairwiseRanker.compareWithBiasMitigation()` (lines 196-252): after the first comparison, check `confidence >= 0.9`. If decisive, skip the reverse call and return early.
- In `CalibrationRanker.compareWithBiasMitigation()` (lines 64-107): same pattern, but requires adding confidence parsing to its simpler prompt first.
- Add a feature flag `conditionalBiasMitigation: boolean` to `EvolutionRunConfig` so it can be toggled per-run.
- Tests: verify that high-confidence matches skip the reverse call, low-confidence matches still run both.

**Estimated impact:** ~40% fewer comparison LLM calls (stacks with tiered routing for compound savings).

### Deferred: Agent-Level Parallelism (#4)

**Status:** Deferred — feasible with snapshot isolation, but lower priority than cost optimizations. Revisit after Phases 1-4.

**Goal:** Run compatible agents concurrently within an iteration for ~30-50% COMPETITION phase speedup.

#### Conflict Analysis

Every agent directly mutates shared `PipelineStateImpl`. Key conflicts:

| Mutation Target | Writers | Readers | Conflict |
|---|---|---|---|
| `pool` (via `addToPool()`) | Generation, Evolution | All agents | Append during read |
| `eloRatings` / `matchCounts` | Calibration, Tournament, `addToPool()` | Reflection, Evolution, Proximity | Write during read |
| `newEntrantsThisIteration` | Generation (append) | Calibration, Proximity | Append during read |
| `dimensionScores` / `allCritiques` | Reflection only | — | No conflict |
| `similarityMatrix` / `diversityScore` | Proximity only | Meta-Review | No conflict |

`addToPool()` (`state.ts:37-46`) mutates 5 fields in one call and is not reentrant-safe — concurrent calls with the same `variation.id` can double-initialize Elo ratings.

#### Safe Parallel Grouping

Only **Reflection + Evolution** can safely run in parallel (in COMPETITION):
- Both only _read_ pool and Elo (to select variants)
- Writes don't overlap: Reflection → `dimensionScores`/`allCritiques`; Evolution → `pool` via `addToPool()`
- Risk: Evolution appending to pool mid-read → solved by **frozen snapshot**

EXPANSION phase has minimal opportunity (only 3 agents, Generation must be first, Calibration depends on `newEntrantsThisIteration`).

#### Recommended Schedule (COMPETITION only)

```
Step 1: Generation                        (must be first — populates pool)
Step 2: Reflection || Evolution           (parallel, with pool/Elo snapshot)
Step 3: Tournament                        (sequential — heavy Elo mutations)
Step 4: Proximity                         (reads final Elo + pool)
Step 5: Meta-Review                       (reads everything)
```

Collapses 6 sequential steps to 5 with Reflection + Evolution overlapping.

#### Recommended Strategy: Snapshot-Based Isolation

Four strategies were evaluated:

| Strategy | Safety | Effort | Deterministic? |
|---|---|---|---|
| **Snapshot isolation** | Very safe | Low-Medium | Yes |
| Mutex/locking | Risky (deadlocks) | High | No |
| Accumulator pattern | Very safe | Very high | Yes |
| Separate R/W state types | Very safe | High | Yes |

**Snapshot isolation** is the clear winner. Freeze pool + Elo after Generation completes, pass frozen copies to Reflection and Evolution. Both agents read from the snapshot; writes go to live state but are sequenced by `Promise.all` completion.

```typescript
// After Generation completes:
const poolSnapshot = Object.freeze([...ctx.state.pool]);
const eloSnapshot = new Map(ctx.state.eloRatings);

// Parallel execution with snapshots
await Promise.all([
  runAgent(runId, agents.reflection, { ...ctx, _poolSnapshot: poolSnapshot, _eloSnapshot: eloSnapshot }, phase, logger),
  runAgent(runId, agents.evolution, { ...ctx, _poolSnapshot: poolSnapshot, _eloSnapshot: eloSnapshot }, phase, logger),
]);

// Tournament runs after both complete — sees all mutations
await runAgent(runId, agents.tournament, ctx, phase, logger);
```

#### Files to Modify

- `src/lib/evolution/core/pipeline.ts` — parallel dispatch in COMPETITION iteration
- `src/lib/evolution/types.ts` — add optional `_poolSnapshot` / `_eloSnapshot` to `ExecutionContext`
- `src/lib/evolution/agents/reflectionAgent.ts` — read from snapshot when available
- `src/lib/evolution/agents/evolvePool.ts` — read from snapshot when available
- `src/lib/evolution/core/state.ts` — add `snapshot()` helper method

#### Estimated Impact

- ~30-50% iteration time reduction in COMPETITION phase (Reflection + Evolution overlap)
- Minimal benefit in EXPANSION (only 3 agents, tight dependencies)
- ~60-80 lines changed across 5 files

### Deferred: OpenAI Batch API (#7)

**Status:** Deferred — requires fundamental architecture changes (async job queue, polling, callback pattern).

**Why:** The pipeline currently runs synchronously within a single request. Batch API requires submitting jobs and polling for results on a 24h SLA, which needs a job queue and webhook/polling infrastructure that doesn't exist.
