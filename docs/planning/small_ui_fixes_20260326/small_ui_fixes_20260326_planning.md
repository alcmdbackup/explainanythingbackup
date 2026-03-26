# Small UI Fixes Plan

## Background
Small UI fixes for the evolution admin pages. The arena leaderboard needs to show Elo uncertainty and a top 15% cutoff indicator. The evolution runs list view has a cost display issue where costs are not updated. Additionally, variants in the arena leaderboard show very high Elo scores despite having no matches, which is misleading.

## Requirements (from GH Issue #839)
- Arena leaderboard should show elo uncertainty, in addition to mu and sigma
- Show a cutoff for top 15% - indicate using text at the top which entry is the 15% cutoff we use for ranking
- Cost not updated on evolution runs - in evolution list view
- Variants in arena leaderboard show very high elo despite no matches

## Problem
The arena leaderboard page shows raw Mu/Sigma columns but doesn't translate sigma into human-readable Elo uncertainty, making it hard to assess confidence in rankings. There's no visual indicator of the top 15% cutoff used by the Swiss fine-ranking eligibility formula, so admins can't see which entries would qualify for further comparison. The runs list page shows $0.00 cost for all runs because the batch cost query reads from `evolution_metrics` (empty for pre-metrics runs) while the legacy `evolution_run_costs` VIEW and `get_run_total_cost` RPC were dropped in migration `20260323000004`. Finally, newly arena-synced variants display inflated Elo scores despite `arena_match_count = 0` because the `sync_to_arena` Postgres RPC hardcodes `arena_match_count = 0` on INSERT, ignoring the correctly-computed value from TypeScript.

## Options Considered

### Issue 1: Elo Uncertainty Column
- **Option A (chosen)**: Add "95% CI" column using existing `formatEloCIRange()` — displays `[lo, hi]` range after the Sigma column
- **Option B**: Show `±X` inline next to Elo value — more compact but less informative

### Issue 2: Top 15% Cutoff Indicator
- **Option A (chosen)**: Compute cutoff client-side, show info text above table with the cutoff Elo value, and tint ineligible rows with reduced opacity
- **Option B**: Add a horizontal separator row — visually cleaner but breaks when sorting by non-Elo columns
- **Option C**: Add a "Swiss Eligible" boolean column — too noisy for a small piece of info

### Issue 3: Cost Display
- **Option A (chosen)**: Change `getEvolutionRunsAction` to query `evolution_agent_invocations` directly with client-side SUM, matching the dropped VIEW logic. Also remove duplicate metric cost column by overriding `listView: false` on cost in `RunEntity.ts` only (not the global `METRIC_CATALOG`), since strategy/experiment list pages legitimately show cost via propagated metrics. Update both the legacy `METRIC_REGISTRY` in `registry.ts` and the entity class to stay consistent.
- **Option B**: Recreate the `evolution_run_costs` VIEW via new migration — adds a migration for something that can be done in TypeScript
- **Option C**: Backfill `evolution_metrics` cost rows from invocations — complex, doesn't fix future gap if metric writes fail
- **Note**: Client-side SUM is consistent with the existing pattern in `getEvolutionCostBreakdownAction`. For very large datasets a DB-level SUM would be more efficient, but the invocation table is bounded (typically 10-50 rows per run), so this is acceptable.

### Issue 4: Arena Match Count Bug
- **Option A (chosen)**: New migration to fix `sync_to_arena` RPC: use `(entry->>'arena_match_count')::INT` on INSERT instead of hardcoded `0`. Keep existing COALESCE/overwrite semantics on UPDATE since the TypeScript caller passes total match count (not delta) — additive UPDATE would double-count on re-sync.
- **Option B**: Fix INSERT + change UPDATE to additive — rejected because TypeScript passes lifetime total, not delta. Re-syncing the same variant would inflate counts.
- **Option C**: Fix only INSERT, also change TypeScript to pass delta — too invasive for a small fix

## Phased Execution Plan

### Phase 1: Fix cost display (backend)
**Files modified:**
- `evolution/src/services/evolutionActions.ts` — Change `getEvolutionRunsAction` cost query from `evolution_metrics` to `SELECT run_id, SUM(cost_usd) FROM evolution_agent_invocations WHERE run_id IN (...) GROUP BY run_id`
- `evolution/src/services/evolutionActions.ts` — Change detail page `get_run_total_cost` RPC call to same inline SUM query
- `evolution/src/lib/core/entities/RunEntity.ts` — Override `listView: false` on cost metric spread: `{ ...METRIC_CATALOG.cost, listView: false, compute: (ctx) => computeRunCost(ctx) }`
- `evolution/src/lib/metrics/registry.ts` — Set `listView: false` on the `cost` metric in the legacy `METRIC_REGISTRY.run.duringExecution` to stay consistent with the entity class
- `evolution/src/lib/core/entityRegistry.test.ts` — The `getEntityListViewMetrics('run')` test may need adjustment since cost is now excluded. Add explicit `expect(names).not.toContain('cost')` assertion.
- `evolution/src/lib/core/metricCatalog.test.ts` — The METRIC_CATALOG test (line 59) checks the global catalog, NOT entity-level — it will NOT break since we only override in RunEntity spread. No change needed here.
- `evolution/src/lib/metrics/registry.test.ts` — Legacy registry test: verify `getListViewMetrics('run')` count still > 0 (it will be, other metrics have listView:true). Update to also set listView:false on cost in METRIC_REGISTRY for consistency. Note: METRIC_REGISTRY is legacy — grep for usage to confirm nothing reads its listView. If unused, the change is harmless but keeps parity.

**Key code change (evolutionActions.ts:240-250):**
```typescript
// Replace evolution_metrics query with direct invocation cost sum
const { data: costs } = await supabase
  .from('evolution_agent_invocations')
  .select('run_id, cost_usd')
  .in('run_id', runIds);

const costMap = new Map<string, number>();
for (const row of costs ?? []) {
  costMap.set(row.run_id, (costMap.get(row.run_id) ?? 0) + Number(row.cost_usd ?? 0));
}
for (const run of typedRuns) {
  run.total_cost_usd = costMap.get(run.id) ?? 0;
}
```

**Key code change (evolutionActions.ts:317) — detail page:**
```typescript
// Replace dropped RPC with direct query
const { data: costRows } = await ctx.supabase
  .from('evolution_agent_invocations')
  .select('cost_usd')
  .eq('run_id', runId);
run.total_cost_usd = (costRows ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
```

**Verify:** Run lint, tsc, build. Write unit test for cost aggregation.

### Phase 2: Fix arena_match_count RPC (backend)
**Files modified:**
- `supabase/migrations/YYYYMMDD_fix_sync_to_arena_match_count.sql` — New migration

**Key SQL change:**
The migration must include the FULL function body (Postgres replaces the entire function). Only the INSERT VALUES clause changes — the ON CONFLICT UPDATE clause keeps its existing COALESCE/overwrite semantics since TypeScript passes total match count, not a delta.

```sql
-- In the INSERT VALUES clause, change:
--   0,  -- arena_match_count (was hardcoded)
-- To:
  COALESCE((entry->>'arena_match_count')::INT, 0),

-- ON CONFLICT UPDATE clause: KEEP EXISTING overwrite semantics (no change needed):
  arena_match_count = COALESCE((entry->>'arena_match_count')::INT, evolution_variants.arena_match_count),
```

**Rollback**: If the migration causes issues, revert by deploying a new migration that restores the hardcoded `0` on INSERT. The change is backward-compatible since `COALESCE(..., 0)` falls back to the same behavior when the JSON field is missing.

**Verify:** Run lint, tsc, build. Test F38 in `persistRunResults.test.ts` already validates the TypeScript caller passes correct values. Add a comment to F38 noting the RPC INSERT fix. An integration test against the actual RPC is the only way to fully validate the SQL change.

### Phase 3: Arena leaderboard UI (frontend)
**Files modified:**
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — Add 95% CI column + 15% cutoff indicator

**3a: Add Elo Uncertainty (95% CI) column:**
- Import `formatEloCIRange` from `@evolution/lib/utils/formatters`
- Add column header after Sigma: `95% CI`
- Add cell: `formatEloCIRange(entry.elo_score, entry.sigma) ?? '—'`
- Not sortable (derived from sigma which is already sortable)

**3b: Add top 15% cutoff indicator:**
- Import `toEloScale` from `@evolution/lib/shared/computeRatings` for consistent Elo conversion
- Compute cutoff in a `useMemo` with edge-case handling:
  ```typescript
  const { top15CutoffMu, top15CutoffElo, hasEnoughEntries } = useMemo(() => {
    const sorted = [...entries].sort((a, b) => b.mu - a.mu);
    if (sorted.length < 3) return { top15CutoffMu: 0, top15CutoffElo: 0, hasEnoughEntries: false };
    const idx = Math.max(0, Math.floor(sorted.length * 0.15) - 1);
    const cutoffMu = sorted[idx]?.mu ?? 0;
    return { top15CutoffMu: cutoffMu, top15CutoffElo: Math.round(toEloScale(cutoffMu)), hasEnoughEntries: true };
  }, [entries]);
  ```
- Only show info text when `hasEnoughEntries`: `"Top 15% cutoff: Elo {cutoffElo} (mu {cutoffMu.toFixed(1)}). Entries above this qualify for Swiss fine-ranking."`
- Import `ELIGIBILITY_Z_SCORE` from the pipeline rank module (or define as local constant `1.04` with comment referencing `rankVariants.ts`) to avoid magic numbers
- For each row, compute eligibility: `mu + ELIGIBILITY_Z_SCORE * sigma >= top15CutoffMu`
- Ineligible rows get `opacity-50` class for visual distinction (only when `hasEnoughEntries`)

**Verify:** Run lint, tsc, build. Write unit tests for cutoff computation. Manual verification on staging.

### Phase 4: Lint, build, all tests
- Run full lint + tsc + build
- Run unit tests
- Run integration tests
- Fix any issues

## Testing

### Unit Tests
- **Phase 1**: Test cost aggregation logic in `evolutionActions` — mock supabase `.from().select().in()` to return invocation rows, verify correct sum per run. Test null cost_usd handling. Test empty invocations returns 0.
- **Phase 1**: Update `metricCatalog.test.ts` — remove or adjust assertion that expects `cost` in run listView metrics (it will now have `listView: false` for runs only). Verify strategy/experiment listView metrics still include cost-derived metrics.
- **Phase 1**: Update `registry.test.ts` — verify `getEntityListViewMetrics('run')` no longer includes `cost`. Verify `getEntityListViewMetrics('strategy')` still includes `total_cost`.
- **Phase 2**: Add comment to test F38 in `persistRunResults.test.ts` noting the RPC INSERT fix. F38 already validates the TypeScript caller passes correct arena_match_count.
- **Phase 3**: Extract cutoff computation into a pure function for testability. Test edge cases: empty array (returns hasEnoughEntries=false), 1-2 entries (returns hasEnoughEntries=false), 3+ entries (returns valid cutoff), entries with sigma=0 (still eligible if mu >= cutoff).

### Integration Tests
- **Phase 2**: If integration test infrastructure supports it, test that `sync_to_arena` RPC correctly uses the passed arena_match_count on INSERT (not hardcoded 0).

### Manual Verification on Staging
- [ ] Arena leaderboard shows 95% CI column with `[lo, hi]` ranges
- [ ] Arena leaderboard hides cutoff indicator when fewer than 3 entries
- [ ] Arena leaderboard shows top 15% cutoff text and ineligible rows are visually dimmed with 3+ entries
- [ ] Runs list page shows correct non-zero costs for completed runs
- [ ] No duplicate cost column in runs list
- [ ] Newly synced arena variants show correct arena_match_count (not always 0)
- [ ] Re-syncing a variant does NOT double-count arena_match_count
- [ ] Run detail page shows correct cost (not $0.00)
- [ ] Strategy/experiment list pages still show cost-derived metric columns

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/visualization.md` — Update arena leaderboard section: document new 95% CI column and top 15% cutoff indicator
- `evolution/docs/arena.md` — Update admin UI section: note the new leaderboard columns and eligibility indicator
- `evolution/docs/data_model.md` — Update cost tracking section: note that `evolution_run_costs` VIEW and `get_run_total_cost` RPC were dropped, cost now queried from `evolution_agent_invocations` directly
- `evolution/docs/metrics.md` — Update to note that run cost `listView` is false (cost displayed via base column, not metrics column)
