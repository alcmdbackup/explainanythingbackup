# Make Competition More Efficient Progress

## Phase 1: Within-Run Top-K Filtering
### Work Done
- Added `tournament.topK` config param to `EvolutionRunConfig` (default: 3)
- Modified `swissPairing()` to filter eligible variants: top K by ordinal AND ordinal >= 0
- Updated convergence check to only require sigma convergence for top-K above-baseline variants
- Removed old `topKBoost` soft weighting in favor of hard exclusion filter
- Added fallback: if <2 eligible variants, uses top 2 by ordinal (always at least one pair)
- Added 4 new unit tests for filtering behavior, updated 5 existing tests to pass explicit `topK`
- All 740 evolution tests pass, lint/tsc/build clean

### Files Modified
- `src/lib/evolution/types.ts` — added `tournament: { topK: number }` to `EvolutionRunConfig`
- `src/lib/evolution/config.ts` — default `tournament: { topK: 3 }`, merge in `resolveConfig()`
- `src/lib/evolution/agents/tournament.ts` — filtering in `swissPairing()`, top-K convergence
- `src/lib/evolution/agents/tournament.test.ts` — 4 new tests, 5 updated

### Issues Encountered
- Hook expected project folder at `docs/planning/feat/...` (using full branch name), but `/initialize` created it at `docs/planning/make_competition_more_efficient_20260211/`. Fixed by `git mv`.

### User Clarifications
- User simplified from 3-phase plan (soft penalties + HoF migration + sigma pairing) to two hard filters: outside top 3 OR below 1200 with certainty
