# Debug Run 3345a6ab In Stage Producing 4 Variants 1200 Elo Only Research

## Problem Statement
Debug why evolution run 3345a6ab in staging is producing only 4 variants all stuck at 1200 Elo, indicating ranking/rating is not working correctly.

## Requirements (from GH Issue #822)
1. Query run 3345a6ab data from staging database
2. Check variant count and Elo values
3. Inspect ranking logs for errors or skipped phases
4. Identify root cause of why variants are not being rated
5. Fix and verify the issue

## High Level Summary

Run `3345a6ab-7662-4e5c-be1e-724934fa6d38` completed with `stopReason: budget_exceeded` after 1 iteration. Budget was $0.05. Generation cost $0.0024, ranking cost $0.0465 (93% of budget). The ranking agent threw `BudgetExceededError` mid-Swiss-round and was marked `success: false`. All partial rating results from ~48 comparisons were discarded. Four variants were persisted with default mu=25 / sigma=8.333 / elo=1200.

Two contributing issues:
1. **Partial results lost** — ranking agent discards all ratings on budget error
2. **Swiss eligibility too permissive** — nearly all 27 arena entries pass the current filter, wasting comparisons on well-calibrated non-contenders

### DB Query Results

| Field | Value |
|-------|-------|
| Run ID | `3345a6ab-7662-4e5c-be1e-724934fa6d38` |
| Status | completed |
| Budget | $0.05 |
| Stop reason | budget_exceeded |
| Total iterations | 1 |
| Match stats | `{ totalMatches: 0, avgConfidence: 0, decisiveRate: 0 }` |
| Variants | 4 (all mu=25, sigma=8.333, elo=1200, matches=0) |
| Arena entries loaded | 27 |

### Invocations

| Iter | Agent | Success | Cost | Error |
|------|-------|---------|------|-------|
| 1 | generation | true | $0.0024 | none |
| 1 | ranking | **false** | $0.0465 | Budget exceeded: spent $0.0488 + $0.0014 reserved = $0.0502, cap $0.0500 |

### Root Cause 1: Partial Ranking Results Lost

When `BudgetExceededError` is thrown during ranking:

1. **`rankPool()`** in `rankVariants.ts` does NOT catch the error or wrap partial results — it re-throws plain `BudgetExceededError`
2. **`Agent.run()`** base class catches it and returns `{ success: false, result: null, budgetExceeded: true }` — no `partialResult`
3. **`runIterationLoop.ts`** (lines 195-198) checks `rankPhase.budgetExceeded` but does NOT check for `partialResult` — immediately breaks without applying any ratings

Compare to generation (lines 161-167), which correctly:
- Uses `Promise.allSettled()` to collect completed variants
- Wraps them in `BudgetExceededWithPartialResults`
- The loop handler extracts `partialResult` and adds variants to pool

### Root Cause 2: Swiss Eligibility Filter Too Permissive

**Current filter** (rankVariants.ts lines 444-454):
```typescript
const getEligibleIds = (): string[] => {
  return pool
    .filter((v) => !eliminatedIds.has(v.id))
    .filter((v) => {
      const r = localRatings.get(v.id);
      if (!r) return false;
      return r.mu >= 3 * r.sigma || topKIds.has(v.id);
    })
    .map((v) => v.id);
};
```

Problem: `mu >= 3 * sigma` passes for nearly all calibrated arena entries (e.g., mu=20, sigma=4 → 20 >= 12 ✓). This means ~27 arena entries + 3 new variants = ~30 eligible for Swiss, generating ~15 matches per round across many variants that have no realistic chance of being in the top 15%.

### Git History: Eligibility Filter Evolution

The eligibility filter was **never removed** — it evolved across the V1→V2 rewrite:

| Version | Filter | Source |
|---------|--------|--------|
| V1 (PR #409, commit `be8184e9`) | `ordinal >= 0` (above baseline) OR in top-K | `src/lib/evolution/agents/tournament.ts` |
| V2 (PR #716, commit `9f4c6e46`) | `mu >= 3 * sigma` OR in top-K(5) | `evolution/src/lib/pipeline/loop/rankVariants.ts` |

The V2 version refined the statistical test but kept the same structural approach. The filter was designed for pools where most variants are new (high sigma). It was NOT designed for pools dominated by well-calibrated arena entries (low sigma), where `mu >= 3 * sigma` passes trivially for all converged variants regardless of their rank in the pool.

### Key Code Files

| File | Role |
|------|------|
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts:195-198` | Where partial ratings are NOT extracted (fix point in loop) |
| `evolution/src/lib/pipeline/loop/rankVariants.ts:444-454` | Swiss eligibility filter (too permissive) |
| `evolution/src/lib/pipeline/loop/rankVariants.ts:305-308` | Triage top-20% cutoff computation |
| `evolution/src/lib/core/Agent.ts:48-76` | Base class catch — works correctly for both error types |
| `evolution/src/lib/pipeline/loop/generateVariants.ts:59-94` | Reference: how generation correctly preserves partial results |
| `evolution/src/lib/pipeline/infra/errors.ts` | `BudgetExceededWithPartialResults` class definition |
| `evolution/src/lib/pipeline/finalize/persistRunResults.ts:184-206` | Variant upsert — falls back to default mu=25 when ratings Map is empty |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/architecture.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- docs/docs_overall/debugging.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/data_model.md
- evolution/docs/cost_optimization.md
- docs/feature_deep_dives/evolution_logging.md

## Code Files Read
- evolution/src/lib/pipeline/loop/runIterationLoop.ts
- evolution/src/lib/pipeline/loop/rankVariants.ts
- evolution/src/lib/pipeline/loop/generateVariants.ts
- evolution/src/lib/core/Agent.ts
- evolution/src/lib/pipeline/infra/errors.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.ts
- evolution/src/lib/shared/computeRatings.ts
- evolution/src/lib/schemas.ts
- evolution/src/lib/pipeline/setup/buildRunContext.ts
