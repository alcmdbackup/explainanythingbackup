# Make Competition More Efficient Plan

## Background
Optimize the evolution pipeline's competition phase to reduce LLM comparison calls. The pipeline currently runs pairwise comparisons on all variants equally, including underperformers. Since we only care about finding the best articles, variants with Elo below 1200 (the starting baseline) can be deprioritized or excluded from further comparisons to save cost and improve throughput.

## Requirements (from GH Issue #406)
1. We only care about finding the **top articles** — certainly those with rating above baseline (1200), and really only the **top 5 articles**. Focus competition resources on accurately ranking those; others can be roughly correct.
2. **Unify on OpenSkill** for everything, including Hall of Fame (currently Elo K-32). One rating system across within-run and cross-run comparisons.
3. Leverage OpenSkill's sigma (uncertainty) to allocate comparison budget: high-sigma top variants get more matches, low-ranked variants get fewer or none.
4. Variants below baseline rating can be deprioritized or excluded from further pairwise comparisons to save LLM calls.

## Problem
The evolution pipeline spends ~35% of its budget on pairwise comparisons (calibration 15% + tournament 20%), running 100-150 LLM comparison calls per run. These calls are distributed equally across all variants, including those already known to be below baseline. Since we only care about accurately ranking the top 5 articles, comparisons between two below-baseline variants are wasted. Additionally, the Hall of Fame uses a separate Elo K-32 system that lacks uncertainty tracking, preventing sigma-based budget allocation for cross-run comparisons.

## Options Considered

### Option A: Soft penalty weighting
- Add `belowBaselinePenalty` (0.1x) in `swissPairing()` for below-baseline pairs
- Increase `topKBoost` for top variants
- ~30% reduction but still wastes some budget on low-ranked comparisons

### Option B: Hard exclusion filter with AND logic (Selected)
- **Exclude** variants that are BOTH below baseline (ordinal < 0) AND outside top K
- Eligible for tournament = in top K OR above baseline (ordinal >= 0)
- Default K=5; above-baseline variants always participate regardless of rank
- Significant comparison reduction, minimal code change (filter before pairing)
- Calibration unchanged — new entrants still get rated to determine initial rank

### Option C: Full pool pruning
- Remove below-baseline variants entirely from pool after calibration
- Breaks "append-only pool" invariant, loses weak variants for crossover

**Decision: Option B** — maximum savings with minimal complexity. Two hard filters in `swissPairing()`.

## Execution Plan

### Step 1: Add `topK` config parameter
- Add `tournament.topK` to `EvolutionRunConfig` (default: 5)
- Wire through `config.ts` defaults and `resolveConfig()` merge

### Step 2: Filter eligible variants in `swissPairing()`
- Before scoring pairs, exclude variants that are BOTH:
  - Outside top K by ordinal AND
  - Below baseline (ordinal < 0, i.e., confidently below Elo 1200)
- Equivalently: eligible = in top K OR ordinal >= 0
- If fewer than 2 eligible variants remain, fall back to top 2 by ordinal

### Step 3: Top-K sigma convergence
- Change convergence check: only require sigma < threshold for eligible variants (in top K OR above baseline)
- Excluded variants can remain high-sigma → tournament stops earlier

**Files modified**: `tournament.ts`, `config.ts`, `types.ts`
**Tests modified**: `tournament.test.ts` (new test cases for filtering)

**Not changed**: `pool.ts` (calibration stays the same — we need full calibration to establish initial ranks), `supervisor.ts`, `hallOfFameActions.ts` (deferred to future PR)

## Testing

### Unit Tests (modify existing + new)
- `tournament.test.ts`: New tests for below-baseline exclusion, top-K filtering, top-K convergence
- Verify that with K=3, only top 3 variants participate in pairing
- Verify variants with ordinal < 0 are excluded even if in top K
- Verify convergence only checks top-K variants

### Manual Verification
- Run a full evolution pipeline locally with and without changes
- Compare: total comparisons, cost, top-3 ranking accuracy

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/rating_and_comparison.md` - Unify rating system description, remove two-system distinction, document top-K focus and below-baseline filtering
- `docs/evolution/hall_of_fame.md` - OpenSkill migration, sigma-based pairing, update Elo references
- `docs/evolution/cost_optimization.md` - Updated elo_per_dollar calculation, efficiency metrics
- `docs/evolution/architecture.md` - Document top-K convergence, below-baseline deprioritization
- `docs/evolution/README.md` - Update "Two Rating Systems" table to reflect unification
