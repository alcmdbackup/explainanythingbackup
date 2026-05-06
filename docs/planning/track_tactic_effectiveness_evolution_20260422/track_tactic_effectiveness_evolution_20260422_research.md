# Track Tactic Effectiveness Evolution Research

## Problem Statement
Is there any place where you can currently track the relative effectiveness of different tactics in the evolution admin dashboard? Audit existing surfaces, identify gaps, and propose concrete follow-ups so a researcher can easily answer "which tactic works best?" at the overall, per-prompt, per-strategy, and per-run level.

## Requirements (from GH Issue #NNN)
- Enumerate every admin-dashboard surface that exposes tactic-effectiveness data (metrics, charts, tables, filters).
- Map the underlying data model: where tactic-effectiveness is persisted, how it is computed, how it stays fresh.
- Walk the user journey for key questions — overall best tactic, best-for-prompt, best-within-strategy, best-in-arena-leaderboard, in-lineage.
- Rank observed gaps by impact × effort and propose concrete remediation (file:line + LOC estimates) for the top items.
- Deliver the audit as a research document; defer implementation to follow-up projects.

## High Level Summary

**Yes — five distinct surfaces track tactic effectiveness today, but there is no unified leaderboard.** The data infrastructure is solid (`evolution_metrics` with `entity_type='tactic'`, `eloAttrDelta:<agent>:<dimension>` dynamic metrics, `run_summary.tacticEffectiveness`, `TacticPromptPerformanceTable`), yet the UI forces a drill-into-each-tactic workflow for global comparison and omits tactic entirely from the arena leaderboard (`generation_method` is shown instead of `agent_name`). Three high-ratio fixes were identified — a tactics-list leaderboard (~100 LOC), an arena-column swap (~20 LOC), and a strategy→Tactics tab (~100 LOC) — each trivially wired from existing components. Two data-quality observations temper the picture: staging has rows for only **3 of 24 tactics** in `evolution_metrics entity_type='tactic'`, and attribution metrics populate only a single dimension value (`lexical_simplify`) — the leaderboard logic works; the data needs broader coverage.

## What Exists Today

### Five Surfaces That Track Tactic Effectiveness

| # | Surface | File (primary) | Scope | Shows |
|---|---------|----------------|-------|-------|
| 1 | `/admin/evolution/tactics/[id]` → **Metrics tab** | `src/app/admin/evolution/tactics/[tacticId]/TacticDetailContent.tsx` (via `EntityMetricsTab`) | Cross-run, **one tactic** | 8 metrics from `evolution_metrics`: `avg_elo` (CI), `avg_elo_delta` (CI), `win_rate` (CI), `best_elo`, `total_variants`, `total_cost`, `run_count`, `winner_count` |
| 2 | `/admin/evolution/tactics/[id]` → **By Prompt tab** | Same page; uses `TacticPromptPerformanceTable` scoped by `tacticId` | One tactic × all prompts | Per-prompt: Runs, Variants, Avg Elo, Elo Delta, Best Elo, Winners, Cost (sorted by Avg Elo desc, limit 5000) |
| 3 | `/admin/evolution/prompts/[id]` | `src/app/admin/evolution/prompts/[promptId]/page.tsx:88` | All tactics × **one prompt** | Same `TacticPromptPerformanceTable` scoped by `promptId` — best organic-discovery surface |
| 4 | `/admin/evolution/experiments/[id]` → **Analysis** | `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx:102-109` | All tactics × experiment's prompt | Same table, scoped by experiment.prompt_id |
| 5 | Run / Strategy / Experiment detail → **Metrics tab → `AttributionCharts`** | `evolution/src/components/evolution/tabs/AttributionCharts.tsx` (embedded on `runs/[id]/page.tsx:118`, `strategies/[id]/page.tsx:135`, `experiments/[id]/ExperimentDetailContent.tsx:103`) | Within one entity | `StrategyEffectivenessChart` — horizontal bar of mean ELO delta per (agent, dimension) with 95% CI whiskers; `EloDeltaHistogram` — 10-ELO buckets |

### Data Model

| Location | What it stores | Granularity | Written by | Stale-cascaded? |
|---|---|---|---|---|
| `evolution_tactics` table | Identity only (name, label, agent_type, category, is_predefined, status) | 24 static tactics | `evolution/scripts/syncSystemTactics.ts` | N/A (lookup table) |
| `evolution_metrics entity_type='tactic'` | 8 aggregate metrics per tactic | Cross-run, single tactic | `computeTacticMetrics()` at run finalization (`evolution/src/lib/metrics/computations/tacticMetrics.ts`) | **No** — recomputed fresh per-run only; arena-driven drift does NOT mark stale |
| `evolution_metrics` rows with `metric_name LIKE 'eloAttrDelta:%'` | Per-(agent, dimension) mean ELO delta + 95% CI | Per-(run, agent, dimension); propagated to strategy/experiment | `computeEloAttributionMetrics()` at finalization (`experimentMetrics.ts:354-458`) | **Yes** — trigger `mark_elo_metrics_stale()` per migration `20260418000004` |
| `evolution_metrics` rows with `metric_name LIKE 'eloAttrDeltaHist:%'` | Fraction of invocations in each 10-ELO bucket | Per-(run, agent, dimension, bucket) | `computeEloAttributionMetrics()` at finalization | **Yes** — same trigger |
| `run_summary.tacticEffectiveness` (JSONB) | Per-tactic `{count, avgElo, seAvgElo}` Welford snapshot | Per-(tactic, run) | `buildRunSummary()` at finalization | N/A (immutable snapshot) |
| `evolution_variants.agent_name` + `.elo_score` + `.is_winner` + `.cost_usd` | Ground truth for any tactic aggregate | Per-variant | Pipeline finalization | Trigger marks dependent metrics stale on `mu`/`sigma` change |

### Dimension Source for Attribution Metrics

`computeEloAttributionMetrics()` reads `invocation.execution_detail.strategy` (the tactic name passed to `GenerateFromPreviousArticleAgent`). Non-generate agents (swiss, merge) return `null` from `Agent.getAttributionDimension()` and are excluded. Colons in dimension values are rejected to preserve metric-name parsing.

### Staging Reality Check

- `evolution_metrics` `entity_type='tactic'`: **only 18 rows across 3 of 24 tactics** (6 of 8 metric families populated). The other 21 tactics render `—` in detail tabs because `computeTacticMetrics()` writes only for tactics that produced variants in at least one completed run.
- Attribution metric families: 32 rows of `eloAttrDelta:*` and 64 rows of `eloAttrDeltaHist:*` — all single-agent (`generate_from_previous_article`), single-dimension (`lexical_simplify`). No breadth yet.
- `evolution_variants` coverage: **260 unique (tactic, prompt) cells populated out of ~2,548 possible** (26 distinct agent_names × 98 prompts) — 10.2% density. Two prompts hold 66% of all arena variants.

## Critical Gaps (Ranked by Impact × Effort)

### Gap 1 — Tactics list has no metric columns (HIGH impact, LOW effort)

**Problem.** `/admin/evolution/tactics/page.tsx:23-46` renders six identity columns only (name, label, agent_type, category, type, status). There is no way to rank all 24 tactics side-by-side by `avg_elo`, `win_rate`, or `total_cost` from a single view. To compare, a researcher drills into each tactic individually — up to 24 clicks for a global ranking. Strategies (`strategies/page.tsx:57`) and experiments (`experiments/page.tsx:206`) already render `createMetricColumns(entity)` for the same pattern; tactics simply isn't wired up.

**Root cause.** `TacticEntity.metrics` (`evolution/src/lib/core/entities/TacticEntity.ts:31-37`) declares `{ duringExecution: [], atFinalization: [], atPropagation: [] }` — an empty registry. The metric definitions live in the parallel flat registry (`evolution/src/lib/metrics/registry.ts:213-228`). The dual-registry divergence (documented in `entityRegistry.ts`) was never reconciled for tactics.

**Concrete fix (~100 LOC).**
1. `evolution/src/lib/core/entities/TacticEntity.ts:31-37` — populate `metrics.atFinalization` with the 8 tactic metric defs (copied from `registry.ts:213-228`); set `listView: true` on `avg_elo`, `avg_elo_delta`, `win_rate`, `total_variants`, `run_count`.
2. `evolution/src/services/tacticActions.ts` — extend `listTacticsAction` to batch-fetch `evolution_metrics` rows keyed by `entity_type='tactic'` + the 5 listView metric names via `getMetricsForEntities()`, pivot onto each row.
3. `src/app/admin/evolution/tactics/page.tsx:23-46` — append `...createMetricColumns<EvolutionTacticRow>('tactic')` to the columns array, import `createMetricColumns` from `@evolution/lib/metrics/metricColumns`.
4. Unproven tactics render as `—` automatically via `metricColumns.tsx:40-48` fallback.

**Verification.** Load page; assert 5 new sortable columns; click `avg_elo` desc; top row has the highest-Elo tactic (should be the one with highest mean in `evolution_metrics`).

### Gap 2 — Arena leaderboard shows `generation_method` not tactic (HIGH impact, LOW effort)

**Problem.** `src/app/admin/evolution/arena/[topicId]/page.tsx:222,277` exposes `entry.generation_method` (`'llm' | 'manual' | 'seed'`) in the Method column. The three-way coarse split hides which of the 24 tactics each row came from, so "which tactic dominates this arena topic?" is unanswerable without leaving the page.

**Root cause.** The column exists in `evolution_variants.agent_name` and is read by `computeTacticMetrics`/`listVariantsAction`, but `toArenaEntry()` (`evolution/src/services/arenaActions.ts:11-35`) discards `agent_name` during DTO projection. The leaderboard query `SELECT *` fetches it; the transformer drops it.

**Concrete fix (~20 LOC).**
1. `evolution/src/services/arenaActions.ts:54` — add `agent_name: string | null` to `ArenaEntry` interface.
2. `arenaActions.ts:20` (inside `toArenaEntry`) — add `agent_name: row.agent_name as string | null`.
3. `src/app/admin/evolution/arena/[topicId]/page.tsx:51` — add `'agent_name'` to the `SortKey` union.
4. `[topicId]/page.tsx:222,277` — add a "Tactic" column header before "Method"; render `entry.agent_name ?? '—'` with a `TACTIC_PALETTE[entry.agent_name]` colored dot matching `TacticPromptPerformanceTable.tsx:66-69` styling; wrap in a `<Link href={\`/admin/evolution/tactics?search=\${entry.agent_name}\`}>`.
5. Seed rows (`generation_method='seed'`) render `—`; keep existing `★ seed` badge.

**Optional extension (~30 LOC, Gap 2.5).** Add tactic filter to arena leaderboard: `getArenaEntriesAction` accepts `tacticName?: string`, `.eq('agent_name', tacticName)` when provided; a dropdown on `[topicId]/page.tsx:195` lets the researcher scope the leaderboard to one tactic.

**Verification.** Load any arena topic with multiple tactics; Tactic column renders colored names; click sorts by agent_name; clicking tactic lands on that tactic's detail page.

### Gap 3 — Strategy detail has no per-tactic breakdown (MEDIUM impact, MEDIUM effort)

**Problem.** `src/app/admin/evolution/strategies/[strategyId]/page.tsx:135` renders `AttributionCharts` inside the Metrics tab. `StrategyEffectivenessChart` extracts only the `dimension` portion of `eloAttrDelta:<agent>:<dimension>` (`StrategyEffectivenessChart.tsx:114-130`) and **drops the agent name** at render time, so bars show dimension labels without tactic attribution. There is no "Tactics" tab on strategy detail, so "within strategy Y, is tactic A or tactic B winning?" requires either drilling into each run's Variants tab or navigating to `/admin/evolution/tactics/[tacticId]` (which is global, not strategy-scoped).

**Root cause.** `evolution_metrics` has no `strategy_id` column — tactic metrics are persisted globally per tactic, not per (strategy, tactic). `TacticPromptPerformanceTable` groups by `(agent_name, prompt_id)`; there is no analogous `(agent_name, strategy_id)` grouping action.

**Concrete fix (~100 LOC).**
1. `evolution/src/services/tacticPromptActions.ts` — clone `getTacticPromptPerformanceAction` into `getTacticStrategyPerformanceAction`. Swap the grouping from `(agent_name, prompt_id)` to `(agent_name, strategy_id)`, filter on `evolution_runs.strategy_id = $1`.
2. `evolution/src/components/evolution/tabs/TacticPromptPerformanceTable.tsx` — refactor to share grouping rendering; alternatively introduce a thin `TacticBreakdownTable` that takes pre-grouped rows.
3. `src/app/admin/evolution/strategies/[strategyId]/page.tsx:55-62` — add `{ id: 'tactics', label: 'Tactics' }` tab; render `<TacticBreakdownTable strategyId={strategyId} />`.
4. Server aggregation on same 5000-row cap; log warn on hit.

**Deferred alternative.** Materialize `evolution_metrics` rows with `entity_type='tactic'` + new `strategy_id` column at propagation time. Requires schema change + new index, more code and more load on finalization; defer until the tab's popularity justifies it.

**Verification.** Open a strategy with ≥2 tactics across its runs; Tactics tab lists them ranked by Avg Elo; each row links to tactic detail.

## Key Findings

1. **`TacticPromptPerformanceTable`** (`evolution/src/components/evolution/tabs/TacticPromptPerformanceTable.tsx`) is the single most versatile tactic-effectiveness surface — rendered in three places (`/admin/evolution/tactics/[id]`, `/admin/evolution/prompts/[id]`, experiment analysis card) and groupable by either tactic or prompt. Same pattern should drive the strategy Tactics tab.
2. **`AttributionCharts`** is entity-scoped correctly but renders dimension only, not agent — bars on the strategy/experiment page can be mislabeled when multiple agents share a dimension value. Small fix to `extractStrategyEntries()` to include `agent` in the label.
3. **`evolution_metrics entity_type='tactic'` is populated sparsely on staging** — 3 of 24 tactics have rows. The list-page leaderboard (Gap 1) will surface this void explicitly (rendering `—`) rather than hide it; this is the correct default.
4. **Attribution stale-cascade works for `eloAttrDelta:*` / `eloAttrDeltaHist:*`** but not for `entity_type='tactic'` rows. Operationally acceptable today because tactic metrics refresh at every run finalization; becomes a problem if arena-only match activity runs for long periods without new generations.
5. **`TACTIC_PALETTE`** (`evolution/src/lib/core/tactics/index.ts:53-104`) is the one definitive color mapping for 24 tactics. Every tactic-displaying surface uses it; extending it for new tactics requires code-change, not DB.
6. **No per-(tactic × model) axis exists.** `evolution_agent_invocations` has `model` on the LLM call but tactic aggregates don't factor by it. If the researcher wants "gpt-oss-20b vs gpt-5-mini performance of `lexical_simplify`", there is no UI today.
7. **No dashboard tile for tactics** — `/admin/evolution-dashboard` shows runs/costs/ELO but no "tactic of the week" or "highest-uplift tactic this month".
8. **Variants list (`/admin/evolution/variants`) shows `agent_name` column but does not link to the tactic detail page** — a 5-LOC orphan; worth folding into Gap 2's PR as a freebie.
9. **`TacticPromptPerformanceTable` 5000-row hard-limit** in `tacticPromptActions.ts:41` has no pagination or warning; latent correctness issue once production data volume grows. Add a `console.warn` / UI banner as a ~5-LOC mitigation until a real paginator is wired.
10. **LineageGraph colors nodes by tactic via `TACTIC_PALETTE`** but has no legend for the 24 colors and no tactic-level filter. Niche but useful if a researcher is inspecting a multi-generation lineage.

## Open Questions

1. **Should unproven tactics (no data) be ranked last or excluded?** Default of `—` + push-to-bottom on sort seems right, but a UX call.
2. **CI-width sort on the leaderboard** — should "tightest CI" (strongest confidence) be a first-class sort key on the tactics list? Low effort (`ci_upper - ci_lower` computed column) if desired.
3. **(Tactic, model) factorization** — worth it, or is the researcher always controlling model at the strategy level? If strategies always pin a model, (tactic, strategy) captures it transitively.
4. **Should the arena-tactic PR also adopt tactic-filtered arena entries (Gap 2.5)?** It's contiguous code but it expands the PR scope to a real UX addition, not just a column rename.
5. **`run_summary.tacticEffectiveness` appears unused in rendering.** Is it worth keeping as a snapshot for point-in-time comparisons, or is `evolution_metrics` sufficient? Potential removal opportunity if no consumer.

## Documents Read

- `docs/docs_overall/getting_started.md` — doc map
- `docs/docs_overall/architecture.md` — Server Action + metrics pattern
- `docs/docs_overall/project_workflow.md` — project/planning conventions
- `evolution/docs/README.md` — doc index
- `evolution/docs/metrics.md` — metric registry, tactic metrics, stale cascade, dynamic prefixes
- `evolution/docs/visualization.md` — admin UI pages, tabs, LogsTab, MetricGrid, EntityMetricsTab
- `evolution/docs/data_model.md` — `evolution_tactics`, `evolution_metrics`, RLS, dynamic metric CHECK
- `evolution/docs/agents/overview.md` — 24 tactics, `getAttributionDimension`, `eloAttrDelta`/`eloAttrDeltaHist` emission
- `evolution/docs/entities.md` — entity registry, agent metric merging
- `evolution/docs/architecture.md` — run finalization order, `computeTacticMetrics` timing
- `evolution/docs/strategies_and_experiments.md` — strategy config, experiment analysis card integration
- `evolution/docs/arena.md` — leaderboard semantics, `generation_method` column
- `evolution/docs/reference.md` — file index for components
- Prior investigation: `docs/planning/investigate_under_budget_run_evolution_20260420/*_research.md`
- Prior project: `docs/planning/investigate_max_agents_evolution_20260422/*_research.md`

## Code Files Read

### Admin UI (`src/app/admin/evolution/`)
- `tactics/page.tsx` — list page (no metric columns — gap 1)
- `tactics/[tacticId]/page.tsx` + `TacticDetailContent.tsx` — 5 tabs (Overview, Metrics, Variants, Runs, By Prompt)
- `arena/[topicId]/page.tsx` — leaderboard (generation_method column — gap 2)
- `strategies/[strategyId]/page.tsx` — detail (no Tactics tab — gap 3)
- `strategies/page.tsx` — comparison for `createMetricColumns` usage pattern
- `experiments/[experimentId]/ExperimentAnalysisCard.tsx` — embeds `TacticPromptPerformanceTable`
- `experiments/[experimentId]/ExperimentDetailContent.tsx` — Metrics tab with AttributionCharts
- `prompts/[promptId]/page.tsx` — embeds `TacticPromptPerformanceTable`
- `variants/page.tsx` — variants list with agent_name column (gap 8)
- `runs/[runId]/page.tsx` — Metrics tab with AttributionCharts
- `evolution-dashboard/page.tsx` — no tactic tile (gap 7)

### Components (`evolution/src/components/evolution/`)
- `tabs/TacticPromptPerformanceTable.tsx` — prompt × tactic grid, 5000-row limit (gap 9)
- `tabs/AttributionCharts.tsx` — conditional wrapper, aggregates histogram buckets
- `tabs/VariantsTab.tsx` — filter by agent_name dropdown
- `tabs/EntityMetricsTab.tsx` — generic metric-display tab
- `charts/StrategyEffectivenessChart.tsx` — drops agent from label (gap 3 adjacent)
- `charts/EloDeltaHistogram.tsx` — fixed 10-ELO buckets, no filter
- `visualizations/LineageGraph.tsx` — `TACTIC_PALETTE` color-by-tactic (gap 4)

### Core + Metrics (`evolution/src/lib/`)
- `core/tactics/index.ts` — `TACTIC_PALETTE` (24 colors)
- `core/tactics/tacticRegistry.ts` — tactic definitions
- `core/tactics/selectTacticWeighted.ts` — weighted selection (per-dispatch, no cap)
- `core/entities/TacticEntity.ts` — empty metrics registry (gap 1 root cause)
- `metrics/registry.ts:213-228` — 8 tactic metric defs with `aggregation_method` + `listView`
- `metrics/computations/tacticMetrics.ts` — `computeTacticMetrics` + `computeTacticMetricsForRun`
- `metrics/experimentMetrics.ts:354-458` — `computeEloAttributionMetrics`
- `metrics/metricColumns.tsx` — generic `createMetricColumns(entity)` + fallback rendering
- `metrics/types.ts` — `DYNAMIC_METRIC_PREFIXES` whitelist for `eloAttrDelta:` + `eloAttrDeltaHist:`
- `metrics/readMetrics.ts` / `writeMetrics.ts` — batch helpers

### Services (`evolution/src/services/`)
- `arenaActions.ts` — `toArenaEntry` drops agent_name (gap 2 root cause)
- `tacticActions.ts` — `listTacticsAction` (gap 1 target)
- `tacticPromptActions.ts` — `getTacticPromptPerformanceAction`, 5000 cap (gap 9)
- `strategyRegistryActionsV2.ts` — strategy CRUD, metric column pattern
- `costAnalytics.ts` — precedent for new service file in same idiom
- `adminAction.ts` — auth-wrapping factory

### Migrations (`supabase/migrations/`)
- `20260418000004_stale_trigger_elo_attr_delta.sql` — stale cascade for attribution metrics
- `20260321000002_consolidate_arena_entries.sql` — `evolution_variants` consolidation (arena rows use `agent_name`)

## Suggested Follow-Up Projects (scope-sized, for planning)

- **`feat/tactics_leaderboard_evolution_<date>`** — Gap 1 (~100 LOC). Adds `createMetricColumns('tactic')` wiring; pairs with `TacticEntity.metrics` population and batched `getMetricsForEntities` fetch.
- **`feat/arena_tactic_column_evolution_<date>`** — Gap 2 + 2.5 (~50 LOC). Projects `agent_name` through `toArenaEntry`; adds Tactic column and optional filter dropdown.
- **`feat/strategy_tactics_tab_evolution_<date>`** — Gap 3 (~100 LOC). New server action + Tactics tab reusing `TacticPromptPerformanceTable` with `strategyId` filter.

Fold into Gap 2 PR as freebies:
- Gap 5 (variants list → tactic detail link) — 5 LOC
- Gap 9 (`tacticPromptActions.ts:41` `console.warn` on 5000-row cap) — 5 LOC
