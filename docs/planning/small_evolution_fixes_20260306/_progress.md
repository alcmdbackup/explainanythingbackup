# Small Evolution Fixes Progress

## Phase 1: Run Detail Page — Named Badges
### Work Done
- Added `getPromptTitleAction` to `promptRegistryActions.ts` — queries `evolution_arena_topics.title` by ID
- Added `getExperimentNameAction` to `experimentActions.ts` — queries `evolution_experiments.name` by ID
- Updated run detail page to fetch prompt title and experiment name via useEffects
- Regrouped badges below title with "Experiment:", "Prompt:", "Strategy:" prefixes
- Fallback to truncated UUID if name fetch fails
- Added 7 new unit tests (4 for prompt title, 3 for experiment name)

## Phase 2: Fix Elo/CI Math Bug
### Work Done
- Added `display_elo: ordinalToEloScale(r.mu)` to `ArenaEloEntry` interface and leaderboard mapping
- UI now shows `display_elo` (always inside CI bounds) instead of `elo_rating` (ordinal-based, can fall outside CI)
- Updated scatter chart to use `display_elo` for Y axis
- Added test verifying `display_elo` is always inside `ci_lower..ci_upper`
- Added rating.test.ts test for mu-based Elo inside CI for various mu/sigma combinations

## Phase 3: Fix Arena Cost — Show Run Cost
### Work Done
- Added `evolution_run_id` to entries select in leaderboard action
- Batch-fetches `evolution_runs.total_cost_usd` for entries linked to runs
- Added `run_cost_usd` and `evolution_run_id` fields to `ArenaEloEntry`
- UI shows `run_cost_usd` with fallback to entry cost
- Added tests: `run_cost_usd` populated when `evolution_run_id` set, null when not

## Phase 4: Leaderboard — Show Strategy/Experiment
### Work Done
- Batch-fetches `evolution_strategy_configs.label` and `evolution_experiments.name` from run data
- Added `strategy_label` and `experiment_name` fields to `ArenaEloEntry`
- Displays strategy/experiment below Run/Variant links in Source column
- Tests verify batch lookup populates strategy_label and experiment_name

## Phase 5: Scatter Chart Improvements
### Work Done
- Enhanced tooltip showing method + model alongside cost/rating
- Added subtitle: "Green area = high rating at low cost (optimal quadrant)"
- Chart uses `display_elo` for Y axis (from Phase 2)
