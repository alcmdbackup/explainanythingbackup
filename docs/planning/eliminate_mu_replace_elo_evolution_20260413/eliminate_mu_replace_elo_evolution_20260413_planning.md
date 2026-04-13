# Eliminate Mu Replace Elo Evolution Plan

## Background
Remove all references to mu and sigma from the codebase and evolution admin UI — everywhere. Universally speak in terms of Elo and confidence intervals instead. The evolution pipeline uses OpenSkill (Weng-Lin Bayesian) ratings internally with mu/sigma pairs, but users should only see Elo scores and 95% confidence intervals. This is a full-scope change covering UI, API, database columns, and internal naming.

## Requirements (from GH Issue #966)
- Remove all references to mu and sigma from the codebase and evolution admin UI — everywhere
- Universally speak in terms of Elo and confidence intervals
- Rename DB columns from mu/sigma to elo/uncertainty terminology
- Update all server action response types
- Update all internal variable names and types where feasible

## Problem
The evolution system uses OpenSkill Bayesian ratings (mu/sigma pairs) as its core rating mechanism. These internal implementation details leak into the UI, API responses, database column names, and documentation. Users see "μ", "σ", "Mu", "Avg Mu" columns which are meaningless without understanding Bayesian statistics. The system already has Elo conversion (`Elo = 1200 + (mu-25)*16`) and CI formatting (`formatEloCIRange`, `formatEloWithUncertainty`) — but these are only used in some places. The goal is to make Elo + CI the universal language, with mu/sigma existing only inside the openskill adapter boundary in `computeRatings.ts`.

## Options Considered
- [x] **Option A: Full elimination** — Rename DB columns, update RPCs/triggers/indexes, change all types/schemas, update all UI labels, update all tests and docs. Highest risk but cleanest result. **SELECTED.**
- [ ] **Option B: UI + API only** — Keep DB columns as mu/sigma, add abstraction layer to convert at read/write boundaries. Lower risk but leaves internal inconsistency.
- [ ] **Option C: UI-only** — Change display labels and formatting only. Minimal risk but mu/sigma still visible in API responses and code.

## Phased Execution Plan

### Phase 1: Core Rating Module & Types
Refactor the rating system boundary. OpenSkill stays internal; everything external speaks Elo.

- [ ] Refactor `evolution/src/lib/shared/computeRatings.ts`:
  - Keep `osRating`/`osRate` imports unchanged (openskill requires mu/sigma)
  - Rename exported `Rating` type from `{mu, sigma}` to `{elo, uncertainty}` where `elo = toEloScale(mu)` and `uncertainty = sigma * ELO_SIGMA_SCALE` (Elo-scale sigma)
  - Update `createRating()`: wraps `osRating()`, converts result to `{elo: 1200, uncertainty: 400/3}` (exact: DEFAULT_MU=25→1200, DEFAULT_SIGMA=25/3 * 16 = 400/3 ≈ 133.33)
  - Update `updateRating(winner, loser)` to convert Elo→mu internally via `fromEloScale()`, call `osRate()`, convert back via `toEloScale()`. **No clamping on the internal mu↔Elo round-trip** — the [0,3000] clamp in `toEloScale` is removed from the internal path; clamping only applies at final display formatting in `formatElo()`.
  - Update `updateDraw(a, b)` same pattern — internal unclamped Elo↔mu conversion
  - Rename `isConverged(r, threshold)` — threshold becomes Elo-scale uncertainty (default: 4.5*16=72)
  - Keep `toEloScale()` as **private** internal helper (still needed at DB boundary in buildRunContext.ts and persistRunResults.ts for converting DB mu→Rating.elo). Remove from public exports.
  - Add `fromEloScale(elo): number` private internal helper for Elo→mu conversion: `(elo - 1200) / 16 + 25`
  - Export a new `toDisplayElo(elo): number` that clamps to [0, 3000] — used only for UI formatting
  - Rename constants: `DEFAULT_ELO=1200`, `DEFAULT_UNCERTAINTY=400/3` (exact fraction, not rounded), `DEFAULT_CONVERGENCE_UNCERTAINTY=72`, `ELO_SIGMA_SCALE=16` (kept as internal constant for DB boundary conversions)
  - Update `computeEloPerDollar()` — parameter changes from `mu` to `elo`, **remove internal `toEloScale(mu)` call** (elo is already Elo-scale), body becomes `(elo - 1200) / cost`
- [ ] Update `evolution/src/lib/shared/selectWinner.ts`:
  - Change from "highest mu, sigma tiebreak" to "highest elo, uncertainty tiebreak (lower wins)"
  - Update `SelectWinnerResult` type: `{winnerId, elo, uncertainty}` instead of `{winnerId, mu, sigma}`
- [ ] Update `evolution/src/lib/types.ts`:
  - All `Rating` references now use `{elo, uncertainty}`
  - `EvolutionRunSummary` V4: rename `muHistory`→`eloHistory`, `topVariants[].mu`→`topVariants[].elo`, `baselineMu`→`baselineElo`, `strategyEffectiveness[].avgMu`→`strategyEffectiveness[].avgElo`
  - Update `DebateExecutionDetail`, `EvolutionExecutionDetail` mu→elo fields
  - Update `IterationSnapshot.ratings` from `{mu, sigma}` to `{elo, uncertainty}`
  - Update `EloAttribution` interface: `deltaMu`→`deltaElo`, `sigmaDelta`→`uncertaintyDelta`. **Remove the `* ELO_SCALE` multiplication** in the computation site — since `deltaElo` is already Elo-scale (it's a difference of Rating.elo values), the `gain` field needs no further scaling. Verify all sites that compute EloAttribution.
  - Update `RankingExecutionDetail.ratingBefore`/`ratingAfter` from `{mu, sigma}` to `{elo, uncertainty}` with `.or()` backward compat in Zod schema
  - Update `MetaReviewExecutionDetail`: rename `strategyMus`→`strategyElos`, `muRange`→`eloRange`
  - Update `DiffMetrics.eloChanges` computation: if it currently calls `toEloScale()`, remove that call since ratings are already Elo-scale
  - Update `SerializedPipelineState.ratings` from `Record<string, {mu, sigma}>` to `Record<string, {elo, uncertainty}>` with Zod `.transform()` backward compat for in-flight checkpoints (old format: convert mu→elo, sigma→uncertainty at deserialization time)
- [ ] Update `evolution/src/lib/schemas.ts`:
  - Add V4 run summary schema with `version: 4` discriminant and `eloHistory` field. **V4 is distinguished from V3 by `version: 4` literal** — the Zod union tries V4 first (requires `version: 4`), then V3 (requires `version: 3`), so a V3 row can never accidentally match V4.
  - V3→V4 transform: apply `toEloScale()` to each mu value in `muHistory`, `topVariants[].mu`, `baselineMu`, `strategyEffectiveness[].avgMu`
  - **V1→V4 migration path** (CRITICAL — V1 values are NOT raw Elo): The existing V1→V3 transform applies `legacyToMu()` which adds `3 * DEFAULT_SIGMA ≈ 25` to V1 values. V1 `eloHistory` values are small ordinals (~0-50), NOT 1200-scale Elo. So V1→V4 must go through V1→V3→V4 (legacyToMu then toEloScale). **Do NOT short-circuit V1 directly to V4** — the V1 field name `eloHistory` is misleading; the values are ordinal-scale.
  - **Union ordering safeguard**: V4 schema MUST precede V1 in the Zod union array. Add a comment `// ORDER MATTERS: V4 must be first, V1 last (V1.version is optional)` to prevent accidental reordering. V4 requires `version: z.literal(4)`, V3 requires `version: z.literal(3)`, V2 requires `version: z.literal(2)`, V1 has `version: z.literal(1).optional()` — only V1 can match without a version field.
  - V2 `ordinalHistory`→V4: V2→V3 (legacyToMu) then V3→V4 (toEloScale), same as existing chain
  - **Execution detail schemas**: keep old field names (`variantMuBefore`, etc.) as **accepted aliases** via `.or()` for backward compat with existing JSONB data, but new writes use `variantEloBefore`, `variantUncertaintyBefore`, etc.
  - Rename `finalLocalMu`→`finalLocalElo`, `finalLocalSigma`→`finalLocalUncertainty` (with `.or()` fallback for old data)
  - Rename `discardReason.localMu`→`discardReason.localElo` (with `.or()` fallback)
  - Rename `muDelta`→`eloDelta`, `sigmaDelta`→`uncertaintyDelta` (with `.or()` fallback)
  - Update `ratingSchema` from `{mu, sigma}` to `{elo, uncertainty}`
- [ ] Update `evolution/src/lib/pipeline/infra/types.ts`:
  - Rename `muHistory: number[][]` → `eloHistory: number[][]` in `EvolutionResult`
- [ ] Update `evolution/src/lib/utils/formatters.ts`:
  - `elo95CI(sigma)` — rename param to `uncertainty` (already expects Elo-scale value)
  - `formatEloCIRange(elo, sigma)` — rename param to `uncertainty`
  - `formatEloWithUncertainty(elo, sigmaElo)` — rename param to `uncertainty`

### Phase 2: Pipeline Logic
Update all pipeline code to use the new Rating type.

- [ ] Update `evolution/src/lib/pipeline/loop/rankSingleVariant.ts`:
  - `BETA = DEFAULT_UNCERTAINTY * Math.SQRT2 / ELO_SIGMA_SCALE` (keep same mathematical value, derive from new constants)
  - Actually, BETA is used in Bradley-Terry: `pWin = 1/(1+exp(-(eloA-eloB)/BETA_ELO))` where BETA_ELO = BETA * ELO_SIGMA_SCALE ≈ 188.6
  - Rename `selectOpponent` scoring: references to `.sigma` become `.uncertainty`
  - Rename before/after tracking: `variantMuBefore`→`variantEloBefore`, etc.
  - Rename `finalMu`→`finalElo`, `finalSigma`→`finalUncertainty`
- [ ] Update `evolution/src/lib/pipeline/loop/swissPairing.ts`:
  - Same constant and variable renames as rankSingleVariant (these files share duplicated constants)
  - Bradley-Terry pWin computation uses elo directly now
  - `sigmaWeight` → `uncertaintyWeight`
- [ ] Update `evolution/src/lib/pipeline/loop/rankNewVariant.ts`:
  - `localVariantMu` → `localVariantElo`
- [ ] Update `evolution/src/lib/pipeline/loop/runIterationLoop.ts`:
  - `topKMuValues()` → `topKEloValues()` — extract `r.elo` instead of `r.mu`
  - `muHistory` → `eloHistory` throughout
  - Eligibility check: `r.elo + ELIGIBILITY_Z_SCORE * r.uncertainty >= top15Cutoff` (cutoff now in Elo scale)
  - `computeTop15Cutoff()`: now returns Elo-scale values (~1200-1600) instead of mu-scale (~25-50). All consumers already updated since they use Rating.elo.
  - `discardReasonsMap` key: `mu` → `elo`, `top15Cutoff` values are now Elo-scale
  - **Backward compat for stored snapshots**: old `IterationSnapshot.discardReasons` has mu-scale `{mu, top15Cutoff}`. Zod schema `.transform()` converts old format: `{elo: toEloScale(old.mu), top15Cutoff: toEloScale(old.top15Cutoff)}`
  - Winner log: `winnerMu`→`winnerElo`, `winnerSigma`→`winnerUncertainty`
- [ ] Update `evolution/src/lib/pipeline/setup/buildRunContext.ts`:
  - Arena entry loading: read `mu`/`sigma` from DB (columns unchanged), convert to Rating `{elo, uncertainty}` at boundary using internal `toEloScale(mu)` and `sigma * ELO_SIGMA_SCALE`
  - Rating initialization uses new Rating type directly
  - Read `elo_score` from DB as the precomputed Elo (or compute from mu) — both are equivalent
- [ ] Update `evolution/src/lib/pipeline/finalize/persistRunResults.ts`:
  - `buildRunSummary()`: use `r.elo` for topVariants, strategyEffectiveness, eloHistory
  - Variant persistence: convert Rating.elo→mu and Rating.uncertainty→sigma at write boundary using `fromEloScale()` and `/ ELO_SIGMA_SCALE`, then write to `mu`/`sigma`/`elo_score` DB columns as before
  - Arena sync: keep sending `mu`/`sigma` in JSON to `sync_to_arena` RPC (internal detail, RPC unchanged)
  - Winner selection uses new SelectWinnerResult type
- [ ] Update checkpoint/snapshot serialization in `evolution/src/lib/types.ts`:
  - `IterationSnapshot.ratings` stored as JSONB uses `{elo, uncertainty}` for new runs
  - Add backward-compat deserialization: if snapshot has `{mu, sigma}` (old format), convert to `{elo, uncertainty}` on read via the Zod schema `.transform()`

### Phase 3: Agents & Metrics
- [ ] Update `evolution/src/lib/core/agents/MergeRatingsAgent.ts`:
  - VariantSnapshotEntry: `{id, elo, uncertainty, matchCount}`
  - Before/after snapshots use elo/uncertainty
  - Arena comparison row writes: `entry_a_elo_before`, `entry_a_uncertainty_before`, etc.
  - Display labels: change μ→"Elo", σ→"±", Δμ→"ΔElo", Δσ→"Δ±"
- [ ] Update `evolution/src/lib/core/agents/generateFromSeedArticle.ts`:
  - `discardReason.localMu` → `discardReason.localElo`
- [ ] Update `evolution/src/lib/core/detailViewConfigs.ts`:
  - All display labels: μ→"Elo", σ→"Uncertainty", Δμ→"Δ Elo", Δσ→"Δ Uncertainty"
  - "Final Local μ"→"Final Local Elo", "Final Local σ"→"Final Local Uncertainty"
  - "Low-σ Opponents"→"Low-Uncertainty Opponents"
  - "Mu"→"Elo" in debate/evolution configs
  - "muRange"→"eloRange"
- [ ] Update `evolution/src/lib/metrics/computations/finalization.ts`:
  - `eloMetricValue()` simplifies — Rating.elo is already Elo, Rating.uncertainty is already Elo-scale
  - No more `toEloScale()` calls needed
- [ ] Update `evolution/src/lib/metrics/computations/propagation.ts`:
  - `sigma` field in MetricValue → `uncertainty`. Note: in MetricValue context, `uncertainty` represents EITHER Elo-scale rating uncertainty (for run-level elo metrics) OR bootstrap standard error (for propagated aggregates). Both are uncertainty measures used for CI computation; the dual meaning is acceptable since the CI formula `[value ± 1.96 * uncertainty]` applies to both.
- [ ] Update `evolution/src/lib/metrics/experimentMetrics.ts`:
  - `MetricValue.sigma` → `MetricValue.uncertainty`
  - `bootstrapPercentileCI` param `allRunRatings: Array<Array<{elo, uncertainty}>>` — sample in Elo space directly: `elo + uncertainty * z` where z is Box-Muller normal. `uncertainty` is Elo-scale sigma (NOT CI half-width), so no 1.96 division needed. Remove `toEloScale()` inside the loop since `v.elo` is already Elo.
- [ ] Update `evolution/src/lib/metrics/writeMetrics.ts`:
  - `WriteMetricOpts.sigma` → `WriteMetricOpts.uncertainty`
  - DB column `evolution_metrics.sigma` rename to `uncertainty` (in Phase 4 migration)
- [ ] Update `evolution/src/lib/metrics/types.ts`:
  - MetricRow Zod schema: `sigma` → `uncertainty`
  - `toMetricValue()` helper: reads `row.uncertainty` instead of `row.sigma` (this maps directly to the renamed DB column after Phase 4 migration)
- [ ] Update `evolution/src/lib/metrics/readMetrics.ts`:
  - Supabase `.select()` calls: if using explicit column lists, update `sigma` → `uncertainty`. If using `*`, no change needed (auto-picks up renamed column).
- [ ] Update `evolution/src/lib/metrics/recomputeMetrics.ts`:
  - DB reads use new column names

### Phase 4: Database Migration
Two changes only. The `evolution_variants` table keeps `mu`/`sigma`/`elo_score` columns unchanged (stale trigger, sync_to_arena RPC, and indexes depend on them). Conversion happens at the TypeScript query boundary.

- [ ] Create migration `supabase/migrations/YYYYMMDD000001_rename_arena_comparison_and_metrics_columns.sql`:
  - **evolution_arena_comparisons** — rename diagnostic columns (no trigger/index dependencies):
    - `entry_a_mu_before` → `entry_a_elo_before`
    - `entry_a_sigma_before` → `entry_a_uncertainty_before`
    - `entry_b_mu_before` → `entry_b_elo_before`
    - `entry_b_sigma_before` → `entry_b_uncertainty_before`
    - `entry_a_mu_after` → `entry_a_elo_after`
    - `entry_a_sigma_after` → `entry_a_uncertainty_after`
    - `entry_b_mu_after` → `entry_b_elo_after`
    - `entry_b_sigma_after` → `entry_b_uncertainty_after`
  - **evolution_metrics** — rename `sigma` → `uncertainty` (no trigger deps)
  - **No changes to**: `evolution_variants` (mu/sigma/elo_score stay), stale trigger, sync_to_arena RPC, indexes
  - **Deployment note**: This migration and the corresponding TypeScript code changes (MergeRatingsAgent column names, metrics column name) **must deploy atomically**. Both column renames are on write-path columns, so staggered deployment would cause INSERT failures. Use a single deploy that includes migration + code.
- [ ] Regenerate `src/lib/database.types.ts` via `npm run db:types` after migration
- [ ] **Rollback migration**: include a companion `YYYYMMDD000002_rollback_rename.sql` that reverses the renames:
  ```sql
  ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_elo_before TO entry_a_mu_before;
  -- (etc for all 8 columns)
  ALTER TABLE evolution_metrics RENAME COLUMN uncertainty TO sigma;
  ```

### Phase 5: Server Actions & API Layer
- [ ] Update `evolution/src/services/arenaActions.ts`:
  - `ArenaEntry` type: add `elo_rating` (from elo_score), `elo_uncertainty` (from sigma * ELO_SIGMA_SCALE), remove mu/sigma from response type
  - Query maps: read mu/sigma from DB, return elo/uncertainty to UI
- [ ] Update `evolution/src/services/evolutionActions.ts`:
  - `IterationSnapshotRow.ratings`: `{elo, uncertainty}` instead of `{mu, sigma}`
  - Transform at query boundary
- [ ] Update `evolution/src/services/evolutionVisualizationActions.ts`:
  - `EloHistoryPoint`: rename `mu`→`elo`, `mus`→`elos`
  - Read muHistory from DB, convert to Elo via `toEloScale()` at boundary
- [ ] Update `evolution/src/services/variantDetailActions.ts` — if any mu/sigma in response
- [ ] Update `evolution/src/services/invocationActions.ts` — if any mu/sigma in response

### Phase 6: UI Components
- [ ] Update `evolution/src/components/evolution/tabs/EloTab.tsx`:
  - Y-axis values: convert from mu to Elo scale (multiply by 16 and offset)
  - Field access: `.elo` instead of `.mu`, `.elos` instead of `.mus`
- [ ] Update `evolution/src/components/evolution/tabs/MetricsTab.tsx`:
  - Column header "Mu" → "Elo"
  - Column header "Avg Mu" → "Avg Elo"
  - `v.mu.toFixed(2)` → `Math.round(v.elo)` (Elo is integer)
  - `stats.avgMu.toFixed(2)` → `Math.round(stats.avgElo)`
  - Sort key: `b.avgMu` → `b.avgElo`
- [ ] Update `evolution/src/components/evolution/tabs/SnapshotsTab.tsx`:
  - Column headers: μ→"Elo", σ→"±" or "Uncertainty"
  - Display: `r.mu.toFixed(2)` → `Math.round(r.elo)`, `r.sigma.toFixed(2)` → `Math.round(r.uncertainty)`
  - "Local μ" → "Local Elo"
  - VariantRow type: `{elo, uncertainty}` instead of `{mu, sigma}`
- [ ] Update `evolution/src/components/evolution/tabs/TimelineTab.tsx`:
  - `μ = ${winner.mu.toFixed(2)}` → `Elo: ${Math.round(winner.elo)}`
- [ ] Update `src/app/admin/evolution/arena/[topicId]/page.tsx`:
  - Sort key `'sigma'` → `'uncertainty'`
  - Column header "Elo ± σ" → "Elo ± Uncertainty" or just "Elo Range"
  - Remove `* ELO_SIGMA_SCALE` multiplications (data is already Elo-scale)
- [ ] Update `src/app/admin/evolution/arena/[topicId]/arenaCutoff.ts`:
  - Input type: `{elo_rating, elo_uncertainty}` instead of `{mu, sigma}`
  - Remove `toEloScale()` call — already Elo
- [ ] Update `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx`:
  - "local mu below the top-15% cutoff" → "local Elo below the top-15% cutoff"

### Phase 7: Tests
Update all test files with mu/sigma references. Tests should be updated incrementally alongside each phase's source changes (not deferred to the end). This list is the comprehensive audit of all 42 affected test files.

**Core rating & selection (Phase 1):**
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` — all assertions use elo/uncertainty
- [ ] `evolution/src/lib/shared/computeRatings.property.test.ts` — property tests use elo/uncertainty
- [ ] `evolution/src/lib/shared/selectWinner.test.ts` — elo/uncertainty assertions
- [ ] `src/testing/mocks/openskill.ts` — mock stays returning `{mu, sigma}` (openskill API requirement). `computeRatings.ts` handles the conversion internally. No change to mock return types needed; only update test assertions that previously checked `.mu`/`.sigma` on the Rating type returned by computeRatings wrappers.
- [ ] `evolution/src/lib/schemas.test.ts` — V4 schema, execution detail field renames
- [ ] `evolution/src/lib/utils/formatters.test.ts` — param renames

**Pipeline (Phase 2):**
- [ ] `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts` — elo/uncertainty
- [ ] `evolution/src/lib/pipeline/loop/rankNewVariant.test.ts` — localVariantElo
- [ ] `evolution/src/lib/pipeline/loop/swissPairing.test.ts` — elo/uncertainty in pairing
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — eloHistory, topKEloValues
- [ ] `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` — DB boundary conversion
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — elo/uncertainty, eloHistory
- [ ] `evolution/src/lib/pipeline/loop/evolution-seed-cost.integration.test.ts` — if mu/sigma refs
- [ ] `evolution/src/lib/pipeline/infra/types.test.ts` — muHistory property type
- [ ] `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — muHistory in fixtures

**Agents (Phase 3):**
- [ ] `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — elo/uncertainty
- [ ] `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts` — elo/uncertainty snapshots
- [ ] `evolution/src/lib/core/agents/SwissRankingAgent.test.ts` — if mu/sigma refs

**Metrics (Phase 3):**
- [ ] `evolution/src/lib/metrics/computations/finalization.test.ts` — elo metric computation
- [ ] `evolution/src/lib/metrics/computations/finalizationInvocation.test.ts` — invocation elo
- [ ] `evolution/src/lib/metrics/computations/propagation.test.ts` — uncertainty field
- [ ] `evolution/src/lib/metrics/experimentMetrics.test.ts` — MetricValue.uncertainty
- [ ] `evolution/src/lib/metrics/recomputeMetrics.test.ts` — DB column refs
- [ ] `evolution/src/lib/metrics/writeMetrics.test.ts` — WriteMetricOpts.uncertainty
- [ ] `evolution/src/lib/metrics/readMetrics.test.ts` — if sigma field refs

**Server actions (Phase 5):**
- [ ] `evolution/src/services/arenaActions.test.ts` — ArenaEntry type
- [ ] `evolution/src/services/evolutionActions.test.ts` — IterationSnapshotRow
- [ ] `evolution/src/services/evolutionVisualizationActions.test.ts` — EloHistoryPoint

**Component tests (Phase 6):**
- [ ] `evolution/src/components/evolution/tabs/EloTab.test.tsx` — .elo/.elos fields
- [ ] `evolution/src/components/evolution/tabs/MetricsTab.test.tsx` — Elo headers
- [ ] `evolution/src/components/evolution/tabs/SnapshotsTab.test.tsx` — elo/uncertainty
- [ ] `evolution/src/components/evolution/tabs/TimelineTab.test.tsx` — winner.elo
- [ ] `evolution/src/components/evolution/tabs/EntityMetricsTab.test.tsx` — uncertainty field
- [ ] `evolution/src/components/evolution/tabs/RunsTable.test.tsx` — uncertainty field
- [ ] `src/app/admin/evolution/arena/[topicId]/computeEloCutoff.test.ts` — elo input type
- [ ] `src/app/admin/evolution/arena/arenaBudgetFilter.test.ts` — entry fixtures
- [ ] `src/app/admin/evolution/arena/[topicId]/page.test.tsx` — sort key, column headers
- [ ] `src/app/admin/evolution/runs/[runId]/page.test.tsx` — if mu/sigma refs
- [ ] `src/app/admin/evolution/runs/page.test.tsx` — if mu/sigma refs

**Integration tests (Phase 4 migration):**
- [ ] `src/__tests__/integration/evolution-sync-arena.integration.test.ts` — RPC params
- [ ] `src/__tests__/integration/evolution-sync-arena-updates.integration.test.ts` — RPC params
- [ ] `src/__tests__/integration/evolution-arena-comparison.integration.test.ts` — renamed columns
- [ ] `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — uncertainty column
- [ ] `src/__tests__/integration/evolution-visualization-data.integration.test.ts` — eloHistory

**E2E tests:**
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — DB queries
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-arena-detail.spec.ts` — if mu/sigma refs
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-invocation-detail.spec.ts` — if mu/sigma refs
- [ ] `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — if mu/sigma refs
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-budget.spec.ts` — mu/sigma in variant fixture
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-logs.spec.ts` — run_summary with muHistory
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-detail.spec.ts` — sigma in metric fixtures

**Integration (additional):**
- [ ] `src/__tests__/integration/evolution-claim.integration.test.ts` — muHistory in fixture

**V3→V4 migration validation:**
- [ ] Add a dedicated test in `evolution/src/lib/schemas.test.ts` that verifies V3 run_summary data with `muHistory: [[25, 30, 28]]` correctly transforms to V4 `eloHistory: [[1200, 1280, 1248]]` via `toEloScale()`
- [ ] Test that V1 `eloHistory` data passes through to V4 without double-conversion

### Phase 8: Documentation
- [ ] Update all 13 evolution docs to use Elo/uncertainty terminology (see Documentation Updates section)
- [ ] Update `docs/docs_overall/architecture.md` — Arena table column descriptions

## Testing

### Unit Tests
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` — verify Rating type is {elo, uncertainty}, createRating returns {elo:1200, uncertainty:133.3}, updateRating/updateDraw work correctly with Elo values, isConverged uses uncertainty threshold
- [ ] `evolution/src/lib/shared/computeRatings.property.test.ts` — verify all property invariants hold with new type (uncertainty decreases, Elo monotonicity, finite outputs)
- [ ] `evolution/src/lib/shared/selectWinner.test.ts` — highest elo wins, uncertainty tiebreak
- [ ] `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts` — opponent selection, convergence, elimination all work with elo/uncertainty
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — persistence writes correct columns, run summary uses eloHistory
- [ ] `evolution/src/lib/metrics/computations/finalization.test.ts` — elo metric computation

### Integration Tests
- [ ] `src/__tests__/integration/evolution-sync-arena.integration.test.ts` — sync_to_arena RPC works with renamed columns/fields
- [ ] `src/__tests__/integration/evolution-sync-arena-updates.integration.test.ts` — arena updates work
- [ ] `src/__tests__/integration/evolution-arena-comparison.integration.test.ts` — comparison records use new column names
- [ ] `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — stale recomputation works with renamed uncertainty column

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — full pipeline run completes, DB contains correct elo/uncertainty values

### Manual Verification
- [ ] Browse arena leaderboard — no μ or σ visible, columns show "Elo", "95% CI", "Elo Range"
- [ ] Browse run detail page — EloTab shows Elo scale, SnapshotsTab shows Elo/Uncertainty, MetricsTab shows "Elo" not "Mu"
- [ ] Browse invocation detail — ConfigDrivenDetailRenderer shows "Elo", "Uncertainty", not μ/σ
- [ ] Search codebase for exposed mu/sigma — `grep -r "\.mu\b" --include="*.tsx"` returns no UI hits

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — full pipeline E2E
- [ ] Manually verify arena leaderboard via Playwright MCP: navigate to `/admin/evolution/arena`, click a topic, verify column headers

### B) Automated Tests
- [ ] `npm run test:unit` — all unit tests pass
- [ ] `npm run test:integration` — all integration tests pass (requires `supabase db reset` for new migration)
- [ ] `npm run lint && npm run tsc` — no type errors or lint issues
- [ ] `npm run build` — production build succeeds

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/README.md` — "OpenSkill Bayesian ratings" → "Elo ratings with confidence intervals"
- [ ] `evolution/docs/arena.md` — mu/sigma references throughout, loadArenaEntries, syncToArena, DB schema
- [ ] `evolution/docs/architecture.md` — mu-based winner determination → elo-based, arena loading
- [ ] `evolution/docs/data_model.md` — mu/sigma column docs → elo_rating/elo_uncertainty, Rating type, RPCs
- [ ] `evolution/docs/rating_and_comparison.md` — core rating system: reframe around Elo + uncertainty, keep OpenSkill as implementation note
- [ ] `evolution/docs/entities.md` — entity relationship references, arena comparison columns
- [ ] `evolution/docs/metrics.md` — sigma → uncertainty in metrics table, eloMetricValue changes
- [ ] `evolution/docs/strategies_and_experiments.md` — muHistory → eloHistory, strategyEffectiveness.avgMu → avgElo
- [ ] `evolution/docs/visualization.md` — admin UI column descriptions, μ/σ → Elo/Uncertainty
- [ ] `evolution/docs/cost_optimization.md` — minor sigma references in budget tier docs
- [ ] `evolution/docs/logging.md` — "sigma" in triage logging → "uncertainty"
- [ ] `evolution/docs/reference.md` — key constants: DEFAULT_MU → DEFAULT_ELO, etc.
- [ ] `evolution/docs/agents/overview.md` — ranking agent docs, sigma-weighted opponent selection → uncertainty-weighted
- [ ] `docs/docs_overall/architecture.md` — Arena table column descriptions (mu, sigma → elo_rating, elo_uncertainty)

## Key Design Decisions

### DB Column Strategy (Final — No Contradictions)
**`evolution_variants`**: Keep `mu`, `sigma`, and `elo_score` columns unchanged. Rationale:
1. Stale trigger fires on `AFTER UPDATE OF mu, sigma` — renaming breaks it
2. `sync_to_arena` RPC extracts `entry->>'mu'` from JSON — RPC stays unchanged
3. Index `idx_variants_arena_prompt` on `(prompt_id, mu DESC)` — stays
4. Pipeline writes mu/sigma from openskill; elo_score is derived

**TypeScript boundary**: `buildRunContext.ts` reads `mu`/`sigma`/`elo_score` from DB and converts to `Rating {elo, uncertainty}`. `persistRunResults.ts` converts `Rating {elo, uncertainty}` back to mu/sigma for DB writes and sends mu/sigma in sync_to_arena JSON.

**Columns that ARE renamed** (safe — no trigger/index/RPC deps):
- `evolution_arena_comparisons`: 8 diagnostic columns (`entry_a_mu_before`→`entry_a_elo_before`, etc.)
- `evolution_metrics`: `sigma`→`uncertainty`

**Deployment**: migration + code deploy must be atomic (single release) to avoid column-name mismatches on the write path.

**Rollback**: companion rollback migration included that reverses the column renames.

### Run Summary V4
Add V4 schema with `version: 4` discriminant. Stores `eloHistory` (Elo-scale values, 800-1600 range) instead of V3's `muHistory` (mu-scale, 25-50 range). V3→V4 transform applies `toEloScale()`. V4 is unambiguously distinguished from V3 by the `version` literal. Existing V1→V2→V3 chain extends to V1→V2→V3→V4.

### Rating Type Boundary
`computeRatings.ts` is the sole file importing openskill. Internally it works with mu/sigma via private helpers `toEloScale()` and `fromEloScale()`. The exported `Rating` type becomes `{elo: number, uncertainty: number}`. Functions `updateRating` and `updateDraw` convert Elo→mu on input, call `osRate`, convert mu→Elo on output. **No clamping** in the internal round-trip — clamping to [0, 3000] only in `toDisplayElo()` used for UI formatting.

### MetricValue.uncertainty Semantics
The `MetricValue.uncertainty` field serves dual purpose: for run-level elo metrics it stores Elo-scale rating uncertainty (from variant's Bayesian sigma × 16); for propagated strategy/experiment metrics it stores bootstrap standard error. Both are valid uncertainty measures used identically for CI computation: `[value ± 1.96 × uncertainty]`.

### Execution Detail Backward Compatibility
Existing JSONB in `evolution_agent_invocations.execution_detail` contains old field names (`variantMuBefore`, etc.). Zod schemas accept both old and new names via `.or()` fallbacks. New writes use the new names. No JSONB data migration required.

### Atomic Phase Execution
Phases 1-3 must be implemented and committed together — they share the `Rating` type boundary. Phase 1 alone would break compilation of Phase 2-3 files. Within a single commit, update computeRatings.ts + all consumers + all tests simultaneously.

**CI gating**: All Phase 1-3 changes MUST be in a single PR. The PR description must note "Atomic refactor — do not split." TypeScript compilation (`npm run tsc`) enforces this — splitting would produce compile errors on the missing Rating fields.

### Bootstrap Sampling in Elo Space
`bootstrapPercentileCI` currently samples `v.mu + v.sigma * z`. After the change, ratings are `{elo, uncertainty}` where uncertainty = sigma × 16 (Elo-scale). The sampling formula becomes `v.elo + v.uncertainty * z` — this works directly because `uncertainty` IS the Elo-scale standard deviation. No division by 1.96 needed (uncertainty is sigma-equivalent, not CI half-width). The `toEloScale()` call inside the loop is also removed since `v.elo` is already Elo.

## Review & Discussion

### Iteration 1 (Security: 3/5, Architecture: 3/5, Testing: 2/5)

**Critical gaps fixed:**
1. **Elo clamping in round-trip** (Security) — Fixed: removed clamping from internal `toEloScale()`; clamping only in `toDisplayElo()` for UI. No information loss in rating updates.
2. **evolution_metrics.sigma rename deployment risk** (Security) — Fixed: added atomic deployment requirement and rollback migration.
3. **V3→V4 schema parsing collision** (Security) — Fixed: V4 uses `version: 4` discriminant; Zod union tries V4 first, V3 requires `version: 3`, no cross-match possible.
4. **Phase 4 contradictory DB decisions** (Architecture) — Fixed: consolidated into single clear "Key Design Decisions" section. evolution_variants stays unchanged; only arena_comparisons and metrics columns renamed.
5. **toEloScale removal before consumers updated** (Architecture) — Fixed: toEloScale stays as private internal helper, not removed from exports until all consumers updated atomically in Phases 1-3 together.
6. **Checkpoint serialization unaddressed** (Architecture) — Fixed: added IterationSnapshot backward-compat via Zod `.transform()` for old `{mu, sigma}` format.
7. **MetricValue.sigma conflation** (Architecture) — Fixed: documented dual semantics in Key Design Decisions; both uses are valid uncertainty measures for CI computation.
8. **29 missing test files** (Testing) — Fixed: Phase 7 now lists all 42 affected test files grouped by phase.
9. **No rollback plan** (Testing) — Fixed: companion rollback migration documented.
10. **No V3→V4 migration validation** (Testing) — Fixed: dedicated tests added for V3→V4 transform correctness and V1 pass-through.
11. **sync_to_arena RPC contradiction** (Security minor→fixed) — Clarified: RPC stays unchanged, TypeScript keeps sending mu/sigma in JSON.
12. **Atomic phase execution** (Architecture) — Added to Key Design Decisions: Phases 1-3 must be committed together.

### Iteration 2 (Security: 3/5, Architecture: 3/5, Testing: 4/5)

**Critical gaps fixed:**
1. **V1→V4 migration math error** (Security) — Fixed: V1 `eloHistory` values are ordinal-scale (~0-50), NOT 1200-scale Elo. Must go through V1→V3 (legacyToMu) then V3→V4 (toEloScale). Added explicit warning and correct chain. Added union ordering safeguard comment.
2. **top15Cutoff scale change unaddressed** (Architecture) — Fixed: computeTop15Cutoff now returns Elo-scale; added backward-compat transform for old mu-scale values in stored snapshots.
3. **EloAttribution double-scaling** (Architecture) — Fixed: removed `* ELO_SCALE` multiplication since deltaElo is already scaled. Documented at the change site.
4. **SerializedPipelineState checkpoint** (Architecture) — Fixed: added to Phase 1 types.ts updates with Zod backward-compat transform.
5. **toMetricValue/readMetrics query mapping** (Architecture) — Fixed: added toMetricValue update and readMetrics select column update to Phase 3.
6. **6 missing test files** (Testing) — Fixed: added types.test.ts, claimAndExecuteRun.test.ts, admin-strategy-budget.spec.ts, evolution-claim.integration.test.ts, admin-evolution-logs.spec.ts, admin-evolution-strategy-detail.spec.ts. Total now 48.
7. **No CI gating for atomic phases** (Testing) — Fixed: added CI gating requirement to Key Design Decisions.
8. **computeEloPerDollar body unchanged** (Security minor) — Fixed: body becomes `(elo - 1200) / cost`, remove internal toEloScale call.
9. **openskill mock description misleading** (Testing minor) — Fixed: mock stays returning {mu, sigma}; computeRatings handles conversion.
10. **bootstrapPercentileCI sampling formula** (Architecture minor) — Fixed: `elo + uncertainty * z` (no 1.96 division). Added Key Design Decision section explaining the math.
11. **RankingExecutionDetail, MetaReviewExecutionDetail** (Architecture minor) — Fixed: added to Phase 1 types.ts updates.
12. **DiffMetrics.eloChanges double-conversion** (Architecture minor) — Fixed: remove toEloScale call since ratings already Elo-scale.
