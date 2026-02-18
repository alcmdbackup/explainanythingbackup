# Evolution Data Model

Core primitives and dimensional query system that structure the evolution pipeline around `prompt + strategy = run`.

## Overview

The evolution framework rearchitects the content evolution pipeline around core primitives, enabling structured experimentation with `prompt + strategy = run`. Every run links to a registered prompt and a formalized strategy, producing ranked articles that feed into a cross-run hall of fame. A unified dimensional explorer enables slicing data by any combination of prompt, strategy, pipeline type, and agent.

## Core Primitives

- **Prompt** — A registered topic in `hall_of_fame_topics` with metadata: title (NOT NULL), difficulty tier, domain tags, status. CRUD via `promptRegistryActions.ts`.
- **Strategy** — A predefined or auto-created config in `strategy_configs`: model choices, iterations, budget caps, agent selection. Hash-based dedup prevents duplicates. CRUD via `strategyRegistryActions.ts`.
- **Run** — A single pipeline execution (`content_evolution_runs`). Two types: explanation-based (`explanation_id` set) or prompt-based (`explanation_id` NULL, `prompt_id` set — cron runner generates seed article). Links to prompt via `prompt_id` FK and strategy via `strategy_config_id` FK. Tracks `pipeline_type` and cost.
- **Article** — A generated text variant in `content_evolution_variants`. Rated via OpenSkill (mu/sigma). Top 3 per run ranked in hall of fame.
- **Agent** — A pipeline component (generation, calibration, tournament, evolution, etc.) with per-agent cost tracking in `evolution_run_agent_metrics`.
- **Pipeline Type** — `'full'` | `'minimal'` | `'batch'`. Auto-set at pipeline start.
- **Run Status** — `pending` | `claimed` | `running` | `completed` | `failed` | `paused` | `continuation_pending`. The `continuation_pending` status indicates a run that yielded at the serverless timeout limit and is awaiting cron-based resume.
- **Hall of Fame** — Top 3 variants from each run, upserted into `hall_of_fame_entries` with rank 1/2/3. Deduped via `(evolution_run_id, rank)` unique index.

## Key Files

### Server Actions
- `src/lib/services/promptRegistryActions.ts` — Prompt CRUD (get, create, update, archive, delete, resolveByText)
- `src/lib/services/strategyRegistryActions.ts` — Strategy CRUD (get, detail, create, update, clone, archive, delete, presets)
- `src/lib/services/unifiedExplorerActions.ts` — Explorer views (table, matrix, trend, article detail)
- `src/lib/services/evolutionActions.ts` — Run trigger with prompt/strategy validation. Inline trigger rejects prompt-based runs (null explanation_id).
- `src/lib/evolution/core/seedArticle.ts` — Shared seed article generator for prompt-based runs (used by cron runner and CLI)

### Pipeline Core
- `src/lib/evolution/core/pipeline.ts` — `autoLinkPrompt()`, `feedHallOfFame()`, `linkStrategyConfig()`, pipeline type tracking
- `src/lib/evolution/core/strategyConfig.ts` — `StrategyConfigRow` type, `hashStrategyConfig()`, `labelStrategyConfig()`
- `src/lib/evolution/types.ts` — `PipelineType`, `PromptMetadata` types (`title` is required/NOT NULL)

- **Agent Invocation** — Per-agent-per-iteration execution record in `evolution_agent_invocations`. Stores structured `execution_detail` (JSONB) with type-specific metrics for drill-down views. Linked to run via `run_id` FK.

### Migrations (in order)
1. `20260207000001` — Prompt metadata (difficulty_tier, domain_tags, status)
2. `20260207000002` — prompt_id FK on runs
3. `20260207000003` — Strategy formalization (is_predefined, pipeline_type)
4. `20260207000004` — pipeline_type on runs
5. `20260207000005` — Hall of fame rank + generation_method CHECK expansion
6. `20260207000006` — Explorer composite indexes
7. `20260207000007` — Strategy lifecycle (status, created_by)
8. `20260207000008` — NOT NULL enforcement (safety-gated)
9. `20260208000001` — Enforce NOT NULL on prompt `title`, non-empty CHECK on prompt `title` and strategy `name`

### Scripts
- `scripts/backfill-prompt-ids.ts` — One-time backfill of prompt_id on existing runs

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
      3. autoLinkPrompt (config JSONB → Hall of Fame entry → explanation title)
      4. feedHallOfFame (top 3 → hall_of_fame_entries with rank)
      5. computeCostPrediction → cost_prediction (if estimate exists)
      6. refreshAgentCostBaselines (fire-and-forget)
```

## Strategy System

- **Hash dedup**: SHA-256 of runtime config fields (12-char prefix). `is_predefined` and `pipeline_type` excluded from hash.
- **Version-on-edit**: Updating config on a strategy with completed runs archives the old row and creates a new one, preserving historical references.
- **3 presets**: Economy ($1, minimal), Balanced ($3, full), Quality ($5, full with premium models)
- **Pre-linked strategy**: When `strategy_config_id` is already set on a run (pre-selected), `linkStrategyConfig` skips auto-creation and only updates aggregates via RPC.
- **`enabledAgents`** (optional on `StrategyConfig`): Array of optional agent names the strategy permits. When undefined, all agents run (backward compat). Required agents (`generation`, `calibration`, `tournament`, `proximity`) always run regardless. Included in config hash for dedup. See [Architecture: Agent Selection](./architecture.md#agent-selection).
- **`singleArticle`** (optional on `StrategyConfig`): When true, runs single-article pipeline mode — skips EXPANSION, disables generation/evolution agents, and focuses on iterative improvement of a single baseline variant. Included in config hash.
- **Config propagation**: At queue time, `queueEvolutionRunAction` snapshots key strategy fields into the run's `config` JSONB: `iterations` → `maxIterations`, `generationModel`, `judgeModel`, `budgetCaps`, `enabledAgents`, `singleArticle`. This makes the run self-contained — execution reads from the run's own config, not the linked strategy. The `strategy_config_id` FK remains for audit/traceability.

## NOT NULL Enforcement

Migration `000008` enforces `NOT NULL` on `prompt_id` and `strategy_config_id`. Safety-gated:
- Aborts if any completed/failed/paused runs still have NULL FKs (backfill incomplete)
- Aborts if any pending/claimed/running runs exist (queue not drained)
- Apply only after running `scripts/backfill-prompt-ids.ts` and draining the queue

## Related Documentation

- [Architecture](./architecture.md) — Pipeline orchestration, phases, checkpoint/resume
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating system used for variant ranking
- [Hall of Fame](./hall_of_fame.md) — Cross-run comparison using Elo K-32
- [Reference](./reference.md) — Configuration, database schema, key files
- [Strategy Experiments](./strategy_experiments.md) — Experiment state in `experiments/` JSON files
