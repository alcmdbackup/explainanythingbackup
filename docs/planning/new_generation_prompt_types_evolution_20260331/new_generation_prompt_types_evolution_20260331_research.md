# New Generation Prompt Types Evolution Research

## Problem Statement
The evolution pipeline currently uses three hardcoded generation strategies: structural_transform, lexical_simplify, and grounding_enhance. There is no mechanism to explore new types of generation prompts or systematically measure which prompt strategies produce the best variants. This project will expand the generation prompt type library and implement a data-driven approach to measuring prompt effectiveness across runs and experiments.

## Requirements (from GH Issue #916)
- Explore new types of generation prompts besides "structural transform" and "lexical simplify"
- Systematically measure prompt effectiveness somehow

## High Level Summary

The generation strategy system is **completely hardcoded** with no extensibility mechanism. Three generation strategies and four evolution strategies are defined as TypeScript constants. Strategy effectiveness is partially tracked (per-run `strategyEffectiveness` in run_summary JSONB, variant `agent_name` attribution) but there is **no cross-run aggregation** of per-generation-strategy performance. The existing metrics and entity system provides a natural extension point via dynamic metric prefixes (like `agentCost:{name}`). Making strategies configurable requires a new `evolution_strategy_definitions` table and updates to `generateVariants()` to load definitions from DB instead of code.

---

## Key Findings

### 1. Current Generation Strategies (Hardcoded)

**File:** `evolution/src/lib/pipeline/loop/generateVariants.ts`

Three strategies defined as `STRATEGIES` const array + `STRATEGY_INSTRUCTIONS` Record:

| Strategy | Preamble | Target Dimension |
|----------|----------|-----------------|
| `structural_transform` | "AGGRESSIVELY restructure this text with full creative freedom" | Structure/flow |
| `lexical_simplify` | "Simplify the language of this text" | Clarity/readability |
| `grounding_enhance` | "Make this text more concrete and grounded" | Engagement (partially) |

**Selection logic:** `STRATEGIES.slice(0, config.strategiesPerRound ?? 3)` — always in order, no randomization.

### 2. Evolution Phase Strategies (Also Hardcoded)

**File:** `evolution/src/lib/pipeline/loop/extractFeedback.ts`

| Strategy | When | Target |
|----------|------|--------|
| `mutate_clarity` | Always (parent 0) | Clarity |
| `mutate_structure` | Always (parent 0) | Structure |
| `crossover` | If 2+ parents | Combines strengths |
| `creative_exploration` | If 0 < diversityScore < 0.5 | **Never fires** (default=1.0) |

### 3. Judging Dimensions vs Strategy Coverage

Variants are judged on 5 dimensions in `evolution/src/lib/comparison.ts`:
1. **Clarity and readability** — covered by `lexical_simplify` + `mutate_clarity`
2. **Structure and flow** — covered by `structural_transform` + `mutate_structure`
3. **Engagement and impact** — **WEAKLY covered** (only `grounding_enhance` partially)
4. **Grammar and style** — **NOT covered** by any generation strategy
5. **Overall effectiveness** — composite, not directly targetable

**Gap analysis:** Engagement and grammar/style are judged but no strategy specifically targets them. This means the pipeline judges variants on dimensions it doesn't optimize for.

### 4. Strategy Effectiveness Tracking (Current State)

**What's tracked:**
- **Per-run:** `run_summary.strategyEffectiveness` — `{ count, avgMu }` per strategy name
- **Per-variant:** `evolution_variants.agent_name` = strategy name, with `mu`, `sigma`, `elo_score`
- **Per-invocation:** `execution_detail.strategies[]` — name, status, variantId, formatIssues
- **Aggregated:** `evolution_metrics` with `entity_type='strategy'` — but this tracks pipeline-level strategies (model+iterations), NOT generation strategies

**What's NOT tracked:**
- Cross-run aggregation of per-generation-strategy performance
- Per-generation-strategy cost breakdown
- Strategy win rates across runs
- Strategy-vs-strategy head-to-head comparison
- Per-iteration strategy performance trends
- Format rejection rates per generation strategy (aggregated)

### 5. No Extensibility Mechanism

- `STRATEGIES` is a `const` array — cannot be extended at runtime
- `STRATEGY_INSTRUCTIONS` is a `Record<typeof STRATEGIES[number], ...>` — type-locked to the 3 names
- No DB table for strategy definitions (the existing `evolution_strategies` table stores pipeline config, not prompt definitions)
- No env vars, feature flags, or config files for strategy selection
- No plugin/registration system

### 6. Prompt Construction Pipeline

All prompts follow: `preamble → text → [feedback] → instructions → FORMAT_RULES → "Output ONLY..."`

Built by `buildEvolutionPrompt()` in `evolution/src/lib/pipeline/loop/buildPrompts.ts`. The strategy interface is effectively:
```typescript
{ preamble: string; instructions: string }
```

This is simple enough to be data-driven — no code logic, just two text fields.

### 7. Metrics System Extension Points

The metrics system supports dynamic metric prefixes (e.g., `agentCost:{agentName}`). This pattern could be extended for per-generation-strategy metrics:
- `genStrategy:{name}:avgMu` — average Elo of variants from this strategy
- `genStrategy:{name}:count` — number of variants produced
- `genStrategy:{name}:winRate` — fraction of runs where this strategy's variant won

These would be computed at finalization and stored in `evolution_metrics` table.

### 8. Test Infrastructure

- `generateVariants.test.ts` (122 lines) — tests strategy count, format validation, budget handling
- `extractFeedback.test.ts` (183 lines) — tests evolution mutations, crossover
- Mock LLM via `createV2MockLlm()` in `evolution/src/testing/v2MockLlm.ts`
- Tests assert `result.variants.length === 3` and strategy names — will need updates for configurable strategies

### 9. Admin UI Components

- **Run detail MetricsTab** — shows `strategyEffectiveness` table (name, count, avgMu)
- **Strategy detail page** — shows pipeline-level metrics, not per-generation-strategy
- **Experiment wizard** — selects pipeline strategies, no generation strategy config
- **EntityMetricsTab** — generic, renders any metrics from `evolution_metrics` table

### 10. Proposed New Generation Strategies

Based on gap analysis of judging dimensions:

| New Strategy | Target Dimension | Description |
|--------------|-----------------|-------------|
| `engagement_hooks` | Engagement/impact | Add compelling openings, rhetorical questions, surprising facts, vivid imagery |
| `style_polish` | Grammar/style | Improve sentence rhythm, vary sentence length, strengthen word choices, eliminate passive voice |
| `argument_strengthen` | Overall effectiveness | Sharpen thesis statements, add evidence, strengthen logical flow, address counterarguments |
| `narrative_weave` | Engagement | Transform exposition into narrative, add characters/scenarios, use storytelling techniques |
| `tone_transform` | Style | Shift register (academic→conversational or vice versa), adjust formality, unify voice |

---

## Design Options

### Option A: Hardcoded Extension (Simplest)
Add 2-5 new strategies directly to the `STRATEGIES` array and `STRATEGY_INSTRUCTIONS` Record. Increase default `strategiesPerRound` or add config to select which strategies run.

**Pros:** Minimal code changes, no DB migration, no UI changes needed
**Cons:** Still not configurable, requires code deploy to experiment with new strategies

### Option B: Data-Driven Strategies (Recommended)
New `evolution_strategy_definitions` table with `{ id, label, phase, preamble, instructions }`. Seed with existing 7 strategies. Extend `V2StrategyConfig` with `generationStrategies?: GenerationStrategyConfig[]` to reference definitions. Update `generateVariants()` to load from DB.

**Pros:** Fully configurable, admin can experiment without deploys, A/B testable
**Cons:** More complex, needs DB migration, UI for definition CRUD

### Option C: Hybrid (Pragmatic)
Add new strategies as hardcoded defaults, but also add per-generation-strategy metrics. Defer data-driven configuration to a future project.

**Pros:** Ships new strategies quickly, adds measurement immediately
**Cons:** Doesn't solve the configurability problem

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — documentation structure
- docs/docs_overall/architecture.md — system design, action wrapping, schema-first
- docs/docs_overall/project_workflow.md — execution steps

### Relevant Docs
- evolution/docs/data_model.md — all DB tables, RLS, RPCs, type hierarchy
- evolution/docs/architecture.md — 3-op loop, generate/rank/evolve phases, content resolution
- evolution/docs/agents/overview.md — GenerationAgent, RankingAgent, Agent.run() template, prompt construction
- evolution/docs/strategies_and_experiments.md — V2StrategyConfig, strategy hashing, experiment lifecycle
- evolution/docs/reference.md — file inventory, configuration, env vars
- evolution/docs/curriculum.md — learning path, key file reading order
- evolution/docs/visualization.md — admin UI pages, shared components, server actions
- evolution/docs/logging.md — EntityLogger, log aggregation, LogsTab
- evolution/docs/rating_and_comparison.md — OpenSkill ratings, triage, Swiss ranking, bias mitigation

## Code Files Read
- `evolution/src/lib/pipeline/loop/generateVariants.ts` — STRATEGIES array, STRATEGY_INSTRUCTIONS, buildPrompt, generateVariants function
- `evolution/src/lib/pipeline/loop/buildPrompts.ts` — buildEvolutionPrompt, feedbackSection
- `evolution/src/lib/pipeline/loop/extractFeedback.ts` — evolution strategies, mutate/crossover/creative prompts
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — strategyEffectiveness computation, variant finalization
- `evolution/src/lib/shared/enforceVariantFormat.ts` — FORMAT_RULES, validateFormat
- `evolution/src/lib/types.ts` — Variant interface, createVariant factory
- `evolution/src/lib/schemas.ts` — Zod schemas, EvolutionConfig, V2StrategyConfig
- `evolution/src/lib/pipeline/strategy.ts` — hashStrategyConfig, upsertStrategy
- `evolution/src/lib/core/metricCatalog.ts` — METRIC_CATALOG (25 metrics)
- `evolution/src/lib/core/entityRegistry.ts` — entity registration, agent metric merging
- `evolution/src/lib/core/entities/RunEntity.ts` — run metric definitions
- `evolution/src/lib/core/entities/StrategyEntity.ts` — strategy propagation metrics
- `evolution/src/lib/core/entities/InvocationEntity.ts` — invocation metrics
- `evolution/src/lib/metrics/registry.ts` — METRIC_REGISTRY
- `evolution/src/lib/metrics/writeMetrics.ts` — writeMetric function
- `evolution/src/lib/metrics/computations/finalization.ts` — run finalization metric compute functions
- `evolution/src/lib/metrics/computations/propagation.ts` — aggregateBootstrapMean, aggregateSum, etc.
- `evolution/src/lib/comparison.ts` — comparison prompt (5 judging dimensions)
- `evolution/src/services/strategyRegistryActionsV2.ts` — strategy CRUD actions
- `evolution/src/services/variantDetailActions.ts` — variant query API
- `evolution/src/testing/v2MockLlm.ts` — mock LLM factory
- `evolution/src/lib/pipeline/loop/generateVariants.test.ts` — generation tests
- `evolution/src/lib/pipeline/loop/extractFeedback.test.ts` — evolution tests
- `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — full loop tests
- `evolution/src/components/evolution/tabs/MetricsTab.tsx` — strategy effectiveness display
- `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx` — generic metrics tab
- `src/app/admin/evolution/start-experiment/page.tsx` — experiment creation wizard
- `src/app/admin/evolution/strategies/page.tsx` — strategy list page
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — experiment wizard form
- `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` — strategy config rendering

## Open Questions
1. Should new strategies be added incrementally (a few at a time) or all at once?
2. Is Option A (hardcoded) or Option B (data-driven) preferred for the first iteration?
3. Should the `creative_exploration` strategy be fixed (it never fires due to diversityScore default)?
4. What budget increase is acceptable per run when running more strategies? (more strategies = more LLM calls = higher cost)
5. Should there be a "strategy selection" mechanism (random subset per iteration) or should all configured strategies run every iteration?
