# Small UI Fixes Research

## Problem Statement
Small UI fixes for the evolution admin pages. The arena leaderboard needs to show Elo uncertainty and a top 15% cutoff indicator. The evolution runs list view has a cost display issue where costs are not updated. Additionally, variants in the arena leaderboard show very high Elo scores despite having no matches, which is misleading.

## Requirements (from GH Issue #839)
- Arena leaderboard should show elo uncertainty, in addition to mu and sigma
- Show a cutoff for top 15% - indicate using text at the top which entry is the 15% cutoff we use for ranking
- Cost not updated on evolution runs - in evolution list view
- Variants in arena leaderboard show very high elo despite no matches

## High Level Summary

Four distinct issues investigated across 2 rounds of 4 parallel research agents:

1. **Elo uncertainty** — All data and formatter functions already exist (`elo95CI`, `formatEloCIRange` in `evolution/src/lib/utils/formatters.ts`). Just need to add a column to the arena leaderboard table.

2. **Top 15% cutoff** — The pipeline uses `ELIGIBILITY_Z_SCORE = 1.04` with `top15Cutoff = sortedByMu[Math.floor(n*0.15)-1].mu`. Can compute this client-side from existing ArenaEntry data (mu, sigma already fetched). Display as a visual separator row or info text above the table.

3. **Cost not updated** — Root cause is **no auto-refresh** on the runs list page. Cost IS written to `evolution_metrics` during execution (after each iteration via `writeMetric`), but the page only loads once on mount with no polling. Additionally, there's a **duplicate cost column** ("Spent" from base columns + "Cost" from metric columns).

4. **High Elo with no matches** — Root cause is in the `sync_to_arena` Postgres RPC which **hardcodes `arena_match_count = 0`** on INSERT (line 270 of migration `20260322000006`), ignoring the correctly-computed value passed from TypeScript. The UPDATE clause also uses overwrite semantics instead of additive. This is a known bug documented in `docs/planning/adhoc_evolution_testing_20260324`.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md — arena entry schema, sync flow, match counting semantics
- evolution/docs/entities.md — entity relationships and cascade behavior
- evolution/docs/visualization.md — admin page list, shared components, server action architecture
- evolution/docs/rating_and_comparison.md — OpenSkill ratings, Elo conversion, 2-phase ranking
- evolution/docs/strategies_and_experiments.md — strategy aggregates, experiment metrics, bootstrap CIs
- evolution/docs/cost_optimization.md — V2CostTracker, budget tiers, cost aggregation
- evolution/docs/metrics.md — metric registry, write/read paths, stale recomputation
- evolution/docs/agents/overview.md — agent operations, format validation
- evolution/docs/reference.md — file inventory, service files
- evolution/docs/minicomputer_deployment.md
- evolution/docs/curriculum.md

## Code Files Read

### Issue 1: Arena leaderboard Elo uncertainty
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — leaderboard page with 8 columns (Rank, Content, Elo, Mu, Sigma, Matches, Method, Cost)
- `evolution/src/services/arenaActions.ts` — `getArenaEntriesAction` fetches all needed fields (elo_score, mu, sigma)
- `evolution/src/lib/utils/formatters.ts` — `elo95CI(sigma)` returns `Math.round(1.96 * sigma)`, `formatEloCIRange(elo, sigma)` returns `[lo, hi]` string
- `evolution/src/lib/shared/computeRatings.ts` — `toEloScale()`, `ELO_SIGMA_SCALE = 16`, `formatElo()`

### Issue 2: Top 15% cutoff indicator
- `evolution/src/lib/pipeline/loop/rankVariants.ts` lines 450-457 — cutoff calculation: `top15Idx = Math.max(0, Math.floor(sortedByMu.length * 0.15) - 1)`, `top15Cutoff = sortedByMu[top15Idx]?.mu`
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — eligibility: `mu + 1.04 * sigma >= top15Cutoff`

### Issue 3: Cost shows $0.00 for all runs
- `evolution/src/services/evolutionActions.ts` lines 237-251 — `getEvolutionRunsAction` queries `evolution_metrics` for cost (returns empty for pre-metrics runs)
- `evolution/src/services/evolutionActions.ts` line 317 — detail page calls dropped `get_run_total_cost` RPC
- `supabase/migrations/20260323000004_drop_legacy_metrics.sql` — **DROPS** `evolution_run_costs` VIEW and `get_run_total_cost` function
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` lines 340-343 — original VIEW definition: `SELECT run_id, COALESCE(SUM(cost_usd), 0) FROM evolution_agent_invocations GROUP BY run_id`
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` lines 206-216 — writes cost metric (only works for runs executed after metrics table creation)
- `evolution/src/components/evolution/RunsTable.tsx` lines 106-130 — base "Spent" column from `run.total_cost_usd`
- `evolution/src/lib/metrics/metricColumns.tsx` lines 36-51 — duplicate "Cost" metric column from `run.metrics`
- `src/app/admin/evolution/runs/page.tsx` line 146 — combines both: `[...getBaseColumns(), ...createRunsMetricColumns()]`

### Issue 4: High Elo with no matches
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` lines 348-371 — `syncToArena()` correctly computes variantMatchCounts from matchHistory
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` lines 257-280 — `sync_to_arena` RPC:
  - INSERT (line 270): hardcodes `arena_match_count = 0` instead of using passed value
  - UPDATE (line 279): uses overwrite not additive increment
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` lines 587-631 — test F38 only validates RPC call params, not DB state
- `docs/planning/adhoc_evolution_testing_20260324/adhoc_evolution_testing_20260324_planning.md` lines 73-79 — previously identified as bug F38

## Key Findings

### Finding 1: Elo Uncertainty Column — Pure UI Addition
- All data already available in `ArenaEntry` type (mu, sigma, elo_score)
- Formatter functions exist: `elo95CI()` and `formatEloCIRange()` in `evolution/src/lib/utils/formatters.ts`
- Formula: 95% CI half-width = `Math.round(1.96 * sigma)`, range = `[elo - half, elo + half]`
- Add new column after Sigma in the leaderboard table
- No backend changes needed

### Finding 2: Top 15% Cutoff — Client-Side Computation
- Pipeline formula: `top15Idx = Math.max(0, Math.floor(n * 0.15) - 1)`, `cutoff = sortedByMu[top15Idx].mu`
- Eligibility: `mu + 1.04 * sigma >= top15Cutoff`
- All data available client-side from ArenaEntry (mu, sigma)
- Display options: visual separator row, info card above table, or row background tinting
- No backend changes needed

### Finding 3: Cost Shows $0.00 for ALL Runs — Dropped Legacy Cost Path + Metrics Table Timing
- **Root cause identified**: `getEvolutionRunsAction` (evolutionActions.ts:240-245) queries `evolution_metrics` table for cost, but:
  1. The `evolution_metrics` table was created on 2026-03-23 (migration `20260323000003`). Runs completed before that have NO cost metrics rows.
  2. The old fallback paths (`evolution_run_costs` VIEW and `get_run_total_cost` RPC) were **dropped** in migration `20260323000004_drop_legacy_metrics.sql`.
  3. Cost during execution is only written if the pipeline loop runs with the new metrics code. Pre-metrics runs never had cost written.
  4. The detail page (evolutionActions.ts:317) still calls `get_run_total_cost` RPC which was dropped — also returns 0.
- **Data source that WORKS**: `evolution_agent_invocations` table always has `cost_usd` per invocation. `SUM(cost_usd) GROUP BY run_id` is the reliable cost source.
- **Fix**: Change the batch cost query in `getEvolutionRunsAction` to query `evolution_agent_invocations` directly (or recreate the `evolution_run_costs` view). Also fix the detail page's dropped RPC call.
- **Additional issue**: duplicate cost columns — "Spent" from `getBaseColumns()` + "Cost" from `createRunsMetricColumns()` (cost has `listView: true` in registry)

### Finding 4: High Elo with No Matches — RPC Bug (Known)
- TypeScript correctly computes match counts from matchHistory
- **Bug in `sync_to_arena` Postgres RPC**: INSERT clause hardcodes `arena_match_count = 0`
- **Second bug**: UPDATE clause overwrites count instead of additive increment
- This was previously identified as bug F38 in `adhoc_evolution_testing_20260324` project
- Fix: new migration to alter the `sync_to_arena` function
- The high Elo itself is expected behavior (pipeline mu synced to arena), but without match counts it's misleading

## Open Questions

1. For Issue 3 (cost), should we recreate the `evolution_run_costs` view (clean) or inline the SUM query in the server action (simpler)?
2. For Issue 4 (arena_match_count), should the RPC also use additive semantics for the UPDATE clause (`arena_match_count = evolution_variants.arena_match_count + new_count`) to properly accumulate lifetime counts?
3. For Issue 2 (15% cutoff), should the cutoff indicator use the same sorting as the table (Elo-based) or always compute from mu (matching the pipeline's actual eligibility formula)?
4. For Issue 3, should we also set `listView: false` on the cost metric in the registry to remove the duplicate "Cost" metric column (since "Spent" from base columns already shows it)?
