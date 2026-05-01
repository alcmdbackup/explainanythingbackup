# Develop Reflection and GenerateFromParentArticle Agent Evolution Research

## Problem Statement
Create a new evolution-pipeline agent `ReflectAndGenerateFromPreviousArticleAgent` that, before generating a variant, runs ONE reflection LLM call to pick the best tactic from a configurable, randomized candidate list (with each candidate's recent ELO-boost stat injected). The reflection step must compose cleanly with the existing `GenerateFromPreviousArticleAgent` (GFPA) so a single invocation row covers the whole reflect+generate+rank flow. UI surfaces (Invocation detail, Timeline, Logs) extend without invasive rewrites; metrics flow naturally under the new agent name.

## Requirements (from GH Issue #NNN)
- Overview
    - This will be a new agent type
    - This will add a new reflection step in from of generateFromPreviousArticle
    - Please extend our existing agent code to make this code as much as possible
    - Re-use existing generateFromPreviousArticle in a modular way as much as possible
- Prompt
    - Read the existing parent
    - Pass in existing list of tactics, a brief summary of each, and the relative elo boosts of each based on performance data
        - Randomize the order with which tactics are passed in to prevent positional bias
    - Pick the best tactic to apply
- Pick the best tactic to use
    - Configurable input for # of tactics to try to apply
- Then call generateFromPreviousArticle

How should this work?

- All of this will be one agent, called reflectAndGenerateFromPreviousArticle
- Lightly modify same re-usable components for invocation details - see below for details

Existing details overview

- Reflection Overview - separate tab for reflection portion
- GenerateFromPreviousArticle Overview - re-use the existing tab for generateFromPreviousArticle
- Metrics - no change, only generateFromPreviousArticle produces metrics anyway
- Timeline - show additional calls used by reflection
- Logs - show logs from both

## High Level Summary

Five rounds of four parallel research agents (20 total) mapped the codebase end-to-end. The Agent framework has clean composition points: GFPA already takes `tactic` as an *input* (not selected internally), `Agent.run()` builds **one** scoped `EvolutionLLMClient` per invocation and injects it via `input.llm`, and `AgentCostScope.recordSpend()` aggregates cost from every LLM call into a single per-invocation `getOwnSpent()`. This means a wrapper agent can issue its own reflection LLM call and then delegate to the GFPA execution path within the same invocation row, with cost auto-attributed correctly — **provided we call inner GFPA logic via `.execute()`, NOT `.run()`** (otherwise we create a nested scope that splits cost). No prior pattern of nested agents exists.

The recommended schema shape (Shape B) adds two optional fields — `useReflection?: boolean` and `reflectionTacticCount?: number` (range 1–24) — to `iterationConfigSchema`, valid only when `agentType: 'generate'`. A separate Zod refinement requires `reflectionTacticCount` when `useReflection=true`. The strategy hash (`hashStrategyConfig`) already serializes the full `iterationConfigs` array, so adding fields automatically branches strategy rows. The wizard at `src/app/admin/evolution/strategies/new/page.tsx` gets a checkbox + number input nested under the existing per-iteration controls.

Tactic-effectiveness data needed for the reflection prompt comes from a live aggregate query against `evolution_variants` (joined to `evolution_runs` for `status='completed'` AND `is_test_content=false`) filtered by `prompt_id`, grouped by `agent_name`, computing mean(`elo_score - 1200`) per tactic. Fallback to global `evolution_metrics entity_type='tactic' metric_name='avg_elo_delta'` rows for cold-start prompts and low-sample tactics. The result is cached once per iteration in `AgentContext` (rather than re-queried per parallel agent dispatch).

The reflection prompt randomizes tactic ordering using existing infrastructure: `SeededRandom.shuffle()` (Fisher-Yates) with seed `deriveSeed(randomSeed, 'iter${iteration}', 'reflect_shuffle${execOrder}')` — same pattern as `MergeRatingsAgent`. Each tactic's summary uses `${label} — ${preamble}` from `TacticDef` (no existing summary helper — we add one). Output parser follows the priority chain pattern from `parseWinner` (`comparison.ts`) — exact match → phrase match → "Your answer:" scoped match → fuzzy match → fallback.

UI extension: `InvocationDetailContent.tsx` needs dynamic tab construction from `execution_detail` section keys (currently static per-agent_name). Two new Overview tabs: "Reflection Overview" (using a NEW `DETAIL_VIEW_CONFIGS['reflection_only']` config — the existing `'reflection'` entry is V1 dead code, do not reuse) and "GenerateFromPreviousArticle Overview" (reusing existing `DETAIL_VIEW_CONFIGS['generate_from_previous_article']`). Timeline tab extends to a 3-phase bar (reflection amber + generation blue + ranking purple) by reading `execution_detail.reflection.durationMs`.

A pre-existing **gap** surfaced: today's `Agent.run()` reuses the run-level logger (`ctx.logger`), so the LogsTab on every invocation detail page is effectively empty for ALL agents (verified by grep). To meet the "Logs - show logs from both" requirement, we recommend a **framework-level fix** in `Agent.run()` that creates an invocation-scoped logger (`createEntityLogger({ entityType: 'invocation', entityId: invocationId, ... })`) and passes it via both `extendedCtx.logger` and the `EvolutionLLMClient` builder. This retroactively populates LogsTab for GFPA, MergeRatings, SwissRanking, and CreateSeedArticle — backward-compat audit found zero test assertions on those log messages.

Cost estimation: the reflection LLM call adds ~$0.0005/agent (typical), negligible vs GFPA's ~$0.03. Concrete diffs to `agentNames.ts` (add `'reflection'` to `AGENT_NAMES`, add `'reflection_cost'` to `COST_METRIC_BY_AGENT`), `metrics/types.ts` (add `'reflection_cost'` to `STATIC_METRIC_NAMES`), `estimateCosts.ts` (new `estimateReflectionCost()`), and `projectDispatchPlan.ts` (add `reflection` field to `EstPerAgentValue`). The `evolution_metrics` table is EAV — no schema migration; propagation metrics (`total_reflection_cost`, `avg_reflection_cost_per_run`) flow via the existing `SHARED_PROPAGATION_DEFS` registry pattern.

Attribution dimension override: `getAttributionDimension(detail) → detail.tactic` (mirrors GFPA). Variants from the new agent will produce `eloAttrDelta:reflect_and_generate_from_previous_article:<tactic>` rows — naturally separated from GFPA's bars in `StrategyEffectivenessChart`. Charts are filter-agnostic and render new agent names transparently.

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/agents/overview.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/data_model.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- evolution/docs/sample_content/api_design_sections.md
- evolution/docs/sample_content/filler_words.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md
- evolution/docs/planning/multi_iteration_strategy_support_evolution_20260415/multi_iteration_strategy_support_evolution_20260415_planning.md
- docs/feature_deep_dives/multi_iteration_strategies.md
- docs/planning/multi_iteration_strategy_support_evolution_20260415/multi_iteration_strategy_support_evolution_20260415_planning.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/feature_deep_dives/variant_lineage.md

## Code Files Read

### Agent framework
- evolution/src/lib/core/Agent.ts — `run()` template method (lines 44–147), `AgentCostScope` wiring (60–61), per-invocation `EvolutionLLMClient` injection (68–79), invocation row create/update (52–55, 84–124), error hierarchy (131–146).
- evolution/src/lib/core/agents/generateFromPreviousArticle.ts — class structure (83–87), input shape `GenerateFromPreviousInput` (34–50), execute flow (145–302), `getAttributionDimension(detail) → detail.tactic` (91–93), `detailViewConfig` (102–143), invocation metrics (95–100).
- evolution/src/lib/core/agents/MergeRatingsAgent.ts — `usesLLM=false` opt-out pattern; Fisher-Yates shuffle template (187–195).
- evolution/src/lib/core/agents/SwissRankingAgent.ts — parallel pair dispatch pattern via `Promise.allSettled`.
- evolution/src/lib/core/agents/createSeedArticle.ts — example of agent making multiple LLM calls (`seed_title` + `seed_article`).
- evolution/src/lib/core/agentRegistry.ts — agent class registry (`getAgentClasses()`).
- evolution/src/lib/core/entityRegistry.ts — invocation metrics merging at lazy init (22–32).
- evolution/src/lib/core/agentNames.ts — typed `AGENT_NAMES` union (10), `COST_METRIC_BY_AGENT` mapping (22–27).
- evolution/src/lib/core/detailViewConfigs.ts — `DETAIL_VIEW_CONFIGS`; existing `'reflection'` entry (184–195) is V1 dead code.
- evolution/src/lib/core/types.ts — `DetailFieldDef` interface (187–194), `AgentContext` (137–178).
- evolution/src/lib/core/Entity.ts — entity logger and metric propagation contract.

### Tactic registry
- evolution/src/lib/core/tactics/index.ts — `ALL_SYSTEM_TACTICS`, `getTacticDef()`, `TACTIC_PALETTE`, `DEFAULT_TACTICS` (109–113).
- evolution/src/lib/core/tactics/types.ts — `TacticDef = { label, category, preamble, instructions }` (4–13).
- evolution/src/lib/core/tactics/generateTactics.ts — 24 system tactic definitions (7–189).
- evolution/src/lib/core/tactics/selectTacticWeighted.ts — weighted random selection accepting `SeededRandom` (19–61).
- evolution/scripts/syncSystemTactics.ts — DB sync (25–35); all 24 tactics share `agent_type='generate_from_previous_article'`.

### Pipeline orchestrator
- evolution/src/lib/pipeline/loop/runIterationLoop.ts — `evolveArticle` main loop, generate-iteration dispatch (316–639), parallel batch + top-up + merge (Phases 1–4), tactic resolution (342–350), GFPA instantiation (425–434), `resolveParent` for sourceMode=pool (385–399).
- evolution/src/lib/pipeline/loop/projectDispatchPlan.ts — single-source dispatch prediction; `IterationPlanEntry`, `EstPerAgentValue` (68–72), `weightedAgentCost` (179–195), `EXPECTED_GEN_RATIO`, `EXPECTED_RANK_COMPARISONS_RATIO`, `DISPATCH_SAFETY_CAP=100` (37).
- evolution/src/lib/pipeline/loop/rankNewVariant.ts — surface/discard wrapper around `rankSingleVariant`; reads `costTracker.getOwnSpent()` (74–90).
- evolution/src/lib/pipeline/loop/rankSingleVariant.ts — binary-search ranking; `compareWithBiasMitigation` call at 314–319; receives same `llm` client from `Agent.run()`.
- evolution/src/lib/pipeline/loop/buildPrompts.ts — `buildEvolutionPrompt(parentText, tactic)` template (16–31).
- evolution/src/lib/pipeline/setup/buildRunContext.ts — context construction; randomSeed init/persist (336–354); maps `iterationConfigs` to `EvolutionConfig`.
- evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts — `hashStrategyConfig` includes full `iterationConfigs` (29).
- evolution/src/lib/pipeline/setup/generateSeedArticle.ts — `seed_title` + `seed_article` prompt example (24–45).
- evolution/src/lib/pipeline/claimAndExecuteRun.ts — top-level `claimAndExecuteRun`, claimed run row carries `experiment_id`/`strategy_id`.
- evolution/src/lib/pipeline/infra/Agent context construction.
- evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts — per-call retry/backoff (3 attempts, 1s/2s/4s), `OUTPUT_TOKEN_ESTIMATES` (33–36), token approximation `chars/4`, logger consumption (111, 154, 158, 173, 181, 185).
- evolution/src/lib/pipeline/infra/estimateCosts.ts — `estimateGenerationCost`, `estimateRankingCost`, `estimateAgentCost` (122–134); `EMPIRICAL_OUTPUT_CHARS`.
- evolution/src/lib/pipeline/infra/costCalibrationLoader.ts — calibration phase enum (`'generation' | 'ranking' | 'seed_title' | 'seed_article'`) at 24, would extend with `'reflection'`.
- evolution/src/lib/pipeline/infra/trackBudget.ts — `createAgentCostScope` interceptor (51–66); `recordSpend` does BOTH `ownSpent += actual` AND `shared.recordSpend()`; `IterationBudgetExceededError`.
- evolution/src/lib/pipeline/infra/createEntityLogger.ts — `createEntityLogger(entityCtx, supabase)` (37–79); supports `entityType: 'invocation'`.
- evolution/src/lib/pipeline/infra/trackInvocations.ts — `createInvocation`, `updateInvocation` (13–49).
- evolution/src/lib/pipeline/finalize/persistRunResults.ts — variant persistence; `parent_variant_id`, `agent_invocation_id` plumbing.

### Comparison + format
- evolution/src/lib/comparison.ts — `buildComparisonPrompt`, `parseWinner` priority chain (340–371), `compareWithBiasMitigation` (forward+reverse 2-pass).
- evolution/src/lib/shared/computeRatings.ts — `formatElo`, comparison-prompt builder (312–336), `parseWinner` (340–371).
- evolution/src/lib/shared/reversalComparison.ts — `run2PassReversal` framework (288–299).
- evolution/src/lib/shared/comparisonCache.ts — LRU comparison cache; key normalization.
- evolution/src/lib/shared/formatRules.ts — `FORMAT_RULES` constant.
- evolution/src/lib/shared/enforceVariantFormat.ts — format validation.
- evolution/src/lib/shared/seededRandom.ts — `SeededRandom`, `deriveSeed` (74), `.shuffle()` Fisher-Yates (54–63).

### Metrics
- evolution/src/lib/metrics/types.ts — `STATIC_METRIC_NAMES` (22–66), `DYNAMIC_METRIC_PREFIXES` (`eloAttrDelta:`, `eloAttrDeltaHist:`).
- evolution/src/lib/metrics/registry.ts — propagation defs for run/strategy/experiment.
- evolution/src/lib/metrics/writeMetrics.ts — `writeMetric`, `writeMetricMax`.
- evolution/src/lib/metrics/readMetrics.ts — `getMetricsForEntities` chunked batch reads (71–114).
- evolution/src/lib/metrics/computations/tacticMetrics.ts — `computeTacticMetrics(db, tacticId, tacticName)` (30–165), `computeTacticMetricsForRun` (171); fires at run finalization only.
- evolution/src/lib/metrics/experimentMetrics.ts — `computeEloAttributionMetrics` (354–539); aggregates by `(agent_name, dimension)` from `evolution_agent_invocations.execution_detail.strategy` (which the GFPA agent writes as `tactic`).

### Services
- evolution/src/services/tacticActions.ts — `listTacticsAction`; batch metric reads via `getMetricsForEntities`.
- evolution/src/services/tacticPromptActions.ts — per-(tactic × prompt) live aggregation; query template (32–100).
- evolution/src/services/tacticStrategyActions.ts — per-(tactic × strategy).
- evolution/src/services/strategyRegistryActions.ts — `createStrategyAction`, validation via `iterationConfigSchema`.
- evolution/src/services/strategyPreviewActions.ts — wizard preview server actions.
- evolution/src/services/logActions.ts — `getEntityLogsAction`.
- evolution/src/services/shared.ts — `applyTestContentColumnFilter`, `applyNonTestStrategyFilter`, `evolution_is_test_name` echo (29).
- evolution/src/services/variantDetailActions.ts — variant detail with lineage chain.

### Schemas
- evolution/src/lib/schemas.ts — `iterationConfigSchema` (402–425), `strategyConfigSchema` (434–511), `generateFromPreviousArticleExecutionDetailSchema` (929–961).
- evolution/src/lib/pipeline/infra/types.ts — `EvolutionConfig`, `IterationResult`, `IterationStopReason`, `EstPerAgentValue`.

### UI components
- src/app/admin/evolution/invocations/[invocationId]/page.tsx — server wrapper.
- src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx — tabs (`TIMELINE_AGENTS = new Set(['generate_from_previous_article'])` at 11; `buildTabs(agentName)` at 13–23; conditional Overview rendering at 67–103).
- src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx — generic renderer for `DetailFieldDef[]` configs.
- src/app/admin/evolution/invocations/[invocationId]/InvocationExecutionDetail.tsx — config lookup at 36–37.
- evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx — 2-phase bar today (105–232); reads `execution_detail.{generation, ranking}.durationMs`; `GENERATION_COLOR='#3b82f6'`, `RANKING_COLOR='#8b5cf6'` (19–21); bucket aggregation for >20 comparisons.
- evolution/src/components/evolution/tabs/LogsTab.tsx — queries by entity_type+entity_id (32–90).
- evolution/src/components/evolution/charts/StrategyEffectivenessChart.tsx — `extractStrategyEntries()` parses `eloAttrDelta:<agent>:<dim>` (110–138); filter-agnostic.
- evolution/src/components/evolution/charts/EloDeltaHistogram.tsx — `extractHistogramBuckets()` (100–126).
- evolution/src/components/evolution/tabs/AttributionCharts.tsx — wrapper.
- evolution/src/components/evolution/DispatchPlanView.tsx — wizard preview renderer; consumes `IterationPlanEntry`.
- src/app/admin/evolution/strategies/new/page.tsx — wizard; `IterationRow` interface (34–46), `toIterationConfigsPayload` (88–101), per-iteration controls render block (~853–903), agentType select.

### Tests / fixtures (will need updating; see Migration section)
- evolution/src/testing/evolution-test-helpers.ts — `createTestStrategyConfig` (168–185), `createMockExecutionContext`.
- evolution/src/testing/v2MockLlm.ts — `createV2MockLlm`.
- evolution/src/testing/service-test-mocks.ts — chainable Supabase mocks.
- evolution/src/testing/executionDetailFixtures.ts — `reflectionDetailFixture` (56–76; V1 test-only artifact).
- evolution/src/lib/schemas.test.ts — schema validation tests.
- evolution/src/lib/pipeline/loop/runIterationLoop.test.ts — `makeConfig()` helper, mocks.
- evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts — hash test fixtures.
- evolution/src/lib/pipeline/setup/buildRunContext.test.ts — config mapping.
- evolution/src/lib/core/agents/generateFromPreviousArticle.test.ts — GFPA unit tests.
- evolution/src/lib/shared/seededRandom.test.ts — shuffle determinism (62–119).
- evolution/src/lib/core/tactics/selectTacticWeighted.test.ts — weighted-selection determinism (29–38).
- src/app/admin/evolution/_components/ExperimentForm.test.tsx — STRATEGIES fixture (38–81).
- evolution/src/services/strategyRegistryActions.test.ts, experimentActions.test.ts — service action mocks.
- src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts — wizard E2E.
- src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts — full-pipeline E2E.

## Key Findings

1. **GFPA is composable as-is**: `tactic` is already an *input* to `GenerateFromPreviousInput`, not selected internally. The wrapper agent picks the tactic via reflection, then passes the chosen tactic into the same generation+ranking flow GFPA uses today. Surface/discard logic, snapshot cloning, and rankSingleVariant invocation all reuse without modification.

2. **Single-invocation cost attribution is provably correct** (R3A3 proof chain): `Agent.run()` builds ONE `AgentCostScope` per invocation and ONE `EvolutionLLMClient` bound to that scope, injected via `input.llm`. Every LLM call (reflection + generation + N×ranking) routes through `scope.recordSpend()`, which both increments local `ownSpent` AND delegates to shared `V2CostTracker`. **Critical caveat**: the wrapper must call inner GFPA logic via `.execute()` (not `.run()`), or it creates a nested scope that splits cost. Implementation guidance: extract a shared `runGenerateAndRankPhase(input, ctx, tactic)` helper that GFPA's `execute()` and the wrapper both call, OR have the wrapper directly invoke `new GenerateFromPreviousArticleAgent().execute(...)`.

3. **Schema shape: Shape B** (R2A1, R2A4 converged). Add to `iterationConfigSchema`:
   ```typescript
   useReflection: z.boolean().optional(),
   reflectionTacticCount: z.number().int().min(1).max(24).optional(),
   ```
   plus refinements: only valid for `agentType: 'generate'`; `reflectionTacticCount` required when `useReflection=true`. Hash function already covers new fields. Backward compatible — existing strategies parse cleanly.

4. **Reflection prompt design** (R3A1): preamble (~120 chars) + parent text + randomized K-tactic list (`${index}. **${label}** — ${preamble}`) + ELO boost stats per tactic + structured ask ("Respond with ONLY the exact tactic name"). Total ~6,900 chars for a 5,000-char parent + 5 tactics — under GFPA baseline. Output parser `parseReflectionTactic` mirrors `parseWinner` priority chain (exact label match → phrase match → contains match → fuzzy/Levenshtein → fallback to highest-ELO tactic).

5. **Tactic summaries**: Use existing `TacticDef.preamble` field as the "summary" — it's already a 1-sentence LLM role assignment (~80–100 chars). New helper `getTacticSummary(name): string` returns `${label} — ${preamble}`.

6. **Mid-run tactic ELO query** (R5A2): live aggregate over `evolution_variants` joined to `evolution_runs` (status='completed', is_test_content=false) filtered by `prompt_id`, grouped by `agent_name`, computing mean(elo_score - 1200). Fallback to `evolution_metrics entity_type='tactic' metric_name='avg_elo_delta'` for tactics with <3 samples or cold-start prompts. Cache result once per iteration on `AgentContext.tacticEloBoosts: Map<string, number | null>`. New helper file: `evolution/src/services/tacticReflectionActions.ts`.

7. **Tactic-order randomization**: Reuse `SeededRandom.shuffle()` (Fisher-Yates) with seed `deriveSeed(ctx.randomSeed, 'iter${iteration}', 'reflect_shuffle${execOrder}')`. Same pattern as `MergeRatingsAgent.ts:187–195`. Reproducible: same run retried → same K candidates in same order → same prompt; LLM choice may vary (non-deterministic).

8. **Cost estimation diff** (R3A2):
   - Add `'reflection'` to `AGENT_NAMES` in `evolution/src/lib/core/agentNames.ts`.
   - Add `'reflection_cost'` mapping to `COST_METRIC_BY_AGENT`.
   - Add `'reflection_cost'` to `STATIC_METRIC_NAMES` in `evolution/src/lib/metrics/types.ts`.
   - Add `'reflection'` to phase enum in `costCalibrationLoader.ts`.
   - New `estimateReflectionCost(seedChars, generationModel, judgeModel)` in `estimateCosts.ts`.
   - Update `EstPerAgentValue` to include `reflection: number` field; thread through `weightedAgentCost`/`projectDispatchPlan`.
   - `OUTPUT_TOKEN_ESTIMATES.reflection = 50` (~200 chars).
   - Starting cost estimate: ~$0.0005/call (negligible vs $0.03 GFPA baseline).
   - Propagation metrics: `total_reflection_cost`, `avg_reflection_cost_per_run` via existing `SHARED_PROPAGATION_DEFS` registry pattern. EAV table — no schema migration.

9. **UI: Invocation detail page** (R2A3, R4A4): refactor `InvocationDetailContent.buildTabs()` to construct tabs dynamically from `execution_detail` section keys (currently static `TIMELINE_AGENTS = new Set(['generate_from_previous_article'])`). New tabs: `overview-reflection` (uses NEW `DETAIL_VIEW_CONFIGS['reflection_only']` config — DO NOT reuse existing `'reflection'` entry which is V1 dead code) + `overview-gfpa` (reuses existing `DETAIL_VIEW_CONFIGS['generate_from_previous_article']`). Metrics, Logs, Timeline tabs unchanged structurally.

10. **UI: Timeline 3-phase bar** (R4A1): add `REFLECTION_COLOR = '#f59e0b'` (amber). Read `execution_detail.reflection.durationMs` (optional). Update phase total math to include reflection. Bar startMs: reflection at 0, generation at `reflectionDurationMs ?? 0`, ranking at `(reflectionDurationMs ?? 0) + (generationDurationMs ?? 0)`. Add `'reflect_and_generate_from_previous_article'` to `TIMELINE_AGENTS`. Historic-row fallback: if `reflection.durationMs` missing, just don't render the third bar.

11. **UI: Wizard** (R4A3): concrete diff for `src/app/admin/evolution/strategies/new/page.tsx`. Add `useReflection?` and `reflectionTacticCount?` to `IterationRow`. Insert checkbox + number input (1–24, default 5) after the existing sourceMode/qualityCutoff block, gated by `it.agentType === 'generate'`. `toIterationConfigsPayload` conditionally emits both fields when `useReflection=true`. `DispatchPlanView` shows optional reflection-cost sub-line.

12. **Logs gap** (R4A2, R5A4) — **EXISTING** infrastructure problem: `Agent.run()` reuses run-level logger; LogsTab on invocation page is empty for ALL agents today (verified by grep — zero log calls inside agents emit invocation-scoped logs). **Recommended framework-level fix**: in `Agent.run()`, after `invocationId` creation, build `invocationLogger = createEntityLogger({ entityType: 'invocation', entityId: invocationId, runId, experimentId, strategyId }, db)`, pass via `extendedCtx.logger` and to `createEvolutionLLMClient(...)`. Keep run-level lifecycle logs (start/complete/error) on `ctx.logger`. Backward compat: zero test assertions on existing log messages (verified by grep). Retroactively benefits GFPA, MergeRatings, SwissRanking, CreateSeedArticle. Requires extending `AgentContext` with optional `experimentId`, `strategyId`, `db` fields (already partially present).

13. **Attribution dimension** (R5A1): override `getAttributionDimension(detail) → detail.tactic` mirroring GFPA. Variants from new agent emit `eloAttrDelta:reflect_and_generate_from_previous_article:<tactic>` rows. `StrategyEffectivenessChart` and `EloDeltaHistogram` are filter-agnostic — render new agent automatically. NOTE: `computeEloAttributionMetrics` currently hardcodes the dimension path as `execution_detail.strategy` (per Agent.ts:28–29 comment). Today, GFPA writes `execution_detail.tactic` AND the aggregator reads `.strategy` — there's an existing rename inconsistency. The new agent should write `execution_detail.tactic` for consistency with GFPA, and the planner should consider whether to migrate the aggregator to call `getAttributionDimension()` properly (separate scope).

14. **Tactic selection refactor**: orchestrator's external `selectTactic(i)` (round-robin or weighted via `selectTacticWeighted`) becomes per-iteration: when `iterCfg.useReflection=true`, the orchestrator builds `TacticCandidate[]` (K randomized + ELO boosts) and passes to wrapper agent input. Otherwise existing GFPA dispatch unchanged. Wrapper input shape adds `tacticCandidates: TacticCandidate[]` and removes `tactic: string` (or keeps both with mutual exclusion validation). Per-iteration `generationGuidance`, if set, MAY constrain the candidate list (open question — see below).

15. **Test impact** (R5A3): ~13 fixture files to update (`runIterationLoop.test.ts`, `buildRunContext.test.ts`, `findOrCreateStrategy.test.ts`, `evolution-test-helpers.ts`, `ExperimentForm.test.tsx`, etc.) and ~15 new tests to add (schema validation, hash distinctness, agent unit, prompt-parser, shuffle determinism, mid-run query cold-start/with-data, cost-attribution, budget enforcement, parallel dispatch, reflection-iteration timeline records, schema for new ExecutionDetail). E2E specs gain wizard checkbox interaction + invocation-detail two-tabs render + Timeline 3-phase bar checks. Schema is backward-compatible (optional fields).

## Resolved Decisions

All 6 open questions resolved during the post-research review:

1. **Tactic candidate-list size** — Default to **all 24 tactics** every reflection call. The `reflectionTacticCount` cap is dropped from the design entirely (cost delta is fractions of a cent per call; LLM gets the fullest signal). To keep prompts compact, write a helper `getTacticSummary(name)` that returns a **compressed 1–2 sentence summary** distilled from the existing `TacticDef.preamble + first sentence of instructions`. No K-of-24 selection policy needed.

2. **`generationGuidance` × reflection** — **Mutually exclusive** per iteration. If `useReflection=true` is set, `generationGuidance` must be undefined and vice versa. Enforced via Zod refinement on `iterationConfigSchema` AND by the wizard UI (selecting one disables the other's controls).

3. **Framework-level logger fix** — **In scope.** Modify `Agent.run()` to create an invocation-scoped logger (`createEntityLogger({ entityType: 'invocation', entityId: invocationId, ... })`) and pass it via both `extendedCtx.logger` and the `EvolutionLLMClient` builder. Run-level lifecycle logs (start/complete/error) stay on the run-level logger. Retroactively populates LogsTab for GFPA, MergeRatings, SwissRanking, CreateSeedArticle. Backward-compat verified — zero test assertions on existing log messages.

4. **Reflection reasoning + ranked output** — Capture full reasoning by default. Reflection returns a **ranked top-N list with per-tactic reasoning**, not a single choice. New optional `IterationConfig.reflectionTopN?: number` (range 1–10, **default 3**). Today's dispatch consumes only `tacticRanking[0]`; the tail is recorded for future multi-tactic generation and post-hoc analysis. Schema:
   ```
   reflection: {
     candidatesPresented: string[],     // 24 shuffled tactic names
     tacticRanking: Array<{tactic: string, reasoning: string}>,
     tacticChosen: string,              // = tacticRanking[0].tactic (denorm for SQL)
     durationMs?: number,
     cost?: number,
   }
   ```
   Future-work caveat: tactic conflicts (e.g., `compression_distill` ⊥ `expansion_elaborate`) need to be resolved before any multi-tactic generation ships.

5. **Aggregator wiring for `getAttributionDimension()`** — **In scope as cleanup.** Migrate `computeEloAttributionMetrics` (`evolution/src/lib/metrics/experimentMetrics.ts`) to look up the agent class via `getAgentClasses()` and call `agent.getAttributionDimension(detail)` instead of the hardcoded `execution_detail.strategy` read. Defensive fallback to the legacy path for unknown agent names. Adds a metrics-layer → agent-registry import. Pure architectural cleanup — zero user-facing change. Regression test required (assert GFPA-only fixture data produces identical aggregator output pre/post migration).

6. **Failure-mode handling** — **No deterministic fallback.** If the reflection LLM call throws OR the parser yields zero valid tactic entries, the wrapper throws (`ReflectionLLMError` / `ReflectionParseError`); `Agent.run()` catches it and marks the invocation row `success=false` with the error message. Partial `execution_detail` is preserved (e.g., `reflection.candidatesPresented` and the raw LLM response when the parser fails). This trades resilience for signal — every parser failure surfaces immediately, surfacing prompt-engineering gaps as queryable invocation rows rather than hiding behind a silent fallback. Schema sub-objects (`reflection`, `generation`, `ranking`) are individually optional so partial population validates.

## Recommended Architecture (with decisions applied)

- **New agent class** `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts`:
  - `name = 'reflect_and_generate_from_previous_article'`
  - `usesLLM = true`
  - Override `getAttributionDimension(detail) → detail.tactic`
  - `execute()`:
    1. Validate input has `tacticCandidates: TacticCandidate[]` (24 entries, pre-shuffled by orchestrator) and `tacticEloBoosts: Map<string, number | null>` (from cached query).
    2. Build reflection prompt: parent text + numbered candidate list (`${label} — ${compressedSummary}` + ELO boost) + structured top-N ask with reasoning.
    3. Call `input.llm.complete(reflectionPrompt, 'reflection', { model, invocationId })`.
    4. Parse output via `parseReflectionRanking` priority chain. Throw `ReflectionParseError` if zero valid tactics extracted.
    5. Validate each chosen tactic via `isValidTactic`; throw if any fail.
    6. Delegate to inner GFPA logic (call `.execute()` directly, NOT `.run()`) with `tactic = tacticRanking[0].tactic`. Same `ctx`, same scope, same `input.llm` — cost auto-attributes.
    7. Merge result detail: `{ reflection, ...gfpaDetail, tactic: tacticChosen }`. Return.

- **Orchestrator changes** in `runIterationLoop.ts`:
  - When `iterCfg.useReflection=true`:
    - Once per iteration: call `getTacticEloBoostsForReflection(db, promptId, ALL_TACTIC_NAMES)`; cache on `AgentContext.tacticEloBoosts`.
    - Per dispatch: shuffle `ALL_SYSTEM_TACTICS` via `SeededRandom(deriveSeed(randomSeed, 'iter${i}', 'reflect_shuffle${execOrder}')).shuffle(...)` to produce `tacticCandidates`. Pass into wrapper agent input alongside `tacticEloBoosts`.
    - Instantiate `ReflectAndGenerateFromPreviousArticleAgent` instead of `GenerateFromPreviousArticleAgent`.
  - Otherwise: existing GFPA dispatch unchanged.

- **Schema** in `evolution/src/lib/schemas.ts`:
  - Add `useReflection?: boolean` and `reflectionTopN?: number` (1–10) to `iterationConfigSchema`.
  - New refinement: `useReflection` only valid for `agentType: 'generate'`; mutually exclusive with `generationGuidance`.
  - New `reflectAndGenerateFromPreviousArticleExecutionDetailSchema` (sub-objects individually optional for partial-failure population).

- **Cost stack**: add `'reflection'` to `AGENT_NAMES`, `'reflection_cost'` to `COST_METRIC_BY_AGENT` and `STATIC_METRIC_NAMES`, `'reflection'` phase to `costCalibrationLoader`. New `estimateReflectionCost()` in `estimateCosts.ts`. Extend `EstPerAgentValue` with `reflection: number` field; thread through `weightedAgentCost` / `projectDispatchPlan`. `OUTPUT_TOKEN_ESTIMATES.reflection ≈ 600` (top-3 × ~200 chars output / 4 chars/token).

- **Mid-run query**: new file `evolution/src/services/tacticReflectionActions.ts` with `getTacticEloBoostsForReflection(db, promptId, tacticNames)`. Live aggregate over `evolution_variants` ⨝ `evolution_runs` (status=completed, is_test_content=false, prompt_id), grouped by `agent_name`, mean(elo_score - 1200). Fallback to `evolution_metrics entity_type='tactic' metric_name='avg_elo_delta'` for tactics with <3 samples or cold-start prompts. Cached once per iteration.

- **UI**: 
  - Dynamic tabs in `InvocationDetailContent.tsx` (driven by `execution_detail` section keys).
  - New `DETAIL_VIEW_CONFIGS['reflection_only']` for the Reflection Overview tab; reuse `DETAIL_VIEW_CONFIGS['generate_from_previous_article']` for the GFPA Overview tab.
  - 3-phase Timeline bar (amber reflection + blue generation + purple ranking).
  - Wizard checkbox + topN input under `agentType='generate'` controls; mutual exclusivity with tactic-guidance editor.

- **Framework**: invocation-scoped logger fix in `Agent.run()` (in scope).

- **Aggregator cleanup**: registry-driven attribution-dimension dispatch in `computeEloAttributionMetrics`.
