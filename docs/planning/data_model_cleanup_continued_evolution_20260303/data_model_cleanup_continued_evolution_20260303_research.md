# Data Model Cleanup Continued Evolution Research

## Problem Statement
Continuation of evolution data model improvements, focusing on generating a clean data model diagram, ensuring every key entity has a detail page, understanding relationships between entities, and making sure every detail page links to related entity detail views in the evolution admin dashboard.

## Requirements (from GH Issue #611)
1. Generate a clean diagram of the updated data model
2. Ensure every key entity has a "details" page that can be viewed
3. Understand relationships between entities
4. In the evolution admin dashboard, every "details" page for an entity (e.g. experiment) should link to detail views for related entities

## High Level Summary

The evolution system has 12 active database tables with rich FK relationships. Most first-class entities already have detail pages, but cross-linking between them is inconsistent. Several entities lack dedicated detail pages (Arena Entry, Arena Topic as a routable detail, Prompt, Strategy). The URL builder utility (`evolutionUrls.ts`) is missing builders for Strategy, Prompt, Arena Topic, and Arena Entry pages. Existing pages link to runs but often miss links to other related entities (variants, arena entries, strategies, experiments, prompts).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/data_model.md — Core primitives, FK relationships, migration history
- evolution/docs/evolution/architecture.md — Pipeline orchestration, data flow, agent framework
- evolution/docs/evolution/arena.md — Arena schema, unified pool model, sync workflow
- evolution/docs/evolution/reference.md — Complete schema reference, key files, CLI commands

## Code Files Read
- `evolution/src/lib/utils/evolutionUrls.ts` — URL builders (6 builders exist, 4+ missing)
- `src/app/admin/quality/evolution/page.tsx` — Runs list page
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail (5 tabs)
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` — Run comparison
- `src/app/admin/quality/evolution/article/[explanationId]/page.tsx` — Article detail
- `src/app/admin/quality/evolution/variant/[variantId]/page.tsx` — Variant detail
- `src/app/admin/quality/arena/page.tsx` — Arena topics list
- `src/app/admin/quality/arena/[topicId]/page.tsx` — Arena topic detail
- `src/app/admin/quality/optimization/page.tsx` — Strategy optimization
- `src/app/admin/quality/optimization/experiment/[experimentId]/page.tsx` — Experiment detail
- `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.tsx` — Experiment runs (links to run detail)
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.tsx` — No cross-links
- `src/app/admin/quality/strategies/page.tsx` — Strategy registry (links to runs)
- `src/app/admin/quality/prompts/page.tsx` — Prompt registry (links to runs)
- `src/app/admin/quality/explorer/page.tsx` — Unified explorer
- `src/app/admin/evolution-dashboard/page.tsx` — Dashboard overview
- `evolution/src/services/evolutionActions.ts` — Run CRUD actions
- `evolution/src/services/articleDetailActions.ts` — Article detail actions (5)
- `evolution/src/services/variantDetailActions.ts` — Variant detail actions (5)
- `evolution/src/services/arenaActions.ts` — Arena actions
- `evolution/src/services/promptRegistryActions.ts` — Prompt CRUD
- `evolution/src/services/strategyRegistryActions.ts` — Strategy CRUD + detail action
- `evolution/src/services/experimentActions.ts` — Experiment lifecycle actions
- `evolution/src/services/eloBudgetActions.ts` — Agent ROI and strategy leaderboard
- `evolution/src/services/evolutionVisualizationActions.ts` — 12 visualization actions

## Key Entities and Relationships

### Entity Inventory (12 active tables)

| # | Entity | Table | PK | Has Detail Page? | Has Detail Action? |
|---|--------|-------|----|------------------|--------------------|
| 1 | **Run** | `evolution_runs` | UUID | YES `/admin/quality/evolution/run/[runId]` | YES `getEvolutionRunByIdAction` |
| 2 | **Variant** | `evolution_variants` | UUID | YES `/admin/quality/evolution/variant/[variantId]` | YES `getVariantFullDetailAction` |
| 3 | **Article** | `explanations` | INT | YES `/admin/quality/evolution/article/[explanationId]` | YES `getArticleOverviewAction` |
| 4 | **Arena Topic** | `evolution_arena_topics` | UUID | YES `/admin/quality/arena/[topicId]` | YES `getArenaBankAction` |
| 5 | **Arena Entry** | `evolution_arena_entries` | UUID | NO (inline in topic detail) | PARTIAL (within topic) |
| 6 | **Arena Elo** | `evolution_arena_elo` | UUID | NO (joined with entry) | NO (joined) |
| 7 | **Arena Comparison** | `evolution_arena_comparisons` | UUID | NO (match history list) | NO (within topic) |
| 8 | **Strategy** | `evolution_strategy_configs` | UUID | NO (list page only, expandable rows) | YES `getStrategyDetailAction` |
| 9 | **Prompt** | `evolution_arena_topics` | UUID | NO (list page only, expandable rows) | PARTIAL (CRUD only) |
| 10 | **Experiment** | `evolution_experiments` | UUID | YES `/admin/quality/optimization/experiment/[experimentId]` | YES `getExperimentStatusAction` |
| 11 | **Agent Invocation** | `evolution_agent_invocations` | UUID | PARTIAL (modal in run timeline) | YES `getAgentInvocationDetailAction` |
| 12 | **Agent Metrics** | `evolution_run_agent_metrics` | UUID | NO (summary in run detail) | NO (aggregated) |

### Foreign Key Relationship Map

```
evolution_experiments
  └── evolution_runs.experiment_id → evolution_experiments(id)

evolution_arena_topics (aka Prompt)
  ├── evolution_runs.prompt_id → evolution_arena_topics(id)
  ├── evolution_arena_entries.topic_id → evolution_arena_topics(id)
  ├── evolution_arena_elo.topic_id → evolution_arena_topics(id)
  └── evolution_arena_comparisons.topic_id → evolution_arena_topics(id)

evolution_strategy_configs
  └── evolution_runs.strategy_config_id → evolution_strategy_configs(id)

evolution_runs
  ├── explanation_id → explanations(id)
  ├── prompt_id → evolution_arena_topics(id)
  ├── strategy_config_id → evolution_strategy_configs(id)
  ├── experiment_id → evolution_experiments(id)
  ├── evolution_variants.run_id → evolution_runs(id)
  ├── evolution_checkpoints.run_id → evolution_runs(id)
  ├── evolution_run_logs.run_id → evolution_runs(id)
  ├── evolution_agent_invocations.run_id → evolution_runs(id)
  ├── evolution_run_agent_metrics.run_id → evolution_runs(id)
  └── evolution_arena_entries.evolution_run_id → evolution_runs(id)

evolution_variants
  ├── run_id → evolution_runs(id)
  ├── explanation_id → explanations(id)
  ├── parent_variant_id → evolution_variants(id) [self-referential]
  └── evolution_arena_entries.evolution_variant_id → evolution_variants(id)

evolution_arena_entries
  ├── topic_id → evolution_arena_topics(id)
  ├── evolution_run_id → evolution_runs(id)
  └── evolution_variant_id → evolution_variants(id)

evolution_arena_elo
  ├── topic_id → evolution_arena_topics(id)
  └── entry_id → evolution_arena_entries(id)

evolution_arena_comparisons
  ├── topic_id → evolution_arena_topics(id)
  ├── entry_a_id → evolution_arena_entries(id)
  ├── entry_b_id → evolution_arena_entries(id)
  └── winner_id → evolution_arena_entries(id)
```

### URL Builders Inventory (`evolutionUrls.ts`)

| Builder | Exists? | URL Pattern |
|---------|---------|-------------|
| `buildRunUrl(runId)` | YES | `/admin/quality/evolution/run/[runId]` |
| `buildVariantUrl(runId, variantId)` | YES | `/admin/quality/evolution/run/[runId]?tab=variants&variant=[variantId]` |
| `buildVariantDetailUrl(variantId)` | YES | `/admin/quality/evolution/variant/[variantId]` |
| `buildArticleUrl(explanationId)` | YES | `/admin/quality/evolution/article/[explanationId]` |
| `buildExperimentUrl(experimentId)` | YES | `/admin/quality/optimization/experiment/[experimentId]` |
| `buildExplorerUrl(filters)` | YES | `/admin/quality/explorer?[filters]` |
| `buildExplanationUrl(explanationId)` | YES | `/results?explanation_id=[explanationId]` |
| `buildStrategyUrl(strategyId)` | **MISSING** | needs `/admin/quality/strategies?id=[strategyId]` or dedicated page |
| `buildPromptUrl(promptId)` | **MISSING** | needs `/admin/quality/prompts?id=[promptId]` or dedicated page |
| `buildArenaTopicUrl(topicId)` | **MISSING** | needs `/admin/quality/arena/[topicId]` |
| `buildArenaEntryUrl(topicId, entryId)` | **MISSING** | needs anchor or dedicated page |

## Cross-Linking Gap Analysis

### Current Cross-Links (EXIST)
1. Experiment RunsTab → Run Detail (via `buildRunUrl`)
2. Strategy page → Run Detail (via `buildRunUrl`) + Explanation (via `buildExplanationUrl`)
3. Prompt page → Run Detail (via `buildRunUrl`) + Explanation (via `buildExplanationUrl`)
4. Run Detail → Article History, Compare page, Variant Detail (via lineage tab)
5. Variant Detail → Run Detail, Article History
6. Arena Topic Detail → Run Detail, Run Compare (for evolution entries)
7. Dashboard → Runs list, Arena, Optimization

### Missing Cross-Links (GAPS)

#### Run Detail Page → Missing:
- Strategy detail (shows strategy name but doesn't link to strategy page)
- Prompt/Topic detail (doesn't link to arena topic)
- Experiment detail (if run is part of an experiment)
- Arena entries created from this run

#### Article Detail Page → Missing:
- Links from individual runs in runs list → Run Detail (unclear drill-in)
- Links from variants → Variant Detail

#### Variant Detail Page → Missing:
- Arena entry (if variant was synced to arena)

#### Arena Topic Detail → Missing:
- Entry → source Variant Detail (evolution entries don't link to source variant)
- Entry → Article History

#### Experiment Detail → Missing:
- Experiment overview → Prompt detail/Arena topic
- Experiment overview → Strategy detail
- No cross-links at all in ExperimentOverviewCard (zero Link imports)

#### Strategy Page → Missing:
- No dedicated detail page (uses expandable row)
- No link to experiments using this strategy
- No link to arena topics where this strategy produced entries

#### Prompt Page → Missing:
- No dedicated detail page (uses expandable row)
- No link to arena topic detail (even though prompt == arena topic!)
- No link to experiments using this prompt

#### Dashboard → Missing:
- Recent runs → Run Detail links
- No link to experiment detail

## Entities Needing Detail Pages

### Priority 1 — Missing dedicated pages for first-class entities:
1. **Strategy** — Has `getStrategyDetailAction` but no `/admin/quality/strategies/[strategyId]` page. Currently uses expandable rows on list page + modal in optimization page.

### Priority 2 — Entities with partial detail views:
2. **Prompt** — Prompts ARE arena topics (`evolution_arena_topics`), but the Prompt list page doesn't link to `/admin/quality/arena/[topicId]`. No dedicated prompt detail page either.
3. **Arena Entry** — Shown inline in topic detail. Could benefit from a dedicated detail page or at minimum deep-link anchors for sharing.
4. **Agent Invocation** — Shown in modal within run timeline. Already has rich `getAgentInvocationDetailAction`. Could be a standalone page for deep linking.

### Priority 3 — Supporting entities (detail pages not strictly needed):
5. Arena Comparison, Arena Elo, Agent Metrics, Checkpoints, Run Logs — these are supporting data best shown within parent entity detail pages.

## Data Model Cleanup Items

1. **Experiment→Prompt FK (1:1)**: `evolution_experiments.prompts` is currently `TEXT[]` (raw strings allowing multiple). Change to a single `prompt_id UUID FK` referencing `evolution_arena_topics`. Each experiment targets exactly one prompt. This enforces referential integrity, simplifies the data model, and enables direct navigation from Experiment to Prompt detail pages. Migration: add `prompt_id` column, backfill from `prompts[0]`, drop `prompts` column.
2. **Strategy reuse via hash dedup**: Confirmed — `resolveOrCreateStrategyFromRunConfig()` uses SHA-256 config hash. If a matching strategy exists, it's reused. No new strategy is created. This means Strategy↔Experiment is implicitly M:N through runs.
3. **Agent Invocation→Variant**: Agent invocations produce variants. Currently `evolution_variants.agent_name` tracks which agent created the variant, but there is no FK from variant to invocation. This is a logical relationship tracked by matching `agent_name` + `generation` (iteration) within a run.

## User Decisions

### DELETE: Article Detail Page
- **Page**: `/admin/quality/evolution/article/[explanationId]` (`src/app/admin/quality/evolution/article/[explanationId]/page.tsx`)
- **Server actions**: `articleDetailActions.ts` (5 actions: overview, runs, elo timeline, agent attribution, variants)
- **URL builder**: `buildArticleUrl(explanationId)` in `evolutionUrls.ts`
- **Reason**: Article should just be linked from experiment; a dedicated cross-run page is unnecessary.
- **Impact**: Remove page, actions, URL builder, and all inbound links (from run detail, variant detail, arena topic detail). Replace with direct links to the explanation's public results page where needed.

## Entity Diagram

See `evolution/docs/evolution/entity_diagram.md` for the canonical Mermaid diagram.

Core relationships:
- **Experiment** points to **Prompt** (1:1 via `prompt_id` FK) and creates **Runs** (1:N via `experiment_id` FK)
- **Strategy** connects to **Run** (1:N via `strategy_config_id` FK, reused via hash dedup)
- **Run** also points to **Prompt** (N:1 via `prompt_id` FK, inherited from experiment)
- **Run** owns **Agent Invocations** (1:N via `run_id` FK)
- **Agent Invocations** produce **Variants** (logical link via `agent_name` + `generation`)
- **Variant** has self-referential lineage (`parent_variant_id` FK)

## Open Questions
1. Should Strategy and Prompt get their own `[id]/page.tsx` detail pages, or should we add deep-link support (anchor/scroll) to the existing list pages?
2. Should Prompt page link directly to its Arena Topic detail page (since they share the same table)?
3. Should Arena Entry get its own detail page, or is the inline expansion in topic detail sufficient?
4. What diagram format is preferred? (Mermaid ER diagram in markdown, or a separate tool?)
