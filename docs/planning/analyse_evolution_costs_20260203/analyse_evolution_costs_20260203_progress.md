# Analyse Evolution Costs Progress

## Phase 1: Cost Analysis Research
### Work Done
- Read all evolution pipeline documentation and 16 source files
- Mapped cost flow: Agent → llmClient.complete → costTracker.reserveBudget → callLLM → onUsage → recordSpend
- Documented per-agent model routing, LLM calls per iteration, and cost estimates
- Identified 6 gaps/bugs: unused generationModel config, DebateAgent costUsd:0, Tournament cost attribution to "pairwise", reservation leak, no per-iteration tracking, character-based embeddings
- Estimated full run cost: $0.24-$0.38 for 2000-word article across 15 iterations

### Issues Encountered
- Workflow hook expected `docs/planning/feat/analyse_evolution_costs_20260203/` but project folder was `docs/planning/analyse_evolution_costs_20260203/`. Fixed with symlink.

## Phase 2: Cost Reduction Research — OpenSkill
### Work Done
- Researched OpenSkill/Weng-Lin Bayesian rating as Elo alternative
- Found moderate savings (25-35%) from batch rating and sigma-guided termination
- Concluded: defer to post-MVP due to high implementation cost vs moderate savings

## Phase 3: Selective Bias Mitigation Experiment
### Work Done
- Built simulation framework in `selectiveBiasMitigation.test.ts` (10 test cases)
- Simulated judge with ground truth, 30% position bias, noise for close variants
- Ran threshold sweep (25-300) across 20 trials with 16 variants
- **Key finding**: Only 0-2.7% savings within single tournament due to cold-start problem (all Elo=1200)
- Fixed edge case bugs: `threshold=0` condition guard, `threshold=Infinity` test redesigned

### Issues Encountered
- `threshold=0` edge case: `eloGap >= 0` always true → fixed with `eloGapThreshold > 0 &&` guard
- `threshold=Infinity` edge case: `x >= Infinity` always false → redesigned test to use threshold=1 (30% savings demonstrated)

### Key Insight
Selective bias mitigation is NOT effective within a single tournament iteration. More promising directions: cross-iteration gaps in CalibrationRanker, or combined with OpenSkill sigma-based scheduling.

## Phase 4: OpenSkill Migration — Implementation
After review of cost analysis findings, decided to proceed with OpenSkill migration as it provides:
- 25-35% cost savings from sigma-guided convergence (fewer tournament rounds)
- Better ranking quality from Bayesian uncertainty tracking
- Foundation for future selective bias mitigation using real sigma values

### Phase 1 — Install OpenSkill + Create Rating Module
- Installed `openskill@^4.1.0` package
- Created `src/lib/evolution/core/rating.ts` — wrapper module with:
  - `Rating` type: `{ mu: number; sigma: number }` (Weng-Lin Bayesian)
  - `createRating()`, `updateRating()`, `updateDraw()` — OpenSkill wrappers
  - `getOrdinal()` — conservative estimate `mu - 3*sigma` for ranking
  - `isConverged()` — sigma-based convergence check (threshold 3.0)
  - `eloToRating()` / `ordinalToEloScale()` — backward compat conversions
- Created `src/lib/evolution/core/rating.test.ts` — 32 tests all passing

### Phase 2 — Migrate Types, State, and Serialization
- Updated `types.ts`: `eloRatings: Map<string,number>` → `ratings: Map<string,Rating>`
  - `getTopByElo(n)` → `getTopByRating(n)` using ordinal sorting
  - `SerializedPipelineState` accepts both `ratings` (new) and `eloRatings` (legacy)
  - Zod schema: V1/V2 union with auto-transform for backward compat
  - `EvolutionRunSummary` version 1→2, all elo→ordinal field renames
- Updated `state.ts`: deserialization handles both formats via `eloToRating()` fallback
- Updated `comparisonCache.ts`, `diversityTracker.ts`: trivial elo→ratings renames

### Phase 3 — Migrate Tournament Agent
- Rewrote `tournament.ts` Swiss pairing to use real sigma + ordinal gap
- Convergence: sigma-based via `isConverged()` instead of "Elo delta < 10 for 5 rounds"
- Rating updates: `updateRating()`/`updateDraw()` based on match confidence
- All 46 tournament tests passing

### Phase 4 — Migrate Remaining Agents
- `calibrationRanker.ts`: `applyEloUpdate` → `applyRatingUpdate` using `updateRating()`/`updateDraw()`
- `debateAgent.ts`: `eloRatings.has` → `ratings.has`, `getTopByElo` → `getTopByRating`
- `evolvePool.ts`: `isEloStagnant` → `isRatingStagnant` using `getOrdinal()`
- `metaReviewAgent.ts`: all `eloRatings` → `ratings` with `getOrdinal()`, threshold -50 → -3
- `reflectionAgent.ts`, `proximityAgent.ts`: `getTopByElo` → `getTopByRating`
- Updated all agent test files (calibration, debate, evolve, metaReview, pool)
- 59 agent+pool tests passing

### Phase 5 — Migrate Pipeline, Supervisor, Data Layer, Admin UI
- `supervisor.ts`: `eloHistory` → `ordinalHistory`, plateau threshold `*100` → `*6` (ordinal scale)
- `pipeline.ts`: `persistVariants` uses `ordinalToEloScale()` for DB `elo_score` column, `buildRunSummary` version 2
- `pool.ts`: stratified sampling uses `getOrdinal()`, pool stats use ordinal range
- `evolutionVisualizationActions.ts`: backward compat for legacy checkpoint snapshots (dual-path reading)
- `article-bank/[topicId]/page.tsx`: `baselineElo` → `baselineOrdinal`, `avgElo` → `avgOrdinal`
- `evolution-test-helpers.ts`: snapshot factory uses `ratings: { mu, sigma }` format
- Updated `supervisor.test.ts` (20 tests), `pipeline.test.ts` (17 tests) — all passing

### Phase 6 — Remove elo.ts + Cleanup
- Deleted `src/lib/evolution/core/elo.ts` and `elo.test.ts`
- Deleted `src/lib/evolution/core/selectiveBiasMitigation.test.ts` (Elo-based, superseded)
- Removed `ELO_CONSTANTS` and `K_SCHEDULE` from `config.ts`
- Added rating module exports to `index.ts`
- Updated `scripts/run-evolution-local.ts` to use OpenSkill ratings
- Verified only intentional backward compat `eloRatings` references remain:
  - `state.ts` deserialize fallback for legacy snapshots
  - `evolutionVisualizationActions.ts` fallback for legacy checkpoint snapshots
  - Integration/E2E tests serve as backward compat validation

### Final Verification
- `npx tsc --noEmit` — clean, no errors
- `npx jest src/lib/evolution --no-coverage` — **320 tests, 22 suites, all passing**
- No DB migration needed: `ordinalToEloScale()` maps ordinal to 0-3000 range for existing `elo_score` column
