# Eliminate Mu Replace Elo Evolution Research

## Problem Statement
Remove all references to mu and sigma from the codebase and evolution admin UI — everywhere. Universally speak in terms of Elo and confidence intervals instead. Understand the scope of change and how to convert from sigma to confidence intervals.

## Requirements (from GH Issue #966)
- Remove all references to mu and sigma from the codebase and evolution admin UI — everywhere
- Universally speak in terms of Elo and confidence intervals
- Understand scope of change
- Understand how to convert from sigma to confidence intervals

## High Level Summary

### Key Architectural Insight

**OpenSkill (the rating library) REQUIRES mu/sigma internally.** The `osRate()` function takes `{mu, sigma}` pairs and returns `{mu, sigma}` pairs. There is no way to make it work with Elo values directly. Therefore, **mu/sigma must remain as internal implementation details** — the goal is to hide them from all user-facing surfaces (UI, API responses, column headers, documentation) while keeping them as the internal computation format.

### Conversion Formulas

The conversion between mu/sigma and Elo/CI is well-defined and invertible:

```
Elo = 1200 + (mu - 25) * 16          // toEloScale()
mu  = (Elo - 1200) / 16 + 25         // inverse (fromEloScale)

eloSigma = sigma * 16                // ELO_SIGMA_SCALE = 400/25 = 16
sigma    = eloSigma / 16             // inverse

95% CI = [Elo - 1.96 * eloSigma, Elo + 1.96 * eloSigma]
```

Examples:
| Sigma (Bayesian) | Elo Sigma | 95% CI Half-Width | Meaning |
|---|---|---|---|
| 8.333 (default) | 133 | ±261 | Brand new, no matches |
| 4.5 (convergence) | 72 | ±141 | Rating settled |
| 3.0 (old threshold) | 48 | ±94 | Very confident |

### Scope Summary

| Layer | Files Affected | Complexity |
|---|---|---|
| **UI Components** | ~8 files | Medium — rename columns, convert values |
| **Server Actions** | 3 files | Low — transform response data |
| **Pipeline Core** | ~15 files | **Keep mu/sigma internally** — only change variable names where exposed |
| **Database Schema** | 5+ migrations | Medium — keep mu/sigma columns, rename cosmetic columns |
| **Zod Schemas** | 1 large file | Medium — rename fields in run_summary, execution_detail |
| **Tests** | 20+ files | High volume but mechanical |
| **Documentation** | 13 evolution docs | Medium — terminology updates |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/README.md
- evolution/docs/arena.md — arena system, loadArenaEntries, syncToArena, DB schema
- evolution/docs/architecture.md — pipeline flow, winner determination, arena loading
- evolution/docs/data_model.md — evolution_variants columns, RPCs, type hierarchy
- evolution/docs/rating_and_comparison.md — OpenSkill rating mechanics, ranking algorithms
- evolution/docs/entities.md — entity relationships, FK cascade
- evolution/docs/metrics.md — metrics system, stale recomputation, CI propagation
- evolution/docs/strategies_and_experiments.md — muHistory, strategy effectiveness, bootstrap CIs
- evolution/docs/visualization.md — admin pages, shared components, column descriptions
- evolution/docs/cost_optimization.md — budget tiers (minor mu references)
- evolution/docs/logging.md — triage logging with sigma references
- evolution/docs/reference.md — key files, constants
- evolution/docs/agents/overview.md — agent operations, ranking, format validation

## Code Files Read

### Core Rating System
- `evolution/src/lib/shared/computeRatings.ts` — Rating type, DEFAULT_MU=25, DEFAULT_SIGMA=8.333, ELO_SIGMA_SCALE=16, toEloScale(), updateRating(), isConverged(). Only file that imports openskill.
- `evolution/src/lib/shared/selectWinner.ts` — Winner selection: highest mu, sigma tiebreak
- `evolution/src/lib/utils/formatters.ts` — elo95CI(), formatEloCIRange(), formatEloWithUncertainty()

### Pipeline
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — BETA, ELIMINATION_CI, CONVERGENCE_THRESHOLD, selectOpponent() with entropy/sigma scoring, before/after mu tracking
- `evolution/src/lib/pipeline/loop/swissPairing.ts` — Same constants (duplicated), Bradley-Terry pWin, sigma-weighted pairing
- `evolution/src/lib/pipeline/loop/rankNewVariant.ts` — localVariantMu for discard decision
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — topKMuValues(), muHistory accumulation, eligibility check (mu + z*sigma >= cutoff)
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — loadArenaEntries reads mu/sigma from DB, defaults to DEFAULT_MU/SIGMA
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — Persists mu/sigma/elo_score to evolution_variants, builds run_summary with muHistory, arena sync

### Agents
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts` — Before/after snapshots with mu/sigma, writes entry_a_mu_before/after to arena_comparisons, display labels μ/σ
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — discardReason with localMu
- `evolution/src/lib/core/detailViewConfigs.ts` — Display labels: μ, σ, Δμ, Δσ, "Final Local μ", "Final Local σ", "Low-σ Opponents", "Mu"

### Schemas & Types
- `evolution/src/lib/schemas.ts` — 18+ mu/sigma type definitions across execution detail schemas, IterationSnapshot, run summary V1/V2/V3 migration transforms (legacyToMu), muHistory field
- `evolution/src/lib/types.ts` — Rating type re-export, DebateExecutionDetail, EvolutionExecutionDetail, IterationSnapshot ratings, EvolutionRunSummary with muHistory/topVariants.mu
- `evolution/src/lib/pipeline/infra/types.ts` — muHistory: number[][] in EvolutionResult

### Metrics
- `evolution/src/lib/metrics/types.ts` — MetricRow with sigma field
- `evolution/src/lib/metrics/writeMetrics.ts` — WriteMetric with sigma, writes sigma to evolution_metrics
- `evolution/src/lib/metrics/computations/finalization.ts` — eloMetricValue() converts sigma → CI
- `evolution/src/lib/metrics/computations/propagation.ts` — 11 sigma references in aggregation functions
- `evolution/src/lib/metrics/experimentMetrics.ts` — MetricValue.sigma, bootstrapMeanCI with sigma propagation, bootstrapPercentileCI with mu/sigma
- `evolution/src/lib/metrics/recomputeMetrics.ts` — Reads mu/sigma from DB for stale recomputation

### UI Components
- `evolution/src/components/evolution/tabs/EloTab.tsx` — Chart renders mu values on Y-axis
- `evolution/src/components/evolution/tabs/MetricsTab.tsx` — "Mu" and "Avg Mu" column headers
- `evolution/src/components/evolution/tabs/SnapshotsTab.tsx` — μ and σ column headers, mu.toFixed(2), sigma.toFixed(2), "Local μ" for discarded variants
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — "μ = {winner.mu.toFixed(2)}" in outcome card

### Admin Pages
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — Sort by 'sigma', "Elo ± σ" column header, sigma * ELO_SIGMA_SCALE for CI display
- `src/app/admin/evolution/arena/[topicId]/arenaCutoff.ts` — computeEloCutoff uses mu → toEloScale(e.mu)
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` — "local mu below the top-15% cutoff"

### Server Actions
- `evolution/src/services/arenaActions.ts` — ArenaEntry type with mu/sigma fields
- `evolution/src/services/evolutionActions.ts` — IterationSnapshotRow with ratings: {mu, sigma}
- `evolution/src/services/evolutionVisualizationActions.ts` — EloHistoryPoint.mu, muHistory extraction

### Database Migrations
- `20260322000007` — ALTER TABLE ADD COLUMN mu/sigma with defaults
- `20260322000006` — sync_to_arena RPC with mu/sigma in JSON
- `20260327000001` — sync_to_arena with p_arena_updates mu/sigma
- `20260323000003` — Stale trigger fires on mu/sigma changes
- `20260328000002` — Expanded stale trigger, same mu/sigma condition
- `20260326000003` — Earlier stale trigger expansion
- `20260331000001` — Arena comparison columns: entry_a/b_mu/sigma_before/after
- `20260322000004` — Index on (prompt_id, mu DESC)

### Testing
- `src/testing/mocks/openskill.ts` — Mock with mu=25, sigma=25/3
- `evolution/src/lib/shared/computeRatings.test.ts` — 93 mu/sigma references
- `evolution/src/lib/shared/computeRatings.property.test.ts` — 31 fast-check property tests
- `evolution/src/lib/shared/selectWinner.test.ts` — 26 mu/sigma references
- `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts` — 52 mu/sigma references
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — 59 mu/sigma references
- `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — 23 mu/sigma references
- `src/__tests__/integration/evolution-sync-arena.integration.test.ts` — mu/sigma in RPC calls
- `src/__tests__/integration/evolution-sync-arena-updates.integration.test.ts` — p_arena_updates with mu/sigma
- `src/__tests__/integration/evolution-arena-comparison.integration.test.ts` — variant fixtures
- `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — metric sigma
- `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — DB queries with mu/sigma
- Various component tests: EloTab.test.tsx, MetricsTab.test.tsx, SnapshotsTab.test.tsx, computeEloCutoff.test.ts

## Key Findings

### 1. OpenSkill is isolated to ONE file
Only `computeRatings.ts` imports `openskill`. All other code uses wrapper functions (`createRating`, `updateRating`, `updateDraw`, `toEloScale`, `isConverged`). This is excellent for our purposes — the boundary is clean.

### 2. The system already has Elo conversion everywhere it matters
- Arena leaderboard already sorts by `elo_score`, not mu
- Arena pages already display "Elo", "95% CI", and "Elo ± σ"
- The `formatEloCIRange()` and `formatEloWithUncertainty()` functions already exist
- Metrics system already stores `winner_elo`, `median_elo`, etc. (not winner_mu)

### 3. mu/sigma are exposed in UI in these specific places
1. **SnapshotsTab** — μ and σ column headers with raw values
2. **MetricsTab** — "Mu" and "Avg Mu" headers with raw values  
3. **TimelineTab** — "μ = X.XX" in winner outcome card
4. **EloTab** — Y-axis shows mu values (not Elo)
5. **Arena leaderboard** — "Elo ± σ" header, sigma sort key
6. **detailViewConfigs** — μ, σ, Δμ, Δσ labels in invocation detail panels
7. **VariantDetailContent** — "local mu below the top-15% cutoff" text

### 4. Database columns CAN stay as mu/sigma internally
The mu/sigma columns on `evolution_variants` are the source of truth for the rating system. Renaming them would break the stale trigger, sync_to_arena RPC, indexes, and 20+ TypeScript query sites. **Keep them as-is internally; add an abstraction layer.**

### 5. execution_detail JSONB can stay as-is
The mu/sigma fields in execution_detail are internal audit data stored as JSONB. No schema migration needed — just change the display labels in `detailViewConfigs.ts`.

### 6. muHistory in run_summary needs renaming
The `muHistory` field in the V3 run summary stores raw mu values. Options:
- **Option A:** Rename to `eloHistory` and store Elo-converted values (breaking change, needs V4 schema)
- **Option B:** Keep `muHistory` name internally but convert values to Elo at read time (in visualization action)
- **Option C:** Keep as-is, convert only at display time in EloTab

### 7. The metrics sigma field is NOT the same as rating sigma
The `evolution_metrics.sigma` column stores Elo-scale uncertainty (already converted via `* ELO_SIGMA_SCALE`) or bootstrap standard error. It's used for CI computation. This field name is fine — "sigma" in a statistics context means standard deviation, which is what CI is derived from.

### 8. Arena comparison before/after columns are diagnostic-only
The `entry_a_mu_before`, `entry_a_sigma_before` etc. columns on `evolution_arena_comparisons` are audit data. They're not displayed in any UI currently. Can be left as-is or renamed in a low-priority migration.

## Open Questions

1. **How deep should "remove mu/sigma" go?**
   - **Option A (UI-only):** Change display labels, column headers, and user-facing text only. Keep all internal code using mu/sigma. ~50 files.
   - **Option B (UI + API):** Also change server action response types and schema field names. ~80 files.
   - **Option C (Full):** Also rename DB columns, internal variables, and types. ~120+ files + DB migration. Very risky.

2. **Should the EloTab chart show Elo values on the Y-axis?**
   Currently shows raw mu (25-50 range). Converting to Elo (800-1600 range) would change the visual scale but be more consistent.

3. **What about the "convergence" concept?**
   Currently: "sigma < 4.5 means converged." In Elo terms: "95% CI < ±141 means converged." Should we expose convergence as a CI threshold?

4. **Run summary V4?**
   Renaming `muHistory` → `eloHistory` and `topVariants[].mu` → `topVariants[].elo` requires a new schema version (V4) with V3→V4 migration transform. Is this worth the churn?

5. **Should `strategyEffectiveness.avgMu` become `avgElo`?**
   This is stored in run_summary JSONB. Same V4 concern.
