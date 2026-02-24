# Add Best 2 Variants Into Hall of Fame Evolution Plan

## Background
Currently, adding evolution pipeline variants to the Hall of Fame requires manual admin action — clicking "Add to Hall of Fame" on a completed run's detail page. This project will automate the process so the top 2 variants from each completed pipeline run are automatically added to the Hall of Fame under the corresponding prompt/topic, and automatically ranked against the existing Hall of Fame pool via pairwise comparisons, all without user intervention.

## Requirements (from GH Issue #TBD)
1. Automatically add top 2 variants (by ordinal) from each completed pipeline run to the Hall of Fame
2. Auto-link to the corresponding prompt/topic in the Hall of Fame
3. Automatically run pairwise comparisons against the existing Hall of Fame pool (no manual action needed)
4. All of this should happen at pipeline finalization (inside `finalizePipelineRun`)

## Problem

The `feedHallOfFame()` function in `hallOfFameIntegration.ts` currently inserts the top 3 variants (by ordinal) from each completed pipeline run into the Hall of Fame. The requirement is to reduce this to 2, since the 3rd-place variant rarely provides additional signal and inflates comparison costs. The `evolution_top3` generation_method label in the DB CHECK constraint is semantically misleading for a top-2 system, but changing it requires a migration and is out of scope — the label is functional as-is.

## Options Considered

1. **Change hardcoded 3 → 2 in `feedHallOfFame()`** (chosen): Minimal change. Update `getTopByRating(3)` → `getTopByRating(2)`, rename variable, update tests and docs. No migration needed since rank CHECK allows 1-3 and we simply stop using rank 3.

2. **Introduce `HALL_OF_FAME_TOP_N` constant**: Adds a config point but over-engineers a value unlikely to change frequently. Rejected.

3. **Also rename `evolution_top3` → `evolution_top2`**: Requires DB migration to update CHECK constraint + Zod schema + all references. High risk for no functional benefit. Rejected.

## Phased Execution Plan

### Phase 1: Code change
1. In `hallOfFameIntegration.ts`: change `getTopByRating(3)` → `getTopByRating(2)`, rename `top3` → `top2`, update JSDoc/comments
2. Run lint + tsc

### Phase 2: Test updates
1. In `hallOfFameIntegration.test.ts`: update test names, reduce mock pool to 2 variants, update expected `entriesInserted` from 3 → 2, update upsert mock returns
2. Run tests

### Phase 3: Documentation
1. Update `data_model.md` (3 HoF-related "top 3" references)
2. Update `hall_of_fame.md` if any HoF insertion references say "top 3"
3. Update migration comment in SQL file (informational only)

### Phase 4: Verification
1. Run full lint, tsc, build, unit tests
2. Update progress doc and commit

## Testing

### Modified tests
- `evolution/src/lib/core/hallOfFameIntegration.test.ts` — update "top 3" → "top 2" in test name, reduce mock variants from 3 → 2, update `entriesInserted: 3` → `2`, update upsert mock to return 2 entries

### Manual verification
- After deploy to staging, trigger a pipeline run and verify only 2 entries appear in the Hall of Fame topic detail page

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/hall_of_fame.md` - Update to document automatic insertion and ranking
- `evolution/docs/evolution/data_model.md` - Update feedHallOfFame description (top 2 instead of top 3)
- `evolution/docs/evolution/architecture.md` - Update finalizePipelineRun data flow to include auto-comparison
- `evolution/docs/evolution/reference.md` - Update key files and configuration
- `evolution/docs/evolution/visualization.md` - Note any UI changes for auto-added entries
- `evolution/docs/evolution/rating_and_comparison.md` - Cross-reference auto-ranking
- `evolution/docs/evolution/README.md` - Update if reading order or overview changes
