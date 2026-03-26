# Debug Run 3345a6ab In Stage Producing 4 Variants 1200 Elo Only Plan

## Background
Evolution run 3345a6ab in staging produced only 4 variants all stuck at 1200 Elo. The ranking agent performed ~48 comparisons but threw `BudgetExceededError` mid-Swiss-round. All partial rating results were discarded because `rankPool()` doesn't wrap partial results like `generateVariants()` does. Additionally, the Swiss eligibility filter is too permissive — nearly all 27 arena entries passed `mu >= 3 * sigma`, wasting comparisons on non-contenders.

## Requirements (from GH Issue #822)
1. Query run 3345a6ab data from staging database
2. Check variant count and Elo values
3. Inspect ranking logs for errors or skipped phases
4. Identify root cause of why variants are not being rated
5. Fix and verify the issue

## Problem
Two issues compound to produce variants with default 1200 Elo:

1. **Partial results lost on budget error.** When `BudgetExceededError` is thrown during ranking, `rankPool()` re-throws without wrapping partial results. The `Agent.run()` base class returns `{ result: null, budgetExceeded: true }` with no `partialResult`. The loop handler breaks without applying any of the ~48 comparisons' rating updates.

2. **Swiss eligibility too broad.** The current filter (`mu >= 3 * sigma || in topK`) admits nearly all calibrated arena entries. With 27 arena entries at low sigma, ~30 variants enter Swiss fine-ranking. This wastes comparisons re-ranking well-calibrated entries that have no realistic chance of being in the top 15%.

## Options Considered

### Bug 1: Partial results preservation

**Option A: Wrap in `BudgetExceededWithPartialResults` (chosen)**
- Catch `BudgetExceededError` in `rankPool()`, build partial `RankResult`, throw wrapped error
- Mirror generation agent pattern
- **Pros:** Follows existing pattern, minimal new code
- **Cons:** Need to generalize `partialVariants` from `Variant[]` to `unknown` to support `RankResult`

**Option B: Return partial `RankResult` with `budgetExceeded` flag**
- Larger refactor, changes `RankResult` type signature
- **Rejected:** More invasive than needed

### Bug 2: Swiss eligibility filter

**Option A: Top-15% upper-bound filter (chosen)**
- Replace `mu >= 3 * sigma` with `mu + 1.04 * sigma >= top15Cutoff`
- A variant is eligible if its 85th-percentile estimate could place it in the top 15%
- Always include new entrants (high sigma = wide upper bound = pass automatically)
- Keep topK safety net for edge cases
- **Pros:** Statistically principled, handles arena-heavy pools, new variants auto-qualify via high sigma

**Option B: Hard cap on Swiss pool size**
- Cap at e.g. 15 variants, sorted by mu
- **Rejected:** Arbitrary, doesn't account for uncertainty

## Phased Execution Plan

### Phase 1: Generalize `BudgetExceededWithPartialResults` and `Agent.run()`
- [ ] In `evolution/src/lib/pipeline/infra/errors.ts`, change `partialVariants: Variant[]` to `partialData: unknown` on `BudgetExceededWithPartialResults`
  - Current: `constructor(public readonly partialVariants: Variant[], originalError: BudgetExceededError)`
  - After: `constructor(public readonly partialData: unknown, originalError: BudgetExceededError)`
- [ ] In `evolution/src/lib/core/Agent.ts:59`, change `error.partialVariants` → `error.partialData`
  - Current: `partialResult: (error as BudgetExceededWithPartialResults).partialVariants`
  - After: `partialResult: (error as BudgetExceededWithPartialResults).partialData`
- [ ] Update the one existing callsite in `generateVariants.ts` that constructs `BudgetExceededWithPartialResults(variants, budgetError)` — no change needed since `Variant[]` is assignable to `unknown`
- [ ] Update the one existing callsite in `runIterationLoop.ts` that reads `genResult.partialResult` — add type assertion: `genResult.partialResult as Variant[]`
- [ ] Run lint + tsc + existing tests to verify no regressions

### Phase 2: Preserve partial ranking results on budget error

**Key insight:** `BudgetExceededError` propagates from `llm.complete()` → `runComparison()` → `executeTriage()`/`executeFineRanking()` unhandled. Partial state (matches, ratings) is accumulated inside these functions and would be lost if the try-catch is only at `rankPool()` scope. The fix must add try-catch **inside** `executeTriage()` and `executeFineRanking()` to capture internal partial state before re-throwing.

- [ ] In `executeTriage()`, wrap the per-entrant comparison loop in try-catch for `BudgetExceededError`. On catch, return a partial `TriageResult` with matches/ratings accumulated so far (variables `triageMatches`, `localRatings`, `matchCounts` are in scope).
- [ ] In `executeFineRanking()`, wrap the Swiss round loop in try-catch for `BudgetExceededError`. On catch, return a partial `FineRankingResult` with matches/ratings accumulated so far.
- [ ] In `rankPool()`, after calling `executeTriage()` and `executeFineRanking()`, merge their results into `allMatches`, `currentRatings`, `currentCounts` (the actual variable names at rankPool scope, lines 587-590).
- [ ] If either phase returned due to budget error, build partial `RankResult` from merged state: `{ matches: allMatches, ratingUpdates: Object.fromEntries(currentRatings), matchCountIncrements: Object.fromEntries(currentCounts), converged: false }`
- [ ] Throw `new BudgetExceededWithPartialResults(partialRankResult, error)` with the partial `RankResult` as payload
- [ ] Run lint + tsc + existing ranking tests

### Phase 3: Extract partial ranking results in loop handler
- [ ] In `runIterationLoop.ts` ranking budget handler (lines 195-198), check for `rankPhase.partialResult`
- [ ] If present, cast to `RankResult` and apply:
  - Rating updates → `ratings` Map
  - Match count increments → `matchCounts`
  - Matches → `allMatches`
- [ ] Mirror the generation handler pattern (lines 161-167)
- [ ] Run lint + tsc + existing loop tests

### Phase 4: Tighten Swiss eligibility filter to top-15% contenders
- [ ] Extract `1.04` to a named constant: `const ELIGIBILITY_Z_SCORE = 1.04; // 85th percentile — 15% chance variant is this good or better`
- [ ] In `executeFineRanking()` in `rankVariants.ts`, replace the eligibility check:
  - **Before:** `r.mu >= 3 * r.sigma || topKIds.has(v.id)`
  - **After:** `r.mu + ELIGIBILITY_Z_SCORE * r.sigma >= top15Cutoff || topKIds.has(v.id)`
- [ ] Compute `top15Cutoff` from sorted mu values of non-eliminated variants: `allMus[Math.max(0, Math.floor(allMus.length * 0.15) - 1)]`
- [ ] Recompute both `top15Cutoff` and `topKIds` each Swiss round (inside `getEligibleIds()`) since ratings change between rounds. Currently `topKIds` is computed once before the loop (lines 437-442) — move it inside `getEligibleIds()` alongside the new cutoff computation.
- [ ] Add minimum pool floor: if eligible count < 3 after filter, fall back to top-3 by mu to avoid degenerate 1-2 variant pools
- [ ] Keep `topKIds` safety net (top 5 by mu always eligible)
- [ ] Log the filter: `"Swiss eligibility: X of Y variants pass top-15% filter"`
- [ ] Run lint + tsc + existing ranking tests

### Phase 5: Update convergence checking
- [ ] Verify convergence check in Swiss already uses `getEligibleIds()` — if so, Phase 4's tighter filter automatically applies (no change needed, just verify)
- [ ] Add unit test confirming convergence only checks top-15% contenders
- [ ] Run lint + tsc

### Phase 6: Tests
- [ ] Unit test: `rankPool()` throws `BudgetExceededWithPartialResults` with partial `RankResult` when budget exceeded mid-triage
- [ ] Unit test: `rankPool()` throws `BudgetExceededWithPartialResults` with partial `RankResult` when budget exceeded mid-Swiss
- [ ] Unit test: `runIterationLoop` applies partial ranking results (mu/sigma/matches) before breaking on budget error
- [ ] Unit test: Swiss eligibility filter excludes low-mu calibrated variants (mu=15, sigma=3 → upper bound 18.12 < top15Cutoff=25)
- [ ] Unit test: Swiss eligibility filter includes high-sigma new variants (mu=25, sigma=8.333 → upper bound 33.7)
- [ ] Unit test: Swiss eligibility filter includes topK variants regardless of upper bound
- [ ] Unit test: Swiss eligibility filter minimum pool floor activates when < 3 eligible
- [ ] Unit test: convergence checking uses tightened eligibility set
- [ ] Integration test: mock LLM + arena-heavy pool (20+ entries) + small budget → partial results preserved with non-default elo. Test file: `evolution/src/lib/pipeline/__tests__/rankPartialResults.test.ts`. Uses mocked `callLLM` and in-memory pool (no real DB needed).
- [ ] Verify existing ranking tests still pass (run full `jest --testPathPattern=evolution` suite)

### Phase 7: Verify fix on staging
- [ ] Deploy to staging (push to branch, Vercel preview deploy)
- [ ] Re-run evolution with same prompt and $0.05 budget
- [ ] Confirm variants have non-default mu/elo values
- [ ] Confirm `run_summary.matchStats.totalMatches > 0`
- [ ] Confirm Swiss eligibility log shows reduced pool size (e.g., 8-10 instead of 30)

## Testing
- Unit tests for `BudgetExceededWithPartialResults` generalization (verify existing gen tests pass)
- Unit tests for `rankPool()` partial result handling — throws with embedded `RankResult` (new)
- Unit tests for `runIterationLoop` partial ranking extraction (new)
- Unit tests for Swiss eligibility filter with top-15% cutoff + minimum pool floor (new)
- Unit test for convergence with tightened eligibility (new)
- Integration test with mocked LLM (no real DB) in `evolution/src/lib/pipeline/__tests__/rankPartialResults.test.ts`
- Existing `rankPool` and generation test suites must continue to pass
- Manual verification on staging with small-budget run

All test files in `evolution/src/lib/pipeline/__tests__/` per codebase convention.

## Rollback Plan
If ranking quality degrades after deployment:
1. **Revert Swiss filter only**: Change `ELIGIBILITY_Z_SCORE` back to the old `mu >= 3 * sigma` check. The partial results fix (Phases 1-3) is always safe and can stay.
2. **Full revert**: `git revert` the PR. No schema changes or migrations are involved — this is purely TypeScript logic.
3. **Detection**: Monitor `evolution_metrics` for `avg_final_elo` regression across runs. If avg Elo drops below previous baseline after 5+ runs, investigate.

The two fixes are independent — partial results preservation (Phases 1-3) can ship without the eligibility filter (Phase 4), and vice versa. This allows partial revert if only one causes issues.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/architecture.md` - Add note about partial result preservation on budget errors
- `evolution/docs/rating_and_comparison.md` - Document Swiss eligibility change from `mu >= 3*sigma` to top-15% upper-bound filter
- `evolution/docs/cost_optimization.md` - Document that ranking now preserves partial results and uses tighter Swiss eligibility to reduce comparison costs
