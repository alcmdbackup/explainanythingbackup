# Evolution Data Model

Core primitives and dimensional query system that structure the evolution pipeline around `prompt + strategy = run`.

## Overview

The evolution framework rearchitects the content evolution pipeline around core primitives, enabling structured experimentation with `prompt + strategy = run`. Every run links to a registered prompt and a formalized strategy, producing ranked articles that feed into a cross-run arena. A unified dimensional view enables slicing data by any combination of prompt, strategy, pipeline type, and agent.

## Core Primitives

- **Prompt** — A registered topic in `evolution_arena_topics` with metadata: title (NOT NULL), difficulty tier, domain tags, status. CRUD via `promptRegistryActions.ts`.
- **Strategy** — A predefined or auto-created config in `evolution_strategy_configs`: model choices, iterations, budget caps, agent selection, optional `budgetCapUsd` (per-run budget cap, excluded from config hash). Hash-based dedup prevents duplicates. CRUD via `strategyRegistryActions.ts`.
- **Run** — A single pipeline execution (`evolution_runs`). Two types: explanation-based (`explanation_id` set) or prompt-based (`explanation_id` NULL, `prompt_id` set — cron runner generates seed article). Links to prompt via `prompt_id` FK, strategy via `strategy_config_id` FK, and optionally to an experiment via `experiment_id` FK. Tracks `pipeline_type` and cost.
- **Article** — A generated text variant in `evolution_variants`. Rated via OpenSkill (mu/sigma). Top 2 per run ranked in arena.
- **Agent** — A pipeline component (generation, calibration, tournament, evolution, treeSearch, etc.) with per-agent cost tracking in `evolution_run_agent_metrics`. The `avg_elo` column stores ratings on the 0-3000 Elo scale (via `toEloScale`), and `elo_gain` is relative to the 1200 baseline.

### Derived Analytics Fields

Some analysis layers compute fields that are not stored in the database but are derived at query time:

- **FactorRanking CIs** (`evolution/src/experiments/evolution/analysis.ts`): The `FactorRanking` interface includes optional `ci_lower` and `ci_upper` fields computed via bootstrap resampling (1000 iterations, 2.5th/97.5th percentiles). Used by the experiment convergence detector — a factor has converged only when `ci_upper` of its top-ranked level exceeds the significance threshold.
- **Arena Leaderboard CIs**: The `getArenaLeaderboardAction` computes `ci_lower` and `ci_upper` from `mu ± 1.96 * sigma` (95% confidence interval) on each entry's OpenSkill rating. Displayed on the leaderboard UI as a range indicator. The `display_elo` field (`toEloScale(mu)`) is shown as the primary Elo display value. Additional fields: `run_cost_usd` (from linked `evolution_runs.total_cost_usd`), `strategy_label`, `experiment_name` (batch-fetched from run data).
- **List entry enrichment fields**: Several list entry interfaces include optional fields populated via post-fetch enrichment (batch lookup of experiment/strategy names, not stored in the database row):
  - `EvolutionRun`: `experiment_name?: string | null`, `strategy_name?: string | null`
  - `InvocationListEntry`: `experiment_name?: string | null`, `strategy_name?: string | null`
  - `VariantListEntry`: `strategy_name?: string | null`

### Explanation vs Variant

Two distinct concepts that are often both referred to as "article":

- **Explanation** (`explanations` table, `explanation_id`) — The original, canonical article. It has a stable ID that persists across all evolution runs. Think of it as the identity of the article — "the article about photosynthesis." Its `content` column holds the original text and is **never modified** by the evolution pipeline. Multiple evolution runs can target the same explanation.

- **Variant** (`evolution_variants` table, `id` UUID) — A specific version of an article's text produced during one evolution run. Each run generates many variants: the original baseline (a copy of the explanation's content), plus everything created by agents (rewrites, crossovers, syntheses, etc.). Variants are **immutable and append-only** — agents never modify existing variants, only create new ones. Each variant has its own Elo rating, creating agent, parent lineage, and content.

The relationship is **one explanation → many runs → many variants per run**:

```
Explanation (stable article identity)
  └── Run 1
  │     ├── Variant A (original_baseline — copy of explanation content)
  │     ├── Variant B (created by GenerationAgent, parentIds: [])
  │     ├── Variant C (created by IterativeEditing, parentIds: [A])
  │     └── Variant D (created by EvolutionAgent crossover, parentIds: [B, C]) ← winner
  └── Run 2
        ├── Variant E (original_baseline)
        ├── Variant F (created by GenerationAgent, parentIds: [])
        └── Variant G (created by DebateAgent, parentIds: [E, F]) ← winner
```

Key implications:
- **Lineage is within-run**: Parent/child relationships exist between variants in the same run. There is no cross-run lineage (Run 2's variants don't know about Run 1's variants).
- **The explanation is never updated**: The winning variant's content is stored in `evolution_variants` (marked `is_winner = true`) and optionally in `evolution_arena_entries`, but it is not written back to `explanations.content`.
- **Variants track their creator**: `agent_name` records which agent/strategy produced the variant. Combined with `parent_variant_id`, this enables creator-based Elo attribution (crediting the agent that made the variant, not the ranking agent that evaluated it).
- **Elo attribution**: `evolution_variants.elo_attribution` (JSONB) stores per-variant creator-based attribution: `{gain, ci, zScore, deltaMu, sigmaDelta}`. Computed at pipeline finalization by `computeAndPersistAttribution()` — measures how much each variant's rating deviated from its parent(s). Agent-level aggregates stored in `evolution_agent_invocations.agent_attribution` (JSONB). See [Rating & Comparison — Creator-Based Elo Attribution](./rating_and_comparison.md#creator-based-elo-attribution).
- **Pipeline Type** — `'full'` | `'minimal'` | `'batch'` | `'single'`. Auto-set at pipeline start.
- **Run Status** — `pending` | `claimed` | `running` | `completed` | `failed` | `paused` | `continuation_pending`. The `continuation_pending` status indicates a run that yielded at the serverless timeout limit and is awaiting cron-based resume.
- **Run Archiving** — `archived BOOLEAN DEFAULT false` on `evolution_runs`. Archived runs are excluded from browse/aggregate queries via `.eq('archived', false)`. The `get_non_archived_runs` RPC handles the LEFT JOIN needed for proper filtering. A partial index on `evolution_runs(archived) WHERE archived = false` optimizes non-archived queries.
- **Arena** — Top 2 variants from each run, upserted into `evolution_arena_entries` with rank 1/2. Deduped via `(evolution_run_id, rank)` non-partial unique index (fixed from partial in `20260224000001`).

## Key Files

### Server Actions
- `evolution/src/services/promptRegistryActions.ts` — Prompt CRUD (get, create, update, archive, delete, resolveByText) + `getPromptTitleAction` (lightweight title lookup by ID)
- `evolution/src/services/strategyRegistryActions.ts` — Strategy CRUD (get, detail, create, update, clone, archive, delete, presets)
- `evolution/src/services/evolutionVisualizationActions.ts` — Explorer views (timeline, invocations, run detail, summary)
- `evolution/src/services/experimentActions.ts` — Experiment CRUD + archive/unarchive + `getExperimentNameAction` (lightweight name lookup by ID) + `getRunMetricsAction` (per-run Elo/cost metrics via `computeRunMetrics`)
- `evolution/src/services/evolutionActions.ts` — Run trigger with prompt/strategy validation. Inline trigger rejects prompt-based runs (null explanation_id).
- `evolution/src/lib/core/seedArticle.ts` — Shared seed article generator for prompt-based runs (used by cron runner and CLI)

### Pipeline Core
- `evolution/src/lib/core/pipeline.ts` — `autoLinkPrompt()`, `feedHallOfFame()`, `linkStrategyConfig()`, pipeline type tracking
- `evolution/src/lib/core/strategyConfig.ts` — `StrategyConfigRow` type, `hashStrategyConfig()`, `labelStrategyConfig()`, `normalizeEnabledAgents()`
- `evolution/src/services/strategyResolution.ts` — Atomic strategy resolution: `resolveOrCreateStrategy()`, `resolveOrCreateStrategyFromRunConfig()`. INSERT-first with fallback SELECT eliminates TOCTOU race.
- `evolution/src/lib/types.ts` — `PipelineType`, `PromptMetadata` types (`title` is required/NOT NULL)

- **Agent Invocation** — Per-agent-per-iteration execution record in `evolution_agent_invocations`. Uses a two-phase lifecycle: `createAgentInvocation()` inserts a row (returning UUID) before agent execution, `updateAgentInvocation()` writes final cost/status/detail after completion. `cost_usd` is incremental per-invocation (not cumulative). Stores structured `execution_detail` (JSONB) with type-specific metrics for drill-down views, `_diffMetrics` for per-agent state diffs (used by Timeline tab), and `_actions` for the action log (array of `{type, ...summary}` objects describing each state mutation the agent dispatched). Action type counts are also aggregated in `run_summary.actionCounts`. Linked to run via `run_id` FK. Individual LLM calls are linked back via `llmCallTracking.evolution_invocation_id` FK (nullable, migration `20260222100001`).

### Migrations (in order)
1. `20260207000001` — Prompt metadata (difficulty_tier, domain_tags, status)
2. `20260207000002` — prompt_id FK on runs
3. `20260207000003` — Strategy formalization (is_predefined, pipeline_type)
4. `20260207000004` — pipeline_type on runs
5. `20260207000005` — Arena rank + generation_method CHECK expansion
6. `20260207000006` — Explorer composite indexes
7. `20260207000007` — Strategy lifecycle (status, created_by)
8. `20260207000008` — NOT NULL enforcement (safety-gated)
9. `20260208000001` — Enforce NOT NULL on prompt `title`, non-empty CHECK on prompt `title` and strategy `name`
10. `20260222100001` — `evolution_invocation_id` FK on `llmCallTracking` (nullable, ON DELETE SET NULL)
11. `20260222100002` — Partial index on `llmCallTracking.evolution_invocation_id` (CONCURRENTLY)
12. `20260222100003` — `evolution_experiments` table for automated experiment state machine
13. `20260222100004` — Fix `update_strategy_aggregates` RPC with Welford's online algorithm for `stddev_final_elo`, adds `elo_sum_sq_diff` column
14. `20260224000001` — Fix arena upsert index: replace partial unique index with non-partial to enable ON CONFLICT inference
15. `20260225000001` — Extend `created_by` CHECK constraint to include `'experiment'` and `'batch'` values
16. `20260225000002` — Fix Welford mean initialization: use `p_final_elo` instead of `0` for first-run `avg_final_elo`
17. `20260226000001` — Add `elo_attribution` JSONB column to `evolution_variants` and `agent_attribution` JSONB column to `evolution_agent_invocations`
18. `20260226000002` — Add CONCURRENTLY index on `evolution_variants.elo_attribution->>'gain'` for attribution-based queries
19. `20260221000002` — Arena table renames (hall_of_fame → arena)
20. `20260303000001` — Flatten experiment model: add `experiment_id` FK on runs, add `design`/`analysis_results` to experiments, drop `evolution_experiment_rounds` and `evolution_batch_runs` tables
21. `20260303000005` — Arena rename and schema migration (hall_of_fame → arena references)
22. `20260304000001` — Add `prompt_id` UUID FK on `evolution_experiments`, backfill from `prompts[1]`, rename `prompts` → `_prompts_deprecated`
23. `20260304000002` — Drop `_prompts_deprecated` column from `evolution_experiments`
24. `20260304000003` — Add `'manual'` to `design` CHECK constraint on `evolution_experiments`
25. `20260306000001` — `evolution_budget_events` audit log table (event types: reserve, spend, release_ok, release_failed)
26. `20260309000001` — Archive improvements: `pre_archive_status TEXT` on experiments, `archived BOOLEAN DEFAULT false` on runs, extended status CHECK to include `'archived'`, partial index on runs, RPCs (`get_non_archived_runs`, `archive_experiment`, `unarchive_experiment`)

### Scripts
- `evolution/scripts/backfill-prompt-ids.ts` — One-time backfill of prompt_id on existing runs

## Dimensional Model

- **Dimensions**: prompt, strategy, pipeline type, agent
- **Units of Analysis**: run, article, task (agent x run)
- **Attribute Filters**: difficulty tier, domain tags, model, budget range — resolved server-side to entity IDs via parameterized queries

## Data Flow

```
Prompt + Strategy → queueEvolutionRunAction → Run
  ├─ estimateRunCostWithAgentModels → estimated_cost_usd + cost_estimate_detail (best-effort)
  → executeMinimalPipeline / executeFullPipeline (sets pipeline_type)
  → agents execute (generation → calibration → tournament → ...)
  → finalizePipelineRun:
      1. persistVariants + persistAgentMetrics
      2. linkStrategyConfig (auto-create or aggregate update)
      3. autoLinkPrompt (config JSONB → Arena entry → explanation title)
      4. feedArena (top 2 → evolution_arena_entries with rank)
      5. persistCostPrediction → queries invocations for actual costs → computeCostPrediction(estimated, actualTotalUsd, perAgentCosts) → cost_prediction (if estimate exists)
      6. pruneCheckpoints (keep one per iteration, ~13x storage reduction)
      7. refreshAgentCostBaselines (fire-and-forget)
```

## Strategy System

- **Hash dedup**: SHA-256 of runtime config fields (12-char prefix). `is_predefined` and `pipeline_type` excluded from hash.
- **Version-on-edit**: Updating config on a strategy with completed runs archives the old row and creates a new one, preserving historical references.
- **3 presets**: Economy ($0.25 budget cap), Balanced ($0.50 budget cap), Quality ($1.00 budget cap) — all use 50 iterations
- **Pre-linked strategy**: When `strategy_config_id` is already set on a run (pre-registered by experiments, batches, or admin selection), `linkStrategyConfig` skips auto-creation and only updates aggregates via RPC. Experiments and batches pre-register strategies at run creation via `resolveOrCreateStrategyFromRunConfig()`, making them visible in the leaderboard immediately.
- **Strategy origin tracking**: `created_by` field on `evolution_strategy_configs` tracks origin: `'admin'` (UI-created), `'system'` (auto-created at finalization), `'experiment'` (experiment pre-registration), `'batch'` (batch runner pre-registration). The strategy registry UI provides a "Origin" filter dropdown.
- **`enabledAgents`** (optional on `StrategyConfig`): Array of optional agent names the strategy permits. When undefined, all agents run (backward compat). Required agents (`generation`, `calibration`, `tournament`, `proximity`) always run regardless. Included in config hash for dedup. See [Architecture: Agent Selection](./architecture.md#agent-selection).
- **`singleArticle`** (optional on `StrategyConfig`): When true, runs single-article pipeline mode — skips EXPANSION, disables generation/evolution agents, and focuses on iterative improvement of a single baseline variant. Included in config hash.
- **Config propagation**: At queue time, `queueEvolutionRunAction` snapshots key strategy fields into the run's `config` JSONB: `iterations` → `maxIterations`, `generationModel`, `judgeModel`, `budgetCaps`, `enabledAgents`, `singleArticle`, `budgetCapUsd`. This makes the run self-contained — execution reads from the run's own config, not the linked strategy. The `strategy_config_id` FK remains for audit/traceability.
- **Archiving**: Any strategy can be archived (no `is_predefined` restriction). `archiveStrategyAction` sets `status: 'archived'`, `unarchiveStrategyAction` restores to `'active'`. `getStrategiesAction` defaults to `status: 'active'` filter. `queueEvolutionRunAction` rejects archived strategies.

## NOT NULL Enforcement

Migration `000008` enforces `NOT NULL` on `prompt_id` and `strategy_config_id`. Safety-gated:
- Aborts if any completed/failed/paused runs still have NULL FKs (backfill incomplete)
- Aborts if any pending/claimed/running runs exist (queue not drained)
- Apply only after running `evolution/scripts/backfill-prompt-ids.ts` and draining the queue

## Related Documentation

- [Architecture](./architecture.md) — Pipeline orchestration, phases, checkpoint/resume
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating system used for variant ranking
- [Arena](./arena.md) — Cross-run comparison using OpenSkill (Weng-Lin Bayesian)
- [Reference](./reference.md) — Configuration, database schema, key files
- [Strategy Experiments](./strategy_experiments.md) — Manual experiment system for comparing configurations
