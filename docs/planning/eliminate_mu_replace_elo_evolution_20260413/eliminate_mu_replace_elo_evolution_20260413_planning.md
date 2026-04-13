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
  - Update `createRating()` to return `{elo: 1200, uncertainty: 133.3}` (DEFAULT_MU→1200, DEFAULT_SIGMA*16→133.3)
  - Update `updateRating(winner, loser)` to convert Elo→mu internally, call osRate, convert back
  - Update `updateDraw(a, b)` same pattern
  - Rename `isConverged(r, threshold)` — threshold becomes Elo-scale uncertainty (default: 4.5*16=72)
  - Remove `toEloScale()` export (no longer needed — Rating.elo is already Elo)
  - Add `fromEloScale(elo): number` internal helper for Elo→mu conversion
  - Rename constants: `DEFAULT_MU`→`DEFAULT_ELO=1200`, `DEFAULT_SIGMA`→`DEFAULT_UNCERTAINTY=133.3`, `DEFAULT_CONVERGENCE_SIGMA`→`DEFAULT_CONVERGENCE_UNCERTAINTY=72`, `ELO_SIGMA_SCALE`→internal only
  - Keep `computeEloPerDollar()` — parameter changes from `mu` to `elo`
- [ ] Update `evolution/src/lib/shared/selectWinner.ts`:
  - Change from "highest mu, sigma tiebreak" to "highest elo, uncertainty tiebreak (lower wins)"
  - Update `SelectWinnerResult` type: `{winnerId, elo, uncertainty}` instead of `{winnerId, mu, sigma}`
- [ ] Update `evolution/src/lib/types.ts`:
  - All `Rating` references now use `{elo, uncertainty}`
  - `EvolutionRunSummary` V4: rename `muHistory`→`eloHistory`, `topVariants[].mu`→`topVariants[].elo`, `baselineMu`→`baselineElo`, `strategyEffectiveness[].avgMu`→`strategyEffectiveness[].avgElo`
  - Update `DebateExecutionDetail`, `EvolutionExecutionDetail` mu→elo fields
  - Update `IterationSnapshot.ratings` from `{mu, sigma}` to `{elo, uncertainty}`
- [ ] Update `evolution/src/lib/schemas.ts`:
  - Add V4 run summary schema with eloHistory, transform V3→V4 (convert mu→Elo via `1200 + (mu-25)*16`)
  - Keep V1/V2/V3→V4 migration chain (V1 eloHistory→V4 eloHistory, V2 ordinalHistory→V4, V3 muHistory→V4)
  - Rename all execution detail schema fields: `variantMuBefore`→`variantEloBefore`, `variantSigmaBefore`→`variantUncertaintyBefore`, etc.
  - Rename `finalLocalMu`→`finalLocalElo`, `finalLocalSigma`→`finalLocalUncertainty`
  - Rename `discardReason.localMu`→`discardReason.localElo`
  - Rename `muDelta`→`eloDelta`, `sigmaDelta`→`uncertaintyDelta`
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
  - `discardReasonsMap` key: `mu` → `elo`
  - Winner log: `winnerMu`→`winnerElo`, `winnerSigma`→`winnerUncertainty`
- [ ] Update `evolution/src/lib/pipeline/setup/buildRunContext.ts`:
  - Arena entry loading: read DB columns `elo_rating` and `elo_uncertainty` (new names) instead of `mu`/`sigma`
  - Rating initialization uses new Rating type directly
- [ ] Update `evolution/src/lib/pipeline/finalize/persistRunResults.ts`:
  - `buildRunSummary()`: use `r.elo` for topVariants, strategyEffectiveness
  - Variant persistence: write to renamed DB columns
  - Arena sync: use new column names in JSON for sync_to_arena RPC
  - Winner selection uses new SelectWinnerResult type

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
  - `sigma` field in MetricValue stays as `sigma` (statistics term for standard deviation — this is NOT the Bayesian sigma, it's the bootstrap SE)
  - Actually rename to `se` or `uncertainty` for consistency
- [ ] Update `evolution/src/lib/metrics/experimentMetrics.ts`:
  - `MetricValue.sigma` → `MetricValue.uncertainty`
  - `bootstrapPercentileCI` param `allRunRatings: Array<Array<{elo, uncertainty}>>` — internally converts to mu/sigma for sampling, or samples in Elo space directly
- [ ] Update `evolution/src/lib/metrics/writeMetrics.ts`:
  - `WriteMetricOpts.sigma` → `WriteMetricOpts.uncertainty`
  - DB column `evolution_metrics.sigma` rename to `uncertainty` (in Phase 4 migration)
- [ ] Update `evolution/src/lib/metrics/types.ts`:
  - MetricRow: `sigma` → `uncertainty`
- [ ] Update `evolution/src/lib/metrics/recomputeMetrics.ts`:
  - DB reads use new column names

### Phase 4: Database Migration
Single migration file that renames columns, updates RPCs, triggers, and indexes.

- [ ] Create migration `supabase/migrations/YYYYMMDD000001_rename_mu_sigma_to_elo.sql`:
  - **evolution_variants**: rename `mu`→`elo_rating`, `sigma`→`elo_uncertainty` (keep `elo_score` as alias or drop it since `elo_rating` replaces it)
    - Actually: `mu`→`elo_rating` and drop `elo_score` (redundant — was always `toEloScale(mu)`)
    - Or: keep `elo_score` and rename `mu`→drop (derive from elo_score). But we need the raw Bayesian mu for openskill. So: keep a private column for internal use.
    - **Decision**: Rename `mu`→`_mu_internal` (prefixed to signal "do not use directly"), `sigma`→`_sigma_internal`. Add computed columns or just use application-layer conversion. OR: keep mu/sigma columns, add `elo_rating` and `elo_uncertainty` as computed/stored columns.
    - **Revised decision**: Keep `mu` and `sigma` columns in the DB (they're needed for openskill math in the pipeline, and the stale trigger fires on them). Rename `elo_score`→`elo_rating` for consistency. Add `elo_uncertainty` stored column = `sigma * 16`. The application reads `elo_rating` and `elo_uncertainty`; writes to `mu`/`sigma` (which auto-updates `elo_rating`/`elo_uncertainty` via trigger or application layer).
    - **Final decision (simplest)**: Don't rename DB columns at all. The DB layer keeps mu/sigma as internal. The TypeScript layer maps them to elo/uncertainty at the query boundary. This avoids a risky schema migration and keeps the stale trigger, sync_to_arena RPC, and indexes working. The `elo_score` column already exists and is correct.
  - **evolution_arena_comparisons**: rename `entry_a_mu_before`→`entry_a_elo_before`, `entry_a_sigma_before`→`entry_a_uncertainty_before` (and same for b, after). These are diagnostic columns with no trigger/index dependencies.
  - **evolution_metrics**: rename `sigma`→`uncertainty`
  - **Indexes**: `idx_variants_arena_leaderboard` and `idx_variants_arena_prompt` reference `mu DESC` — if keeping mu column, no change needed. If renaming, recreate index.
  - **Stale trigger**: `AFTER UPDATE OF mu, sigma` — if keeping mu/sigma columns, no change needed.
  - **sync_to_arena RPC**: Update JSON field extraction to accept both old (`mu`/`sigma`) and new (`elo_rating`/`elo_uncertainty`) field names for backward compat during rollout. Or just update the TypeScript caller to keep sending mu/sigma in the JSON (internal detail).
- [ ] Regenerate `src/lib/database.types.ts` via `npm run db:types` after migration

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
- [ ] Update `evolution/src/lib/shared/computeRatings.test.ts` — all assertions use elo/uncertainty
- [ ] Update `evolution/src/lib/shared/computeRatings.property.test.ts` — property tests use elo/uncertainty
- [ ] Update `evolution/src/lib/shared/selectWinner.test.ts` — elo/uncertainty assertions
- [ ] Update `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts` — elo/uncertainty
- [ ] Update `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — elo/uncertainty
- [ ] Update `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — elo/uncertainty
- [ ] Update `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts` — elo/uncertainty
- [ ] Update `src/__tests__/integration/evolution-sync-arena.integration.test.ts` — RPC params
- [ ] Update `src/__tests__/integration/evolution-sync-arena-updates.integration.test.ts` — RPC params
- [ ] Update `src/__tests__/integration/evolution-arena-comparison.integration.test.ts` — fixtures
- [ ] Update `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — metric fields
- [ ] Update `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — DB queries
- [ ] Update `src/testing/mocks/openskill.ts` — mock returns elo/uncertainty (internally still uses mu/sigma math)
- [ ] Update component tests: EloTab.test.tsx, MetricsTab.test.tsx, SnapshotsTab.test.tsx, computeEloCutoff.test.ts, arenaBudgetFilter.test.ts, EntityMetricsTab.test.ts, RunsTable.test.tsx
- [ ] Update `src/__tests__/integration/evolution-visualization-data.integration.test.ts` — eloHistory

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

### DB Column Strategy
**Keep `mu` and `sigma` columns in evolution_variants.** These are needed by:
1. The stale trigger (`AFTER UPDATE OF mu, sigma`)
2. The sync_to_arena RPC (reads mu/sigma from JSON)
3. Index `idx_variants_arena_prompt` on `(prompt_id, mu DESC)`
4. The pipeline internally (openskill requires mu/sigma)

The TypeScript layer maps mu→elo and sigma→uncertainty at the Supabase query boundary. The `elo_score` column is kept as the precomputed Elo value (already maintained in sync with mu).

**Rename only these DB columns:**
- `evolution_arena_comparisons`: `entry_a_mu_before`→`entry_a_elo_before`, etc. (diagnostic, no trigger/index deps)
- `evolution_metrics`: `sigma`→`uncertainty` (no trigger deps, only queried by TypeScript)

### Run Summary V4
Add a V4 schema version that stores `eloHistory` (Elo-scale values) instead of `muHistory`. The V3→V4 migration transform applies `toEloScale()` to each mu value. The existing V1→V2→V3 chain is extended to V1→V2→V3→V4.

### Rating Type Boundary
`computeRatings.ts` is the sole file importing openskill. Internally it works with mu/sigma. The exported `Rating` type becomes `{elo: number, uncertainty: number}`. Functions `updateRating` and `updateDraw` convert Elo→mu on input, call osRate, then convert mu→Elo on output. This keeps the openskill dependency completely encapsulated.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
