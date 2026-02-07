# Analyse Evolution Costs Plan

## Background
The evolution pipeline uses Elo ratings for pairwise ranking of text variants, with bias mitigation doubling every comparison call. Research found that Tournament (55-65%) and Calibration (15-20%) dominate cost, and selective bias mitigation within a single tournament yields negligible savings (0-2.7%) due to the cold-start problem (all variants begin at Elo 1200). OpenSkill's Bayesian `{mu, sigma}` rating system provides proper uncertainty tracking that enables smarter convergence detection and better Swiss pairing — reducing total comparisons needed rather than cost per comparison.

## Problem
The tournament's convergence heuristic ("max Elo change < 10 for 5 consecutive rounds") is conservative and runs extra rounds after rankings have stabilized. The `sigma()` proxy at `tournament.ts:54-56` uses `1/sqrt(matchCount+1)` which ignores match outcomes. The adaptive K-factor in `elo.ts` uses coarse 3-tier buckets (48/32/16). Replacing Elo with OpenSkill gives proper Bayesian sigma for convergence detection, outcome-aware uncertainty for pairing, and automatic K-factor equivalent via sigma decay — estimated to reduce tournament comparisons by 15-25% (~8-15% total run cost).

## Options Considered

### 1. Pairwise OpenSkill (Recommended)
Drop-in replacement for Elo math. Keep all pairwise comparison infrastructure (prompts, parsing, bias mitigation, caching). Replace `updateEloWithConfidence()` with `rate()`, `state.eloRatings` with `state.ratings: Map<string, Rating>`, convergence detection with sigma-based threshold.
- **Pros**: Proper sigma, automatic K-factor, better convergence, low risk
- **Cons**: New dependency, data migration for existing runs

### 2. Group Ranking with OpenSkill
Present 3-4 texts in one prompt, get ranked order, feed to `rate()`.
- **Pros**: Theoretical 75-85% reduction in tournament LLM calls
- **Cons**: Prompt length doubles, position bias worsens (primacy/recency/middle-neglect), `gpt-4.1-nano` parsing reliability drops, can't scale 2-pass reversal to N! permutations
- **Decision**: Rejected. Quality/reliability risks outweigh token savings.

### 3. Smarter Convergence with Existing Elo
Add match-count-based early termination to tournament using existing `sigma()` proxy.
- **Pros**: No new dependency, ~5-line change
- **Cons**: Proxy sigma ignores match outcomes (a variant with 4 decisive wins has same sigma as 2-2), less accurate than OpenSkill
- **Decision**: Subsumed by Option 1. OpenSkill provides real sigma for free.

### 4. Selective Bias Mitigation Only
Skip reverse comparison when Elo gap is large.
- **Pros**: Simple per-comparison optimization
- **Cons**: Experiment proved only 0-2.7% savings within single tournament (cold-start problem). Cross-iteration savings limited to calibration (3-5%).
- **Decision**: Incorporate as secondary optimization after OpenSkill, using mu/sigma gap instead of raw Elo gap.

---

## Phased Execution Plan

**Migration strategy:** Phases 2-5 are executed as a single atomic commit to avoid intermediate compile errors (Phase 2 changes types that 20+ files depend on). The phasing is for organizational clarity, not separate deployments.

### Phase 1: Install OpenSkill + Rating Module

**Goal:** Add `openskill` dependency, create a rating module that wraps its API, and write unit tests.

**Done when:** Rating module passes all unit tests, lint/tsc/build pass.

**New dependency:**
- `openskill@^4.0.0` (MIT license, ~15KB, transitive deps: `ramda`, `gaussian`, `sort-unwind` — all mature, zero-dep libraries). Pin major version. Run `npm audit` after install. Verify named exports `rating`, `rate`, `ordinal` exist at this version. Verify ESM/CJS compat with project's module resolution (Next.js).

**New file:** `src/lib/evolution/core/rating.ts`

Wraps OpenSkill's API with evolution-specific helpers:
```typescript
import { rating, rate, ordinal } from 'openskill';

export type Rating = { mu: number; sigma: number };

export function createRating(): Rating;           // rating() default
export function updateRating(winner: Rating, loser: Rating): [Rating, Rating];  // rate() pairwise
export function updateDraw(a: Rating, b: Rating): [Rating, Rating];             // rate() with rank=[1,1]
export function getOrdinal(r: Rating): number;    // mu - 3*sigma
export function isConverged(r: Rating, threshold?: number): boolean;  // sigma < threshold
export function ratingToDisplay(r: Rating): string;  // "25.3 ± 4.1"
export function eloToRating(elo: number, matchCount?: number): Rating; // backward compat conversion
export function ordinalToEloScale(ord: number): number; // map ordinal to 0-3000 for DB compat
```

**Backward compat helpers:**
- `eloToRating(elo, matchCount)`: converts old Elo number to `{mu, sigma}`. Mapping: `mu = 25 + (elo - 1200) * (25/400)`. Sigma derived from matchCount: `sigma = matchCount >= 8 ? 3.0 : matchCount >= 4 ? 5.0 : 8.333` (lower sigma for well-tested variants, default sigma for unknown).
- `ordinalToEloScale(ord)`: maps ordinal back to 0-3000 range for the `content_evolution_variants.elo_score` DB column. Must map the **default ordinal** (fresh rating: `mu=25, sigma=8.333`, ordinal ≈ 0) to Elo 1200. Formula: `clamp(1200 + ord * (400/25), 0, 3000)`. This means ordinal 0 → Elo 1200, ordinal 25 → Elo 1600, ordinal -25 → Elo 800.

**Test file:** `src/lib/evolution/core/rating.test.ts`
- Winner mu increases, loser mu decreases
- Both sigmas shrink after match
- Draw updates both toward each other
- Ordinal penalizes high sigma
- `isConverged` returns true when sigma < threshold
- Multiple matches cause sigma to converge monotonically
- Edge cases: same player as winner/loser, NaN/Infinity guards
- `eloToRating`: Elo 1200 → mu 25, preserves relative ordering
- `ordinalToEloScale`: fresh rating ordinal (≈0) maps to Elo 1200, round-trip preserves ordering, values within [0, 3000]
- Performance: 1000 sequential `updateRating()` calls complete in < 100ms

**Files created:**
- `src/lib/evolution/core/rating.ts`
- `src/lib/evolution/core/rating.test.ts`

---

### Phase 2: Migrate Types, State, and Serialization

**Goal:** Replace `eloRatings: Map<string, number>` with `ratings: Map<string, Rating>` throughout types and state. Handle backward-compat deserialization. Update `EvolutionRunSummary` and its Zod schema.

**Done when:** All type errors resolved in types.ts, state.ts, config.ts. Serialization round-trip tests pass. lint/tsc may still have errors in downstream consumers (fixed in Phases 3-5).

**Note:** Phases 2-5 are committed atomically. Intermediate compile errors in downstream files are expected and resolved sequentially.

**Files to modify:**

1. **`src/lib/evolution/types.ts`**
   - Add `import type { Rating } from './core/rating'`
   - `PipelineState.eloRatings` → `PipelineState.ratings: Map<string, Rating>`
   - `PipelineState.getTopByElo(n)` → `PipelineState.getTopByRating(n)` (rename interface method)
   - `SerializedPipelineState.eloRatings: Record<string, number>` → `SerializedPipelineState.ratings: Record<string, {mu: number, sigma: number}>`. Add optional `eloRatings?: Record<string, number>` for backward compat (old snapshots).
   - `EvolutionRunSummary`: rename `eloHistory` → `ordinalHistory`, `topVariants[].elo` → `topVariants[].ordinal`, `baselineElo` → `baselineOrdinal`, `strategyEffectiveness[].avgElo` → `strategyEffectiveness[].avgOrdinal`
   - `EvolutionRunSummarySchema` (Zod): bump `version` to `2`, update field names. Add migration: if parsed data has `version: 1` or missing, transform old field names to new.

2. **`src/lib/evolution/core/state.ts`**
   - `PipelineStateImpl`: rename `eloRatings` to `ratings`, initialize with `createRating()` instead of `1200`
   - `addToPool()`: set `ratings.set(v.id, createRating())`
   - `getTopByElo()` → `getTopByRating()`: sort by `getOrdinal(r)` instead of raw Elo
   - `toJSON()`: serialize `ratings` as `Record<string, {mu, sigma}>`
   - `deserializeState()`: if snapshot has `eloRatings` (old format), convert via `eloToRating(elo, matchCounts[id])`. If snapshot has `ratings` (new format), use directly.

3. **`src/lib/evolution/core/validation.ts`**
   - Update all references from `state.eloRatings` to `state.ratings`

4. **`src/lib/evolution/config.ts`**
   - Remove `ELO_CONSTANTS.INITIAL_RATING` (replaced by `createRating()` default)
   - Add `RATING_CONSTANTS = { CONVERGENCE_SIGMA_THRESHOLD: 3.0 }`

5. **`src/lib/evolution/core/elo.ts`**
   - Keep file during migration (deleted in Phase 6). Mark all exports as `@deprecated`.

---

### Phase 3: Migrate Tournament Agent

**Goal:** Replace Elo updates and convergence logic in Tournament with OpenSkill.

**Done when:** Tournament tests pass, convergence uses sigma, Swiss pairing uses real sigma. Lint/tsc pass for tournament.ts.

**Files to modify:**

1. **`src/lib/evolution/agents/tournament.ts`**
   - Replace `updateEloWithConfidence()` calls (line 282) with `updateRating()`/`updateDraw()` from rating module
   - Remove `getAdaptiveK()` calls (lines 276-278) — not needed with OpenSkill
   - Replace convergence detection (lines 288-306): sigma-based
   - Add `convergenceSigmaThreshold` (default: 3.0) to `TournamentConfig`
   - Remove `sigma()` proxy function (lines 54-56) — use real sigma from `state.ratings`
   - Update `swissPairing()`: use `getOrdinal()` for rating-based calculations, real sigma for pairing weight
   - Rename `getTopQuartileElo()` → `getTopQuartileOrdinal()`
   - Update `needsMultiTurn()`: use mu difference instead of Elo diff
   - Replace `state.eloRatings` → `state.ratings` throughout
   - Remove import of `getAdaptiveK`, `updateEloWithConfidence` from `elo.ts`

2. **`src/lib/evolution/agents/tournament.test.ts`**
   - Update all `eloRatings` references to `ratings` with `{mu, sigma}` objects
   - Update convergence assertions

---

### Phase 4: Migrate Remaining Agents

**Goal:** Replace Elo references in all other agents.

**Done when:** All agent tests pass. Lint/tsc pass for all agent files.

**Files to modify:**

1. **`src/lib/evolution/agents/calibrationRanker.ts`**
   - Replace `updateEloWithConfidence()` / `updateEloDraw()` calls (lines 82-90)
   - Remove `getAdaptiveK()` calls — not needed
   - Remove Elo imports

2. **`src/lib/evolution/agents/calibrationRanker.test.ts`**
   - Update `eloRatings` references to `ratings`

3. **`src/lib/evolution/agents/debateAgent.ts`**
   - Update `state.eloRatings.has()` / `.get()` (lines 15, 211-212) to `state.ratings` + `getOrdinal()`

4. **`src/lib/evolution/agents/debateAgent.test.ts`**
   - Update `eloRatings` references

5. **`src/lib/evolution/agents/evolvePool.ts`**
   - Update `eloRatings` references for variant selection to `ratings` + `getOrdinal()`
   - Update `isPoolStale()` function signature from `eloRatings: Map<string, number>` to `ratings: Map<string, Rating>`

6. **`src/lib/evolution/agents/evolvePool.test.ts`**
   - Update all `eloRatings` references

7. **`src/lib/evolution/agents/metaReviewAgent.ts`**
   - Update 15+ `eloRatings` references to `ratings` + `getOrdinal()` for strategy analysis

8. **`src/lib/evolution/agents/metaReviewAgent.test.ts`**
   - Update `eloRatings` references

9. **`src/lib/evolution/agents/reflectionAgent.ts`**
   - Uses `state.getTopByElo()` → update to `state.getTopByRating()`

10. **`src/lib/evolution/agents/proximityAgent.ts`**
    - Uses `state.getTopByElo()` → update to `state.getTopByRating()`

11. **`src/lib/evolution/agents/pairwiseRanker.ts`**
    - No changes needed — returns `Match` objects, callers handle rating updates

---

### Phase 5: Migrate Pipeline, Supervisor, Pool, and Data Layer

**Goal:** Update all remaining references to Elo throughout pipeline core, server actions, admin UI, and test infrastructure.

**Done when:** `grep -r "eloRatings\|getTopByElo\|getAdaptiveK\|updateElo\|INITIAL_RATING\|baselineElo" src/ --include="*.ts" --include="*.tsx"` returns zero hits (excluding `elo.ts` itself). All tests pass. Lint/tsc/build pass.

**Core files:**

1. **`src/lib/evolution/core/supervisor.ts`**
   - `shouldStop()`: replace `Math.max(...state.eloRatings.values())` with ordinal equivalent
   - `eloHistory` → `ordinalHistory`, `SupervisorResumeState.eloHistory` → `.ordinalHistory`
   - Backward compat in `setPhaseFromResume()`: if resume data has `eloHistory`, use as-is (values are ordinals in practice)

2. **`src/lib/evolution/core/supervisor.test.ts`**
   - Update `eloRatings`/`eloHistory` references

3. **`src/lib/evolution/core/pipeline.ts`**
   - Update `eloRatings` references in `EvolutionRunSummary` construction
   - Update `getTopByElo()` → `getTopByRating()` calls

4. **`src/lib/evolution/core/pipeline.test.ts`**
   - Update all Elo references

5. **`src/lib/evolution/core/pool.ts`**
   - Update `getCalibrationOpponents()` to use `getOrdinal()` for ranking

6. **`src/lib/evolution/core/pool.test.ts`**
   - Update `eloRatings` references

**Data layer files:**

7. **`src/lib/services/evolutionActions.ts`**
   - `elo_score` column: continue writing to this column using `ordinalToEloScale()` for backward compat
   - Update any `eloRatings` references in query results

8. **`src/lib/services/evolutionVisualizationActions.ts`**
   - Update JSONB extraction: `state_snapshot->'eloRatings'` → `state_snapshot->'ratings'`
   - Add backward compat: `COALESCE(state_snapshot->'ratings', state_snapshot->'eloRatings')` for old checkpoints
   - Update `getEvolutionRunEloHistoryAction` return type: `ratings: Record<string, number>` → `Record<string, {mu, sigma}>`

9. **`src/__tests__/integration/evolution-visualization.integration.test.ts`**
   - Update hardcoded `eloRatings` in checkpoint snapshots to `ratings` format
   - Update `elo_score` assertions

**Admin UI files:**

10. **`src/components/evolution/tabs/VariantsTab.tsx`**
    - Update `elo_score` display to show `ratingToDisplay()` format (mu ± sigma)

11. **`src/components/evolution/tabs/EloTab.tsx`**
    - Update `EloHistoryData` type to include `{mu, sigma}`. Rename component/types if desired (optional — "Elo" in component name is legacy but non-breaking).

12. **`src/app/admin/quality/evolution/run/[runId]/page.tsx`**
    - Update Elo references in run detail display

13. **`src/app/admin/quality/evolution/page.tsx`**
    - Update any Elo column references

14. **`src/app/admin/quality/article-bank/[topicId]/page.tsx`**
    - Update `elo_score` references

**Scripts (local tooling):**

15. **`scripts/run-evolution-local.ts`**
    - Update `state.getTopByElo()` → `state.getTopByRating()`, `state.eloRatings` → `state.ratings`, `elo_score` references

Note: `scripts/run-bank-comparison.ts`, `scripts/lib/bankUtils.ts`, `scripts/add-to-bank.ts` are **out of scope** (article bank Elo system — separate PR).

**Test infrastructure:**

14. **`src/testing/utils/evolution-test-helpers.ts`**
    - `createTestCheckpoint()`: update `eloRatings` → `ratings` in snapshot shape
    - `createTestVariant()`: update `elo_score: 1200` → use `ordinalToEloScale(25)` (default ordinal)

15. **`src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts`**
    - Update `elo_score` values in seeded data

16. **`src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts`**
    - Update `elo_score` and `eloRatings` in seeded data

17. **`src/lib/evolution/core/selectiveBiasMitigation.test.ts`**
    - This experiment file directly uses `state.eloRatings`, `getAdaptiveK`, `updateEloWithConfidence`. Two options:
      - (a) **Update to OpenSkill**: Replace Elo functions with rating module. Keep as a historical experiment.
      - (b) **Delete**: The experiment is complete and findings are documented in the research doc. Prefer this option — the test served its purpose.
    - **Decision**: Delete. Findings preserved in research doc. Remove from git.

**DB Note:** The `content_evolution_variants.elo_score` column (CHECK constraint 0-3000) is NOT migrated in this plan. Instead, `ordinalToEloScale()` maps ordinal values to the existing column range. This avoids a DB migration and keeps the admin UI working with existing queries. The column can be renamed/restructured in a future PR if needed.

**Article Bank Scope Note:** `src/lib/services/articleBankActions.ts` has its own Elo system (`computeEloPerDollar`, `INITIAL_ELO`, `article_bank_elo` DB table) that is separate from the evolution pipeline Elo. The article bank Elo is used for cross-article comparison, not variant ranking. This plan migrates the **evolution pipeline Elo only**. Article bank Elo migration is a separate concern:
- `articleBankActions.ts` — update `elo_rating` references to use OpenSkill if desired (separate PR)
- `articleBankActions.test.ts`, `article-bank-actions.integration.test.ts`, `admin-article-bank.spec.ts` — article bank tests
- `scripts/run-bank-comparison.ts`, `scripts/lib/bankUtils.ts`, `scripts/lib/bankUtils.test.ts` — bank comparison scripts
These files are **explicitly out of scope** for this PR. They will continue using the existing Elo system. The `scripts/run-evolution-local.ts` file IS in scope (it accesses evolution pipeline state directly).

---

### Phase 6: Remove Elo Module + Cleanup

**Goal:** Delete deprecated Elo code, verify zero references remain.

**Done when:** `elo.ts` and `elo.test.ts` deleted. `grep -r "from.*elo" src/lib/evolution/ --include="*.ts"` returns zero hits (excluding `selectiveBiasMitigation.test.ts` if kept). All tests pass. Lint/tsc/build pass.

**Files to delete:**
- `src/lib/evolution/core/elo.ts`
- `src/lib/evolution/core/elo.test.ts`
- `src/lib/evolution/core/selectiveBiasMitigation.test.ts` (experiment complete, findings in research doc)

**Files to modify:**
- `src/lib/evolution/config.ts` — remove `ELO_CONSTANTS` if now empty
- `src/lib/evolution/index.ts` — remove any re-exports of Elo functions

---

## Rollback Plan

### Strategy
The migration is a single atomic commit (Phases 2-6). Rollback = revert the commit.

### Checkpoint Backward Compat
- New code reads both old (`eloRatings`) and new (`ratings`) checkpoint formats
- If rollback is needed after new checkpoints have been written, the old code cannot read them. **Mitigation**: existing completed runs keep their old-format checkpoints. Only in-progress runs during the deploy window would have new-format checkpoints. These runs can be re-queued.

### DB Column Unchanged
- `content_evolution_variants.elo_score` column is unchanged (still 0-3000 numeric). No DB migration needed, no DB rollback needed.

### Dependency Removal
- If `openskill` needs to be removed: `npm uninstall openskill`, revert the commit.

---

## Testing

### New Unit Tests
- `src/lib/evolution/core/rating.test.ts` (Phase 1) — OpenSkill wrapper: winner/loser updates, draws, ordinal, convergence, backward compat conversion, ordinalToEloScale, edge cases, performance

### Backward Compatibility Tests (split across two files)
**In `rating.test.ts` (Phase 1)** — pure conversion functions, no state dependencies:
- `eloToRating`: Elo 1200 → mu 25, preserves relative ordering across a range of Elo values
- `ordinalToEloScale`: fresh rating ordinal (≈0) → Elo 1200, values within [0, 3000]
- `ordinalToEloScale` round-trip: Elo → `eloToRating` → `getOrdinal` → `ordinalToEloScale` preserves ordering

**In `state.test.ts` (Phase 2)** — deserialization with real state:
- Deserialize old `eloRatings` snapshot → verify `state.ratings` contains valid `{mu, sigma}` objects
- Verify deserialized ratings preserve relative ordering (higher old Elo → higher ordinal)
- Old-format `EvolutionRunSummary` (version 1) deserializes correctly with new Zod schema v2

### Convergence Regression Test (in tournament.test.ts, Phase 3)
- Create test with 8 variants of known quality ordering
- Run tournament with OpenSkill sigma-based convergence and record total comparisons
- Run same tournament with old fixed-round convergence (5 consecutive rounds with max change < 10) and record total comparisons
- Assert: sigma-based convergence uses **fewer or equal** comparisons while producing the same top-K ranking
- This validates the claimed 15-25% reduction in tournament comparisons

### Existing Test Files Requiring Updates (12 files)
| Test File | Phase | Change |
|-----------|-------|--------|
| `src/lib/evolution/core/state.test.ts` | 2 | `eloRatings` → `ratings`, Rating objects |
| `src/lib/evolution/core/supervisor.test.ts` | 5 | `eloHistory` → `ordinalHistory` |
| `src/lib/evolution/core/pipeline.test.ts` | 5 | `eloRatings` in summary assertions |
| `src/lib/evolution/core/pool.test.ts` | 5 | `eloRatings` → `ratings` in test setup |
| `src/lib/evolution/agents/tournament.test.ts` | 3 | Rating objects, convergence assertions |
| `src/lib/evolution/agents/calibrationRanker.test.ts` | 4 | Rating objects |
| `src/lib/evolution/agents/debateAgent.test.ts` | 4 | `eloRatings` → `ratings` |
| `src/lib/evolution/agents/evolvePool.test.ts` | 4 | `eloRatings` → `ratings`, function signatures |
| `src/lib/evolution/agents/metaReviewAgent.test.ts` | 4 | `eloRatings` → `ratings` |
| `src/__tests__/integration/evolution-visualization.integration.test.ts` | 5 | Snapshot format, `elo_score` values |
| `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts` | 5 | Seeded `elo_score` values |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` | 5 | Seeded snapshot format |

### Additional Test Files (scripts)
| Test File | Phase | Change |
|-----------|-------|--------|
| `scripts/run-bank-comparison.test.ts` | N/A | Out of scope (article bank) |
| `scripts/lib/bankUtils.test.ts` | N/A | Out of scope (article bank) |

### Test Files Deleted (2)
- `src/lib/evolution/core/elo.test.ts` — replaced by `rating.test.ts`
- `src/lib/evolution/core/selectiveBiasMitigation.test.ts` — experiment complete

### Test Infrastructure Updates
- `src/testing/utils/evolution-test-helpers.ts` — update `createTestCheckpoint()` and `createTestVariant()` to use new format
- `src/lib/evolution/core/state.test.ts` — add backward-compat deserialization test (old `eloRatings` format → new `ratings` format)

### CI/CD Pipeline Gates
The project uses standard GitHub Actions CI. This PR must pass all existing gates before merge:
1. **Lint** (`npx eslint`) — zero errors
2. **Type check** (`npx tsc --noEmit`) — zero errors
3. **Unit tests** (`npx jest --no-coverage`) — all pass
4. **Integration tests** (`npx jest src/__tests__/integration/ --no-coverage`) — all pass
5. **Build** (`npm run build`) — succeeds
6. **E2E tests** (`npx playwright test`) — all pass

No new CI/CD configuration changes needed. The existing pipeline covers all verification.

### Verification Commands

**Run after Phase 5 (before Phase 6 deletions):**
```bash
# Verify no Elo references remain in evolution pipeline (elo.ts still exists but should be the only consumer)
grep -r "eloRatings\|getAdaptiveK\|updateElo\|INITIAL_RATING\|getTopByElo\|baselineElo" \
  src/lib/evolution/ src/components/evolution/ src/app/admin/quality/evolution/ \
  src/lib/services/evolutionActions.ts src/lib/services/evolutionVisualizationActions.ts \
  scripts/run-evolution-local.ts \
  --include="*.ts" --include="*.tsx" \
  --exclude="elo.ts" --exclude="elo.test.ts" --exclude="selectiveBiasMitigation.test.ts"
# Expected: zero hits. If any hits remain, fix before proceeding to Phase 6.
```

**Run after Phase 6 (final verification):**
```bash
# Run all evolution tests
npx jest src/lib/evolution/ --no-coverage

# Run integration tests
npx jest src/__tests__/integration/evolution --no-coverage

# Run E2E tests for admin evolution
npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution*.spec.ts

# Verify elo.ts no longer exists
test ! -f src/lib/evolution/core/elo.ts && echo "OK: elo.ts deleted" || echo "FAIL: elo.ts still exists"

# Lint + type check
npx eslint src/lib/evolution/
npx tsc --noEmit

# Full build
npm run build
```

**Post-deploy smoke test (manual):**
```bash
# Run a local evolution pipeline with 4 variants, 3 iterations to verify end-to-end
npx ts-node scripts/run-evolution-local.ts --max-iterations 3 --max-variants 4

# Verify output includes mu/sigma ratings (not raw Elo numbers)
# Expected: "Rating: 28.4 ± 5.2" format, not "Elo: 1245"
```

---

## Documentation Updates

### Files to Update
- `docs/feature_deep_dives/evolution_pipeline.md` — Replace Elo references with OpenSkill {mu, sigma} explanation
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Document mu/sigma display format in admin UI
- `docs/planning/visualization_tool_for_evolution_pipeline_20260131/visualization_tool_for_evolution_pipeline_20260131_planning.md` — Update EloTab/EloSparkline/VariantsTab sections to reference {mu, sigma} and confidence ribbons

---

## Files Summary

### New Files (2)
| File | Purpose |
|------|---------|
| `src/lib/evolution/core/rating.ts` | OpenSkill wrapper module with backward compat helpers |
| `src/lib/evolution/core/rating.test.ts` | Rating module unit tests |

### Modified Source Files (26)
| File | Phase | Change |
|------|-------|--------|
| `src/lib/evolution/types.ts` | 2 | `eloRatings` → `ratings`, `getTopByElo` → `getTopByRating`, `SerializedPipelineState` union, `EvolutionRunSummary` + Zod schema v2 |
| `src/lib/evolution/core/state.ts` | 2 | Rating init, serialization, backward-compat deserialization, `getTopByRating` |
| `src/lib/evolution/core/validation.ts` | 2 | `eloRatings` → `ratings` |
| `src/lib/evolution/config.ts` | 2 | Remove `ELO_CONSTANTS.INITIAL_RATING`, add `RATING_CONSTANTS` |
| `src/lib/evolution/agents/tournament.ts` | 3 | Rating updates, convergence, Swiss pairing, remove Elo imports |
| `src/lib/evolution/agents/calibrationRanker.ts` | 4 | Rating updates, remove Elo imports |
| `src/lib/evolution/agents/debateAgent.ts` | 4 | `eloRatings` → `ratings` |
| `src/lib/evolution/agents/evolvePool.ts` | 4 | Variant selection by ordinal, function signature |
| `src/lib/evolution/agents/metaReviewAgent.ts` | 4 | 15+ `eloRatings` → ordinal references |
| `src/lib/evolution/agents/reflectionAgent.ts` | 4 | `getTopByElo` → `getTopByRating` |
| `src/lib/evolution/agents/proximityAgent.ts` | 4 | `getTopByElo` → `getTopByRating` |
| `src/lib/evolution/core/supervisor.ts` | 5 | `eloHistory` → `ordinalHistory`, plateau detection |
| `src/lib/evolution/core/pipeline.ts` | 5 | Summary construction, `getTopByRating` |
| `src/lib/evolution/core/pool.ts` | 5 | Opponent selection by ordinal |
| `src/lib/evolution/index.ts` | 6 | Remove Elo re-exports |
| `src/lib/services/evolutionActions.ts` | 5 | `elo_score` writes via `ordinalToEloScale()` |
| `src/lib/services/evolutionVisualizationActions.ts` | 5 | JSONB extraction backward compat, return type |
| `src/components/evolution/tabs/VariantsTab.tsx` | 5 | Display `ratingToDisplay()` |
| `src/components/evolution/tabs/EloTab.tsx` | 5 | `EloHistoryData` type update for `{mu, sigma}` |
| `src/app/admin/quality/evolution/run/[runId]/page.tsx` | 5 | Elo display → ordinal/rating |
| `src/app/admin/quality/evolution/page.tsx` | 5 | Elo column references |
| `src/app/admin/quality/article-bank/[topicId]/page.tsx` | 5 | `elo_score` references |
| `scripts/run-evolution-local.ts` | 5 | `getTopByElo` → `getTopByRating`, `eloRatings` → `ratings` |
| `scripts/lib/bankUtils.ts` | N/A | Out of scope (article bank Elo) |
| `src/testing/utils/evolution-test-helpers.ts` | 5 | Test fixture format |

### Out of Scope Files (article bank Elo — separate PR)
| File | Reason |
|------|--------|
| `src/lib/services/articleBankActions.ts` | Separate Elo system for cross-article comparison |
| `src/lib/services/articleBankActions.test.ts` | Article bank tests |
| `src/__tests__/integration/article-bank-actions.integration.test.ts` | Article bank integration |
| `src/__tests__/e2e/specs/09-admin/admin-article-bank.spec.ts` | Article bank E2E |
| `scripts/run-bank-comparison.ts` | Bank comparison script |
| `scripts/lib/bankUtils.ts` | Bank utility functions |
| `scripts/lib/bankUtils.test.ts` | Bank utility tests |
| `scripts/add-to-bank.ts` | Bank insertion script |

### Deleted Files (3)
| File | Phase | Reason |
|------|-------|--------|
| `src/lib/evolution/core/elo.ts` | 6 | Replaced by `rating.ts` |
| `src/lib/evolution/core/elo.test.ts` | 6 | Replaced by `rating.test.ts` |
| `src/lib/evolution/core/selectiveBiasMitigation.test.ts` | 6 | Experiment complete, findings in research doc |

### Dependencies Added (1)
| Package | Version | Purpose |
|---------|---------|---------|
| `openskill` | `^4.0.0` | Weng-Lin Bayesian rating system (MIT, zero transitive deps) |
