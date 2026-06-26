## Problem Statement
Help me build a user facing website for evolution.

## Requirements (from GH Issue #1293)
Build a front-end and stop experimenting.

- Choose a good URL.
- User can paste in any article.
- It can run a pipeline using a set strategy that is selectable via the UI.
- Can see final output, and a diff against the initial input side-by-side. Following the existing pattern on variant details tab for diff against parent.

## High Level Summary
TBD after research.

Initial picture from the docs read at /initialize time:

- The evolution pipeline already has an admin entry point at `POST /api/evolution/run` plus four other entry points (CLI batch runner, local runner, core `claimAndExecuteRun`). All converge on `claimAndExecuteRun` which claims a pending `evolution_runs` row, executes the iteration loop, finalizes results, and syncs winners to the arena.
- Strategies are stored in `evolution_strategies` (config + iteration sequence + budget). A new public-facing endpoint can list active strategies via the existing `listStrategiesAction` / `evolution_strategies` registry.
- Articles enter the pipeline through one of two `evolution_runs` paths: `explanation_id` (existing main-app `explanations` row) or `prompt_id` + `evolution_explanations` (a generated seed). For pasted articles, we likely insert a new `evolution_explanations` row with `source='explanation'` (or a new source value) and reference it from the created run — TBD in planning.
- The current website topology (Option B) already runs the evolution admin at `ea-evolution.vercel.app` with hostname-gated middleware; the public site is at `explainanything.vercel.app`. The new user-facing pages need their own routes — could live on the public host (alongside the existing search-and-explain flow) or on a third hostname; "Choose a good URL" is one of the open decisions for planning.
- Side-by-side diff infrastructure already exists: `SideBySideWordDiff` (Parent left / Child right, `diffWordsWithSpace`) is used by `VariantParentDiffTab` on the variant detail page and by the Match Viewer's text-vs-text view. The user explicitly asked we follow the "variant details tab" pattern, so this is the component to reuse.
- Cost discipline must be enforced at the public boundary: both the per-run `V2CostTracker` (with the new `EVOLUTION_MAX_OUTPUT_TOKENS` cap to avoid OpenRouter 402s) and the global `LLMSpendingGate` (daily / monthly caps via `evolution_daily_cap_usd`). User submissions need a per-IP / per-session cap on top — TBD in planning.
- Existing client-server pattern: every action via Next.js Server Actions (`withLogging` + `serverReadRequestId`), wrapped in `{ success, data, error }`. The page state machine pattern (`pageLifecycleReducer`: idle → loading → streaming → viewing) is reusable for the paste-run-view flow.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/design_style_guide.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/markdown_ast_diffing.md
- docs/feature_deep_dives/authentication_rls.md
- docs/feature_deep_dives/state_management.md
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/reference.md
- evolution/docs/variant_lineage.md
- evolution/docs/agents/overview.md
- evolution/docs/criteria_agents.md
- evolution/docs/editing_agents.md
- evolution/docs/entities.md
- evolution/docs/evolution_metrics.md
- evolution/docs/curriculum.md
- evolution/docs/implicit_rubric_weights.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/paragraph_recombine_with_coherence_pass.md
- evolution/docs/prompt_editor.md
- evolution/docs/rating_and_comparison.md

## Code Files Read
- (to be filled during /research)
