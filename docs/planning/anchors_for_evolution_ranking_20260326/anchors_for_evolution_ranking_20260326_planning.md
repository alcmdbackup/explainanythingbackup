# Anchors For Evolution Ranking Plan

## Background
Explore whether using "anchor variants" for arena ranking would speed up ranking convergence of newer variants. Anchors are designated well-established variants that serve as the exclusive comparison opponents for new entrants. Because anchors accumulate many matches, they develop much lower sigma (uncertainty) values. The hypothesis is that comparing high-sigma new variants against low-sigma anchors will cause the new variants' ratings to converge faster in the Weng-Lin Bayesian model.

## Requirements (from GH Issue #845)
Requirements are open-ended — the research phase determined specifics:
- The Weng-Lin math confirms 2x faster sigma reduction per match against low-sigma opponents (σ³/c³ scaling, verified with Plackett-Luce beta=sigma/2=4.167)
- 3.3x fewer total matches to reach calibration threshold (17 vs 60 for σ<5.0)
- No sigma floor — variant content is immutable, so sigma should converge naturally
- Prior art: Glicko, TrueSkill, USCF all use the same principle
- Integration point: `selectOpponents()` in triage phase, currently ignores sigma

## Problem
New variants entering the arena require many pairwise comparisons (~60) to calibrate their ratings when compared only against other uncertain variants. This wastes expensive LLM judge calls. The Plackett-Luce sigma update equation (`delta ∝ σ³/c³`, where `c = sqrt(σ_w² + β² + σ_l² + β²)` and `β = DEFAULT_SIGMA/2 = 4.167`) shows that comparing against low-sigma opponents reduces c, producing 2x more sigma reduction per match. By preferring low-sigma opponents during triage, we can calibrate new variants in ~17 matches instead of ~60 — a 3.3x speedup that directly reduces LLM comparison costs.

**Math verification**: Per-match delta is `σ³/(4c³)`. For new (σ=8.33) vs anchor (σ=2): c=10.40, delta=0.129, reduction=0.555. For new vs new (σ=8.33): c=13.18, delta=0.063, reduction=0.267. Ratio: 2.08x. Compounds multiplicatively: 0.933^10=0.48 vs 0.968^10=0.74 → 3.3x fewer matches to reach σ<5.0.

## Options Considered
- [x] **Option A: Sigma-weighted opponent selection in triage**: Modify `selectOpponents()` to prefer lowest-sigma variants within each quartile. Minimal code change, leverages existing stratified architecture. No new DB columns needed.
- [ ] **Option B: Separate anchor-matching phase before triage**: Add a dedicated pre-triage phase where every new variant faces N designated anchors. Guarantees calibration but adds a second code path and could waste budget on predictable outcomes.
- [ ] **Option C: Persistent anchor designation with DB column**: Add `is_anchor` boolean to `evolution_variants`. Admin-managed anchors with special treatment. Powerful but over-engineered for the problem — the sigma-based approach auto-selects the best anchors dynamically.

**Selected: Option A** — simplest change with the biggest impact. The existing stratified selection already picks from the right elo bands; we just need to sort by sigma within each band instead of taking the first by mu.

## Phased Execution Plan

### Phase 0: Fix Arena Entry Rating Sync (prerequisite for all anchor work)
**Bug**: `syncToArena()` in `evolution/src/lib/pipeline/finalize/persistRunResults.ts` (line 358-359) filters out arena entries (`!isArenaEntry(v)`) when building `p_entries` for the RPC. This means arena entries participate in matches during a run and get updated mu/sigma in memory, but those updates are **never written back to the DB**. Staging data confirms: 43 arena entries with only 43 total matches, min_sigma=5.36 — no entry has converged past calibration threshold despite multiple runs.

- [ ] After building `newEntries` (line 358), build a separate `arenaUpdates` array from `pool.filter(isArenaEntry)` — only entries that participated in matches this run (skip entries with 0 matches to avoid unnecessary writes):
  ```typescript
  const arenaUpdates = pool
    .filter((v) => isArenaEntry(v) && (variantMatchCounts.get(v.id) ?? 0) > 0)
    .map((v) => {
      const r = ratings.get(v.id);
      const existingCount = /* loaded from arena entry */ v.arenaMatchCount ?? 0;
      const runMatches = variantMatchCounts.get(v.id) ?? 0;
      return {
        id: v.id,
        mu: r?.mu ?? 25,
        sigma: r?.sigma ?? 8.333,
        elo_score: r ? toEloScale(r.mu) : 1200,
        arena_match_count: existingCount + runMatches,  // absolute total, not delta
      };
    });
  ```
- [ ] Add a **separate `p_arena_updates` JSONB parameter** to the `sync_to_arena` RPC — do NOT reuse `p_entries` (which would overwrite immutable fields like `variant_content`, `run_id`, `generation_method` via ON CONFLICT). The new parameter gets a dedicated UPDATE loop:
  ```sql
  FOR entry IN SELECT * FROM jsonb_array_elements(p_arena_updates)
  LOOP
    UPDATE evolution_variants SET
      mu = COALESCE((entry->>'mu')::NUMERIC, mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, arena_match_count)
    WHERE id = (entry->>'id')::UUID AND synced_to_arena = true;
  END LOOP;
  ```
- [ ] Use **absolute arena_match_count** (existing + this run's matches, computed in TS) — NOT additive delta in SQL. This keeps the RPC fully idempotent under retry (syncToArena retries once on failure, line 390-408). Absolute overwrites are safe: worst case on concurrent writes is last-writer-wins on count, which is bounded by one run's worth of matches.
- [ ] For mu/sigma: last-writer-wins (simplest). Concurrent runs produce slightly inaccurate intermediate ratings, but this is self-correcting — the next run loads the latest snapshot and refines further. Accepted tradeoff for single-pipeline usage; revisit if concurrent arena syncs become common.
- [ ] Update existing test "excludes arena entries from new entries" (persistRunResults.test.ts ~line 380) — arena entries should now appear in `p_arena_updates`, NOT in `p_entries`. The test assertion changes from "arena entries excluded" to "arena entries in separate update payload".
- [ ] Add new unit tests (see Testing section)
- [ ] Add integration test: load arena entry with mu=25/sigma=8, run pipeline, verify post-sync sigma < 8 and arena_match_count increased

### Phase 1: Sigma-Weighted Opponent Selection
- [ ] Modify `selectOpponents()` in `evolution/src/lib/pipeline/loop/rankVariants.ts`:
  - Current code sorts `existing` by mu descending (line 69), then picks fixed indices: `top[0]`, `top[1]`, `sorted[q2-1]`, `sorted[q2]`, `sorted[q3]`
  - Change: within each quartile slice (`sorted.slice(0, q1)` for top, `sorted.slice(q2-1, q2+1)` for mid, `sorted.slice(q3)` for bottom), sub-sort by sigma ascending before picking the first element
  - This preserves mu-based stratification (quartiles still defined by mu) while preferring the most confident variant within each band
  - Fallback: if sigma is unavailable for a variant (no rating), treat as DEFAULT_SIGMA (8.333) so it sorts last
- [ ] No sigma floor — variant content is immutable, so true quality is fixed and sigma should converge naturally. Lower sigma = better anchor = faster calibration.
- [ ] `selectOpponents()` is only called from `executeTriage()` (line 319) — no impact on Swiss fine-ranking which uses `swissPairing()` independently

### Phase 2: Convergence Logging & Observability
- [ ] Add structured log in `executeTriage()` per entrant: `{ opponentSigmas: number[], sigmaBefore: number, sigmaAfter: number, matchCount: number }`
- [ ] Add optional `low_sigma_opponents_count` field to `RankingExecutionDetail` in `evolution/src/lib/schemas.ts` — use `.optional()` in Zod schema for backward compatibility with existing persisted execution details that lack this field
- [ ] Update `DETAIL_VIEW_CONFIGS` in `evolution/src/lib/core/detailViewConfigs.ts` to render the new field with label "Low-σ Opponents"

### Phase 3: Fix gpt-oss-20b Model String (separate commit)
- [ ] Rename `openai/gpt-oss-20b` → `gpt-oss-20b` in `allowedLLMModelSchema` (`src/lib/schemas/schemas.ts`) — the slash in the value prevents it from appearing in the strategy creation dropdown
- [ ] Update pricing key in `src/config/llmPricing.ts` from `openai/gpt-oss-20b` → `gpt-oss-20b`
- [ ] Update `isOpenRouterModel()` in `src/lib/services/llms.ts` to match `gpt-oss-20b`
- [ ] Update `apiModel` mapping in `src/lib/services/llms.ts` to prepend `openai/` when calling OpenRouter API: `isOpenRouterModel(validatedModel) ? \`openai/${validatedModel}\` : validatedModel`
- [ ] Update all test assertions in `schemas.test.ts`, `llmPricing.test.ts`, `llms.test.ts`
- [ ] **DB migration**: any existing `evolution_strategies` rows with `config->>'generationModel' = 'openai/gpt-oss-20b'` or `config->>'judgeModel' = 'openai/gpt-oss-20b'` must be updated to `gpt-oss-20b`. Add a SQL migration to handle this.
- [ ] This phase is a **separate commit** from the anchor ranking work

### Phase 4: Arena Leaderboard UI Enhancement
- [ ] Add "Anchor" badge/indicator on the arena leaderboard (`src/app/admin/evolution/arena/[topicId]/page.tsx`) for entries whose sigma is in the bottom 25th percentile of all entries for that prompt (adaptive threshold, no hardcoded floor)
- [ ] Show anchor count in leaderboard header (e.g., "4 anchors")

## Testing

### Unit Tests
#### Phase 0: Arena Sync Fix
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — update existing "excludes arena entries from new entries" test: arena entries should now appear in `p_arena_updates` (not `p_entries`), with updated mu/sigma/elo_score/arena_match_count
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — test that arena_match_count in `p_arena_updates` is absolute total (existing + run matches), ensuring idempotency under retry
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — test that arena entries with 0 matches during the run are excluded from `p_arena_updates`
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — test that `p_arena_updates` does NOT include variant_content, run_id, or generation_method (immutable fields preserved)

#### Phase 1: Sigma-Weighted Selection (via `rankPool()` — `selectOpponents` is private)
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — test that triage matches use lowest-sigma existing variants within each quartile: set up pool with 2 variants per quartile at same mu but different sigmas, verify the lower-sigma one is selected as opponent
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — test all-same-sigma case: when all existing variants have identical sigma, selection still works (degenerates to current behavior)
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — test empty existing pool: only new entrants, selectOpponents falls back to pairing new-vs-new (no crash)
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — test no-ratings fallback: when ratings.size===0, selection uses position-based fallback (no crash)
- [ ] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — test fewer existing than n: selectOpponents pads with new entrants (existing behavior preserved)

### Integration Tests
- [ ] `src/__tests__/integration/evolution-sync-arena.integration.test.ts` — Phase 0: verify arena entry mu/sigma/match_count are updated after pipeline run sync
- [ ] `src/__tests__/integration/evolution-sync-arena.integration.test.ts` — Phase 1: verify arena entries with low sigma are loaded correctly and participate in triage

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-anchor-ranking.spec.ts` — E2E test: create a prompt with pre-existing arena entries at varying sigmas, trigger a mock pipeline run, verify via run detail execution_detail that `low_sigma_opponents_count > 0` and triage opponents include the lowest-sigma arena entries
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` — add assertion that `gpt-oss-20b` appears in model dropdown (Phase 3 verification)

### Manual Verification
- [ ] Run a local evolution pipeline with `--mock` flag and verify triage selects lower-sigma opponents from existing pool
- [ ] Compare sigma convergence speed in logs between anchor-weighted and baseline runs

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Visual check of arena leaderboard anchor badge via local server (Phase 4 only)
- [ ] Playwright verification: open strategy creation dialog, confirm `gpt-oss-20b` appears in model dropdown (Phase 3)

### B) Automated Tests
- [ ] `npm run test:unit -- --testPathPattern="rankVariants"` — all ranking tests pass (existing + new)
- [ ] `npm run test:unit -- --testPathPattern="computeRatings"` — all rating tests pass (no changes, regression check)
- [ ] `npm run test:integration -- --testPathPattern="evolution-sync-arena"` — arena sync tests pass (Phase 0 + Phase 1)
- [ ] `npm run test:unit -- --testPathPattern="schemas.test|llmPricing|llms.test"` — Phase 3 test updates pass

### C) Rollback Plan
- [ ] If sigma-weighted selection degrades ranking quality: revert the single sort change in `selectOpponents()` — it's a 5-line diff. Monitor via `low_sigma_opponents_count` in execution details and sigma convergence rate in Phase 2 logs.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/arena.md` — add section on anchor behavior: how low-sigma variants are auto-preferred via sigma-weighted opponent selection in triage
- [ ] `evolution/docs/rating_and_comparison.md` — document sigma-weighted opponent selection in triage, gamma/cubic scaling explanation (σ³/c³)
- [ ] `evolution/docs/architecture.md` — mention sigma-weighted triage in the Rank Phase description
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — document `low_sigma_opponents_count` execution detail field
- [ ] `docs/feature_deep_dives/evolution_logging.md` — document new triage convergence log entries
- [ ] `evolution/docs/metrics.md` — no changes needed (metrics system unchanged)
- [ ] `evolution/docs/visualization.md` — document anchor badge on leaderboard (percentile-based threshold)

## Key Code Changes Summary

| File | Change |
|------|--------|
| `evolution/src/lib/pipeline/finalize/persistRunResults.ts` | `syncToArena()`: build separate `arenaUpdates` payload for arena entries, pass as `p_arena_updates` (Phase 0) |
| `supabase/migrations/` | Add `p_arena_updates` JSONB param to `sync_to_arena` RPC with dedicated UPDATE loop (Phase 0) |
| `evolution/src/lib/pipeline/loop/rankVariants.ts` | `selectOpponents()`: sub-sort each quartile slice by sigma ascending before picking. No other changes. |
| `evolution/src/lib/schemas.ts` | Add optional `low_sigma_opponents_count` to `RankingExecutionDetail` (`.optional()` for backward compat) |
| `evolution/src/lib/core/detailViewConfigs.ts` | Render `low_sigma_opponents_count` in admin UI |
| `src/lib/schemas/schemas.ts` | Rename `openai/gpt-oss-20b` → `gpt-oss-20b` in enum (separate commit) |
| `src/config/llmPricing.ts` | Update pricing key to `gpt-oss-20b` |
| `src/lib/services/llms.ts` | Update `isOpenRouterModel()` match + add `openai/` prefix in apiModel mapping |
| `src/app/admin/evolution/arena/[topicId]/page.tsx` | Anchor badge for entries in bottom 25th percentile of sigma |
| `supabase/migrations/` | Migration to update existing strategy configs referencing `openai/gpt-oss-20b` |

## Review & Discussion

### Iteration 1 (3 agents: Security 2/5, Architecture 3/5, Testing 3/5)
**Critical gaps identified and resolved:**
1. ~~Stale sigma floor references~~ — Removed all ANCHOR_SIGMA_FLOOR references from Phase 4 and key code changes table. Phase 4 now uses adaptive percentile-based threshold.
2. ~~Ambiguous quartile sort~~ — Phase 1 now specifies exact implementation: sub-sort each quartile slice by sigma ascending before picking first element. Preserves mu-based stratification.
3. ~~Math claim challenge~~ — Added explicit math verification in Problem section with actual Plackett-Luce constants (beta=4.167, not 11.78). The 2x/3.3x numbers are correct.
4. ~~Schema backward compatibility~~ — `low_sigma_opponents_count` (renamed from `anchor_opponents_used`) uses `.optional()` in Zod schema.
5. ~~selectOpponents is private~~ — Tests now specify testing through `rankPool()` indirectly, not direct function calls.
6. ~~Only 2 of 4 code paths tested~~ — Added 5 test cases covering: sigma preference, all-same-sigma, empty pool, no-ratings, fewer-than-n existing.
7. ~~Phase 3 DB migration missing~~ — Added migration step for existing strategy configs.
8. ~~Stale key code changes table~~ — Updated to remove sigma floor reference, use correct field name.
9. ~~No rollback plan~~ — Added rollback section.
10. ~~Phase 3 should be separate commit~~ — Explicitly noted as separate commit.

### Iteration 2 (Security 4/5, Architecture 4/5, Testing 4/5)
Minor issues only. All iteration-1 gaps confirmed resolved. Phase 0 added for arena sync bug.

### Iteration 3 (Security 4/5, Architecture 4/5, Testing 5/5)
**Critical gaps identified and resolved:**
11. ~~Additive match_delta not idempotent under retry~~ — Changed to absolute arena_match_count (existing + run matches computed in TS). The RPC overwrite is idempotent — retrying with the same absolute value produces the same result.
12. ~~ON CONFLICT overwrites immutable fields~~ — Split into separate `p_arena_updates` JSONB parameter with dedicated UPDATE loop that only touches mu/sigma/elo_score/arena_match_count. Immutable fields (variant_content, run_id, generation_method) are never modified.
13. ~~Existing test "excludes arena entries" would break~~ — Updated test plan to modify existing assertion: arena entries should appear in `p_arena_updates` not `p_entries`.
14. ~~No test for immutable field preservation~~ — Added test: `p_arena_updates` must NOT include variant_content/run_id/generation_method.
