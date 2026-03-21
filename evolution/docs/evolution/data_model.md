# Evolution Data Model

Core primitives and dimensional query system that structure the evolution pipeline around `prompt + strategy = run`.

## Overview

The evolution framework rearchitects the content evolution pipeline around core primitives, enabling structured experimentation with `prompt + strategy = run`. Every run links to a registered prompt and a formalized strategy, producing ranked articles that feed into a cross-run arena. A unified dimensional view enables slicing data by any combination of prompt, strategy, pipeline type, and agent.

## Core Primitives

- **Prompt** — A registered topic in `evolution_arena_topics` with metadata: title (NOT NULL), difficulty tier, domain tags, status. CRUD via `promptRegistryActions.ts`.
- **Strategy** — A predefined or auto-created config in `evolution_strategy_configs`: model choices, iterations, budget caps, agent selection, optional `budgetCapUsd` (per-run budget cap, excluded from config hash). Hash-based dedup prevents duplicates. CRUD via `strategyRegistryActions.ts`.
- **Evolution Explanation** — A decoupled seed content record in `evolution_explanations`. Stores the article text that started a run, whether copied from the `explanations` table (`source: 'explanation'`) or LLM-generated from a prompt (`source: 'prompt_seed'`). FKs: `explanation_id` (INT, nullable) for explanation-based, `prompt_id` (UUID, nullable) for prompt-based. Referenced by runs, experiments, and arena entries via `evolution_explanation_id` UUID FK.
- **Run** — A single pipeline execution (`evolution_runs`). Two types: explanation-based (`explanation_id` set) or prompt-based (`explanation_id` NULL, `prompt_id` set — batch runner generates seed article). Links to prompt via `prompt_id` FK, strategy via `strategy_config_id` FK (NOT NULL — every run must have a strategy), experiment via `experiment_id` FK, and evolution explanation via `evolution_explanation_id` FK. Config is read from the strategy FK at runtime (no inline `config` JSONB). `budget_cap_usd` is a direct column on the run row. Tracks `pipeline_type` and cost.
- **Article** — A generated text variant in `evolution_variants`. Rated via OpenSkill (mu/sigma). Top 2 per run ranked in arena.
- **Agent** — In V2, pipeline operations (generation, ranking, evolution) tracked via `evolution_agent_invocations` with per-operation cost attribution.

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
- **Pipeline Version** — `pipeline_version='v2'` on all V2 runs.
- **Run Status** — `pending` | `claimed` | `running` | `completed` | `failed` | `cancelled`. V2 has no `continuation_pending` or `paused` statuses — runs complete in a single execution.
- **Run Archiving** — `archived BOOLEAN DEFAULT false` on `evolution_runs`. Archived runs are excluded from browse/aggregate queries via `.eq('archived', false)`.
- **Arena** — Top 2 variants from each run, upserted into `evolution_arena_entries` with rank 1/2. Deduped via `(evolution_run_id, rank)` non-partial unique index (fixed from partial in `20260224000001`).

## Key Files

### V2 Core
- `evolution/src/lib/v2/types.ts` — `EvolutionConfig`, `EvolutionResult`, `V2Match`, `V2StrategyConfig`
- `evolution/src/lib/v2/runner.ts` — Run lifecycle: claim → resolve → evolve → persist → arena sync
- `evolution/src/lib/v2/evolve-article.ts` — Main orchestrator: generate→rank→evolve loop
- `evolution/src/lib/v2/strategy.ts` — `hashStrategyConfig()`, `labelStrategyConfig()` for V2
- `evolution/src/lib/v2/finalize.ts` — Persist results in V1-compatible format
- `evolution/src/lib/v2/experiments.ts` — Experiment creation, run management, metrics

### Server Actions
- `evolution/src/services/experimentActionsV2.ts` — 7 V2 server actions for experiment lifecycle
- `evolution/src/services/evolutionRunnerCore.ts` — Shared runner core for admin triggers

### Invocation Tracking
- **Agent Invocation** — Per-operation-per-iteration execution record in `evolution_agent_invocations`. Uses a two-phase lifecycle: `createInvocation()` inserts a row (returning UUID) before operation executes, `updateInvocation()` writes final cost/status/detail after completion. `cost_usd` is incremental per-invocation (not cumulative). Stores structured `execution_detail` (JSONB). Linked to run via `run_id` FK.

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
27. `20260312000001` — Remove ordinal column from `evolution_arena_elo`, recalibrate Elo via `sync_to_arena` RPC rewrite
28. `20260314000001` — Create `evolution_explanations` table, add `evolution_explanation_id` UUID FK on `evolution_runs`, `evolution_experiments`, `evolution_arena_entries`, backfill + SET NOT NULL on runs/experiments

### Scripts
- `evolution/scripts/backfill-prompt-ids.ts` — One-time backfill of prompt_id on existing runs

## Dimensional Model

- **Dimensions**: prompt, strategy, pipeline type, agent
- **Units of Analysis**: run, article, task (agent x run)
- **Attribute Filters**: difficulty tier, domain tags, model, budget range — resolved server-side to entity IDs via parameterized queries

## Data Flow

```
Experiment Created → addRunToExperiment → Run (status='pending')
  → Runner claims run (claim_evolution_run RPC)
  → resolveConfig() → V2 flat EvolutionConfig
  → resolveContent() → fetch explanation or generate seed article
  → upsertStrategy() → hash-based dedup
  → loadArenaEntries() → inject into initial pool
  → evolveArticle() loop: generate → rank → evolve
  → finalizeRun():
      1. Build run_summary (winner, pool, ratings, stopReason, costs)
      2. Persist variants to evolution_variants
      3. Update strategy aggregates via RPC
      4. Mark experiment completed if all runs done
  → syncToArena() (prompt-based runs only)
```

## Strategy System

- **Hash dedup**: SHA-256 of runtime config fields (12-char prefix). `is_predefined` and `pipeline_type` excluded from hash. The shared `upsertStrategy()` function performs find-or-create by config hash and is called by all run-creation paths.
- **Version-on-edit**: Updating config on a strategy with completed runs archives the old row and creates a new one, preserving historical references.
- **3 presets**: Economy ($0.25 budget cap), Balanced ($0.50 budget cap), Quality ($1.00 budget cap) — all use 50 iterations
- **strategy_config_id is NOT NULL**: Every run must have a linked strategy. All run-creation paths call `upsertStrategy()` before inserting a run, ensuring `strategy_config_id` is always set. The `config` JSONB column on `evolution_runs` has been dropped — the runner reads config from the strategy FK at runtime.
- **`budget_cap_usd` on run row**: Per-run budget cap is a direct column on `evolution_runs`, not part of the strategy config. This allows different runs of the same strategy to have different budgets without creating separate strategy rows.
- **Strategy origin tracking**: `created_by` field on `evolution_strategy_configs` tracks origin: `'admin'` (UI-created), `'system'` (auto-created at finalization), `'experiment'` (experiment pre-registration), `'batch'` (batch runner pre-registration). The strategy registry UI provides a "Origin" filter dropdown.
- **`enabledAgents`** (optional on `V2StrategyConfig`): Array of optional agent names the strategy permits. When undefined, all agents run. Required agents (`generation`, `ranking`, `proximity`) always run regardless. Included in config hash for dedup. See [Architecture: Agent Selection](./architecture.md#agent-selection).
- **`singleArticle`** (optional on `V2StrategyConfig`): When true, runs single-article pipeline mode — skips EXPANSION, disables generation/evolution agents, and focuses on iterative improvement of a single baseline variant. Included in config hash.
- **Archiving**: Any strategy can be archived (no `is_predefined` restriction). `archiveStrategyAction` sets `status: 'archived'`, `unarchiveStrategyAction` restores to `'active'`. `getStrategiesAction` defaults to `status: 'active'` filter. `queueEvolutionRunAction` rejects archived strategies.

## NOT NULL Enforcement

`strategy_config_id` is NOT NULL on `evolution_runs` — every run must have a strategy. All run-creation paths call `upsertStrategy()` before inserting a run. The `config` JSONB column has been dropped; config is read from the strategy FK at runtime. `budget_cap_usd` is a direct column on the run row.

Migration `000008` enforces `NOT NULL` on `prompt_id` and `strategy_config_id`. Safety-gated:
- Aborts if any completed/failed/paused runs still have NULL FKs (backfill incomplete)
- Aborts if any pending/claimed/running runs exist (queue not drained)
- Apply only after running `evolution/scripts/backfill-prompt-ids.ts` and draining the queue

## Related Documentation

- [Architecture](./architecture.md) — V2 pipeline orchestration, iteration loop, stop reasons
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating system used for variant ranking
- [Arena](./arena.md) — Cross-run comparison using OpenSkill (Weng-Lin Bayesian)
- [Reference](./reference.md) — Configuration, database schema, key files
- [Strategy Experiments](./strategy_experiments.md) — Manual experiment system for comparing configurations
