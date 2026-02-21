# Use OpenSkill for Hall of Fame Evolution Plan

## Background
The Hall of Fame uses a separate Elo K-32 rating system while the evolution pipeline uses OpenSkill (Weng-Lin Bayesian). The Elo code is duplicated across 4+ files with identical `computeEloUpdate()` and `computeEloPerDollar()` functions. The existing `core/rating.ts` already has all needed OpenSkill functions plus backward-compat helpers (`eloToRating`, `ordinalToEloScale`), making migration feasible with no new dependencies.

## Requirements (from GH Issue #487)
- Migrate evolution_hall_of_fame_elo table from Elo (rating/K-factor) to OpenSkill (mu/sigma/ordinal)
- Update hallOfFameActions.ts comparison logic
- Update all UI components showing Elo ratings
- Update CLI scripts
- Deprecate Elo calculation code
- Update elo_per_dollar to ordinal_per_dollar
- Maintain backward compat for existing data

## Problem
The Hall of Fame and the evolution pipeline use two different rating systems: Elo K-32 and OpenSkill respectively. This means entries fed from evolution runs undergo a lossy rating conversion (`ordinalToEloScale`) when entering the Hall of Fame, then get re-rated with completely different math. The Elo code is duplicated in 4+ files with identical constants and formulas. Unifying on OpenSkill eliminates the dual-system complexity, removes code duplication, and preserves rating fidelity from evolution runs into the Hall of Fame.

## Scope

### IN SCOPE: Real Elo K-32 math
- `evolution_hall_of_fame_elo` table columns
- `hallOfFameActions.ts` — `computeEloUpdate()`, `computeEloPerDollar()`, init logic, comparison logic
- 4 CLI scripts with duplicated Elo math (`run-hall-of-fame-comparison.ts`, `run-prompt-bank-comparisons.ts`, `run-bank-comparison.ts`, `lib/hallOfFameUtils.ts`)
- UI labels/columns referencing Hall of Fame Elo
- All associated tests

### OUT OF SCOPE: Elo-scale display columns
These columns already store OpenSkill ordinals mapped to 0-3000 via `ordinalToEloScale()`. The underlying math is already OpenSkill — only the column names reference "Elo":
- `evolution_variants.elo_score`
- `evolution_run_agent_metrics.avg_elo`, `elo_gain`, `elo_per_dollar`
- `evolution_strategy_configs.avg_final_elo`, `avg_elo_per_dollar`, `best_final_elo`, `worst_final_elo`, `stddev_final_elo`
- `update_strategy_config_aggregates()` RPC

Renaming these is optional and a separate project.

## Options Considered

### Option A: Native OpenSkill (mu/sigma/ordinal) with backward-compat elo_rating column
**Chosen.** Add `mu`, `sigma`, `ordinal` columns to `evolution_hall_of_fame_elo`. Keep `elo_rating` as a derived column (`ordinalToEloScale(ordinal)`) for backward compat and display. Use `eloToRating()` to migrate existing rows. All new math uses OpenSkill functions from `core/rating.ts`.

**Pros**: Clean separation — native OpenSkill for math, Elo-scale for display. No breaking changes to UI that already shows 0-3000 scale. Reuses existing `core/rating.ts` functions.
**Cons**: One extra column to maintain (`elo_rating` as derived). Slight complexity in keeping it in sync.

### Option B: Full replacement — drop elo_rating entirely
Remove `elo_rating` column, show raw ordinal everywhere.

**Pros**: Cleanest schema, no backward compat.
**Cons**: Breaking change for all UI components. Raw ordinal (typically -5 to 40) is less intuitive than 0-3000 scale. Would require reworking every chart and leaderboard axis.

### Option C: Keep Elo math, just add mu/sigma tracking
Track both systems in parallel.

**Pros**: Zero risk, no behavioral change.
**Cons**: More complexity, not less. Doesn't solve the core problem.

## Key Design Decisions

### D1: Confidence threshold for decisive vs draw
Elo uses confidence as a continuous weight: `scoreA = 0.5 ± 0.5 * confidence`. OpenSkill is binary: decisive (`updateRating`) or draw (`updateDraw`).

**Decision**: Use `confidence >= 0.6` as decisive threshold. Below 0.6, treat as draw. This prevents low-confidence judgments from causing large rating swings.

**Behavioral impact**: This is a deliberate simplification from Elo's continuous weighting. In Elo, a confidence of 0.59 gives `scoreA = 0.795` (almost decisive), while in OpenSkill it becomes a draw. This means marginal-confidence comparisons will produce smaller rating changes than under Elo. This is acceptable because: (1) OpenSkill's sigma-based update magnitude already provides adaptive scaling that Elo lacked, (2) draws still reduce sigma (uncertainty), so even low-confidence matches contribute to convergence, and (3) the alternative (mapping confidence to partial outcomes) is not supported by the OpenSkill API.

### D2: Initialization of new entries
Elo starts at 1200 (fixed). OpenSkill starts at `{mu:25, sigma:8.333}`.

**Decision**: New entries get `createRating()`. When fed from evolution runs, carry over the run's final OpenSkill rating directly (no conversion needed — currently the pipeline converts to Elo scale via `ordinalToEloScale`, we'll instead pass the raw `{mu, sigma}`).

### D3: Migration of existing data
**Decision**: Use the existing `eloToRating(elo, matchCount)` function. Entries with 8+ matches get sigma=3.0 (converged), 4-7 matches get sigma=5.0, fewer get default sigma=8.333. This preserves relative ordering while adding proper uncertainty.

### D4: UI display scale
**Decision**: Keep showing 0-3000 scale in UI (via `ordinalToEloScale`). Rename labels from "Elo Rating" to "Rating" or "Skill Rating". The 0-3000 scale is familiar and intuitive; raw ordinal would confuse users.

## Phased Execution Plan

### Phase 1: Database Migration + Core Logic
**Goal**: Add OpenSkill columns, migrate existing data, update server-side rating math.

**Files modified**:
- `supabase/migrations/YYYYMMDD_hall_of_fame_openskill.sql` — NEW migration
- `evolution/src/services/hallOfFameActions.ts` — Replace Elo math with OpenSkill, update HallOfFameEloEntry interface

**Migration SQL**:
```sql
-- Rollback: ALTER TABLE evolution_hall_of_fame_elo DROP COLUMN mu, DROP COLUMN sigma, DROP COLUMN ordinal;
--           DROP INDEX IF EXISTS idx_evolution_hall_of_fame_elo_topic_ordinal;
--           CREATE INDEX idx_evolution_hall_of_fame_elo_leaderboard ON evolution_hall_of_fame_elo(topic_id, elo_rating DESC);

-- Add OpenSkill columns
ALTER TABLE evolution_hall_of_fame_elo
  ADD COLUMN mu NUMERIC(10,6) NOT NULL DEFAULT 25.0,
  ADD COLUMN sigma NUMERIC(10,6) NOT NULL DEFAULT 8.333333,
  ADD COLUMN ordinal NUMERIC(10,6) NOT NULL DEFAULT 0.0;

-- Migrate existing rows: map elo_rating → mu, derive sigma from match_count
-- Note: ordinal can go negative for low-Elo entries (e.g., elo=400 → mu=-25 → ordinal≈-50).
-- This is fine — NUMERIC(10,6) handles negatives, and ordinalToEloScale clamps to [0,3000]
-- which satisfies the existing CHECK constraint on elo_rating.
UPDATE evolution_hall_of_fame_elo SET
  mu = 25.0 + (elo_rating - 1200) * (25.0 / 400.0),
  sigma = CASE
    WHEN match_count >= 8 THEN 3.0
    WHEN match_count >= 4 THEN 5.0
    ELSE 8.333333
  END,
  ordinal = (25.0 + (elo_rating - 1200) * (25.0 / 400.0))
            - 3 * (CASE WHEN match_count >= 8 THEN 3.0
                        WHEN match_count >= 4 THEN 5.0
                        ELSE 8.333333 END);

-- Now update elo_rating and elo_per_dollar to be consistent with the new ordinal values.
-- The round-trip elo → mu/sigma → ordinal → eloScale does NOT reproduce the original elo
-- (e.g., elo=1200, matchCount=8 → mu=25, sigma=3, ordinal=16 → eloScale=1456).
-- This is expected: the Elo-scale display now reflects the OpenSkill ordinal, not the old Elo rating.
-- Leaderboard ordering will change because entries with different sigma values (match counts)
-- will produce different ordinals even from the same original elo_rating.
UPDATE evolution_hall_of_fame_elo SET
  elo_rating = GREATEST(0, LEAST(3000,
    1200 + ordinal * (400.0 / 25.0)
  )),
  elo_per_dollar = CASE
    WHEN total_cost_usd IS NULL OR total_cost_usd = 0 THEN NULL
    ELSE (GREATEST(0, LEAST(3000, 1200 + ordinal * (400.0 / 25.0))) - 1200) / total_cost_usd
  END;

-- Replace elo_rating-based index with ordinal-based index for leaderboard sorting
DROP INDEX IF EXISTS idx_evolution_hall_of_fame_elo_leaderboard;
CREATE INDEX idx_evolution_hall_of_fame_elo_topic_ordinal ON evolution_hall_of_fame_elo(topic_id, ordinal DESC);
```

**hallOfFameActions.ts changes** (all callsites that interact with `evolution_hall_of_fame_elo`):
```typescript
// REMOVE: computeEloUpdate(), computeEloPerDollar(), INITIAL_ELO, ELO_K
// ADD: import { createRating, updateRating, updateDraw, getOrdinal, ordinalToEloScale } from '../lib/core/rating';

// Confidence threshold for decisive vs draw
const DECISIVE_CONFIDENCE_THRESHOLD = 0.6;

// CALLSITE 1: addToHallOfFameAction (~line 188)
//   BEFORE: elo_rating: INITIAL_ELO, match_count: 0
//   AFTER:  mu: 25.0, sigma: 8.333, ordinal: 0.0,
//           elo_rating: 1200, match_count: 0, elo_per_dollar: null

// CALLSITE 2: generateAndAddToHallOfFameAction (~line 746)
//   Same change as CALLSITE 1

// CALLSITE 3: runHallOfFameComparisonInternal (~lines 341-500)
//   Update .select() at ~line 368: fetch 'entry_id, mu, sigma, ordinal, match_count' (was: 'entry_id, elo_rating, match_count')
//   Replace eloMap with ratingMap: Map<string, { rating: Rating, matchCount: number }>
//   Swiss pairing: sort by getOrdinal(rating) DESC (was: sort by elo_rating DESC)
//   For each comparison result:
//     if (confidence >= DECISIVE_CONFIDENCE_THRESHOLD):
//       updateRating(winner, loser)
//     else:
//       updateDraw(a, b)
//   Persist: mu, sigma, ordinal=getOrdinal(r),
//     elo_rating=ordinalToEloScale(ordinal),
//     elo_per_dollar=(ordinalToEloScale(ordinal) - 1200) / totalCostUsd

// CALLSITE 4: getHallOfFameLeaderboardAction (~line 290)
//   Change .order('elo_rating', { ascending: false }) to .order('ordinal', ...)
//   Add mu, sigma, ordinal to .select()

// CALLSITE 5-8: Read-only queries — no changes needed (elo_rating kept in sync):
//   5. getCrossTopicSummaryAction (~line 531) — reads elo_rating for avg_elo aggregation
//   6. getHallOfFameTopicsAction (~line 799) — reads elo_rating for elo_min/elo_max display
//   7. getPromptBankCoverageAction (~line 934) — reads elo_rating for coverage stats
//   8. getPromptBankMethodSummaryAction (~line 1035) — reads elo_rating for method comparison
//   All read elo_rating/elo_per_dollar for display. elo_rating is derived from ordinal,
//   so these queries work unchanged. No .select() changes needed.
//
// DELETE callsites (no changes needed):
//   deleteHallOfFameEntryAction (~line 631), deleteHallOfFameTopicAction (~line 668)
//   DELETE by ID — no column awareness needed.
```

**Type change**:
```typescript
export interface HallOfFameEloEntry {
  id: string;
  entry_id: string;
  mu: number;           // NEW
  sigma: number;        // NEW
  ordinal: number;      // NEW
  elo_rating: number;   // KEPT for backward compat (derived from ordinal)
  elo_per_dollar: number | null;  // Derived: (ordinalToEloScale(ordinal) - 1200) / totalCostUsd
  match_count: number;
  generation_method: HallOfFameGenerationMethod;
  model: string;
  total_cost_usd: number | null;
  created_at: string;
}
```

**Verification**: Unit tests for new comparison logic pass. After migration, `elo_rating` is recalculated from ordinal (not preserved as original Elo). This is intentional — the Elo-scale display now reflects OpenSkill ordinal. Entries with high match counts (low sigma) will see elo_rating increase (e.g., 1200 → 1456 for matchCount=8) because their ordinal is higher than entries with the same mu but more uncertainty.

**Note on elo_per_dollar column rename**: The requirements say "update elo_per_dollar to ordinal_per_dollar". We keep the column named `elo_per_dollar` for backward compatibility (consistent with the OUT OF SCOPE Elo-scale columns). The formula changes to `(ordinalToEloScale(ordinal) - 1200) / totalCostUsd`. Renaming the column is deferred to the Elo-naming cleanup project.

### Phase 2: Pipeline Integration + CLI Scripts
**Goal**: Pass raw OpenSkill ratings from evolution runs to Hall of Fame. Remove duplicated Elo code from CLI scripts.

**Files modified**:
- `evolution/src/lib/core/hallOfFameIntegration.ts` — Pass raw `{mu, sigma}` instead of converting to Elo scale
- `evolution/scripts/run-hall-of-fame-comparison.ts` — Remove duplicated Elo math, use `core/rating.ts`
- `evolution/scripts/run-prompt-bank-comparisons.ts` — Same
- `evolution/scripts/run-bank-comparison.ts` — Same (4th script with identical duplicated Elo math at lines 98-114)
- `evolution/scripts/lib/hallOfFameUtils.ts` — Remove Elo init, use `createRating()`
- `evolution/scripts/add-to-hall-of-fame.ts` — References `elo_score` (variant's Elo-scale display column, OUT OF SCOPE). Only cosmetic label change in console output if desired. No Elo math to remove.

**hallOfFameIntegration.ts key change**:
```typescript
// BEFORE: elo_rating: ordinalToEloScale(getOrdinal(variant.rating))
// AFTER:  mu: variant.rating.mu, sigma: variant.rating.sigma,
//         ordinal: getOrdinal(variant.rating),
//         elo_rating: ordinalToEloScale(getOrdinal(variant.rating))
```

**Deployment ordering**: Phase 1 migration adds NOT NULL columns with defaults (mu=25, sigma=8.333, ordinal=0). If `feedHallOfFame()` runs before Phase 2 code deploys, it will insert rows with these default values instead of the actual variant ratings. **All phases must be in the same PR.** The deploy sequence is: (1) Supabase migration runs first via CI (`supabase db push`), adding the new columns, then (2) Vercel redeploys with the updated code that references the new columns. This order is safe because the migration adds columns with defaults — old code still works with the new schema. If this project's CI runs migrations after code deploy, the code must be backward-compatible by conditionally selecting mu/sigma/ordinal only if they exist (check with a try/catch on the first query).

**Verification**: CLI scripts run successfully against dev DB. `feedHallOfFame()` correctly passes OpenSkill ratings.

### Phase 3: UI Updates
**Goal**: Update all UI components to display "Rating" instead of "Elo Rating" and use ordinal-derived values.

**Files modified** (~15 components):
- `src/app/admin/quality/hall-of-fame/page.tsx` — CrossTopicSummary, PromptBankSummary, Topics Table
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` — CostEloScatter, Leaderboard, AddFromRunDialog
- `evolution/src/components/evolution/tabs/EloTab.tsx` — Rename to RatingTab or update labels
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — Update column header
- `evolution/src/components/evolution/EloSparkline.tsx` — Rename to RatingSparkline or update labels
- `src/app/admin/quality/optimization/_components/CostSummaryCards.tsx` — Label update
- `src/app/admin/quality/optimization/_components/AgentROILeaderboard.tsx` — Label update
- `src/app/admin/quality/optimization/_components/StrategyLeaderboard.tsx` — Label update
- `src/app/admin/quality/strategies/page.tsx` — Column header
- `src/app/admin/quality/explorer/page.tsx` — Column header
- `src/components/admin/EvolutionSidebar.tsx` — "Elo Optimization" → "Rating Optimization" or "Cost Optimization"

**Approach**: Rename display labels only. The underlying data flow already works because `elo_rating` remains as a backward-compat column holding the 0-3000 scale value. No data plumbing changes needed in UI — just text labels.

**Verification**: Visual inspection of all pages. No broken layouts or missing data.

### Phase 4: Test Updates + Cleanup
**Goal**: Update all test assertions, remove dead Elo code.

**Test files to update** (12 files):
- `hallOfFameActions.test.ts` (~20 tests) — Update init assertions (mu/sigma instead of elo=1200), update comparison math assertions
- `hallOfFameUtils.test.ts` (5 tests) — Update init assertions
- `run-hall-of-fame-comparison.test.ts` (9 tests) — Replace Elo math assertions with OpenSkill
- `run-bank-comparison.test.ts` (9 tests) — Replace duplicated Elo math assertions with OpenSkill (mirrors run-hall-of-fame-comparison.test.ts)
- `bankUtils.test.ts` (lib/) — Update elo_rating=1200 init assertions
- `hallOfFame.test.ts` (6 tests) — Update feedHallOfFame assertions
- `hallOfFameIntegration.test.ts` (~8 tests) — Update assertions for raw OpenSkill passthrough
- `rating.test.ts` (11 tests) — Already correct, add round-trip migration accuracy test
- `hall-of-fame-actions.integration.test.ts` (9 tests) — Update init assertions, update `insertElo()` helper to include mu/sigma/ordinal, verify migration data
- `evolution-cost-attribution.integration.test.ts` — Verify avg_elo and elo_per_dollar assertions still hold (these use Elo-scale display columns which are OUT OF SCOPE, but confirm no regression)
- `admin-hall-of-fame.spec.ts` (14 E2E tests) — Update expected column labels ("Rating" not "Elo Rating"), update `seedHallOfFameData`/`seedPromptBankData` helpers to include mu/sigma/ordinal values consistent with seeded elo_rating, verify 0-3000 display
- `eloBudgetActions.test.ts` — Verify no changes needed (uses evolution pipeline Elo-scale fields which are OUT OF SCOPE)

**Dead code to remove**:
- `computeEloUpdate()` in `hallOfFameActions.ts`
- `computeEloPerDollar()` in `hallOfFameActions.ts`
- `INITIAL_ELO`, `ELO_K` constants in `hallOfFameActions.ts`
- Duplicated Elo functions in 4 CLI scripts (including `run-bank-comparison.ts`)

**Verification**: All unit, integration, and E2E tests pass. `npm run lint && npm run tsc && npm run build` clean.

## Testing

### Unit Tests (modify existing)
- `hallOfFameActions.test.ts` — New entries init with `createRating()` defaults (mu=25, sigma≈8.333). Comparison updates use `updateRating`/`updateDraw` based on confidence threshold. `elo_rating` derived correctly.
- `hallOfFameUtils.test.ts` — Init uses `createRating()`.
- `run-hall-of-fame-comparison.test.ts` — Rating math uses OpenSkill. Swiss pairing by ordinal.
- `rating.test.ts` — Add tests for `eloToRating` round-trip accuracy (migration validation).

### Integration Tests (modify existing)
- `hall-of-fame-actions.integration.test.ts` — Verify mu/sigma/ordinal columns populated. Verify `elo_rating` backward compat.
- `hallOfFameIntegration.test.ts` — Verify raw OpenSkill ratings pass through from evolution runs.

### E2E Tests (modify existing)
- `admin-hall-of-fame.spec.ts` — Verify leaderboard displays "Rating" (not "Elo Rating"). Verify 0-3000 scale values. Verify scatter chart works.

### Manual Verification
- Run migration on staging, verify existing entries' ratings are preserved (round-trip).
- Run a Hall of Fame comparison round on staging, verify ratings update correctly.
- Visual check of all UI pages listed in Phase 3.

## Documentation Updates
The following docs need updates:
- `evolution/docs/evolution/hall_of_fame.md` — Update Elo references to OpenSkill
- `evolution/docs/evolution/rating_and_comparison.md` — Update cross-reference between within-run and cross-run systems (now unified)
- `evolution/docs/evolution/data_model.md` — Update Hall of Fame data model references
- `evolution/docs/evolution/architecture.md` — Update architecture references to Elo
- `evolution/docs/evolution/README.md` — Update two rating systems table (now one system)
- `evolution/docs/evolution/cost_optimization.md` — Update elo_per_dollar references
- `evolution/docs/evolution/reference.md` — Update database schema and key files
