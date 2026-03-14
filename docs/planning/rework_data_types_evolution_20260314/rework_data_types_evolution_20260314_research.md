# Rework Data Types Evolution Research

## Problem Statement
Rework the core types within the evolution pipeline to make things easier to maintain and clean up architecture & downstream dependencies.

## Requirements (from GH Issue #701)
- Split types into `core_entities.ts`, `secondary_entities.ts`, and `supporting_types.ts`
- Core entities = exactly 7 types, one per admin dashboard entity. Each must have: A) own DB table, B) unique identifier, C) foreign keys linking to related entities
- Secondary entities = types for explanations
- Supporting types = everything else
- Each file exports a programmatically checkable list of types

---

## High Level Summary

Currently all shared types live in `evolution/src/lib/types.ts` (869 lines) plus 10+ service action files. The proposed split creates 7 canonical entity types derived directly from DB schemas.

---

## Proposed Core Entities (7 types, 1 per admin section)

Each type is the **canonical row shape** for its DB table with FK references as IDs.

### DB Schema Changes Required

| Table | Change | Details |
|-------|--------|---------|
| *(new)* `evolution_explanations` | CREATE TABLE | Separate table for evolution-generated seed articles (see below) |
| `evolution_experiments` | ADD COLUMN | `evolution_explanation_id UUID REFERENCES evolution_explanations(id)` |
| `evolution_experiments` | ALTER COLUMN | `prompt_id` DROP NOT NULL (make optional) |
| `evolution_runs` | ADD COLUMN | `evolution_explanation_id UUID NOT NULL REFERENCES evolution_explanations(id)` |
| `evolution_runs` | ALTER COLUMN | `prompt_id` DROP NOT NULL (make optional) |
| `evolution_arena_entries` | ADD COLUMN | `evolution_explanation_id UUID NOT NULL REFERENCES evolution_explanations(id)` |
| `evolution_arena_entries` | ADD COLUMN | `strategy_config_id UUID REFERENCES evolution_strategy_configs(id)` |
| `evolution_arena_entries` | ALTER COLUMN | `topic_id` DROP NOT NULL (make optional) |

### New Table: `evolution_explanations`

Decouples evolution's concept of "the article being evolved" from the main `explanations` table. Prompt-based runs generate a seed article here instead of leaving `explanation_id` NULL. Explanation-based runs create a row here pointing back to the source explanation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID PK` | |
| `explanation_id` | `INT NULL` | **FK → explanations** (set when evolving an existing article, NULL for prompt-generated seeds) |
| `prompt_id` | `UUID NULL` | **FK → evolution_arena_topics** (set for prompt-based seeds) |
| `title` | `TEXT NOT NULL` | article title |
| `content` | `TEXT NOT NULL` | original/seed article text |
| `source` | `TEXT NOT NULL` | `'explanation'` or `'prompt_seed'` |
| `created_at` | `TIMESTAMPTZ` | |

**Behavioral change:** The runner's prompt-based path currently generates a seed article in-memory and never persists it. After this change, `generateSeedArticle()` inserts into `evolution_explanations` and the resulting UUID is set on the run row. This means all runs have a traceable `evolution_explanation_id`, making the FK required everywhere.

**Impact on core entity FKs:** All entities that currently reference `explanations.id` (int) would instead reference `evolution_explanations.id` (UUID). The `evolution_explanations` row optionally points back to `explanations.id` for explanation-based runs.

### 1. `Experiment`
**Table:** `evolution_experiments` | **PK:** `id UUID` | **Admin:** `/admin/evolution/experiments/[id]`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `string` | UUID PK |
| `name` | `string` | NOT NULL |
| `status` | `ExperimentStatusValue` | pending, round_running, round_analyzing, pending_next_round, converged, budget_exhausted, max_rounds, failed, cancelled, completed, archived |
| `optimization_target` | `'elo' \| 'elo_per_dollar'` | |
| `total_budget_usd` | `number` | |
| `spent_usd` | `number` | |
| `max_rounds` | `number` | |
| `current_round` | `number` | |
| `convergence_threshold` | `number` | |
| `factor_definitions` | `Record<string, unknown>` | JSONB |
| `evolution_explanation_id` | `string` | **FK → EvolutionExplanation** (required) ⚠️ NEW COLUMN |
| `prompt_id` | `string \| null` | **FK → Prompt** (optional) ⚠️ CHANGE: currently NOT NULL |
| `design` | `string` | 'L8', 'full-factorial', 'manual' |
| `analysis_results` | `Record<string, unknown> \| null` | JSONB |
| `config_defaults` | `Record<string, unknown> \| null` | JSONB |
| `results_summary` | `Record<string, unknown> \| null` | JSONB |
| `error_message` | `string \| null` | |
| `pre_archive_status` | `string \| null` | stored before archiving |
| `created_at` | `string` | |
| `updated_at` | `string` | |
| `completed_at` | `string \| null` | |

**Schema changes needed:**
- ADD `explanation_id INT NOT NULL REFERENCES explanations(id)` — every experiment targets one article
- ALTER `prompt_id` DROP NOT NULL — prompt is optional (experiment may just target an explanation directly)

### 2. `Prompt`
**Table:** `evolution_arena_topics` | **PK:** `id UUID` | **Admin:** `/admin/evolution/prompts/[id]`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `string` | UUID PK |
| `prompt` | `string` | NOT NULL, unique (lowercased/trimmed) |
| `title` | `string` | NOT NULL (enforced by migration 000009) |
| `difficulty_tier` | `string \| null` | |
| `domain_tags` | `string[]` | |
| `status` | `'active' \| 'archived'` | |
| `deleted_at` | `string \| null` | soft delete |
| `created_at` | `string` | |

### 3. `Strategy`
**Table:** `evolution_strategy_configs` | **PK:** `id UUID` | **Admin:** `/admin/evolution/strategies/[id]`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `string` | UUID PK |
| `config_hash` | `string` | SHA-256 12-char, UNIQUE |
| `name` | `string` | NOT NULL |
| `description` | `string \| null` | |
| `label` | `string` | auto-generated |
| `config` | `StrategyConfig` | JSONB (models, iterations, enabledAgents, singleArticle, budgetCapUsd) |
| `is_predefined` | `boolean` | |
| `pipeline_type` | `PipelineType \| null` | |
| `status` | `'active' \| 'archived'` | |
| `created_by` | `'system' \| 'admin' \| 'experiment' \| 'batch'` | |
| `run_count` | `number` | |
| `total_cost_usd` | `number` | |
| `avg_final_elo` | `number \| null` | |
| `avg_elo_per_dollar` | `number \| null` | |
| `best_final_elo` | `number \| null` | |
| `worst_final_elo` | `number \| null` | |
| `stddev_final_elo` | `number \| null` | |
| `first_used_at` | `string` | |
| `last_used_at` | `string` | |
| `created_at` | `string` | |

**Note:** `StrategyConfig` (the JSONB shape) and `PipelineType` are supporting types imported by this entity.

### 4. `Run`
**Table:** `evolution_runs` | **PK:** `id UUID` | **Admin:** `/admin/evolution/runs/[id]`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `string` | UUID PK |
| `evolution_explanation_id` | `string` | **FK → EvolutionExplanation** (required) ⚠️ NEW COLUMN |
| `prompt_id` | `string \| null` | **FK → Prompt** (optional) ⚠️ CHANGE: currently NOT NULL |
| `strategy_config_id` | `string` | **FK → Strategy** |
| `experiment_id` | `string \| null` | **FK → Experiment** |
| `status` | `EvolutionRunStatus` | pending, claimed, running, completed, failed, paused, continuation_pending |
| `phase` | `PipelinePhase` | EXPANSION, COMPETITION |
| `pipeline_type` | `PipelineType \| null` | full, minimal, batch, single |
| `total_variants` | `number` | |
| `total_cost_usd` | `number` | |
| `estimated_cost_usd` | `number \| null` | |
| `budget_cap_usd` | `number` | |
| `config` | `Record<string, unknown>` | JSONB snapshot of strategy config |
| `current_iteration` | `number` | |
| `error_message` | `string \| null` | |
| `runner_id` | `string \| null` | |
| `continuation_count` | `number` | |
| `run_summary` | `EvolutionRunSummary \| null` | JSONB |
| `cost_estimate_detail` | `Record<string, unknown> \| null` | JSONB |
| `cost_prediction` | `Record<string, unknown> \| null` | JSONB |
| `archived` | `boolean` | |
| `source` | `string` | 'explanation' or 'prompt:<id>' |
| `started_at` | `string \| null` | |
| `completed_at` | `string \| null` | |
| `created_at` | `string` | |

**FKs:** evolution_explanation_id → EvolutionExplanation (required), strategy_config_id → Strategy (required), prompt_id → Prompt (optional), experiment_id → Experiment (optional)

**Schema changes needed:**
- ADD `evolution_explanation_id UUID NOT NULL REFERENCES evolution_explanations(id)` — every run links to its article
- ALTER `prompt_id` DROP NOT NULL — prompt is optional (explanation-based runs don't need a prompt)
- Legacy `explanation_id` INT column can be kept for backward compat or dropped (derived via evolution_explanations.explanation_id)

### 5. `Invocation`
**Table:** `evolution_agent_invocations` | **PK:** `id UUID` | **Admin:** `/admin/evolution/invocations/[id]`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `string` | UUID PK |
| `run_id` | `string` | **FK → Run** (CASCADE) |
| `iteration` | `number` | |
| `agent_name` | `string` | |
| `execution_order` | `number` | |
| `success` | `boolean` | |
| `cost_usd` | `number` | incremental per-invocation |
| `skipped` | `boolean` | |
| `error_message` | `string \| null` | |
| `execution_detail` | `AgentExecutionDetail \| Record<string, never>` | JSONB |
| `agent_attribution` | `AgentAttribution \| null` | JSONB |
| `created_at` | `string` | |

**Unique constraint:** `(run_id, iteration, agent_name)`

### 6. `Variant`
**Table:** `evolution_variants` | **PK:** `id UUID` | **Admin:** `/admin/evolution/variants/[id]`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `string` | UUID PK |
| `run_id` | `string` | **FK → Run** (CASCADE) |
| `evolution_explanation_id` | `string` | **FK → EvolutionExplanation** ⚠️ REPLACES explanation_id |
| `variant_content` | `string` | |
| `elo_score` | `number` | 0-3000 |
| `generation` | `number` | >= 0 |
| `parent_variant_id` | `string \| null` | **FK → Variant** (self-ref) |
| `agent_name` | `string` | |
| `quality_scores` | `Record<string, unknown>` | JSONB |
| `match_count` | `number` | |
| `is_winner` | `boolean` | |
| `cost_usd` | `number \| null` | |
| `elo_attribution` | `EloAttribution \| null` | JSONB |
| `created_at` | `string` | |

**FKs:** run_id → Run, evolution_explanation_id → EvolutionExplanation, parent_variant_id → Variant

### 7. `ArenaEntry`
**Table:** `evolution_arena_entries` | **PK:** `id UUID` | **Admin:** `/admin/evolution/arena/entries/[id]`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `string` | UUID PK |
| `topic_id` | `string \| null` | **FK → Prompt** (optional) ⚠️ CHANGE: currently NOT NULL |
| `evolution_explanation_id` | `string` | **FK → EvolutionExplanation** (required) ⚠️ NEW COLUMN |
| `strategy_config_id` | `string \| null` | **FK → Strategy** ⚠️ NEW COLUMN |
| `evolution_variant_id` | `string \| null` | **FK → Variant** |
| `content` | `string` | |
| `generation_method` | `ArenaGenerationMethod` | oneshot, evolution_winner, evolution_baseline, etc. |
| `model` | `string` | |
| `total_cost_usd` | `number \| null` | |
| `evolution_run_id` | `string \| null` | **FK → Run** |
| `metadata` | `Record<string, unknown>` | JSONB |
| `deleted_at` | `string \| null` | soft delete |
| `created_at` | `string` | |

**FKs:** evolution_explanation_id → EvolutionExplanation (required), topic_id → Prompt (optional), strategy_config_id → Strategy (optional), evolution_variant_id → Variant (optional), evolution_run_id → Run (optional)

**Schema changes needed:**
- ADD `evolution_explanation_id UUID NOT NULL REFERENCES evolution_explanations(id)` — every arena entry is about an article
- ADD `strategy_config_id UUID REFERENCES evolution_strategy_configs(id)` — links entry to the strategy that produced it
- ALTER `topic_id` DROP NOT NULL — prompt is optional (entry can exist without arena topic)

---

## Discussion: What about ArenaElo and ArenaComparison?

The `evolution_arena_elo` table has its own PK and FKs (entry_id → ArenaEntry, topic_id → Prompt) but functions as a **rating record** attached to an entry, not a standalone entity with its own admin section. Same for `evolution_arena_comparisons`.

**Recommendation:** These go in `secondary_entities.ts` alongside explanation types — they're important reference types but not one of the 7 core entities.

---

## Proposed Secondary Entities

Types that have their own table and FK relationships but don't have a dedicated admin section in the evolution dashboard:

- `EvolutionExplanation` — **NEW TABLE** `evolution_explanations`. The article identity for the evolution system. Links to `explanations` for existing articles, or stores prompt-generated seed content directly. This is the entity that `Experiment`, `Run`, `Variant`, and `ArenaEntry` all reference.
- `ArenaElo` — rating record for an arena entry (mu, sigma, display_elo, elo_per_dollar, match_count)
- `ArenaComparison` — pairwise comparison between entries (winner_id, confidence, judge_model, dimension_scores)

---

## Proposed Supporting Types

Everything else currently in `types.ts` and service files:

**Status/enum unions** (used as column types in core entities):
- `EvolutionRunStatus`, `PipelineType`, `PipelinePhase`, `AgentName`

**Config types** (JSONB shapes embedded in core entities):
- `StrategyConfig`, `EvolutionRunConfig`, `EvolutionRunSummary` + schema

**Attribution types** (JSONB shapes embedded in Variant/Invocation):
- `EloAttribution`, `AgentAttribution`

**Pipeline internals** (in-memory only, no DB table):
- `TextVariation`, `OutlineVariant`, `PipelineState`, `ExecutionContext`
- `Critique`, `MetaFeedback`, `DebateTranscript`, `Match`
- `AgentPayload`, `AgentResult`
- All 13 `AgentExecutionDetail` variants + union
- `LLMCompletionOptions`, `EvolutionLLMClient`, `EvolutionLogger`, `CostTracker`
- `DiffMetrics`, `Checkpoint`, `SerializedPipelineState`, `SerializedCheckpoint`
- Error classes, constants

**Visualization/UI shapes** (derived views, no own table):
- `DashboardData`, `TimelineData`, `EloHistoryData`, `LineageData`, `BudgetData`
- `VariantFullDetail`, `VariantListEntry`, `InvocationListEntry`, `InvocationFullDetail`
- All `*Input` types, `*Summary` types, `*Stats` types

**Runner/cost types:**
- `RunnerOptions`, `RunnerResult`
- `CostSummary`, `DailyCost`, `ModelCost`, `UserCost`

---

## Programmatic Type List Enforcement

Each file exports a const array for compile-time checking:

```typescript
// core_entities.ts
export const CORE_ENTITY_TYPES = [
  'Experiment', 'Prompt', 'Strategy', 'Run', 'Invocation', 'Variant', 'ArenaEntry',
] as const;
```

---

## Key Observations

1. **Core entities are pure data shapes** — they mirror DB rows with FKs as string IDs. No methods, no JSONB sub-types inlined, no derived/computed fields.

2. **JSONB column types live in supporting_types** — `StrategyConfig`, `EvolutionRunSummary`, `EloAttribution` etc. are referenced by core entities but defined separately since they're embedded shapes, not entities.

3. **Import direction**: `core_entities` imports from `supporting_types` for JSONB column types (StrategyConfig, EloAttribution, etc.). `secondary_entities` imports from both. Service files import from all three.

4. **Current types that map to core entities need renaming**: `PromptMetadata` → `Prompt`, `StrategyConfigRow` → `Strategy`, `EvolutionRun` stays or becomes `Run`, `EvolutionVariant` → `Variant`, etc.

5. **Service-local view types stay in services**: `ExperimentStatus`, `ExperimentSummary`, `VariantFullDetail`, `InvocationFullDetail` etc. are UI-specific projections and should stay in their service files or go to supporting_types, not core_entities.

---

## Code Files Read
- `evolution/src/lib/types.ts` — main types file (869 lines, 69+ exports)
- `evolution/src/lib/core/strategyConfig.ts` — StrategyConfig, StrategyConfigRow
- `evolution/src/lib/index.ts` — public API re-exports
- `evolution/src/services/evolutionActions.ts` — EvolutionRun, EvolutionVariant, VariantListEntry
- `evolution/src/services/experimentActions.ts` — ExperimentStatus, ExperimentSummary, ExperimentRun
- `evolution/src/services/arenaActions.ts` — ArenaTopic, ArenaEntry, ArenaEloEntry, ArenaComparison
- `evolution/src/services/evolutionVisualizationActions.ts` — DashboardData, TimelineData, InvocationListEntry, VariantDetail
- `evolution/src/services/variantDetailActions.ts` — VariantFullDetail, VariantRelative, VariantMatchEntry
- `evolution/src/services/eloBudgetActions.ts` — StrategyRunEntry, StrategyPeakStats
- `evolution/src/services/costAnalytics.ts` — CostSummary, DailyCost, ModelCost, UserCost
- `evolution/src/services/costAnalyticsActions.ts` — StrategyAccuracyStats
- `evolution/src/services/evolutionRunnerCore.ts` — RunnerOptions, RunnerResult
- `src/app/admin/evolution/` — all admin pages
- `supabase/migrations/` — all evolution table definitions (20+ migration files)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/reference.md
