# Improvements to Evolution Including Speeding Up Plan

## Background
The evolution pipeline iteratively improves text content via 8 LLM-driven agents, Elo-based ranking, and a two-phase supervisor (EXPANSION → COMPETITION). Tournament and calibration dominate wall-clock time (~90% per iteration) because every pairwise comparison requires two sequential LLM calls (position-bias mitigation) and the Swiss pairing algorithm produces suboptimal matchups that waste comparison budget on uninformative pairs. A previous project (`recommended_improvements_evolution_pipeline_20260131`) implemented 4 of 7 proposed improvements; this project targets the two highest-value remaining speedups.

## Problem
Each pairwise comparison runs forward (A vs B) then reverse (B vs A) **sequentially**, doubling wall-clock time despite the two calls being completely independent. Additionally, the Swiss pairing in `tournament.ts` uses greedy adjacent matching after Elo sort, which often pairs variants with well-established ratings against each other — producing low-information matches that waste LLM budget. Together, these inefficiencies cause tournament rounds to run slower and require more rounds than necessary to converge on stable rankings.

## Options Considered
See research doc, section "Speed Improvement Options Evaluated" for the full 7-option analysis. Summary of decisions:

| # | Approach | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Conditional bias mitigation | DEFERRED | Diminishing returns if parallel rounds implemented |
| 2 | **Parallel bias mitigation rounds** | **SELECTED** | ~50% faster per comparison, ~5 lines |
| 3 | **Info-theoretic Swiss pairing** | **SELECTED** | ~35-45% fewer rounds, ~55 lines |
| 4 | Agent-level parallelism | DEFERRED | ~3-4% gain for ~95 lines of risky code |
| 5 | Budget pressure tuning | DEFERRED | Config-only, do separately |
| 6 | Prompt shortening | DEFERRED | Orthogonal to architecture |
| 7 | Batch API | DEFERRED | Using DeepSeek, not applicable |

For pairing algorithm: chose **Approach A** (sigma-weighted info-theoretic pairing using `matchCount` as uncertainty proxy) over Approach B (replacing Elo with OpenSkill). Rationale: no new dependencies, small surface area, preserves all existing Elo infrastructure.

## Phased Execution Plan

### Phase 1: Parallel Bias Mitigation Rounds
**Goal**: Run Round 1 (A vs B) and Round 2 (B vs A) concurrently via `Promise.all`.

**Why `Promise.all` (not `Promise.allSettled`)**: Each `comparePair` has an internal try/catch that returns `{ winner: null }` on non-budget errors. Only `BudgetExceededError` propagates — and that should abort the entire comparison, which `Promise.all` does correctly (rejects immediately). The in-flight second call finishes silently; its result is discarded. This matches the existing error semantics where a budget abort in any comparison aborts the agent.

**Files to modify**:
1. `src/lib/evolution/agents/calibrationRanker.ts` — `compareWithBiasMitigation()` (lines 89-92)
   - Change sequential `await` calls to `const [r1raw, r2raw] = await Promise.all([this.comparePair(...), this.comparePair(...)])`
   - Rest of the method (normalization, agreement logic, caching) remains identical

2. `src/lib/evolution/agents/pairwiseRanker.ts` — `compareWithBiasMitigation()` (lines 224-228)
   - Same change: `Promise.all` for the two `comparePair` calls
   - Normalization and merging logic unchanged

**Test interleaving impact**: The outer `Promise.allSettled` in `CalibrationRanker.execute()` (line 189) runs multiple `compareWithBiasMitigation` calls in parallel. Currently with sequential inner calls, the mock `callIndex` interleaves as: `comp1-fwd, comp2-fwd, comp1-rev, comp2-rev`. After this change, inner calls are grouped: `comp1-fwd, comp1-rev, comp2-fwd, comp2-rev`. This breaks the hardcoded mock response arrays in `calibrationRanker.test.ts`.

**Tests to update**:
- `src/lib/evolution/agents/calibrationRanker.test.ts`:
  - **FIX** "exits early after minOpponents decisive matches" test (line 157): Response array must change from `['A','A','B','B',...]` (interleaved) to `['A','B','A','B',...]` (grouped: comp1-fwd=A, comp1-rev=B→normalized=A→agreement, comp2-fwd=A, comp2-rev=B→normalized=A→agreement). Update comments to explain new interleaving order. **Note**: Verify actual mock interleaving empirically (run test before changing arrays) — exact order depends on whether mocks resolve synchronously or asynchronously.
  - **VERIFY** "runs remaining batch" test (line 172): Uses `Array(20).fill('A')` — all-A produces disagreement regardless of interleaving order. This test survives unchanged.
- `src/lib/evolution/agents/pairwiseRanker.test.ts` — Each test calls `compareWithBiasMitigation` exactly once (no outer batching), so mock order is always [responses[0], responses[1]]. **All existing tests pass unchanged.**
- **NEW** test in `pairwiseRanker.test.ts`: Verify concurrent execution by tracking that both `comparePair` promises are created before either resolves. Implementation: mock `complete()` to return a deferred promise; assert both calls were initiated (call count = 2) before resolving either promise.

**Verification**: Run existing unit + integration tests. Same inputs produce same outputs — only wall-clock time changes.

### Phase 2: Information-Theoretic Swiss Pairing
**Goal**: Replace greedy adjacent pairing with sigma-weighted info-theoretic pair scoring.

**Files to modify**:
1. `src/lib/evolution/agents/tournament.ts` — `swissPairing()` function (lines 54-84)
   - New signature adds `matchCounts: Map<string, number>` parameter with default `new Map()` for backward compatibility
   - Score all candidate pairs by: `outcomeUncertainty * sigmaProxy * topKBoost`
   - `sigma(v) = 1 / sqrt(min(matchCount(v), 20) + 1)`
   - `outcomeUncertainty = 1 - |2 * expectedA - 1|` (from Elo expected score)
   - `topKBoost = 1.5` if both variants in top K (K = max(1, floor(pool/3)))` — clamp K≥1 to avoid boost-for-all when pool < 3
   - Greedy selection by descending score, skipping used/completed pairs

2. `src/lib/evolution/agents/tournament.ts` — `execute()` method
   - Pass `state.matchCounts` to `swissPairing()` call

**Tests to update**:
- `src/lib/evolution/agents/tournament.test.ts` — update `swissPairing` tests:
  - Update all 4 existing call sites (lines 106, 121, 131, 137) to pass `matchCounts` parameter
  - **FIX** "skips already-played pairs" test (line 114): Info-theoretic scoring may select a different pair than greedy adjacent. Update expected pair assertion to match new algorithm behavior.
  - Add test: new/low-matchCount variants get paired preferentially over established ones
  - Add test: established variants with similar Elo get paired (high outcome uncertainty)
  - Add test: top-K boost prioritizes top-quartile matchups
  - Add test: falls back gracefully when all pairs exhausted
  - Add edge cases: empty matchCounts (all sigma=1.0), single variant (no pairs), pool size < 3 (K clamped to 1)
  - Existing tests for Tournament.execute should still pass

**Verification**: Run unit tests. Then run local evolution (`scripts/run-evolution-local.ts --full --iterations 5`) and compare convergence speed (rounds to reach stable top-3) vs baseline.

### Phase 3: Integration Testing & Docs
**Goal**: Verify end-to-end, update docs.

**Steps**:
1. Run full integration test suite: `npm run test:integration -- --grep evolution`
2. Run local evolution with `--mock` to verify pipeline doesn't regress
3. Update feature docs

## Testing

### Unit Tests (Phase 1)
- `pairwiseRanker.test.ts`: All existing `compareWithBiasMitigation` tests pass unchanged (each test calls it once — no cross-comparison interleaving)
- `calibrationRanker.test.ts`:
  - **FIX** "exits early" test (line 157): Change response array from `['A','A','B','B',...]` to `['A','B','A','B',...]` to match new grouped interleaving (`comp1-fwd, comp1-rev, comp2-fwd, comp2-rev`). Update comments.
  - **VERIFY** "runs remaining batch" test (line 172): `Array(20).fill('A')` produces disagreement regardless of interleaving. Passes unchanged.
- **NEW** concurrent execution test in `pairwiseRanker.test.ts`: Mock `complete()` with deferred promises. Assert call count reaches 2 before resolving either. Confirms `Promise.all` is used (sequential would only reach 1).

### Unit Tests (Phase 2)
- `tournament.test.ts`:
  - Update all 4 existing `swissPairing` call sites to pass `matchCounts` parameter
  - Add info-theoretic pairing tests (preferential pairing of uncertain variants, top-K boost, exhaustion fallback)
  - Add edge cases: empty matchCounts, single variant, pool < 3
  - Existing Tournament.execute tests pass unchanged (internal pairing change is transparent)

### Integration Tests
- `evolution-pipeline.integration.test.ts`: Full pipeline with real DB still passes
- Local CLI: `npm run evolution:local -- --mock --full --iterations 3` completes successfully

### Manual Verification
- Run `npm run evolution:local -- --full --iterations 5` with live API
- Compare run_summary metrics: `matchStats.totalMatches` (should decrease), `avgConfidence` (should hold or increase), ranking quality (top variants should be same or better)

## Rollback Plan
- **Phase 1** (parallel rounds): Revert the two `Promise.all` lines back to sequential `await`. Zero behavioral change, just slower. Low risk — this is a concurrency-only optimization.
- **Phase 2** (info-theoretic pairing): Revert `swissPairing()` to the original greedy adjacent algorithm. The function is self-contained (no state changes outside returned pairs) and called from exactly one production site (`Tournament.execute()`). Reverting restores original pairing behavior with no side effects.
- **Monitoring**: After deployment, compare via run summaries:
  - `totalIterations` and `matchStats.totalMatches` should decrease (fewer rounds to converge)
  - `matchStats.avgConfidence` should stay the same or increase (better-matched pairs)
  - `baselineRank` and top variant Elo should not regress
- **No feature flags needed**: Both changes are internal algorithm improvements with identical external interfaces. The two phases are independently revertable via single-function changes.

## Documentation Updates
- `docs/feature_deep_dives/evolution_pipeline.md` — Update "Tournament" section to describe info-theoretic pairing and parallel bias mitigation
- `docs/planning/improvements_to_evolution_including_speeding_up_20260201/_progress.md` — Track phase completion
