# Generalize to generateFromPreviousArticle Research

## Problem Statement

Today the generation agent is `generateFromSeedArticle` and always starts from the seed article. We want to generalize it to `generateFromPreviousArticle`, where the "previous" article can be either the seed or a high-quality variant already in the current run's pool. We also want to track parent relationships on variants so we can:

1. Display a variant's full lineage (chain of parents) with text diffs.
2. Attribute ELO change at the *variant* level (delta vs. parent).
3. Attribute ELO change at the *invocation/agent* level (which generation strategies/dimensions generate the most ELO lift).
4. Improve the variant invocation detail view for this agent.

## Requirements (from user)

- Change generateFromSeedArticle to generateFromPreviousArticle
    - Goal - transform either seed article or existing "good" variants in the pool
    - Source options - seed vs. run pool
        - First iteration must always be seed, later can be "run pool"
    - For "run variants" mode, add additional settings to be configured within iteration in strategy
        - Quality cutoff - two modes, top X or top X%
        - Can provide value of X
        - This means agent grabs a random article from "run pool" meeting the configured cutoff
    - Note
        - Can't take variants from pool, besides seed
        - If take from pool, then strategy results will be contaminated across runs
- Variant can have a parent in db
    - Parent should be visible from variants tab
    - Allow computation/display of full chain of parents if needed
- Update lineage tab in variant detail view
    - Allow a computation of diff vs. parents for visualization
    - Show full chain of parents
    - Look at tools to quickly compute and display this diff
- Be able to attribute elo increase vs. parent - at variant level
    - On variants tab on runs and strategies, and variants list view, every variant should should show identifier for its parent, elo/confidence intervals for parent, and elo change over parent
    - Audit to see we are not missing any other places where variant is shown
    - Explore if we have a standard component for displaying variants, both the individual list and the entries in the list
- Be able to attribute elo increase - at invocation level
    - Be able to break down agent type by the distribution of their increase in elo
    - This applies only to agents who generate new types of agents (not swiss for example which does ranking)
    - Within agent framework, for each agent, be able to define which dimensions matters for analysis purposes
    - Suggest how to incorporate this into agent and metric framework systematically
    - For generateFromPreviousArticle, focus on generation strategy (e.g. lexicalSipmlify)
- Improvements to variant invocation detail view for generateFromPreviousArticle
    - Suggest ways to improve the display

## High Level Summary

**Good news: ~60% of the infrastructure is already in place.**

- **Parent column exists.** `evolution_variants.parent_variant_id` is already present, and `GenerateFromSeedArticleAgent` already writes `parentIds: [seedVariantId]` (persisted as `parent_variant_id`). We do NOT need a new DB column for single-parent tracking.
- **Lineage UI already exists.** `VariantLineageSection.tsx` already renders parent/children/ancestor chain.
- **Diff library already installed.** `diff` v8.0.2 is in `package.json`, and an unused `TextDiff.tsx` component already exists (`Before | After | Diff` tabs, word-level).
- **Generation strategy already stored per invocation.** `execution_detail.strategy` on each invocation carries the dimension (e.g., `"lexical_simplify"`).
- **Per-invocation metrics already supported.** `METRIC_REGISTRY['invocation'].atFinalization` already has `best_variant_elo`, `variant_count`, etc. We can add `elo_delta_vs_parent` following the same pattern.

**What's genuinely new:**

1. **Agent rename + source-selection logic** (seed vs. pool + quality cutoff).
2. **Strategy config extension** — `IterationConfig` gets `sourceMode` and `qualityCutoff`.
3. **Variant-level ELO delta vs. parent** computed + surfaced in all list views and lineage tab.
4. **Invocation-level ELO attribution by dimension** — a declarative "dimension" field on each generation agent + an aggregate metric grouped by it.
5. **Lineage tab upgrade** — render `TextDiff` between each node and its parent, full chain visualization.
6. **Variants-tab audit** — ensure all three views (standalone, run/strategy tab, arena) show parent ELO + delta.

## Documents Read

- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/project_workflow.md`
- `evolution/docs/strategies_and_experiments.md`

## Code Files Read (via Explore agents)

- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — current agent (307 lines); 3 strategies hardcoded; `seedVariantId` input; `parentIds: [seedVariantId]` on variant creation.
- `evolution/src/lib/core/agentRegistry.ts` — lazy singleton registry.
- `evolution/src/lib/core/Agent.ts` — abstract base class; `invocationMetrics`, `detailViewConfig`.
- `evolution/src/lib/core/agents/SwissRankingAgent.ts`, `MergeRatingsAgent.ts` — do NOT produce variants.
- `evolution/src/lib/core/agents/createSeedArticle.ts` — produces the seed variant.
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — dispatch on `agentType` (lines 299–360).
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — `computeTop15Cutoff()` (lines 102–110).
- `evolution/src/lib/schemas.ts` — `iterationConfigSchema` (361–373), `strategyConfig` (380–449), `variantSchema` (67–77), `evolutionAgentInvocationInsertSchema` (178–196), `generateFromSeedExecutionDetailSchema` (876–908).
- `evolution/src/lib/types.ts` — `Variant`, `Rating`.
- `evolution/src/lib/metrics/registry.ts` — metric registry (110–209).
- `evolution/src/lib/metrics/writeMetrics.ts` — upsert to `evolution_metrics` (61–95).
- `evolution/src/lib/metrics/recomputeMetrics.ts` — lazy stale recompute.
- `evolution/src/lib/metrics/types.ts` — `DynamicMetricName = agentCost:${string}` (extensible).
- `src/lib/database.types.ts` — DB types (846–938) for `evolution_variants`, including `parent_variant_id`.
- `evolution/src/components/evolution/variant/VariantLineageSection.tsx` — current lineage tab.
- `evolution/src/components/evolution/visualizations/TextDiff.tsx` — exists, unused.
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — run/strategy variants tab.
- `evolution/src/components/evolution/visualizations/VariantCard.tsx` — compact variant card (not used in tables).
- `src/app/admin/evolution/variants/page.tsx` — standalone variants list.
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` — detail page.
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — invocation detail view, timeline only for `generate_from_seed_article`.
- `src/app/admin/evolution/invocations/[invocationId]/InvocationExecutionDetail.tsx` — config-driven detail renderer.
- `evolution/src/lib/core/detailViewConfigs.ts` — per-agent field definitions.
- `supabase/migrations/` — naming convention `YYYYMMDDHHmm00?_<desc>.sql`.

## Findings by Area

### 1. `generateFromSeedArticle` agent

- Class: `GenerateFromSeedArticleAgent` at `evolution/src/lib/core/agents/generateFromSeedArticle.ts`.
- Input: `{ originalText, strategy, llm, initialPool, initialRatings, initialMatchCounts, cache, seedVariantId }`.
- Output variant always carries `parentIds: [seedVariantId]` → persisted to `parent_variant_id`.
- 3 hardcoded generation strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance`.
- Registered in `agentRegistry.ts` alongside `CreateSeedArticleAgent`, `SwissRankingAgent`, `MergeRatingsAgent`.
- `execution_detail.detailType = 'generate_from_seed_article'` and `execution_detail.strategy` (literal string) captured per invocation.
- Registered in `DETAIL_VIEW_CONFIGS` in `detailViewConfigs.ts` for structured display.

### 2. Variant DB schema + seed/parent tracking

- `evolution_variants.parent_variant_id UUID NULL REFERENCES evolution_variants(id)` already exists.
- App-layer `Variant.parentIds: string[]` (array in memory, single-value in DB).
- Seed variant has `parent_variant_id = NULL` (it has no parent).
- No migration needed — `parent_variant_id` is already the authoritative parent pointer.
- For "full ancestor chain": recursive SQL CTE or iterative app-layer fetch — both are cheap (chains max out at ~20 iterations given `iterationConfigs.max === 20`).

### 3. Run pool access + quality cutoff feasibility

- Pool snapshot passed as `initialPool: ReadonlyArray<Variant>` (deep-clone at iteration start in `runIterationLoop.ts:299`).
- `initialRatings: ReadonlyMap<string, Rating>` provides ELO for every pool member.
- Implementing quality cutoff: filter `initialPool` by rating.elo vs. a computed threshold at **agent-input-construction time** (not inside the agent). Keeps agent pure.
- `computeTop15Cutoff` is a good model — we'll add `computeTopNCutoff(ratings, n)` and `computeTopPercentCutoff(ratings, pct)`.

### 4. Variant detail view, lineage tab, and diff tooling

- `VariantDetailContent.tsx` has 4 tabs: Content, Metrics, Matches, **Lineage**.
- `VariantLineageSection.tsx` shows: direct parent, direct children, horizontal ancestor chain (one hop at a time using `getVariantLineageChainAction`).
- `TextDiff.tsx` exists with `Before | After | Diff` tabs using `diffWordsWithSpace` — ready to drop into lineage tab.
- No side-by-side merge view; inline diff is sufficient.

### 5. Variant list components

- **Three distinct list surfaces**, none share a row component:
  - Standalone: `src/app/admin/evolution/variants/page.tsx` — columns: `ID | Run | Agent | Rating±CI | 95% CI | Matches | Generation | Parent | Winner`.
  - Run/strategy tab: `VariantsTab.tsx` — columns: `Rank | Rating±CI | 95% CI | Matches | Strategy | Iteration | Parent | Persisted | Actions`.
  - Arena: `src/app/admin/evolution/arena/[topicId]/page.tsx` — columns: `Rank | Elo±CI | 95% CI | Arena Matches | Generation Method | Cost | Parent`.
- All three already render `parent_variant_id` as a link. None currently show parent ELO or delta.
- **Opportunity:** introduce a shared `VariantRow` / `VariantParentBadge` component to avoid drift across the three surfaces.

### 6. Agent framework & invocation detail view

- `Agent<TInput, TOutput, TDetail>` abstract class exposes `invocationMetrics: FinalizationMetricDef[]` (per-agent registered metrics).
- Invocation detail view: `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` with tabs Overview, Metrics, Timeline (gated to `generate_from_seed_article`), Logs.
- `InvocationExecutionDetail.tsx` uses `DETAIL_VIEW_CONFIGS[detailType]` to config-render arbitrary fields.

### 7. Metric framework

- `METRIC_REGISTRY: Record<EntityType, EntityMetricRegistry>` at `evolution/src/lib/metrics/registry.ts`.
- Entity types: `run`, `strategy`, `experiment`, `variant`, **`invocation`**, `prompt`.
- Phases: `duringExecution`, `atFinalization`, `atPropagation`.
- Per-invocation metrics already supported — registry has `best_variant_elo`, `avg_variant_elo`, `variant_count`, `format_rejection_rate`, `total_comparisons`.
- Dynamic metric names: `DynamicMetricName = \`agentCost:${string}\`` — pattern extensible to e.g. `eloAttrDelta:<agent>:<dimension>`.
- Metric row shape: `{entity_type, entity_id, metric_name, value, sigma, ci_lower, ci_upper, n, origin_entity_*, aggregation_method, source, stale}`.

### 8. Contamination concern (from user)

The user flagged: **can't take variants from pool across runs — strategy results get contaminated**. Interpreting this: the "pool" a `generateFromPreviousArticle` invocation draws from is **only the current run's own pool** (the `initialPool` snapshot), never variants from *other* runs. Our implementation enforces this naturally because `initialPool` is already scoped to the current run.

However, we should NOT allow the seed-article source to be anything other than the run's own seed. The agent should never pull from the strategy-level variant archive.
