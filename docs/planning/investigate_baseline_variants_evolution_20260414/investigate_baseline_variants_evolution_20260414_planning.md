# Investigate Baseline Variants Evolution Plan

## Background
We want to understand why baseline variants in the last few stage runs are consistently near the strongest variants in the pool, and why the same baseline variant appears to be reused every run. Research confirmed that every run creates a fresh baseline `evolution_variants` row (new UUID, default rating mu=25/elo=1200) from the persisted seed's *text* rather than reusing the seed row itself. This causes (a) the baseline to rise to elo 1300–1400 in many runs by winning a handful of judge comparisons from a fresh start, (b) the arena to accumulate near-duplicate `generation_method='pipeline'` baseline copies (487 rows for one prompt), and (c) the seed row's arena rating to stay frozen at its original value (elo 1099 for the Fed seed) because subsequent runs never match the seed row's UUID.

## Requirements (from GH Issue #TBD)
- Investigate why baseline variants in the last few stage runs are consistently near the strongest variants in the pool.
- Investigate why the same baseline variant is being used every run.
- Document how `generateFromSeedArticle` uses the baseline for ranking newly generated variants.
- Explain why ratings for newly generated variants are often systematically low (< 1200).

## Problem
The pipeline persists a seed variant per prompt (`generation_method='seed'`) so the same text is reused across runs, but it fails to reuse the **rating**: each subsequent run constructs a fresh `Variant` from the seed's text with a new UUID and default `mu=25/sigma=8.333`. This disconnects the per-run baseline from its historical arena state, inflates the baseline's in-run rating against freshly-spawned transforms (which also start at 1200), and prevents any arena-wide accumulation of evidence about the seed's true relative quality. Separately, the name "baseline" is a misleading relic — the variant in question is literally the persisted seed article, and calling it "baseline" hides its role in the data model. There is also a redundant duplicate: `runIterationLoop.ts:367-376` creates a `seedBaseline` shadow copy of the seed agent's output with identical text, bloating the pool and confusing semantics.

## Options Considered
- [x] **Option A: Read-only investigation + report** — research only; no code change. *Rejected:* user wants the behavior fixed.
- [ ] **Option B: Investigation + targeted fix** *(selected)* — load the seed's persisted rating into each run's pool, update its rating through `arenaUpdates` at finalize, eliminate the first-run duplicate `seedBaseline`, and rename "baseline" → "seed variant" throughout.
- [ ] **Option C: Investigation + observability improvements** — add metrics/logging for seed-vs-new-variant match outcomes. *Deferred:* can layer on later once the rating loop is correct.

## Design (Option B)

### A) Introduce `reusedFromSeed` flag (NOT `fromArena`)

**Why a new flag instead of `fromArena=true`:** `fromArena=true` is used by `finalize/persistRunResults.ts:106` (`localPool = pool.filter(v => !v.fromArena)`) to exclude arena entries from `evolution_variants` inserts *and* from `buildRunSummary` (topVariants, seedVariantRank, strategyEffectiveness) *and* from `selectWinner`. If we set `fromArena=true` on the seed variant, the seed silently disappears from run summaries, can never be winner, and is dropped from strategy aggregates — none of which we want. A dedicated flag disambiguates.

Add to `Variant` type in `evolution/src/lib/types.ts`:
```ts
interface Variant {
  // ... existing fields ...
  fromArena?: boolean;       // loaded via loadArenaEntries (existing)
  reusedFromSeed?: boolean;  // NEW: is the persisted seed for this prompt
  arenaMatchCount?: number;  // lifted to top-level for both flags (existing on ArenaTextVariation)
}
```

**Finalize routing (persistRunResults.ts):**
```ts
// Persisted row inserts: exclude arena-loaded entries AND the reused seed (already exists as a DB row)
const newEntries = pool.filter(v => !v.fromArena && !v.reusedFromSeed).map(...)

// Arena-rating updates: include arena entries AND the reused seed (if they played ≥1 match)
const arenaUpdates = pool
  .filter(v => (v.fromArena || v.reusedFromSeed) && (variantMatchCounts.get(v.id) ?? 0) > 0)
  .map(...)

// Run summary + winner selection: use FULL pool (don't filter seed out)
const summaryPool = pool.filter(v => !v.fromArena || v.reusedFromSeed)
// buildRunSummary operates on summaryPool; selectWinner(summaryPool, ratings) too.
```

This keeps the seed visible in `topVariants`, `seedVariantRank`, `seedVariantElo`, `strategyEffectiveness`, and `is_winner` computation while routing its post-run rating through the arena UPSERT path (not a fresh INSERT).

### B) Seed rating load/writeback

Current (broken) flow for prompt-based runs with an existing seed:

```
resolveContent()            → returns seed.variant_content as originalText
loadArenaEntries()          → loads ALL synced_to_arena=true rows (incl. seed) into initialPool
runIterationLoop L211-214   → creates NEW Variant{ id: fresh_uuid, strategy: 'baseline' },
                              adds default mu=25/sigma=8.33 rating
finalizeRun → sync_to_arena → writes the fresh baseline UUID as a new pipeline arena entry;
                              seed row untouched; arena grows by +1 near-duplicate
```

Target flow:

```
resolveContent()            → returns { originalText, seedVariantRow?: {id, mu, sigma, arena_match_count} }
                              reads all needed fields in ONE query (no second round-trip — avoids read-skew race)
loadArenaEntries(excludeId) → filters OUT the seed row when excludeId matches (seed enters via baseline path)
runIterationLoop L211-216   → if seedVariantRow present:
                                createVariant overridden to use seed.id, strategy='seed_variant',
                                reusedFromSeed=true, arenaMatchCount=seed.arena_match_count
                                ratings.set(seed.id, dbToRating(seed.mu, seed.sigma))
                              else (first run for prompt, or explanation_id flow): unchanged
runIterationLoop L367-376   → eliminate the duplicate seedBaseline: use seedVariant directly as the
                              seed_variant pool member (strategy='seed_variant'), persisted with
                              generation_method='seed' at finalize. (One pool entry, not two.)
finalizeRun                  → reusedFromSeed variants route to arenaUpdates (updates seed row);
                              first-run seed_variant (no reusedFromSeed flag) gets inserted normally
                              with generation_method='seed'.
```

**Invariant asserted at runtime**: `resolveContent` guarantees any returned seed row has `synced_to_arena=true` (the SELECT filter already enforces this at line 133). Add an explicit assertion in `buildRunContext.ts` after the SELECT: if somehow `synced_to_arena=false` on the result, log an error and treat as "no seed found" (fall through to `CreateSeedArticleAgent`).

**Concurrency race (two runners on same prompt):** Both runners load the same seed mu/sigma; both compute post-run updates; both emit `arenaUpdates` → last-writer-wins overwrites the other. **Mitigation**: in `persistRunResults.ts` arenaUpdates builder, for each `reusedFromSeed` entry compare the pre-run-loaded rating (pass through from `initialRatings` / `seedVariantRow`) against the DB row at write time via an optimistic-concurrency `UPDATE ... WHERE id=? AND mu=loaded_mu AND sigma=loaded_sigma AND arena_match_count=loaded_match_count`. Include `arena_match_count` in the predicate so a concurrent runner that incremented match count but left mu/sigma near-equal still trips the guard. If the affected row count is 0, log a `WARN` with both snapshots, emit a metric `evolution.seed_rating.collision` (for monitoring), and skip the update. Postgres `NUMERIC` is exact, so equality holds end-to-end provided we pass mu/sigma as strings (not JS floats) — do this by using the Supabase client's raw parameter form rather than `.eq()` on numbers, OR by storing the loaded mu/sigma as the stringified `toString()` at load time and comparing via `::text` cast. Document the exact serialization in the test.

**Arithmetic correction**: `dbToRating(mu=18.75, sigma=7.15)` yields `elo = 1200 + (18.75 - 25) * 16 = 1100` (not 1099). Minor correction to Phase 3 expectations.

**Archived mid-run**: If the seed is archived (`archived_at` set) after `resolveContent` returned it, the in-memory run continues unaffected. At finalize, the optimistic-concurrency `UPDATE` must NOT filter on `archived_at IS NULL` — we want the rating update to land regardless (the archive is a UI-visibility decision, not a rating decision). Document this.

### C) Rename "baseline" → "seed variant"

**Forward/back deploy ordering**: Roll out Zod `.transform()` changes and code renames in a single deploy. Deploying only the reader changes would fail to emit the new field names; deploying only the writer changes would fail to parse old reader expectations. Document this as a hard requirement: no partial deploys.

**Code symbols to rename**:
- `V2_BASELINE_STRATEGY` constant (`persistRunResults.ts:20`) → `SEED_VARIANT_STRATEGY`, value `'baseline'` → `'seed_variant'`.
- Literal `strategy: 'baseline'` in `runIterationLoop.ts:212` and `:369` → `'seed_variant'` (and at L369 also eliminate the duplicate as described above).
- `EvolutionRunSummaryV3Schema` fields `baselineRank`, `baselineElo` → `seedVariantRank`, `seedVariantElo`.
- `topVariants[*].isBaseline` → `isSeedVariant`.

**Zod `.transform()` back-compat for run_summary**:
- Accept both shapes (old + new) via discriminated union OR `.transform()` on read.
- Precedence rule when BOTH old and new present on same row: **new names win**, old names silently dropped with a one-line log (covers transient state during a rollback).
- Write side: ALWAYS emits new names only. No dual-write.
- **Rollback safety**: wrap the transform in `safeParse` fallback — if a legacy run_summary row fails to migrate, return `null` for the offending fields and log a WARN rather than throwing. Admin UI renders "—" when fields are null. This prevents a single bad row from blocking the whole admin page.

**Feature flag for finalize-path routing**:
Gate the new `reusedFromSeed` routing behind env var `EVOLUTION_REUSE_SEED_RATING` (default: `true` once deployed, but allow `false` to instantly revert to the old fresh-baseline path if a bug appears). Implementation: **the flag is read EXACTLY ONCE at `buildRunContext.resolveContent`**. If false, `seedVariantRow` is not returned (even if the seed row exists) — the pipeline falls through to the fresh-baseline path. Finalize never re-reads the env var; the `reusedFromSeed` flag on the Variant is the sole in-run signal routing it through arenaUpdates. This avoids mid-run inconsistency if the operator flips the flag during execution. Rename-related changes (agent_name / field names) are *not* gated — those are deploy-ordered cleanly.

**Flag/flag-invariant**: `reusedFromSeed=true` Variants are created ONLY in the `buildRunContext → runIterationLoop:211-216` path (reused-seed branch). They do NOT have `fromArena=true`. In contrast, `loadArenaEntries` produces Variants with `fromArena=true, reusedFromSeed=false`. The seed row is loaded exactly once (via resolveContent) and filtered out of loadArenaEntries by `excludeId=seed.id`, so no Variant ever has both flags. Assert this in types (e.g. via a discriminated union or runtime sanity check) to prevent future misuse.

**Admin UI dual-read**: Tabs that filter on `agent_name` or display it:
- `MetricsTab.tsx`, `SnapshotsTab.tsx`, `TimelineTab.tsx`
- `TimelineTab.tsx:360` (literal display label)
Each needs to accept BOTH `'baseline'` (legacy rows) and `'seed_variant'` (new rows) as the seed-variant marker. Removal timeline: one release cycle (≈ 2 weeks) — then we delete the legacy branch. Tracked as follow-up issue (NOT part of this project).

**External observability**: SQL/Honeycomb dashboards that filter on `agent_name='baseline'` need a heads-up. Deliverable: append a note to the PR description listing these; do NOT modify dashboards in this project.

### D) What we are NOT doing in this project
- **No cleanup** of the 487 legacy `generation_method='pipeline'` baseline copies for the Fed prompt (or other prompts). They remain as arena entries; separate one-shot archive script if wanted.
- **No change to OpenSkill `beta=0`**. Aggressive per-match updates remain.
- **No change to the duplicate-title bug** in `createSeedArticle.ts:137` / `generateSeedArticle.ts:102`. Separate issue; flag only.
- **No change to the discard/persist threshold** for low-elo new variants.

## Phased Execution Plan

### Phase 1: Seed rating load/writeback + first-run duplicate elimination
- [ ] Add `reusedFromSeed?: boolean` field on `Variant` in `evolution/src/lib/types.ts`.
- [ ] Extend `resolveContent()` in `evolution/src/lib/pipeline/setup/buildRunContext.ts` to return `{ originalText, seedVariantRow?: { id: string; mu: number; sigma: number; arena_match_count: number } }` — single query, all columns fetched in one SELECT.
- [ ] Add invariant: if `seedVariantRow.synced_to_arena !== true`, log ERROR and treat as no seed (fall through).
- [ ] Gate behind env var `EVOLUTION_REUSE_SEED_RATING` (default 'true' once deployed).
- [ ] Update `loadArenaEntries()` to accept `excludeId?: string` parameter; filter out that row when provided.
- [ ] Update `RunContext` / `EvolveArticleOptions` to carry `seedVariantRow`.
- [ ] In `runIterationLoop.ts:211-216`: when `seedVariantRow` is set, construct the seed-variant pool entry with `id=seedVariantRow.id`, `strategy='seed_variant'`, `reusedFromSeed=true`, `arenaMatchCount=seedVariantRow.arena_match_count`; seed `ratings` via `dbToRating(mu, sigma)`. Preserve the current fresh-variant path when `seedVariantRow` is null.
- [ ] In `runIterationLoop.ts:367-376` (first-run path): eliminate the duplicate `seedBaseline`. Re-label the CreateSeedArticleAgent's `seedVariant` with `strategy='seed_variant'` (upstream in `createSeedArticle.ts`) and use it directly — do NOT push a second pool entry.
- [ ] Update `persistRunResults.ts`:
  - [ ] Introduce `summaryPool = pool.filter(v => !v.fromArena || v.reusedFromSeed)` for `buildRunSummary` / `selectWinner` inputs (replacing current `localPool` where summary semantics are needed).
  - [ ] `newEntries = pool.filter(v => !v.fromArena && !v.reusedFromSeed)` — excludes the reused seed from INSERT.
  - [ ] `arenaUpdates = pool.filter(v => (v.fromArena || v.reusedFromSeed) && matchCount > 0)` — includes reused seed.
  - [ ] First-run seed_variant is persisted normally (no reusedFromSeed flag) with `generation_method='seed'` at line 425 via updated test: `isSeeded && v.strategy === SEED_VARIANT_STRATEGY`.
  - [ ] Emit optimistic-concurrency UPDATE for reusedFromSeed entries: `WHERE id=? AND mu=loaded_mu AND sigma=loaded_sigma`. If 0 rows affected, log WARN with both snapshots; skip update.

### Phase 2: Rename baseline → seed variant
- [ ] `persistRunResults.ts`: rename `V2_BASELINE_STRATEGY` → `SEED_VARIANT_STRATEGY`; value `'baseline'` → `'seed_variant'`.
- [ ] `runIterationLoop.ts`: both literal `'baseline'` → `'seed_variant'`.
- [ ] `createSeedArticle.ts`: update `createVariant(strategy='seed_article')` → `strategy='seed_variant'` (consolidates with the first-run duplicate-elimination).
- [ ] `schemas.ts`: rename `baselineRank`/`baselineElo`/`isBaseline` in `EvolutionRunSummaryV3Schema`; add Zod `.transform()` (new names win; `safeParse` fallback with null + WARN on failure).
- [ ] Admin UI filter/display dual-accept in `MetricsTab.tsx`, `SnapshotsTab.tsx`, `TimelineTab.tsx`, including the literal display label at TimelineTab.tsx:360.
- [ ] **Enumerated test files to mechanically update** (from Grep):
  - `evolution/src/lib/schemas.test.ts`
  - `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`
  - `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts`
  - `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts`
  - `evolution/src/lib/pipeline/loop/evolution-cost-attribution.integration.test.ts`
  - `evolution/src/lib/pipeline/loop/evolution-seed-cost.integration.test.ts`
  - `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts`
  - `evolution/src/lib/core/agents/createSeedArticle.test.ts`
  - `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts`
  - `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts`
  - `evolution/src/lib/core/agents/SwissRankingAgent.test.ts`
  - `evolution/src/components/evolution/tabs/MetricsTab.test.tsx`
  - `evolution/src/components/evolution/tabs/SnapshotsTab.test.tsx`
  - `evolution/src/components/evolution/tabs/TimelineTab.test.tsx`
  - `evolution/src/services/evolutionActions.test.ts`
  - `evolution/src/services/evolutionVisualizationActions.test.ts`
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-logs.spec.ts` — **audit for `agent_name='baseline'` filter/assertion; dual-accept**.
- [ ] Doc renames across the 6 evolution docs listed under Documentation Updates.

### Phase 3: Stage verification
- [ ] **Executable trigger**: insert a pending run via SQL and let `processRunQueue.ts` pick it up. Example:
  ```bash
  # Create a pending run for prompt 50514a24-... on stage via npm run query:staging
  # (query:staging is read-only, so use admin UI or run-evolution-local.ts with --mock=false
  # pointing at stage — requires service_role creds, flagged as follow-up if unavailable)
  npx tsx evolution/scripts/run-evolution-local.ts --prompt=50514a24-cdf3-40e4-a1c1-922009ebd74d
  ```
  If `run-evolution-local.ts` does not support stage targeting, instead trigger via the admin UI start-experiment flow.
- [ ] Assertions via `npm run query:staging`:
  - New run's seed variant row has `id = 39d3275f-c898-4cdd-9d4c-ccdea7f02360` (same as existing seed).
  - `agent_name='seed_variant'`, `generation_method='seed'`.
  - Starting pool rating (from `evolution_logs`) shows `mu≈18.75, sigma≈7.15` (within small tolerance for concurrent writes).
  - After completion: seed row's `arena_match_count` is `5 + this_run_matches`.
  - `evolution_variants WHERE run_id=<new> AND strategy='seed_variant'` returns ZERO rows (the seed is routed through arenaUpdates, not INSERT).
- [ ] **Automated verification script**: add `scripts/verify-seed-reuse.ts` with a formal contract:
  - **Usage**: `npx tsx scripts/verify-seed-reuse.ts --run-id=<uuid> --target=staging|prod`
  - **Exit codes**: `0` = all assertions passed, `1` = at least one assertion failed (prints which), `2` = usage error (missing/invalid args), `3` = DB connection / query error
  - **Assertions** (each printed PASS/FAIL):
    1. Run with `run-id` has `status='completed'`.
    2. `evolution_variants WHERE run_id=? AND strategy='seed_variant'` returns 0 rows (routed through arenaUpdates, not INSERT).
    3. A seed row exists for the run's `prompt_id` with `generation_method='seed' AND synced_to_arena=true`.
    4. Seed row's `arena_match_count` ≥ prior snapshot (provide via `--prior-match-count=N`) or grew since the run's `created_at`.
  - **CI wiring**: optional post-deploy GitHub Actions job `.github/workflows/verify-seed-reuse.yml` that runs the script against staging after a successful deploy; non-fatal (continues on failure) for now, can be promoted to blocking after confidence is established.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` —
  - seed row exists + EVOLUTION_REUSE_SEED_RATING=true → `resolveContent` returns `seedVariantRow` with stored mu/sigma/arena_match_count.
  - seed row exists + EVOLUTION_REUSE_SEED_RATING=false → returns `seedVariantRow=undefined` (fallback path).
  - `loadArenaEntries(excludeId=seed.id)` excludes it from `initialPool`; `loadArenaEntries(excludeId=null|undefined)` behaves as today (regression guard).
  - Seed row with `synced_to_arena=false` → resolveContent logs ERROR and returns no seed.
  - Invariant: returned `seedVariantRow.reusedFromSeed` marker is independent of `fromArena` — no Variant emitted with both flags.
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` —
  - With `seedVariantRow`: pool[0] has `id=seedVariantRow.id`, `strategy='seed_variant'`, `reusedFromSeed=true`, `fromArena=false/undefined`, rating = `dbToRating(mu, sigma)`.
  - Without `seedVariantRow` (explanation_id path): pool[0] has fresh UUID, default rating, no reusedFromSeed.
  - First-run seed path (seedPrompt set): pool contains exactly ONE seed entry (the seedVariant from CreateSeedArticleAgent), `strategy='seed_variant'`, no duplicate.
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` —
  - Pool with reusedFromSeed=true + match_count>0: routed to `arenaUpdates`, NOT `newEntries`; optimistic UPDATE emitted with `WHERE id=? AND mu=loaded_mu AND sigma=loaded_sigma AND arena_match_count=loaded_match_count`.
  - Pool with reusedFromSeed=true + match_count=0: skipped from both (no-op); explicit assertion that seed row is untouched.
  - `buildRunSummary` includes the reused seed in `topVariants`, `seedVariantRank`, `seedVariantElo`, `strategyEffectiveness`.
  - `selectWinner` can pick the reused seed when it has highest elo; `is_winner=true` is NOT written to a new evolution_variants row (reusedFromSeed takes arenaUpdates path) but the seed's winner status is reflected in `run_summary.topVariants[0].isSeedVariant=true`.
  - Optimistic-concurrency collision: pre-load mu=X/sigma=Y/match_count=5, write-time DB has mu=X'/sigma=Y'/match_count=6 → 0-row UPDATE → WARN log + `evolution.seed_rating.collision` metric emitted + no crash.
  - **Numeric precision test**: load mu=18.747996042000842 (15-digit decimal); write-time equality holds via string-based parameter binding, not JS float comparison.
  - **First-run finalize assertion**: seed-agent path produces EXACTLY ONE evolution_variants INSERT with `agent_name='seed_variant'`, `generation_method='seed'`, no shadow seedBaseline row.
  - **Flag-OFF path**: with `EVOLUTION_REUSE_SEED_RATING=false`, even if a seed row exists in DB, the run emits a fresh-UUID seed_variant INSERT with `generation_method='pipeline'` (old behavior).
- [ ] `evolution/src/lib/schemas.test.ts` —
  - Round-trip: V3 schema with new names → parse → same shape.
  - Legacy shape (baselineRank/baselineElo/isBaseline) → parse → transformed to new names.
  - Both-present case: new names win, old dropped with log.
  - Malformed legacy cases (explicit per-field coverage): (a) partial baselineRank with no baselineElo; (b) baselineElo present with no baselineRank; (c) topVariants entries with `isBaseline` of wrong type (string instead of bool). All three → safeParse returns null for unparseable fields, no throw.
- [ ] **Dual-read UI tests** (symmetric across all 3 tabs): add cases in each of `MetricsTab.test.tsx`, `SnapshotsTab.test.tsx`, `TimelineTab.test.tsx` — render a run with mixed `agent_name='baseline'` and `agent_name='seed_variant'` rows; assert both are recognized as the seed variant and rendered identically.
- [ ] **Server-side filter audit**: grep `evolution/src/services/*.ts` for literal `'baseline'` strings and ensure any server-action filter that depends on it is updated for dual-accept. Files to inspect: `evolutionActions.ts`, `evolutionVisualizationActions.ts`, `arenaActions.ts`.

### Integration Tests
- [ ] `evolution/src/lib/pipeline/loop/evolution-seed-cost.integration.test.ts` — verify end-to-end: first run creates seed row (generation_method='seed'), second run against same prompt reuses the seed's UUID and updates its rating via arenaUpdates.
- [ ] Add new integration test `evolution/src/lib/pipeline/finalize/seed-arena-update.integration.test.ts` — simulate two sequential runs; assert after run 2 the seed row's `arena_match_count` has grown and `mu/sigma` updated.
- [ ] Add new integration test `evolution/src/lib/pipeline/finalize/seed-concurrent-race.integration.test.ts` — simulate TWO concurrent runners processing two different runs for the same prompt; both load the same seed mu/sigma; second finalize hits 0-row UPDATE; assert WARN log + `evolution.seed_rating.collision` metric + first writer's rating persists.
- [ ] Add new integration test `evolution/src/lib/pipeline/finalize/seed-flag-off.integration.test.ts` — run pipeline end-to-end with `EVOLUTION_REUSE_SEED_RATING=false`; assert new fresh-UUID baseline row is persisted with `generation_method='pipeline'` and the original seed row is untouched (back-compat / rollback path exercised).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-logs.spec.ts` — audit for `agent_name='baseline'` assertions; update to accept both or specifically assert the new name for new runs.

### Manual Verification
- [ ] Query stage after deploy: `npm run query:staging -- "SELECT run_id, agent_name, generation_method, mu, sigma FROM evolution_variants WHERE run_id = '<new-run-id>'"` confirms seed reuse (seed UUID present with `agent_name='seed_variant'`, `generation_method='seed'`).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `/admin/evolution/arena/[topicId]` renders correctly with a mix of legacy `'baseline'` and new `'seed_variant'` rows.
- [ ] `/admin/evolution/runs/[runId]` MetricsTab shows the seed variant in `topVariants` after the new routing (not missing).

### B) Automated Tests
- [ ] `npm run test:unit -- --grep "seed_variant|seedVariant|reusedFromSeed"` — all new/renamed tests pass.
- [ ] `npm run test:unit -- evolution/src/lib/pipeline` — full pipeline suite green.
- [ ] `npm run test:integration -- --grep "seed"` — seed-rating persistence + rename transforms.
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-logs.spec.ts` — E2E green with dual-accept.

## Rollback Plan

If a bug is discovered post-deploy:
1. **Finalize-path routing bug** (e.g. seed rating incorrectly overwritten, missing rows): set env var `EVOLUTION_REUSE_SEED_RATING=false` on Vercel/minicomputer and restart the runner. Pipeline reverts to the previous fresh-baseline behavior within 1 minute. Incorrectly-written arena rating changes are preserved but no new seed updates happen until the flag is re-enabled. **Validation that rollback works**: `seed-flag-off.integration.test.ts` (listed under Integration Tests) exercises exactly this path; run it locally before the first deploy to verify the kill-switch works.
2. **Zod transform bug** (legacy run_summary rows fail to render): the `safeParse` fallback returns null for unparseable fields and renders "—" in the UI. No crash. Fix the transform and redeploy; no data loss (all run_summary rows remain intact on DB).
3. **Nuclear option**: revert the PR. New-schema run_summary rows written during the deploy window would need their new field names back-mapped to old names — but the Zod transform handles this direction too (new names have higher precedence, old names are accepted as input). Revert is safe.
4. **Observability**: the `evolution.seed_rating.collision` metric should be monitored after deploy; if collision rate is non-trivial (>1% of runs against the same prompt), consider adding a retry/merge strategy in a follow-up project.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] evolution/docs/architecture.md — "baseline" → "seed variant"; describe seed-variant rating load/writeback and `reusedFromSeed` flag.
- [ ] evolution/docs/rating_and_comparison.md — note that the seed variant enters each run with its persisted rating.
- [ ] evolution/docs/strategies_and_experiments.md — rename `baselineRank`/`baselineElo` in the Run Summary V3 section.
- [ ] evolution/docs/arena.md — clarify that the seed row is reused across runs (no more pipeline duplicates); optimistic-concurrency note.
- [ ] evolution/docs/data_model.md — agent_name enum (`'baseline'` legacy, `'seed_variant'` current).
- [ ] evolution/docs/curriculum.md — glossary update.
- [ ] evolution/docs/visualization.md — if UI copy changes.
- [ ] evolution/docs/metrics.md — `baselineElo` metric rename if exposed.
- [ ] evolution/docs/cost_optimization.md — unlikely but flagged.
- [ ] evolution/docs/reference.md — strategy name reference + env var `EVOLUTION_REUSE_SEED_RATING`.
- [ ] evolution/docs/agents/overview.md — no change expected.
- [ ] evolution/docs/entities.md — no change expected.
- [ ] evolution/docs/logging.md — no change expected.
- [ ] evolution/docs/minicomputer_deployment.md — document new env var.
- [ ] evolution/docs/README.md — no change expected.
- [ ] docs/feature_deep_dives/evolution_metrics.md — if metrics change.
- [ ] docs/feature_deep_dives/testing_setup.md — if test patterns change.

## Review & Discussion

### 2026-04-14 — initial research round (user + assistant)

- Confirmed on stage DB: seed variant `39d3275f-…` (Fed prompt) has arena elo 1099, arena_match_count=5, all 5 comparisons from the seed-creating run `140f7bce` (2026-04-12). No subsequent run touched the seed row's rating.
- Confirmed by reading `runIterationLoop.ts:212` + `persistRunResults.ts:425`: the baseline variant is created with a **fresh UUID** and default `createRating()`; only the *original* run that invoked `CreateSeedArticleAgent` persists the row with `generation_method='seed'`. Subsequent runs persist their baseline copy as `generation_method='pipeline'`.
- Corrected earlier mischaracterization that the baseline loads with arena mu/sigma — it does not. The arena seed row IS loaded by `loadArenaEntries` (into `initialPool`), but the orchestrator additionally creates a separate `Variant` with a fresh UUID as the baseline, so the seed ends up in the pool twice (once as an arena entry with stored rating, once as the fresh baseline) — with two different UUIDs.
- User decision: load the seed's real rating into the run's pool as the baseline, and route post-run matches back to the seed row via `arenaUpdates`. Rename "baseline" → "seed variant" to remove terminology conflation.
- Open: handle 487 legacy pipeline-baseline arena copies as a **separate** follow-up (not in scope here).
- Open: double-title bug in `createSeedArticle.ts:137` flagged but not fixed in this project.

### 2026-04-14 — plan-review iteration 1 (3 agents, all 3/5)

- **Critical gap (Sec+Arch)**: `fromArena=true` causes `finalize` to drop the seed from `localPool`, breaking `seedVariantRank`/`seedVariantElo`/`topVariants`/`strategyEffectiveness` and preventing seed `is_winner`.
  - **Resolution**: introduce a dedicated `reusedFromSeed` flag (Section A above) that routes through `arenaUpdates` (like `fromArena`) but keeps the seed in summary/winner inputs.
- **Critical gap (Arch)**: first-run path at `runIterationLoop.ts:367-376` creates a duplicate `seedBaseline` shadow of the seed agent's output — after the rename both would be `strategy='seed_variant'`, creating two entries with the same role.
  - **Resolution**: eliminate the duplicate; use `createSeedArticle.ts`'s output directly as the single seed_variant pool entry.
- **Critical gap (Sec)**: concurrent runners on the same prompt both emit arenaUpdates → last-writer-wins silently loses one run's rating evidence.
  - **Resolution**: optimistic-concurrency UPDATE (`WHERE mu=loaded_mu AND sigma=loaded_sigma`); if 0 rows affected, log WARN and skip. Evidence loss is surfaced rather than silent.
- **Critical gap (Testing)**: no rollback for buggy Zod transform.
  - **Resolution**: `safeParse` fallback returns null for unparseable fields + WARN log; UI renders "—". Also: env var `EVOLUTION_REUSE_SEED_RATING` as a kill-switch for the finalize-path change.
- **Critical gap (Testing)**: ~15 test files not enumerated.
  - **Resolution**: Phase 2 now lists all 16 test files (plus the E2E spec).
- **Critical gap (Testing)**: E2E `admin-evolution-logs.spec.ts` unaccounted for.
  - **Resolution**: added to Phase 2 checklist; audit required.
- **Critical gap (Testing)**: no dual-read mixed-row test.
  - **Resolution**: new test case in `MetricsTab.test.tsx` asserting mixed-agent_name rendering.
- **Critical gap (Testing)**: stage verification lacks an executable trigger.
  - **Resolution**: Phase 3 now specifies `run-evolution-local.ts --prompt=<id>` as the primary trigger (with admin-UI fallback) and adds an automated `scripts/verify-seed-reuse.ts` assertion script.
- **Critical gap (Testing)**: no feature flag / rollout safety.
  - **Resolution**: `EVOLUTION_REUSE_SEED_RATING` env var gates the new finalize routing; documented in `evolution/docs/reference.md` + `minicomputer_deployment.md`.
- **Invariant (Sec)**: seed must be `synced_to_arena=true` for arenaUpdates to fire.
  - **Resolution**: explicit assertion in `resolveContent`; log ERROR + fall through to fresh-baseline path if violated.
- **Minor**: arithmetic slip `1099` → `1100`; archived-mid-run clarified; Zod precedence rule documented; forward/back deploy ordering called out; external observability consumer note added to PR description; no-match-edge-case for seed explicitly stated.

### 2026-04-14 — plan-review iteration 2 (Sec 4/5, Arch 5/5, Testing 4/5, 0 critical gaps)

All 10 iteration-1 critical gaps resolved with no new critical gaps introduced. Minor hardening pass applied:

- **Sec**: kill-switch read pinned to `resolveContent` only (reusedFromSeed is the sole in-run signal); optimistic-concurrency predicate extended to include `arena_match_count` so stale-match-count races are caught; numeric precision handled via string-based parameter binding on Postgres `NUMERIC` (documented + tested); `evolution.seed_rating.collision` metric emitted for observability; reusedFromSeed↔fromArena mutual exclusion asserted in types.
- **Arch**: explicit flag invariant (`reusedFromSeed=true` Variants never have `fromArena=true`); server-side filter audit added for `evolutionActions.ts`/`evolutionVisualizationActions.ts`/`arenaActions.ts`; is_winner semantics clarified (seed's winner status is reflected in `run_summary.topVariants[0].isSeedVariant=true`, not via `is_winner` column on a new row).
- **Testing**: symmetric dual-read tests across all 3 admin tabs (not just MetricsTab); explicit first-run finalize-level assertion (exactly one INSERT, no shadow row); explicit flag-OFF integration test (`seed-flag-off.integration.test.ts`); concurrent-race integration test (`seed-concurrent-race.integration.test.ts`); per-field malformed-legacy coverage in schemas.test.ts (all 3 legacy fields); formal `scripts/verify-seed-reuse.ts` contract (usage, exit codes, assertions, CI wiring); numeric-precision test; rollback path validated by integration test.
