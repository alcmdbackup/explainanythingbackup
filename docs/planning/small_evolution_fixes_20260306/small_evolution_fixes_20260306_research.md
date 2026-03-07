# Small Evolution Fixes Research

## Problem Statement
Have a few small fixes I want to make for evolution.

## Requirements (from GH Issue #655)
- [ ]  Run detail page: prompt and experiment badges should show names (not just "Prompt"/"Experiment"), and strategy badge should be labeled "Strategy:"
- [ ]  Arena page bugs
    - [ ]  Leaderboard should show experiment and strategy for a given variant
    - [ ]  Elo sometimes sits outside confidence intervals - **1547 vs.** 1633–1956
    - [ ]  Chart on cost vs. rating tab seems buggy - should be scatter plot, don't understand it
    - [ ]  Cost on leaderboard is wrong - it disagrees with cost from run

## High Level Summary

Research conducted across 4 rounds with 4 agents each (16 total). Key findings:

1. **Run detail badges need names** — Currently the prompt badge says just "Prompt" and experiment says just "Experiment" with no names. Strategy badge shows `strategy.label` but has no "Strategy:" prefix. Data is available: prompts have `title` (via `getPromptsAction` or direct query on `evolution_arena_topics`), experiments have `name` (via `getExperimentStatusAction`). The run detail page already fetches strategy detail separately; similar pattern needed for prompt and experiment names.
2. **Elo outside CI is a real math bug** — `elo_rating` uses ordinal (`mu - 3*sigma`) but CI uses `mu ± 1.96*sigma`. Since 3 > 1.96, the point estimate can fall below CI lower bound. Fix: display `ordinalToEloScale(mu)` as the point estimate, keep ordinal for ranking only.
4. **Arena cost mismatch is by design but confusing** — arena entries store `totalRunCost / numVariants` (per-entry share), but run detail shows full run cost. Need to either show full run cost on arena or clarify the per-entry nature.
5. **Leaderboard missing experiment/strategy** — data is available via `evolution_run_id` JOIN to `evolution_runs` (which has `strategy_config_id` and `experiment_id`), but `getArenaLeaderboardAction` doesn't fetch it. Also available in `metadata.winning_strategy` on expanded detail.
6. **Scatter chart is correctly implemented** as a Recharts ScatterChart but lacks entry labels in tooltip, quadrant explanation is minimal, and the "Optimal" label is tiny.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/admin_panel.md — sidebar switching, evolution routes
- docs/docs_overall/design_style_guide.md — color tokens, badge patterns
- docs/docs_overall/testing_overview.md — testing tiers, E2E patterns
- evolution/docs/evolution/visualization.md — dashboard components, server actions
- evolution/docs/evolution/architecture.md — pipeline phases, agent system
- evolution/docs/evolution/arena.md — OpenSkill ratings, topic archiving, sync
- evolution/docs/evolution/data_model.md — core primitives, strategy system

## Code Files Read

### Run Detail Badges (Prompt/Experiment/Strategy)
- `src/app/admin/evolution/runs/[runId]/page.tsx` (production: `src/app/admin/quality/evolution/run/[runId]/page.tsx`):
  - Lines 176-192: Prompt badge says just "Prompt", Experiment badge says just "Experiment" — no names shown
  - Lines 216-224: Strategy badge shows `strategy.label` but no "Strategy:" prefix
  - `EvolutionRun` interface has `prompt_id`, `experiment_id`, `strategy_config_id` — all nullable UUIDs
  - Strategy is already fetched via `getStrategyDetailAction(run.strategy_config_id)` in a useEffect
  - **Prompt name**: available via `evolution_arena_topics.title` (query by `prompt_id`). Could use inline Supabase query or a lightweight action.
  - **Experiment name**: available via `evolution_experiments.name` (query by `experiment_id`). `getExperimentStatusAction` exists but is heavy; could add a lightweight fetch.
- `evolution/src/services/promptRegistryActions.ts` — `getPromptsAction` returns `PromptMetadata` with `title` field
- `evolution/src/services/experimentActions.ts` — `ExperimentStatus` has `name` field
- `evolution/src/lib/utils/evolutionUrls.ts` — `buildStrategyUrl`, `buildExperimentUrl`, `buildArenaTopicUrl`, etc.

### Arena Leaderboard
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — leaderboard table (lines 750-876), Source column shows Run/Variant links but NOT strategy/experiment names. EntryDetail expansion (lines 156-263) shows `winning_strategy` from metadata.
- `evolution/src/services/arenaActions.ts` — `getArenaLeaderboardAction` (lines 290-346) does two queries: `evolution_arena_elo` + `evolution_arena_entries`. Does NOT join to `evolution_runs`. Returns `ArenaEloEntry` with 14 fields.

### Elo/CI Math
- `evolution/src/lib/core/rating.ts` — `getOrdinal()` = `mu - 3*sigma` (line 51-52), `ordinalToEloScale(ord)` = `1200 + ord * 16` clamped to [0,3000]
- `evolution/src/services/arenaActions.ts` lines 328, 335-336:
  - `elo_rating: r.elo_rating` (from DB, derived from ordinal = mu-3*sigma)
  - `ci_lower: ordinalToEloScale(r.mu - 1.96 * r.sigma)`
  - `ci_upper: ordinalToEloScale(r.mu + 1.96 * r.sigma)`
  - **BUG**: elo_rating uses 3-sigma penalty, CI uses 1.96-sigma → point estimate below CI lower bound

### Arena Cost
- `evolution/src/lib/core/arenaIntegration.ts` lines 220-222: `perEntryCost = totalCost / newVariants.length`, each entry gets split cost
- `sync_to_arena` RPC (migration 20260303000005) — stores cost as-is, no computation
- `evolution_arena_entries.total_cost_usd` = per-entry share of run cost (for evolution entries)
- Run detail page shows `evolution_runs.total_cost_usd` = full run cost

### Scatter Chart
- `src/app/admin/evolution/arena/[topicId]/page.tsx` lines 31-94: Recharts `ScatterChart`, X=Cost(USD), Y=Rating(Elo), colored by method
- Has median reference lines + "Optimal" quadrant label (lines 67-72)
- Tooltip shows `$X.XXXX` and `X.X` but no entry name/method
- Manual legend below chart with 3 method colors

### Tests
- `evolution/src/services/arenaActions.test.ts` — 1376 lines, covers getArenaLeaderboardAction including CI computation
- `evolution/src/lib/core/rating.test.ts` — 245 lines, covers ordinalToEloScale, getOrdinal
- `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — 724 lines, E2E coverage for leaderboard, CI display, scatter chart
- `src/__tests__/integration/arena-actions.integration.test.ts` — 810 lines, full integration coverage

## Key Findings

1. **Run detail badges need names** — Prompt badge says "Prompt" (no name), experiment says "Experiment" (no name), strategy shows label but no "Strategy:" prefix. Data available: `evolution_arena_topics.title` for prompt name, `evolution_experiments.name` for experiment name. Page already has a useEffect pattern for fetching strategy; same pattern works for prompt/experiment.

2. **Elo outside CI: CONFIRMED BUG** — Root cause is architectural mismatch:
   - `elo_rating` = `ordinalToEloScale(mu - 3*sigma)` (conservative ranking estimate)
   - `ci_lower` = `ordinalToEloScale(mu - 1.96*sigma)` (statistical bound)
   - Since 3 > 1.96, elo_rating is always pulled lower than ci_lower when sigma is large
   - **Fix**: Display `ordinalToEloScale(mu)` as point estimate, use ordinal only for sort order

4. **Arena cost mismatch: CONFIRMED** — Arena stores `totalRunCost / numNewVariants` per entry. Run detail shows full `totalRunCost`. These will always disagree unless we change one.
   - **Fix option A**: Show full run cost on arena entries (join through `evolution_run_id`)
   - **Fix option B**: Label arena cost as "per-entry cost" and add run cost via join

5. **Missing experiment/strategy on leaderboard: CONFIRMED** — `getArenaLeaderboardAction` doesn't join to `evolution_runs`. Data path exists: `evolution_arena_entries.evolution_run_id` → `evolution_runs.strategy_config_id` / `experiment_id`. Need to add JOIN and display columns.

6. **Scatter chart: WORKS BUT CONFUSING** — Is a proper ScatterChart. Issues:
   - Tooltip doesn't show entry name/method (only cost + rating numbers)
   - "Optimal" quadrant label is tiny (font-size 9) and unexplained
   - No visible data point labels
   - **Fix**: Enhance tooltip with entry method/model, add subtitle explaining quadrants

## Production vs Main Route Mapping

Production uses `/admin/quality/` paths; main uses `/admin/evolution/` (from UI cleanup PR #644, not yet on production):
- Production: `/admin/quality/evolution/run/[runId]` → Main: `/admin/evolution/runs/[runId]`
- Production: `/admin/quality/arena/[topicId]` → Main: `/admin/evolution/arena/[topicId]`
- Production: `/admin/quality/strategies/[id]` → Main: `/admin/evolution/strategies/[id]`
- Production: `/admin/quality/prompts/` → Main: `/admin/evolution/prompts/`

All fixes should target the **main** branch paths (`/admin/evolution/`). URL builders in `evolutionUrls.ts` already updated on main.

## Open Questions

1. For the Elo display fix: should we show `mu`-based Elo everywhere (including the main leaderboard column), or keep ordinal-based for ranking and show mu-based only alongside CI?
2. For arena cost: should we show the full run cost (matching run detail) or keep per-entry cost but clearly label it? Or show both?
3. For strategy/experiment on leaderboard: show as columns in the table, or only in the expanded detail view?
4. For the scatter chart: is it worth significant rework, or just tooltip + explanation improvements?
