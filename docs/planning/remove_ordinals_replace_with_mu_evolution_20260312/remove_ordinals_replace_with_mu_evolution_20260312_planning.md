# Remove Ordinals Replace With Mu Evolution Plan

## Background
Remove ordinal (mu - 3*sigma) as the ranking/display metric throughout the evolution pipeline. Replace all ordinal usage with pure mu for sorting, Elo scale conversion, and persistence. The ordinal function penalizes uncertainty, which is already communicated via sigma/CI — baking it into the point estimate double-counts uncertainty.

## Requirements (from GH Issue #694)
Completely get rid of concept of ordinals from codebase. Replace with mu everywhere for evolution ranking.

## Problem
The evolution pipeline has a legacy concept called "ordinal" (mu - 3*sigma) that was used as a conservative skill estimate. This double-counts uncertainty since sigma is already communicated through confidence intervals. The codebase has already migrated ~90% to pure mu, but remnants persist in the arena DB column, deprecated function aliases, scripts, and test fixtures. Additionally, the Elo scale formula was calibrated for ordinal input (fresh ordinal ≈ 0 → Elo 1200) but now receives mu (fresh mu = 25 → Elo 1600), causing `eloGain` and `eloPerDollar` to show inflated values for unimproved variants.

## Options Considered

### Option A: Remove ordinal, keep Elo formula as-is (fresh = 1600)
- Pros: Smaller change, no data migration for elo_score values
- Cons: `eloGain` and `eloPerDollar` remain semantically wrong (fresh variant shows +400 gain)

### Option B: Remove ordinal AND recalibrate Elo scale (fresh = 1200) ← CHOSEN
- Pros: Semantically correct (fresh = 1200, zero gain, zero elo/dollar), clean slate
- Cons: Requires DB migration to shift existing elo_score/elo_rating values down by 400
- Formula change: `1200 + mu * 16` → `800 + mu * 16` (equivalently `1200 + (mu - 25) * 16`)

### Option C: Remove ordinal column entirely from DB ← ALSO CHOSEN
- Drop the column, rewrite `sync_to_arena` RPC without ordinal
- Pros: Clean break, no stale data, no confusion
- Cons: Requires rewriting the RPC — acceptable scope

## Phased Execution Plan

### Phase 1: Core rating module cleanup
**Files:** `evolution/src/lib/core/rating.ts`, `evolution/src/lib/index.ts`, `src/testing/mocks/openskill.ts`

1. Update `toEloScale(mu)` formula: `1200 + (mu - DEFAULT_MU) * (400 / DEFAULT_MU)` → fresh mu=25 maps to 1200
2. Fix stale comment on `toEloScale` (line 71)
3. Remove deprecated `ordinalToEloScale` alias (line 79)
4. Remove `ordinalToEloScale` from `index.ts` exports (line 56)
5. Remove `ordinal()` function from openskill mock (lines 43-45)
6. Update `computeEloPerDollar` — no formula change needed (already uses `toEloScale(mu) - 1200`)
7. Run: lint, tsc, build, unit tests for rating.test.ts

### Phase 2: Arena actions cleanup
**Files:** `evolution/src/services/arenaActions.ts`

1. Remove `ordinal` field from `ArenaEloEntry` interface (line 71)
2. Remove `elo_rating` field and outdated comment (line 72) — `display_elo` replaces it
3. Update `buildInitialEloRow`: replace ordinal computation with `ordinal: 0` dummy value (line 140) — deploy-safety
4. Update leaderboard SELECT: remove ordinal from query (line 310)
5. Update leaderboard response mapping: remove `ordinal: r.ordinal` (line 377)
6. Update comparison SELECT: remove ordinal (line 435)
7. Update comparison upsert: replace ordinal computation with `ordinal: 0` dummy (line 543)
8. Update CI bound comments from "ordinalToEloScale" to "toEloScale" (lines 91-93)
9. Run: lint, tsc, build, unit tests for arenaActions.test.ts

### Phase 3: Arena integration cleanup
**Files:** `evolution/src/lib/core/arenaIntegration.ts`

1. Remove `ordinal` from SELECT clause (line 36) — safe for both schema versions (column exists but isn't queried)
2. Replace `ordinal: rating.mu - 3 * rating.sigma` with `ordinal: 0` in syncToArena eloRows (line 259) — dummy value for deploy-safety: old RPC still expects the field in JSONB, and column is NOT NULL until migration drops it. After migration runs, the field is ignored.
3. Run: lint, tsc, build, unit tests for arenaIntegration.test.ts

### Phase 4: Scripts cleanup
**Files:** `evolution/scripts/lib/arenaUtils.ts`, `evolution/scripts/run-arena-comparison.ts`, `evolution/scripts/run-bank-comparison.ts`, `evolution/scripts/run-prompt-bank-comparisons.ts`

1. Remove `ordinal` from `.select()` queries in `run-arena-comparison.ts` (line 151), `run-bank-comparison.ts` (line 151), `run-prompt-bank-comparisons.ts` (line 199) — column will be dropped by migration
2. Replace `ordinal` field with `ordinal: 0` dummy value in all 4 scripts' DB insert/upsert objects — deploy-safety
3. Also update `evolution/scripts/backfill-experiment-metrics.ts` — has ordinal comments to clean up
4. Run: lint, tsc, build, unit tests for script test files

### Phase 5: Legacy/backward-compat cleanup
**Files:** `evolution/src/services/experimentHelpers.ts`, `evolution/src/lib/core/persistence.continuation.test.ts`

1. Keep V2→V3 ordinal transform in `types.ts` (backward compat for old checkpoints) — the V2 ordinal→mu conversion stays, and `toEloScale` will now produce correct (400 lower) Elo values automatically
2. **Keep** ordinal fallback in `experimentHelpers.ts:extractTopElo()` (line 12) — `extractTopElo` does raw JSONB access without `EvolutionRunSummarySchema.parse()`, so V2 run_summary data with only `ordinal` on topVariants needs the fallback to avoid returning null. **Fix:** Use the OLD formula inline for the V2 path: `return 1200 + topVariants[0].ordinal * (400 / 25)` instead of `toEloScale(topVariants[0].ordinal)`. This preserves correct historical values (fresh ordinal≈0 → Elo 1200) while the mu path uses the new formula. Add a comment: `// V2 legacy: ordinal used the old Elo scale (1200 + ord * 16)`
3. Remove `getOrdinal` and `ordinalToEloScale` mocks from `persistence.continuation.test.ts` (lines 47, 49)
4. Note: `eloToRating()` in `rating.ts` is already consistent with the new formula (`mu = 25 + (elo - 1200) * (25/400)` roundtrips correctly) — no changes needed
5. Run: lint, tsc, build, affected unit tests

### Phase 6: Database migration

**Deploy ordering:** Code deploys first (Vercel), then migration runs manually. The code changes in Phases 1-5 make the code **backward-compatible with both schema versions**:
- Code stops sending `ordinal` in JSONB payloads to `sync_to_arena` — the OLD RPC still works because it reads `ordinal` from JSONB via `v_elo->>'ordinal'` which returns NULL, but the column is NOT NULL. **Fix:** Phase 3 must keep sending `ordinal: 0` as a dummy value until migration runs. After migration drops the column, the field is simply ignored.
- Code removes `ordinal` from SELECT queries — **Fix:** Use `.select('mu, sigma, match_count')` (no ordinal). The column still exists in DB but isn't queried. Safe for both schemas.
- After code deploys cleanly, run the migration to drop the column and shift Elo values.

**Rollback plan:** If migration causes issues:
1. Re-add ordinal column: `ALTER TABLE evolution_arena_elo ADD COLUMN ordinal NUMERIC(10,6) DEFAULT 0;`
2. Shift Elo values back:
   ```sql
   UPDATE evolution_variants SET elo_score = elo_score + 400 WHERE elo_score IS NOT NULL;
   UPDATE evolution_arena_elo SET elo_rating = elo_rating + 400;
   UPDATE evolution_run_agent_metrics SET avg_elo = avg_elo + 400, elo_gain = elo_gain + 400 WHERE avg_elo IS NOT NULL;
   UPDATE evolution_run_agent_metrics SET elo_per_dollar = CASE WHEN cost_usd > 0 THEN (avg_elo - 1200) / cost_usd ELSE NULL END WHERE avg_elo IS NOT NULL;
   ```
3. Restore old sync_to_arena RPC (from migration `20260303000005`)
4. Restore old indexes: `CREATE INDEX idx_arena_elo_topic_ordinal ON evolution_arena_elo(topic_id, ordinal DESC);`
5. Revert code to previous commit

**File:** NEW `supabase/migrations/20260312000001_remove_ordinal_recalibrate_elo.sql`

```sql
-- Remove ordinal column from evolution_arena_elo and recalibrate Elo scale.
-- Old formula: toEloScale(x) = 1200 + x * 16  (fresh ordinal≈0 → 1200)
-- New formula: toEloScale(mu) = 1200 + (mu - 25) * 16 = 800 + mu * 16  (fresh mu=25 → 1200)
-- Net effect: all stored Elo values shift down by 400.
-- IMPORTANT: Run AFTER code deploy. Code is backward-compatible with both schemas.

-- 1. Shift elo_score down by 400 in evolution_variants
UPDATE evolution_variants SET elo_score = elo_score - 400 WHERE elo_score IS NOT NULL;

-- 2. Shift elo_rating down by 400 in evolution_arena_elo
UPDATE evolution_arena_elo SET elo_rating = elo_rating - 400;

-- 3. Shift avg_elo and elo_gain in evolution_run_agent_metrics
-- elo_gain = avg_elo - 1200, so it shifts by same amount
UPDATE evolution_run_agent_metrics SET
  avg_elo = avg_elo - 400,
  elo_gain = elo_gain - 400
WHERE avg_elo IS NOT NULL;

-- 4. Recalculate elo_per_dollar (= elo_gain / cost_usd, cannot shift by constant)
UPDATE evolution_run_agent_metrics SET
  elo_per_dollar = CASE
    WHEN cost_usd > 0 THEN (avg_elo - 1200) / cost_usd
    ELSE NULL
  END
WHERE avg_elo IS NOT NULL;

-- 5. Drop ordinal-based indexes
DROP INDEX IF EXISTS idx_arena_elo_topic_ordinal;
DROP INDEX IF EXISTS idx_hof_elo_topic_anchor_eligible;

-- 6. Drop ordinal column
ALTER TABLE evolution_arena_elo DROP COLUMN ordinal;

-- 7. Recreate indexes with mu
CREATE INDEX idx_arena_elo_topic_mu
  ON evolution_arena_elo(topic_id, mu DESC);

CREATE INDEX idx_arena_elo_topic_anchor_eligible
  ON evolution_arena_elo(topic_id, mu DESC)
  WHERE match_count >= 4 AND sigma < 5.0;

-- 8. Rewrite sync_to_arena RPC without ordinal
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_topic_id UUID,
  p_run_id UUID,
  p_entries JSONB DEFAULT '[]'::JSONB,
  p_matches JSONB DEFAULT '[]'::JSONB,
  p_elo_rows JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_entry JSONB;
  v_match JSONB;
  v_elo JSONB;
  v_rows INT;
  v_entries_inserted INT := 0;
  v_matches_inserted INT := 0;
  v_elos_upserted INT := 0;
BEGIN
  -- 1. Insert new entries
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_arena_entries (
      id, topic_id, content, generation_method, model,
      total_cost_usd, evolution_run_id, evolution_variant_id, metadata
    ) VALUES (
      (v_entry->>'id')::UUID,
      p_topic_id,
      v_entry->>'content',
      v_entry->>'generation_method',
      v_entry->>'model',
      (v_entry->>'total_cost_usd')::NUMERIC,
      p_run_id,
      (v_entry->>'evolution_variant_id')::UUID,
      COALESCE(v_entry->'metadata', '{}'::JSONB)
    )
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_entries_inserted := v_entries_inserted + v_rows;
  END LOOP;

  -- 2. Insert match comparisons
  FOR v_match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    INSERT INTO evolution_arena_comparisons (
      topic_id, entry_a_id, entry_b_id, winner_id,
      confidence, judge_model, dimension_scores
    ) VALUES (
      p_topic_id,
      (v_match->>'entry_a_id')::UUID,
      (v_match->>'entry_b_id')::UUID,
      CASE WHEN v_match->>'winner_id' IS NOT NULL
           THEN (v_match->>'winner_id')::UUID ELSE NULL END,
      (v_match->>'confidence')::NUMERIC,
      v_match->>'judge_model',
      v_match->'dimension_scores'
    );
    v_matches_inserted := v_matches_inserted + 1;
  END LOOP;

  -- 3. Upsert elo ratings (no ordinal)
  FOR v_elo IN SELECT * FROM jsonb_array_elements(p_elo_rows)
  LOOP
    INSERT INTO evolution_arena_elo (
      topic_id, entry_id, mu, sigma,
      elo_rating, elo_per_dollar, match_count
    ) VALUES (
      p_topic_id,
      (v_elo->>'entry_id')::UUID,
      (v_elo->>'mu')::NUMERIC,
      (v_elo->>'sigma')::NUMERIC,
      (v_elo->>'elo_rating')::NUMERIC,
      CASE WHEN v_elo->>'elo_per_dollar' IS NOT NULL
           THEN (v_elo->>'elo_per_dollar')::NUMERIC ELSE NULL END,
      (v_elo->>'match_count')::INT
    )
    ON CONFLICT (topic_id, entry_id) DO UPDATE SET
      mu = EXCLUDED.mu,
      sigma = EXCLUDED.sigma,
      elo_rating = EXCLUDED.elo_rating,
      elo_per_dollar = EXCLUDED.elo_per_dollar,
      match_count = EXCLUDED.match_count,
      updated_at = NOW();
    v_elos_upserted := v_elos_upserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'entries_inserted', v_entries_inserted,
    'matches_inserted', v_matches_inserted,
    'elos_upserted', v_elos_upserted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

### Phase 7: Update all test fixtures
**Files:** 19 test files

1. `rating.test.ts` — remove ordinalToEloScale alias test, update toEloScale expected values (fresh=1200 not 1600)
2. `arenaActions.test.ts` — remove ordinal from all fixtures and assertions
3. `experimentActions.test.ts` — remove V2 ordinal path tests (lines 314-327)
4. `arenaIntegration.test.ts` — remove ordinal from fixtures (lines 378, 383, 423)
5. `arenaBudgetFilter.test.ts` — remove ordinal from makeEntry() (line 11)
6. `tournament.test.ts` — update comments from ordinal to mu (lines 210-260)
7. `evolutionVisualizationActions.test.ts` — update ordinal comment (line 606)
8. `experimentMetrics.test.ts` — update ordinal comments and Elo expected values (lines 196, 346-348)
9. `persistence.continuation.test.ts` — remove ordinal mocks (lines 47, 49)
10. `arena-actions.integration.test.ts` — remove ordinal assertions (lines 620-652)
11. `evolution-visualization.integration.test.ts` — update comments (lines 186-188)
12. `pipeline.test.ts` — update V2→V3 test expected values (lines 364-377)
13. `experiment-driver/route.test.ts` — replace ordinal with mu in fixtures (lines 285-557)
14. `metricsWriter.test.ts` — update hardcoded 1600→1200 Elo assertions (lines 451, 511-512), elo_gain=400→0 for fresh
15. `pipelineUtilities.test.ts` — update toBeCloseTo(1600)→1200 assertion (line 192)
16. `analysis.test.ts` — update topElo:1600 fixtures and eloPer$ assertion (lines 11, 19-20, 27). Note: `topElo` in `run_summary` JSONB is a display value written at run completion time — the migration does NOT backfill these. Test fixtures should reflect what future runs will write (using new formula), not historical stored values.
17. `variantDetailActions.test.ts` — update elo_score:1600 fixture (line 15)
18. `state.test.ts` — update comment "returns top N by ordinal descending" → "by mu descending" (line 85)
19. `admin-experiment-detail.spec.ts` (E2E) — update ordinal:10 in run_summary fixture (line 105)
20. Run: full test suite

### Phase 8: Code comments + documentation updates
**Files:** 6 evolution docs + source files with ordinal comments

1. `rating_and_comparison.md` — update Elo scale description: fresh=1200, formula=`800 + mu*16`
2. `arena.md` — remove ordinal column references, update elo_rating description
3. `visualization.md` — replace "ordinal values (mu - 3*sigma)" with "mu values", update ordinalToEloScale refs
4. `data_model.md` — update avg_elo description, remove ordinalToEloScale reference
5. `reference.md` — update DB schema section, remove ordinal from evolution_arena_elo
6. `experimental_framework.md` — update scale consistency section: fresh=1200
7. Clean up ordinal comments in production source files: `experimentMetrics.ts` (lines 152, 328), `backfill-experiment-metrics.ts` (line 67)

## Testing

### Unit tests to modify
- `rating.test.ts` — new expected values for `toEloScale(25)` = 1200 (was 1600), remove alias test
- `arenaActions.test.ts` — remove ordinal from all fixtures/assertions
- `arenaIntegration.test.ts` — remove ordinal from fixtures
- `tournament.test.ts` — comment-only changes
- `experimentActions.test.ts` — remove ordinal path tests
- `experimentMetrics.test.ts` — update expected Elo values (shifted down 400)
- `persistence.continuation.test.ts` — remove ordinal mocks
- `arenaBudgetFilter.test.ts` — remove ordinal from fixture helper
- `pipeline.test.ts` — update V2→V3 expected values
- `experiment-driver/route.test.ts` — replace ordinal with mu in fixtures
- `metricsWriter.test.ts` — update 1600→1200, elo_gain=400→0 for fresh
- `pipelineUtilities.test.ts` — update 1600→1200 assertion
- `analysis.test.ts` — update topElo:1600 fixtures
- `variantDetailActions.test.ts` — update elo_score:1600 fixture
- `state.test.ts` — update ordinal comment
- `evolutionVisualizationActions.test.ts` — update ordinal comment

### Integration tests to modify
- `arena-actions.integration.test.ts` — remove ordinal column test
- `evolution-visualization.integration.test.ts` — update expected Elo values and comments

### E2E tests to modify
- `admin-experiment-detail.spec.ts` — update ordinal:10 in run_summary fixture

### Manual verification on stage
- Arena leaderboard displays correct Elo values (shifted down 400 from current)
- Run detail metrics show correct median/p90/max Elo
- Strategy aggregate metrics are consistent
- eloPerDollar shows 0 for unimproved variants
- V2 legacy run summaries still parse correctly

## Documentation Updates
The following docs were identified as relevant and need updates:
- `evolution/docs/evolution/rating_and_comparison.md` — fresh=1200, formula=`800 + mu*16`, remove ordinal references
- `evolution/docs/evolution/arena.md` — remove ordinal column documentation, update display_elo description
- `evolution/docs/evolution/visualization.md` — replace all "ordinal" with "mu", update ordinalToEloScale → toEloScale
- `evolution/docs/evolution/data_model.md` — update avg_elo description, remove ordinalToEloScale mention
- `evolution/docs/evolution/reference.md` — update evolution_arena_elo schema (ordinal column dropped)
- `evolution/docs/evolution/experimental_framework.md` — update "fresh variant maps to Elo 1600" → 1200
