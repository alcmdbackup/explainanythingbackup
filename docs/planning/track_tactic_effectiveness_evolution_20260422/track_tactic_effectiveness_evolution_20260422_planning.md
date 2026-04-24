# Track Tactic Effectiveness Evolution Plan

## Background
The evolution admin dashboard has tactic-effectiveness data scattered across five surfaces (tactics detail Metrics + By Prompt tabs, prompt detail page, experiment analysis card, AttributionCharts on entity Metrics tabs) but no unified comparison view. Researchers asking "which tactic is most effective?" today must drill into each of 24 tactic detail pages individually. The underlying data — `evolution_metrics entity_type='tactic'`, `eloAttrDelta:<agent>:<dim>` dynamic metrics, `TacticPromptPerformanceTable` — already exists; what's missing is UI wiring. See `track_tactic_effectiveness_evolution_20260422_research.md` for the full audit.

## Requirements (from GH Issue #NNN)
Help surface tactic effectiveness in the evolution admin dashboard so a researcher can answer:
- Which tactic is most effective overall (highest avg Elo, tightest CI, best cost efficiency)?
- Which tactic performs best on prompt X?
- Within strategy Y, which tactic is driving wins?
- On the arena leaderboard, which tactics dominate?
- In a variant's lineage, which tactics appear?

## Problem
Three concrete gaps block the common workflows:
1. **Tactics list has no metric columns** — ranking 24 tactics requires drilling into each individually. Strategies/experiments list pages already show metric columns via `createMetricColumns(entity)`; tactics isn't wired up because `TacticEntity.metrics` is an empty registry.
2. **Arena leaderboard exposes `generation_method` (llm/manual/seed) but not tactic/`agent_name`** — the column exists in `evolution_variants.agent_name` but `toArenaEntry()` discards it during projection.
3. **Strategy detail has no per-tactic breakdown** — `AttributionCharts` renders delta distribution but drops agent names at the label level; there's no tab that ranks tactics within a strategy's runs.

## Options Considered
- [x] **Option A: One PR for all three gaps + freebies** — Selected. Ship Gap 1 (tactics leaderboard), Gap 2 (arena tactic column), Gap 3 (strategy Tactics tab), plus Gap 5 (variants-list link to tactic detail) and Gap 9 (5000-row warn). One design pass across related UI surfaces. Rationale: all three surface the same `evolution_metrics`/`evolution_variants` data, use the same `TACTIC_PALETTE` + `createMetricColumns` pattern, and benefit from a single consistency review.
- [ ] **Option B: Three sequential PRs** — Rejected. Faster incremental delivery but costs three planning/review cycles for loosely-coupled changes that share patterns.
- [ ] **Option C: Gap 1 only + freebies** — Rejected. Leaves arena `generation_method` column misleading and strategy-level tactic comparison unanswered indefinitely.

## Preconditions (external blockers discovered during research)

Before any of the feature phases below deliver user-visible value, two independent blockers must be resolved. Both are scoped as Phase 0 of this plan so that at merge time the project's features work end-to-end.

### Blocker 1: minicomputer runner is on stale pre-Phase-4 code
Evidence (2026-04-22 22:16 UTC run `67c5942e`): `run_summary.budgetFloorConfig` still contains the 2-field pre-Phase-4 shape `{ numVariants: 9, minBudgetAfterParallelAgentMultiple: 2 }`; `parallel_dispatched` caps at 9 despite $0.50+ budgets; `sequential_dispatched` is always 0. Until the runner is redeployed to `main` (which contains Phase 4 `7ad722d6` + Phase 7b `fd0e93d7`), tactic metrics accumulate slowly because generations are artificially throttled.

**Fix — operational, no code:** Follow the redeploy recipe from `docs/planning/investigate_max_agents_evolution_20260422/investigate_max_agents_evolution_20260422_research.md` (§ Recommended fix). 11-step systemd/git-pull sequence on the minicomputer. Independent of this repo's branch.

### Blocker 2: `computeRunMetrics` is never called in production
Evidence: grep of `evolution/src/lib/pipeline/**/*.ts` (finalize path) returns zero callers of `computeRunMetrics`. Only `experimentMetrics.test.ts` and `attributionPipeline.integration.test.ts` exercise it. The 32 runs on staging with `eloAttrDelta:*` rows are all orphaned (run_id → deleted `evolution_runs` row). No live run has ever had attribution metrics written against it. Zero strategies and zero experiments on staging have propagated attribution rows. `AttributionCharts` consequently renders nothing on any entity page today.

**Concrete Fix — code change in this repo, folded into this project's PR:**

**Important — two realizations uncovered during plan review:**

1. `computeRunMetrics` as it exists today returns an in-memory `RunMetricsWithRatings` bag; its helper `computeEloAttributionMetrics` populates in-memory entries at `experimentMetrics.ts:431,450` but never calls `writeMetric`. Just calling the function is a no-op for persistence.
2. `SHARED_PROPAGATION_DEFS` in `registry.ts:35-107` is a static array keyed by exact `sourceMetric` string; `propagateMetrics` in `persistRunResults.ts:444-478` filters rows by `metric_name === def.sourceMetric`. Dynamic prefixes like `eloAttrDelta:<agent>:<dim>` are an open set generated per-run — they cannot be enumerated at def-time, and option (a) "extend `SHARED_PROPAGATION_DEFS`" is mechanically impossible without refactoring the propagation layer to support prefix-match.

**Therefore committing to option (b) — write at all three entity levels directly from inside the compute step, mirroring `computeTacticMetricsForRun`'s pattern:**

- [x] Extend `computeRunMetrics` signature in `evolution/src/lib/metrics/experimentMetrics.ts:267`:
  ```typescript
  export async function computeRunMetrics(
    runId: string,
    db: SupabaseClient,
    opts?: { strategyId?: string; experimentId?: string },
  ): Promise<RunMetricsWithRatings>
  ```
  Pass `strategyId` and `experimentId` from the caller. These are already available on the `run` row in `persistRunResults.ts`.
- [x] Extend `computeEloAttributionMetrics` (line 354-458) to directly `writeMetric` each produced `eloAttrDelta:<agent>:<dim>` and `eloAttrDeltaHist:<agent>:<dim>:<lo>:<hi>` row at `entity_type='run'` (always) AND at `entity_type='strategy'`/`entity_type='experiment'` (when the corresponding opt is set). Use the existing `writeMetric(db, entityType, entityId, metricName, value, 'at_finalization', {...})` helper from `evolution/src/lib/metrics/writeMetrics.ts` (line 86) — same helper tactic metrics already use internally.
- [x] Wire into `evolution/src/lib/pipeline/finalize/persistRunResults.ts` at ~line 400 inside the existing finalize try/catch (matching tactic-metrics placement at line 410-411):
  ```typescript
  // Attribution metrics — run/strategy/experiment eloAttrDelta:* rows.
  // Gated by EVOLUTION_EMIT_ATTRIBUTION_METRICS (default 'true') so ops can
  // disable without a revert PR if a regression surfaces.
  if (process.env.EVOLUTION_EMIT_ATTRIBUTION_METRICS !== 'false') {
    try {
      const { computeRunMetrics } = await import('../../metrics/experimentMetrics');
      await computeRunMetrics(runId, db, {
        strategyId: run.strategy_id ?? undefined,
        experimentId: run.experiment_id ?? undefined,
      });
    } catch (err) {
      logger?.warn('Attribution metric emission failed (non-fatal)', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  ```
  The try/catch is required — finalize must not abort if attribution writes fail (regression safety).
- [x] Verify stale cascade still works: migration `20260418000004_stale_trigger_elo_attr_delta.sql` fires when a variant's `mu`/`sigma` change. It marks matching `eloAttrDelta:*` rows stale at run/strategy/experiment level. Once option (b) populates those rows, the existing trigger picks them up. No new trigger needed.
- [x] Document the eventual-consistency caveat in `evolution/docs/metrics.md`: "Propagated `eloAttrDelta:*` / `eloAttrDeltaHist:*` rows at strategy/experiment level are written once per run finalization. When arena matches re-rate a variant post-run, the stale trigger flags the rows but there is no automatic recompute path — they refresh only on the next run in that strategy/experiment."
- [x] Add `evolution/src/lib/metrics/attributionFinalization.integration.test.ts`:
  - Happy path: seed a run with `generate_from_previous_article` variants spanning ≥2 tactics (requires `createTestTacticMetric` factory + `agent_invocation_id` wiring — see Test Factories below); call `finalizeRun`; assert `eloAttrDelta:<agent>:<tactic>` rows exist at `entity_type IN ('run','strategy','experiment')`. Flip a variant's `mu`/`sigma`; assert stale cascade marks rows at all three levels.
  - **Failure path** (required — regression guard): mock `computeRunMetrics` to reject with a DB error; assert `finalizeRun` still transitions the run to `status='completed'`, a WARN-level log is emitted with the error message, and `evolution_runs.error_message` remains null.
  - **Kill-switch path**: set `EVOLUTION_EMIT_ATTRIBUTION_METRICS='false'`; call `finalizeRun`; assert no `eloAttrDelta:*` rows written AND no WARN log emitted.

**Test factory prerequisites for Blocker 2C:**
- [x] Add `createTestTacticMetric(tacticId, overrides)` to `evolution/src/testing/evolution-test-helpers.ts` — returns a `MetricRow` seed for `evolution_metrics` at `entity_type='tactic'`. Name must use `[TEST]` prefix on `tactic.name` so staging's "Hide test content" filter works.
- [x] Extend `createTestVariant()` to optionally accept `agent_invocation_id` + a corresponding `createTestInvocation()` that populates `execution_detail.strategy`. Required so the attribution-dimension grouping in `computeEloAttributionMetrics` has data to group by.

**Estimated size:** ~40 LOC (Part A + call site + kill switch) + ~50 LOC (`writeMetric` per-row in `computeEloAttributionMetrics`) + ~40 LOC (test factories) + ~120 LOC (integration test with all 3 paths) ≈ **~250 LOC**.

Both blockers must be resolved before the project's Verification section can pass. Blocker 1 is gated on ops (outside this PR); Blocker 2 is a code change inside this PR. Plan assumes both land before merge.

## Phased Execution Plan

### Phase 0: Resolve blockers
- [x] **Blocker 1** — redeploy minicomputer to current `main`. Verified 2026-04-22 23:39 UTC on run `d790381c-8596-4977-81b3-21477c286b5b`: dispatch log carries `(parallel batch)` suffix, `safetyCap=100`, `topUpEnabled=true`, `floor_config` no longer contains `numVariants`, parallel dispatched 100 (vs 9 pre-redeploy).
- [x] **Blocker 2A** — wire `computeRunMetrics` into `persistRunResults.ts` finalize path.
- [x] **Blocker 2B** — ensure propagation of `eloAttrDelta:*` / `eloAttrDeltaHist:*` to strategy + experiment entity rows.
- [x] **Blocker 2C** — integration test for attribution finalization + stale cascade.
- [ ] Smoke check: trigger a fresh run post-redeploy; verify `AttributionCharts` now renders on the run, strategy, and experiment detail pages.

### Phase 1: Foundation — TacticEntity metrics registry
Populate the missing metric registry so `createMetricColumns('tactic')` has something to render.

- [x] Edit `evolution/src/lib/core/entities/TacticEntity.ts:31-37`: replace empty `metrics: { duringExecution: [], atFinalization: [], atPropagation: [] }` with the 8 metric definitions copied from the flat registry at `evolution/src/lib/metrics/registry.ts:213-228`. Each entry uses `compute: () => null` (values come from `evolution_metrics`).
- [x] Set `listView: true` on 5 entries: `avg_elo`, `avg_elo_delta`, `win_rate`, `total_variants`, `run_count`. Leave `best_elo`, `total_cost`, `winner_count` as `listView: false` to avoid row-width bloat.
- [x] Add unit test `evolution/src/lib/core/entities/TacticEntity.test.ts` asserting `TacticEntity.metrics.atFinalization` has 8 entries with correct `listView` flags.
- [x] Verify `getEntity('tactic').metrics` returns the same shape as `getEntity('strategy').metrics` via the existing entity-registry test.

### Phase 2: Tactics list leaderboard — Gap 1
Turn `/admin/evolution/tactics` into a sortable leaderboard.

- [x] Extend `listTacticsAction` in `evolution/src/services/tacticActions.ts`:
  - Add optional input params: `sortKey?: string` (one of the 5 listView metric names + identity columns), `sortDir?: 'asc' | 'desc'`, `search?: string` (ilike on `name`).
  - After fetching tactic rows, call `getMetricsForEntities(db, 'tactic', tacticIds, listViewMetricNames)` from `evolution/src/lib/metrics/readMetrics.ts`; attach returned rows as `metrics: MetricRow[]` on each tactic.
  - Apply sort: server-side for identity columns (via `.order()`); for metric-key sorts, do in-memory sort on the attached `metrics` array after the batch fetch (since `evolution_metrics` is a separate table — a JS-side sort on ≤200 already-attached rows is cheaper than a cross-table JOIN + window query). Null metrics (unproven tactics) sort last regardless of direction — explicitly test this.
  - Apply `search` via `.ilike('name', `%${escapeIlike(search)}%`)` using the same escape helper as `listPromptsAction` (`arenaActions.ts:349-352`).
- [x] Extend the `EvolutionTacticRow` return type to include `metrics: MetricRow[]`.
- [x] Edit `src/app/admin/evolution/tactics/page.tsx:23-46`:
  - Import `createMetricColumns` from `@evolution/lib/metrics/metricColumns`; append `...createMetricColumns<EvolutionTacticRow>('tactic')` to the columns array. Generic renderer handles CI suffix (`[lo, hi]` for Elo-like, `± half` for percent) and `—` fallback for unproven tactics.
  - Add `FilterDef` entry for `search` (text input) alongside existing `status` / `agentType` filters.
  - Add sort state (`useState<{ key: string; dir: 'asc'|'desc' }>`); pass `sortKey`/`sortDir` into `listTacticsAction` via `loadData`; wire `onSort` to `EntityListPage`'s controlled-sort props (the supported mode; grep strategies/page.tsx for reference — if strategies list doesn't currently expose sort either, upgrade it in the same PR for consistency).
- [x] Verify in dev: unproven tactics (21 of 24 on staging) render `—` for metric cells; 3 populated tactics show values with CI; sort by Avg Elo desc puts populated tactics on top with nulls at bottom; search filter matches name prefix case-insensitively.
- [x] Freebie — Gap 9: add `console.warn` + inline UI banner (not just console) at `evolution/src/services/tacticPromptActions.ts:41` when `data.length === 5000` — researcher hitting the cap needs visible signal. Banner surfaces via the return payload (`{ items, hitCap: boolean }`); table renders banner above when true.

### Phase 3: Arena tactic column — Gap 2
Expose tactic on the arena leaderboard.

- [x] Edit `evolution/src/services/arenaActions.ts:48-68`: add `agent_name: string | null` to the `ArenaEntry` interface.
- [x] Edit `arenaActions.ts:11-35` (inside `toArenaEntry`): add `agent_name: row.agent_name as string | null` so the field is projected through the DTO.
- [x] Edit `src/app/admin/evolution/arena/[topicId]/page.tsx:51`: add `'agent_name'` to the `SortKey` union type.
- [x] Edit `[topicId]/page.tsx:222,277`: insert a "Tactic" `<th>` column before "Method"; in the row body render the tactic with a colored dot from `TACTIC_PALETTE` (`evolution/src/lib/core/tactics/index.ts:53-104`) matching `TacticPromptPerformanceTable.tsx:66-69` styling. Wrap in `<Link href={\`/admin/evolution/tactics/\${resolveTacticId(entry.agent_name)}\`}>` — link directly to the tactic detail page by UUID, not a filtered list. Use a small helper `resolveTacticId(name)` that maps tactic name → UUID from a fetched list (arena actions already return tactic IDs; if not, add a `tactic_id` field to `ArenaEntry` projection in `toArenaEntry`).
- [x] If arena actions don't currently join `evolution_tactics`: add `tactic_id: string | null` to `ArenaEntry` via a sub-select `(SELECT id FROM evolution_tactics WHERE name = v.agent_name)` or in-memory lookup after batch-fetching the tactic registry.
- [x] Handle null `agent_name` (seed rows, manual entries) by rendering `—`; keep the existing `★ seed` badge for seeds.
- [x] Freebie — Gap 5: on `src/app/admin/evolution/variants/page.tsx` (variants list), wrap the `agent_name` cell in a link to `/admin/evolution/tactics/${tacticId}` using the same resolve pattern. 5-10 LOC.

### Phase 4: Strategy Tactics tab — Gap 3
Add a "Tactics" tab to strategy detail that ranks tactics within the strategy's runs.

**Depends on Phase 0 Blocker 2** — the tab reads `evolution_metrics entity_type='strategy' AND metric_name LIKE 'eloAttrDelta:%'`, which will be empty until `computeRunMetrics` + propagation is wired.

- [x] Create `evolution/src/services/tacticStrategyActions.ts` (new file, sibling of `tacticPromptActions.ts`).
  - [x] Export `getStrategyTacticBreakdownAction({ strategyId })`.
  - [x] Query 1 — pull pre-aggregated delta + CI from `evolution_metrics` for `entity_type='strategy' AND entity_id=$1 AND metric_name LIKE 'eloAttrDelta:%'`. Parse tactic name from the suffix. Yields `avgEloDelta`, `ciLower`, `ciUpper`, `n`. Rows are populated by Phase 0 Blocker 2B — eventual-consistency caveat applies (rows may be flagged stale after arena drift; no runtime recompute; fresh values only on next run in this strategy).
  - [x] Query 2 — pull deterministic aggregates from `evolution_variants` for the same strategy. **Cannot use PG `COUNT(*) FILTER` syntax via PostgREST.** Follow `tacticPromptActions.ts:73-90` pattern: `.select('agent_name, is_winner, cost_usd')`, `.eq('run_id', IN subquery)` then aggregate in JS:
    ```typescript
    const grouped = groupBy(rows, r => r.agent_name);
    for (const [tactic, variants] of grouped) {
      results.set(tactic, {
        variantCount: variants.length,
        totalCost: variants.reduce((s, v) => s + (v.cost_usd ?? 0), 0),
        winnerCount: variants.filter(v => v.is_winner).length,
      });
    }
    ```
  - [x] Merge Query 1 + Query 2 keyed by tactic name into `{ tacticName, avgEloDelta, ciLower, ciUpper, n, variantCount, totalCost, winnerCount, winRate }`; sort by `avgEloDelta desc`. If a tactic appears in Query 2 but not Query 1 (produced variants but attribution metric missing — possible for pre-Blocker-2 historical runs), include it with `avgEloDelta: null, ciLower: null, ciUpper: null, n: variantCount` and render `—` in the Elo Delta column.
- [x] Create `evolution/src/components/evolution/tabs/TacticStrategyPerformanceTable.tsx`. Mirror `TacticPromptPerformanceTable.tsx` layout; columns: Tactic (colored dot + name, linked to `/admin/evolution/tactics/[id]`), Variants, Elo Delta with `[ci_lower, ci_upper]` suffix via `formatEloCIRange`, Win Rate, Cost.
- [x] Edit `src/app/admin/evolution/strategies/[strategyId]/page.tsx:55-62`: add `{ id: 'tactics', label: 'Tactics' }` to the TABS array between Metrics and Runs. Render `<TacticStrategyPerformanceTable strategyId={strategyId} />` inside the tab body.
- [x] Add a caveat subheader on the tab: "Covers variant-producing tactics only — `eloAttrDelta` is emitted by `generate_from_previous_article` runs. Swiss/merge iterations are excluded (no attribution dimension)."

### Phase 5: Complementary polish
Small fixes that belong with this PR's theme.

**Depends on Phase 0 Blocker 2** for the `StrategyEffectivenessChart` label fix — the chart doesn't render until attribution rows exist on strategies/experiments.

- [x] Edit `evolution/src/components/evolution/charts/StrategyEffectivenessChart.tsx:114-130` (`extractStrategyEntries`): change bar labels from `<dim>` to `<agent> / <dim>` so bars disambiguate when multiple agents share a dimension value. This uncovers the current rendering ambiguity without changing the underlying data.
- [x] Add unit test for `extractStrategyEntries` in `evolution/src/components/evolution/charts/StrategyEffectivenessChart.test.ts` (new): assert the new label format on single-agent + multi-agent inputs, CI passthrough, null-CI handling.
- [x] Update E2E `src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-effectiveness-chart.spec.ts` to assert the label text contains `/` (i.e., new `agent / dim` format). Seeded-data setup may need updating to produce a multi-agent attribution row so the disambiguation is observable.
- [x] Update `evolution/docs/visualization.md` tactics-list section: describe the new metric columns + server-side sort behavior + search filter.
- [x] Update `evolution/docs/arena.md`: note the Tactic column + direct link-to-tactic-by-id UX.
- [x] Update `evolution/docs/strategies_and_experiments.md`: describe the strategy-detail Tactics tab and its data sources (pre-aggregated attribution metrics + live variant aggregates), with the eventual-consistency caveat for post-run arena drift.
- [x] Update `evolution/docs/metrics.md`: (a) note `createMetricColumns('tactic')` wiring + `TacticEntity.metrics` population; (b) in the Attribution metric § document `computeRunMetrics` is now called at finalization with the `EVOLUTION_EMIT_ATTRIBUTION_METRICS` kill switch; (c) document the eventual-consistency note for propagated rows.
- [x] Update `evolution/docs/entities.md`: note `TacticEntity.metrics` registry is now populated, reconciling with `METRIC_REGISTRY['tactic']`. Flag the dual-registry duplication as a pending follow-up (not new with this PR — existing tech debt).
- [x] Update `evolution/docs/agents/overview.md`: note the Attribution Dimension (Phase 5) section that `computeEloAttributionMetrics` output now persists to `evolution_metrics` (previously only in-memory).
- [x] Update `evolution/docs/reference.md`: add `tacticStrategyActions.ts` + `TacticStrategyPerformanceTable.tsx` to the file index.

## Testing

### Unit Tests
- [x] `evolution/src/lib/core/entities/TacticEntity.test.ts` (new) — assert 8 metrics registered, 5 with `listView: true`.
- [x] `evolution/src/services/tacticActions.test.ts` — extend existing test: `listTacticsAction` returns rows with `metrics: MetricRow[]` attached; assert server-side sort for identity columns + JS-side sort for metric keys with nulls sorted last in both asc/desc; search filter escapes `%_\\` correctly; covers 100-ID chunk path in `getMetricsForEntities`.
- [x] `evolution/src/services/tacticStrategyActions.test.ts` (new) — assert `eloAttrDelta:*` parsing, JS-side variant aggregate (using `reduce` pattern, no PG `FILTER` syntax), merge of Query 1 + Query 2 with tactics-in-variants-but-missing-attribution case (renders `avgEloDelta: null`), sort-by-delta-desc, empty-strategy handling (returns `[]`).
- [x] `evolution/src/services/tacticPromptActions.test.ts` — extend to assert `console.warn` + `{ hitCap: true }` flag fire when `data.length === 5000`.
- [x] `evolution/src/services/arenaActions.test.ts` — assert `toArenaEntry` projects `agent_name` and resolved `tactic_id`; null-handling for seed/manual rows.
- [x] `evolution/src/components/evolution/charts/StrategyEffectivenessChart.test.ts` (new) — assert `extractStrategyEntries` returns entries with `agent / dim` labels (not just `dim`); covers single-agent, multi-agent, and null-CI inputs.
- [x] `evolution/src/lib/metrics/experimentMetrics.test.ts` — extend to cover the new `computeRunMetrics(runId, db, { strategyId, experimentId })` signature: with `opts` populated, assert `writeMetric` is called for run/strategy/experiment rows; without `opts`, only run-level rows are written.

### Integration Tests
- [x] `evolution/src/lib/metrics/attributionFinalization.integration.test.ts` (new, Blocker 2C) — seed a run with `generate_from_previous_article` variants spanning ≥2 tactics; call `finalizeRun`; assert `eloAttrDelta:<agent>:<tactic>` + `eloAttrDeltaHist:<agent>:<tactic>:<bucket>` rows exist at `entity_type IN ('run','strategy','experiment')`. Flip a variant's `mu`/`sigma`; assert stale cascade marks rows at all three levels.
- [x] `src/__tests__/integration/evolution-tactic-leaderboard.integration.test.ts` (new) — seed 3 tactics with variants across 2 runs, call `listTacticsAction`, verify metric rows attached; flip a variant's `mu`/`sigma`, confirm tactic metrics update on next read (covers live read path).

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-tactics-leaderboard.spec.ts` (new) — load `/admin/evolution/tactics`; assert 5 metric columns present; click "Avg Elo" header; verify descending order matches a direct SQL query against the staging fixture.
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-arena-tactic.spec.ts` (new) — open an arena topic with variants from ≥2 tactics; assert Tactic column renders colored dots; click sort by tactic; click a tactic name → lands on tactics list filtered.
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-tactics-tab.spec.ts` (new) — open a strategy with ≥2 tactics in its runs; click Tactics tab; assert rows present, sorted by Elo Delta desc; click a tactic → lands on tactic detail.
- [x] Extend `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — update existing assertions to account for new Tactic column position.

### Manual Verification
- [ ] Open `/admin/evolution/tactics` — leaderboard ranks by Avg Elo desc; unproven tactics render `—` with CI cells blank.
- [ ] Sort by Win Rate — top row has highest winner/variant ratio.
- [ ] Open any arena topic — Tactic column shows colored tactic names; click a tactic → jumps to tactics list filtered.
- [ ] Open a strategy with multiple tactics in its runs — Tactics tab lists them ranked by Elo Delta with CI.
- [ ] Open strategy Metrics tab — `StrategyEffectivenessChart` bar labels now read `<agent> / <dim>` instead of ambiguous `<dim>` alone.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `admin-evolution-tactics-leaderboard.spec.ts` — leaderboard rendering + sort. (4/4 passed locally)
- [x] `admin-evolution-arena-tactic.spec.ts` — arena Tactic column + navigation. (3/3 passed locally)
- [x] `admin-evolution-strategy-tactics-tab.spec.ts` — strategy detail Tactics tab. (3/3 passed locally)
- [x] Regression: `admin-arena.spec.ts` existing selectors still pass with column shift. (2/2 passed locally)

### B) Automated Tests
- [x] `npm run test:unit -- --testPathPattern="(TacticEntity|tacticActions|tacticStrategyActions|arenaActions|StrategyEffectivenessChart)"` — all pass.
- [x] `npm run test:integration -- --testPathPattern="(evolution-tactic-leaderboard|attributionFinalization)"` — passes against real DB. **Prerequisite**: `supabase db reset` locally to ensure migration `20260418000004` is applied (otherwise `evolution_metrics` dynamic-prefix inserts get rejected).
- [x] `npm run test:integration:evolution` — specific evolution-tier integration runner; confirms both new integration tests are picked up.
- [x] `npm run test:esm` — no evolution files live in ESM tier today, but run to confirm no regressions from shared metric-helper changes.
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-tactics-leaderboard.spec.ts src/__tests__/e2e/specs/09-admin/admin-evolution-arena-tactic.spec.ts src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-tactics-tab.spec.ts src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-effectiveness-chart.spec.ts` — 3 new + 1 updated chart spec pass.
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — regression test: existing arena spec passes with new Tactic column added (column-index selectors updated in spec). (2/2 passed locally)
- [x] `npm run lint && npm run tsc && npm run build` — clean.

### C) Staging validation gate (required before opening PR)
- [ ] Deploy branch to staging (Vercel preview) after Phase 0 Blocker 2 code lands.
- [ ] Trigger 2-3 real evolution runs via admin UI on strategies with ≥2 tactics in their iteration guidance.
- [ ] Confirm (a) no finalize errors in logs, (b) `evolution_metrics` rows at `entity_type IN ('strategy','experiment')` with `metric_name LIKE 'eloAttrDelta:%'` are populated, (c) manually update a variant's `mu`/`sigma` and assert `mark_elo_metrics_stale` flags the corresponding attribution rows.
- [ ] Confirm `AttributionCharts` now renders on the strategy and experiment detail pages for these runs.
- [ ] Only after staging validation passes, open PR to main.

### D) Rollback plan
- [ ] **Blocker 2 kill switch**: set `EVOLUTION_EMIT_ATTRIBUTION_METRICS=false` in Vercel/minicomputer env. Finalize path skips `computeRunMetrics`; attribution rows stop being written but existing rows remain. No revert PR needed; no data loss.
- [ ] **UI leaderboard issue**: if Phase 2 breaks the tactics list render (e.g., `createMetricColumns` throws on unexpected metric shape), the list page is isolated behind `/admin` auth — revert the `createMetricColumns` addition with a 1-line removal. Unrelated admin routes unaffected.
- [ ] **Arena column issue**: if Phase 3 breaks arena leaderboard rendering, fallback is to `agent_name: null` → `—` for all rows (visually noisy but non-breaking). No revert needed.
- [x] Document all three rollback levers in `evolution/docs/reference.md` under a new "Kill switches / feature flags" section.

## Documentation Updates
- [x] `evolution/docs/visualization.md` — tactics list page: describe 5 metric columns (avg_elo, avg_elo_delta, win_rate, total_variants, run_count) + click-to-sort + CI suffix rendering.
- [x] `evolution/docs/arena.md` — leaderboard: describe new Tactic column (colored dot + linkable) placed before Method; null-handling for seed/manual rows.
- [x] `evolution/docs/strategies_and_experiments.md` — strategy detail: describe new Tactics tab, its dual-query backend (`eloAttrDelta:*` metrics for delta+CI, variant aggregate for cost/variant_count/winner_count), sort by Elo Delta desc.
- [x] `evolution/docs/metrics.md` — `Tactic Metrics` section: note `createMetricColumns('tactic')` now wired on the list page; `TacticEntity.metrics` populated.
- [x] `evolution/docs/reference.md` — update file index with new `tacticStrategyActions.ts` + `TacticStrategyPerformanceTable.tsx`.

## Review & Discussion
_Populated by /plan-review with agent scores, reasoning, and gap resolutions._
