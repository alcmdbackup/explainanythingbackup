# evaluateCriteriaThenGenerateFromPreviousArticle Research

## Problem Statement

**EvaluateCriteriaThenGenerateFromPreviousArticle**

- Architecture
    - Look at how reflectAndGenerateFromPreviousArticle works
- "Criteria"
    - New top-level entity called criteria, pattern it on "tactics" of setup (including list view in evolution admin panel side nav, etc)
    - What it includes
        - Criteria name
        - Description - what it should be evaluating for specifically
        - Min rating (number)
        - Max rating (number)
- Prompt
    - Prompt 1
        - Read the existing parent
        - List of criteria to evaluate on and rating range
        - Rating for each criteria
    - Prompt 2
        - Focus on the criteria(s) that are the weakest
        - Return examples of what needs to be addressed, and suggestions of how to fix it.
        - Return this in a structured form of a list
- Strategy configuration
    - Pass in the list of criteria to evaluate
- Generation impact
    - Use evaluation and examples to generate new version
    - This replaces the "tactic" structurally
    - Figure out how to refactor to make this work

## Requirements (from GH Issue #NNN)

(Same content as Problem Statement above — verbatim user input.)

## High Level Summary

A new evolution agent `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` will run TWO LLM calls (evaluate parent against user-defined criteria, then extract structured fix-suggestions for the weakest criteria) BEFORE delegating to `GenerateFromPreviousArticleAgent.execute()` to produce a variant. The architecture mirrors the existing `ReflectAndGenerateFromPreviousArticleAgent` (Shape A, top-level `agentType: 'reflect_and_generate'` enum value) but with two critical differences:

1. **Criteria is a new user-defined DB-first entity** (not code-first like Tactic). Pattern after `evolution_prompts` CRUD: full `evolution_criteria` table with `name`, `description`, `min_rating`, `max_rating`, `status`, `is_test_content`, plus admin list/detail/edit/delete pages, sidebar nav, and server actions in `arenaActions.ts`-style.

2. **Generation is no longer driven by a tactic name**. Instead, the LLM-generated suggestions (structured `{example_passage, what_needs_addressing, suggested_fix}` triplets) feed into the inner GFPA's prompt via a NEW optional `customPrompt: { preamble, instructions }` field on `GenerateFromPreviousInput`. When set, GFPA bypasses `buildPromptForTactic` and uses the override directly. `Variant.tactic` becomes a static synthetic marker `'criteria_driven'` (added to `TACTIC_PALETTE` for color consistency); per-criteria detail lives in `execution_detail.weakestCriteria` and feeds attribution as `eloAttrDelta:evaluate_criteria_and_generate:<weakest_criteria_name>`.

The wrapper agent runs as ONE invocation with unified cost attribution (4 LLM calls: evaluate + suggest_fixes + generation + ranking, all under a single `AgentCostScope`). Three new typed agent labels (`'evaluate_criteria'`, `'suggest_fixes'`, possibly rolled up as `'evaluation_cost'`) plumb through `AGENT_NAMES`, `COST_METRIC_BY_AGENT`, `OUTPUT_TOKEN_ESTIMATES`, calibration loader phase enum, and `SHARED_PROPAGATION_DEFS`. Strategy hash canonicalization strips falsy `criteriaIds` so existing strategies don't re-hash.

UI: 6-tab invocation detail (Evaluate / Suggestions / Generation Overview / Metrics / Timeline / Logs) with a 4-phase Timeline bar (NEW emerald `EVALUATION_COLOR` + cyan `SUGGEST_COLOR` + existing blue/purple). Strategy wizard adds an `agentType: 'criteria_and_generate'` option with a per-iteration multi-select for `criteriaIds`, mutually exclusive with `generationGuidance` and `reflectionTopN`. DispatchPlanView shows a "Criteria: N" indicator on those iterations.

Kill-switch: `EVOLUTION_CRITERIA_EVALUATION_ENABLED !== 'false'` — when set to `'false'`, all `agentType: 'criteria_and_generate'` iterations fall back to vanilla GFPA dispatch. v1 defers per-criteria metric registration (`avg_score:<criteriaId>` etc.) — keep aggregates inside `execution_detail` only; add metric layer in a follow-up.

## Documents Read

### Core
- `docs/docs_overall/getting_started.md` — repo doc map.
- `docs/docs_overall/architecture.md` — system architecture, tech stack, V2 vs V1.
- `docs/docs_overall/project_workflow.md` — initialization/research/plan/execute workflow.

### Evolution (full directory)
- `evolution/docs/README.md` — doc map + reading order.
- `evolution/docs/architecture.md` — V2 config-driven loop, agent lifecycle, AgentCostScope invariant, kill-switch contract, B-bug invariants from 2026-04-23 hardening pass.
- `evolution/docs/agents/overview.md` — Agent.run() template method, 24 tactics, format validation, ReflectAndGenerateFromPreviousArticleAgent contract, attribution dimension extractors.
- `evolution/docs/data_model.md` — schemas for evolution_strategies, evolution_runs, evolution_variants, evolution_tactics, evolution_metrics; Zod boundary; agent_invocation_id threading.
- `evolution/docs/cost_optimization.md` — three-layer budget model, AGENT_NAMES + COST_METRIC_BY_AGENT, OUTPUT_TOKEN_ESTIMATES, calibration loader, AgentCostScope.
- `evolution/docs/rating_and_comparison.md` — Elo + uncertainty (OpenSkill internally), parseWinner priority chain, comparison cache, 2-pass reversal.
- `evolution/docs/strategies_and_experiments.md` — IterationConfig schema, sourceMode/qualityCutoff, generationGuidance, reflectionTopN, hashStrategyConfig, propagation defs.
- `evolution/docs/metrics.md` — evolution_metrics table, dynamic metric prefixes, eloAttrDelta:* family, propagation, stale recomputation, attribution extractors registry.
- `evolution/docs/arena.md` — leaderboard, syncToArena, seed variant handling.
- `evolution/docs/entities.md` — entity hierarchy, entity registry, dual-registry parity.
- `evolution/docs/reference.md` — file inventory by layer, kill-switches table, env vars, RLS, test-content classifier.
- `evolution/docs/visualization.md` — admin pages, EntityListPage, RegistryPage, DispatchPlanView, EntityMetricsTab, LogsTab.
- `evolution/docs/minicomputer_deployment.md` — runner deployment, env-file convention, kill-switch flips.
- `evolution/docs/curriculum.md` — onboarding path + glossary (Tactic, Strategy, Criteria — new term).
- `evolution/docs/logging.md` — EntityLogger, invocation-scoped logger (Phase 2 fix), denormalized FKs.

### Tracked precedent plans
- `docs/planning/develop_reflection_and_generateFromParentArticle_agent_evolution_20260430/_planning.md` — 12-phase precedent for wrapper agent shipping (cost-stack, schema, logger fix, agent class, orchestrator, aggregator, UI tabs, Timeline, wizard, docs).
- `docs/planning/track_tactic_effectiveness_evolution_20260422/_planning.md` — Blocker 2 wired `computeRunMetrics` into finalize path; tactic metric registry pattern; eloAttrDelta:* persistence; eventual-consistency caveat for arena drift.
- `docs/planning/generalize_to_generateFromPreviousArticle_evolution_20260417/_planning.md` — `parent_variant_id` semantics; sourceMode/qualityCutoff invariants; agent_invocation_id threading; lineage tab + bootstrapDeltaCI; ATTRIBUTION_EXTRACTORS registry pattern; load-bearing barrel-import.

## Code Files Read

### Agent infrastructure
- `evolution/src/lib/core/Agent.ts` — base class, `run()` template method, AgentCostScope construction, per-invocation EvolutionLLMClient injection, partial-update catch path.
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts` — class signature, `buildPromptForTactic`, execute flow, format validation, rankNewVariant integration, agent_invocation_id threading, attribution extractor.
- `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts` — full file: input/output types, `buildReflectionPrompt`, `parseReflectionRanking`, custom error types, execute flow with 3 try/catch error preservation paths, merge step with `totalCost` recompute, registration.
- `evolution/src/lib/core/agentRegistry.ts` — `_agents` array.
- `evolution/src/lib/core/entityRegistry.ts` — `tactic: new TacticEntity()` registration line 41.
- `evolution/src/lib/core/entities/TacticEntity.ts` — full entity class (8 metrics, listColumns, listFilters, actions=delete, detailTabs).
- `evolution/src/lib/core/entities/PromptEntity.ts` — full entity class (createConfig, listColumns, actions=rename/edit/delete, children cascade).
- `evolution/src/lib/core/tactics/index.ts` — ALL_SYSTEM_TACTICS, ALL_TACTIC_NAMES, getTacticDef, getTacticSummary, TACTIC_PALETTE.
- `evolution/src/lib/core/detailViewConfigs.ts` — DETAIL_VIEW_CONFIGS map; reflection_only, generate_from_previous_article, reflect_and_generate_from_previous_article entries.
- `evolution/src/lib/core/agentNames.ts` — typed AGENT_NAMES union + COST_METRIC_BY_AGENT mapping.

### Pipeline orchestrator
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — main loop, dispatchOneAgent closure, parallel batch + top-up, AgentContext per-dispatch construction, kill-switch resolution.
- `evolution/src/lib/pipeline/loop/reflectionDispatch.ts` — `resolveReflectionEnabled` helper.
- `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` — `EstPerAgentValue` (gen/rank/reflection/total), `weightedAgentCost`, dispatch projection.
- `evolution/src/lib/pipeline/loop/buildPrompts.ts` — `buildEvolutionPrompt` (preamble + source + feedback + instructions + FORMAT_RULES).
- `evolution/src/lib/pipeline/loop/rankNewVariant.ts` — binary-search ranking, top-15% local cutoff, surface/discard.
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — run-level AgentContext setup.
- `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` — `canonicalizeIterationConfig` (strips falsy optionals), `hashStrategyConfig`.
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — OUTPUT_TOKEN_ESTIMATES, calibration ladder, recordSpend lifecycle.
- `evolution/src/lib/pipeline/infra/estimateCosts.ts` — `estimateAgentCost`, `estimateReflectionCost`, REFLECTION_PROMPT_OVERHEAD.
- `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts` — phase enum.
- `evolution/src/lib/pipeline/infra/trackInvocations.ts` — `updateInvocation` partial-update conditional spread (Phase 2 fix).
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — `createAgentCostScope`, `getOwnSpent`.

### Schemas + metrics
- `evolution/src/lib/schemas.ts` — `iterationAgentTypeEnum`, `iterationConfigSchema` with refinements, `agentExecutionDetailSchema` discriminated union, `generateFromPreviousExecutionDetailSchema`, `reflectAndGenerateFromPreviousArticleExecutionDetailSchema`, `evolutionPromptInsertSchema`.
- `evolution/src/lib/metrics/types.ts` — STATIC_METRIC_NAMES, DYNAMIC_METRIC_PREFIXES.
- `evolution/src/lib/metrics/registry.ts` — METRIC_REGISTRY[entityType], SHARED_PROPAGATION_DEFS.
- `evolution/src/lib/metrics/experimentMetrics.ts` — `computeEloAttributionMetrics`, dimension dispatch via ATTRIBUTION_EXTRACTORS.
- `evolution/src/lib/metrics/attributionExtractors.ts` — `ATTRIBUTION_EXTRACTORS` map, `registerAttributionExtractor`.
- `evolution/src/lib/types.ts` — `Variant` interface, `createVariant` factory, `agentInvocationId` threading.
- `evolution/src/lib/shared/formatRules.ts` + `enforceVariantFormat.ts` — FORMAT_RULES, validateFormat.
- `evolution/src/lib/comparison.ts` — `parseWinner` priority chain.

### Server actions + UI
- `evolution/src/services/arenaActions.ts` — listPromptsAction, createPromptAction, updatePromptAction, archivePromptAction, deletePromptAction, toArenaEntry, getArenaTopicDetailAction.
- `evolution/src/services/tacticActions.ts` — listTacticsAction, getTacticDetailAction, getTacticVariantsAction, getTacticRunsAction.
- `evolution/src/services/tacticReflectionActions.ts` — `getTacticEloBoostsForReflection` (2-trip pattern).
- `evolution/src/services/strategyPreviewActions.ts` — `getStrategyDispatchPreviewAction`.
- `evolution/src/services/shared.ts` — `applyTestContentColumnFilter`, `applyNonTestStrategyFilter`.
- `src/app/admin/evolution/strategies/new/page.tsx` — 2-step wizard, IterationRow interface, agentType select, reflectionTopN input, sourceMode/qualityCutoff controls, TacticGuidanceEditor popover, `toIterationConfigsPayload`.
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — strategy multi-select pattern (custom checkbox grid + select-all), inline-create dialog for prompts.
- `src/app/admin/evolution/prompts/page.tsx` — RegistryPage usage, create/edit/delete dialogs.
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — `buildTabs(agentName)`, TIMELINE_AGENTS, 5-tab reflection layout.
- `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx` — generic field renderer.
- `src/app/admin/evolution/invocations/[invocationId]/InvocationExecutionDetail.tsx` — `keyFilter` slicing.
- `evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx` — 3-phase bar, REFLECTION_COLOR/GENERATION_COLOR/RANKING_COLOR.
- `evolution/src/components/evolution/tabs/InvocationParentBlock.tsx` — agent-name gate, parent ELO + delta CI display.
- `evolution/src/components/evolution/EntityListPage.tsx` — full props interface (inferred from prompts usage).
- `evolution/src/components/evolution/DispatchPlanView.tsx` — per-iteration row rendering.
- `evolution/src/components/evolution/charts/StrategyEffectivenessChart.tsx` — bar labels `<agent> / <dim>`.
- `src/components/admin/EvolutionSidebar.tsx` — sidebar nav entries (Prompts, Strategies, Tactics, Experiments, Runs, Variants, Invocations, Arena).
- `src/components/sources/SourceCombobox.tsx` — Combobox + multi-select pattern (precedent for criteria picker).

### Migrations referenced
- `supabase/migrations/20260415000001_evolution_is_test_content.sql` — `evolution_is_test_name(text)` IMMUTABLE function + BEFORE INSERT/UPDATE-OF-name trigger pattern (reusable for evolution_criteria).
- `supabase/migrations/20260417000001_evolution_tactics.sql` — pattern for thin entity table (id, name, label, agent_type, category, status, RLS).
- `supabase/migrations/20260423081160_add_is_test_content_to_prompts_experiments.sql` — extending the is_test_content trigger pattern.
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` — RLS pattern (deny_all + service_role_all + readonly_select).

## Key Findings

1. **Reference architecture is sound and reusable.** `ReflectAndGenerateFromPreviousArticleAgent` (Shape A: top-level `agentType: 'reflect_and_generate'`) provides a clean template. Mirror its file structure: input/output types → custom error types → prompt builder → parser → Agent class with `getAttributionDimension`, `detailViewConfig`, `invocationMetrics` → `execute()` flow with try/catch partial-detail writes → bottom-of-file `registerAttributionExtractor` call.

2. **Inner GFPA dispatch via `.execute()` is LOAD-BEARING.** Calling `.run()` creates a NESTED `AgentCostScope`, splitting cost attribution between wrapper and inner. Add `// LOAD-BEARING INVARIANT` comment block at the call site referencing this research doc.

3. **Tactic-driven generation refactor: Option B (custom prompt override) is recommended.** Add optional `customPrompt: { preamble: string; instructions: string }` to `GenerateFromPreviousInput`. When set, GFPA's `execute()` skips `buildPromptForTactic` and calls `buildEvolutionPrompt(override.preamble, 'Original Text', parentText, override.instructions)` directly. `FORMAT_RULES` injection is automatic. Minimal blast radius — Variant.tactic stays the same; attribution pipeline untouched. (Rejected alternatives: Option A pollutes `ALL_SYSTEM_TACTICS`; Option C duplicates agent logic; Option D over-engineers.)

4. **Variant.tactic for criteria-driven invocations: static `'criteria_driven'`.** Add `'criteria_driven': '#6366f1'` (or similar) to `TACTIC_PALETTE`. Per-invocation criteria detail lives in `execution_detail.weakestCriteria` (string array of names). Rationale: keeping `Variant.tactic` low-cardinality preserves lineage-graph color consistency; per-invocation details still reachable via `agent_invocation_id` join.

5. **Attribution dimension: weakest-criteria-name (Option a, refined).** `getAttributionDimension(detail) → detail?.weakestCriteria?.[0] ?? null` (or join multiple weakest with underscore). Produces `eloAttrDelta:evaluate_criteria_and_generate:<weakest_name>` rows. Cardinality manageable (~30 user-defined criteria). StrategyEffectivenessChart renders `evaluate_criteria_and_generate / clarity` etc. Sanitize: reject names containing `:`.

6. **Criteria entity is DB-first user-defined (NOT code-first like Tactic).** Mirror `evolution_prompts` pattern, NOT `evolution_tactics`. Required surface: (a) `evolution_criteria` migration with name UNIQUE, description, min_rating + max_rating NUMERIC + CHECK (max > min), status, is_test_content, archived_at, created_at, updated_at + RLS deny_all/service_role_all/readonly_select + BEFORE trigger reusing `evolution_is_test_name`; (b) Zod insert + full schemas in `schemas.ts`; (c) `CriteriaEntity` class in `evolution/src/lib/core/entities/`; (d) registration in `entityRegistry.ts`; (e) full CRUD server actions (list/detail/create/update/delete/archive); (f) admin pages list + detail using `EntityListPage` self-managed mode + `RegistryPage`-style FormDialog/ConfirmDialog; (g) sidebar nav entry in `EvolutionSidebar.tsx`; (h) NO sync script (criteria are user-defined). v1 SKIPS criteria-level metric registration.

7. **Strategy config wires criteria via `iterationConfig.criteriaIds: string[]`.** Add to `iterationConfigSchema` (Zod) with three refinements: only valid when `agentType === 'criteria_and_generate'`, non-empty array when present, mutually exclusive with `generationGuidance`. Add `'criteria_and_generate'` to `iterationAgentTypeEnum`. Update `isVariantProducingAgentType` to include it. Update `canonicalizeIterationConfig` to strip empty/undefined criteriaIds (keeps existing strategy hashes stable). FK enforcement is app-layer only (validate UUIDs exist + status='active' inside `createStrategyAction` before `upsertStrategy`).

8. **Cost stack additions: 2 new typed agent labels.** Add `'evaluate_criteria'` and `'suggest_fixes'` to `AGENT_NAMES`, `COST_METRIC_BY_AGENT` (mapping to `'evaluation_cost'` and `'suggest_fixes_cost'` respectively, OR rolled up to single `'evaluation_cost'`). Add to `STATIC_METRIC_NAMES` (run-level + total + avg-per-run). Add to `costCalibrationLoader` phase enum + `createEvolutionLLMClient` calibration ladder. Add `OUTPUT_TOKEN_ESTIMATES.evaluate_criteria = 300` (scales with criteria count) and `OUTPUT_TOKEN_ESTIMATES.suggest_fixes = 2000`. Add `evaluation` field to `EstPerAgentValue`. Add `estimateEvaluateCriteriaCost(parentChars, model, judge, criteriaCount)` and `estimateSuggestFixesCost(parentChars, model, judge)`. Propagate `total_evaluation_cost` and `avg_evaluation_cost_per_run` via `SHARED_PROPAGATION_DEFS`.

9. **Two LLM calls inside the wrapper need partial-detail preservation.** Apply the reflection pattern thrice: (a) capture `costBeforeEvaluate = ctx.costTracker.getOwnSpent?.() ?? 0`, call evaluate LLM, on throw write partial detail with `evaluation: { rawResponse?, parseError?, durationMs, cost }` via `updateInvocation(...)` then re-throw `CriteriaEvaluationLLMError`/`CriteriaEvaluationParseError`; (b) similar for suggest_fixes — partial detail must include the evaluation that succeeded plus partial suggest_fixes; (c) inner GFPA throw — partial detail must include both prior phases. Total cost recompute: `totalCost = evaluateCost + suggestCost + (gfpaDetail.totalCost ?? 0)`.

10. **Structured-output convention: line-pattern parsing, NOT JSON.** Codebase has zero `JSON.parse` for LLM output in evolution agents (sole exception: `generateSeedArticle` legacy fallback). `parseWinner`, `parseReflectionRanking` both use forgiving line-pattern regex with hard-throw on zero valid entries. Mirror this:
    - **Prompt 1 (evaluate)**: output format `<criteriaName>: <score>` per line; parser regex `/^([\w_]+)\s*:\s*(\d+(?:\.\d+)?)\s*$/m`; validate score ∈ [min_rating, max_rating]; drop unknowns; throw `CriteriaEvaluationParseError` if zero valid.
    - **Prompt 2 (suggest_fixes)**: output format with markdown delimiters per suggestion (e.g. `### Suggestion 1\nCriterion: ...\nExample: ...\nIssue: ...\nFix: ...`); block-level regex extracts triplets; throw `SuggestFixesParseError` if zero valid.

11. **Iteration-scoped data fetch pattern.** Mirror `getTacticEloBoostsForReflection`: fetch `evolution_criteria` rows for `iterCfg.criteriaIds` once at iteration start (before `dispatchOneAgent` closure is defined), inside try/catch (return empty Map on failure). Pass by reference to all parallel agents via new `AgentContext.evaluationCriteria?: Map<string, CriteriaRow>` field. Closure captures the local `let` so the same Map reference flows to every dispatch.

12. **Kill-switch + rollback playbook.** Add `EVOLUTION_CRITERIA_EVALUATION_ENABLED` env flag (default `'true'`; check `process.env.X !== 'false'`). Add `resolveCriteriaEvaluationEnabled(iterCfg, env)` helper alongside `resolveReflectionEnabled` in `reflectionDispatch.ts` (or new `criteriaDispatch.ts`). When `'false'`, all `agentType: 'criteria_and_generate'` iterations fall back to vanilla GFPA dispatch (with a default tactic). Document in `evolution/docs/reference.md` Kill Switches table.

13. **Strategy wizard UI: per-iteration multi-select for criteriaIds.** Add `criteriaIds?: string[]` to `IterationRow` interface. Render a button + popover (modeled on `TacticGuidanceEditor` but listing criteria from `listCriteriaAction({ status: 'active' })`) when `agentType === 'criteria_and_generate'`. Hide TacticGuidanceEditor + reflectionTopN + sourceMode/qualityCutoff controls in that mode. Empty-state with link to `/admin/evolution/criteria/new`. Inline-create dialog (mirroring prompt creation in ExperimentForm). Update `toIterationConfigsPayload` to conditionally emit `criteriaIds`.

14. **Invocation detail UI: 6-tab layout for new agent.** Tabs: Evaluate Overview / Suggestions Overview / Generation Overview / Metrics / Timeline / Logs. Add to `TIMELINE_AGENTS` set. Extend `buildTabs(agentName, executionDetail)` dispatcher. Add `evaluation_only` and `suggestions_only` entries to `DETAIL_VIEW_CONFIGS` for the keyFilter slicing (criteriaScored table, weakestCriteria badge, suggestion list). Add `EVALUATION_COLOR = '#10b981'` (emerald) and `SUGGEST_COLOR = '#06b6d4'` (cyan) to `InvocationTimelineTab.tsx`; render 4-phase bar (evaluation → suggestions → generation → ranking).

15. **DispatchPlanView updates.** Add `evaluation` field to `EstPerAgentValue` and propagate through `weightedAgentCost`. For preview, assume `criteriaCount = 5` as default (mirror `reflectionTopN ?? 3` pattern); runtime cost-tracker refines based on actual `evaluationCriteria.length`. Render "Criteria: N" indicator inline on the agentType badge when iteration is `criteria_and_generate`.

16. **Phase ordering** (10 phases for the criteria project; skipping reflection's logger fix and aggregator migration since they're shipped):
    - Phase 1: Criteria entity scaffolding (DB table + Zod + entity + admin CRUD + sidebar nav + server actions)
    - Phase 2: Schema & cost-stack foundation (iterationConfig.criteriaIds, AGENT_NAMES, STATIC_METRIC_NAMES, OUTPUT_TOKEN_ESTIMATES, calibration ladder, agentExecutionDetailSchema variant, hash canonicalization, fixture migration)
    - Phase 3: Cost estimation integration (estimateEvaluateCriteriaCost, estimateSuggestFixesCost, EstPerAgentValue, weightedAgentCost, getStrategyDispatchPreviewAction)
    - Phase 4: Mid-run criteria fetch (`getCriteriaForEvaluation` server action; AgentContext.evaluationCriteria field)
    - Phase 5: Wrapper agent class (`EvaluateCriteriaThenGenerateFromPreviousArticleAgent` with 2 LLM calls + inner GFPA dispatch + custom error types + partial-detail preservation + merge step)
    - Phase 6: GFPA `customPrompt` override field (Phase 5 depends on this; could move earlier but isolated edit makes Phase 5 cleaner)
    - Phase 7: Orchestrator integration (resolveCriteriaEvaluationEnabled, dispatchOneAgent branch, kill-switch gate, cost-estimation sizing, Zod refinements)
    - Phase 8: UI invocation detail tabs + Timeline 4-phase bar
    - Phase 9: Strategy wizard (agentType option, criteriaIds multi-select popover, mutual exclusivity, DispatchPlanView indicator)
    - Phase 10: Documentation updates (architecture.md, reference.md, agents/overview.md, strategies_and_experiments.md, metrics.md, plus new section in arena.md if the criteria-driven tactic surfaces on leaderboard)

17. **Tests directory layout matches existing conventions:**
    - Agent unit: `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.test.ts`
    - Schema: extend `evolution/src/lib/schemas.test.ts`
    - Hash: extend `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts`
    - Cost: extend `evolution/src/lib/pipeline/infra/estimateCosts.test.ts`
    - Entity: `evolution/src/lib/core/entities/CriteriaEntity.test.ts`
    - Server actions: `evolution/src/services/criteriaActions.test.ts`
    - Integration: `evolution/src/lib/pipeline/finalize/criteriaPipeline.integration.test.ts`
    - E2E: `src/__tests__/e2e/specs/09-admin/admin-evolution-criteria-leaderboard.spec.ts`, `admin-evolution-criteria-pipeline.spec.ts`, `admin-evolution-criteria-wizard.spec.ts`

18. **No DB rollback worry — additive-only.** New `evolution_criteria` table is additive; CI's destructive-DDL guard allows CREATE TABLE. Existing strategies continue to work because `iterCfg.criteriaIds === undefined` for all of them (canonicalization keeps the hash stable). The kill-switch env flag provides a single-flip rollback; no code revert needed.

## Open Questions

These need user clarification before planning is finalized:

1. **Single weakest criteria vs. multiple?** The requirements say "Focus on the criteria(s) that are the weakest" — plural. Should the wrapper auto-pick all criteria below some threshold (e.g., bottom 25%, or score below `min_rating + 0.2 * (max - min)`)? Or always pick top-K weakest where K is configurable per iteration (e.g., `weakestK: number`, default 1)? Recommendation: configurable `weakestK` (1-5, default 1) on the iteration config, so the strategy designer controls focus breadth.

2. **Cost rollup: one bucket or two?** Should `'evaluate_criteria'` and `'suggest_fixes'` each get their own metric (`evaluation_cost`, `suggest_fixes_cost`) or be rolled into one `evaluation_cost` for simpler dashboards? The reflection precedent uses a single `reflection_cost` even though reflection is conceptually one call; for our 2-call flow, a single `evaluation_cost` rolls cleaner. Recommendation: one combined `evaluation_cost` covering both LLM calls; the `execution_detail` already breaks down per-phase cost for forensics.

3. **Score range per-criteria vs. uniform?** The requirements have `min_rating` and `max_rating` per criteria. Should the LLM be told the range explicitly (e.g., "Score X on a scale of 1-10")? Or normalize all to 0-100 internally? Recommendation: pass per-criteria range to the LLM verbatim; parser validates score ∈ [min, max] and drops invalid scores (logs warn).

4. **Rollback behavior when kill-switch is `'false'`.** When `EVOLUTION_CRITERIA_EVALUATION_ENABLED='false'`, what tactic does the iteration use for vanilla GFPA dispatch? Reflection's fallback uses round-robin over the 3 core tactics. Should criteria iterations fall back to: (a) round-robin over core tactics, (b) the strategy's `generationGuidance` if present (but those are mutually exclusive — would have to relax that), (c) skip the iteration entirely (warn-log + 0 dispatches)? Recommendation: (a) — round-robin core tactics; preserves the iteration's variant production budget under degraded mode.

5. **Is per-criteria metric registration deferred to v2?** v1 keeps criteria-level analytics inside `execution_detail` only (no `evolution_metrics entity_type='criteria'` rows). Confirm this is acceptable — if researchers need a "Criteria Leaderboard" page like the Tactics leaderboard, that's a separate follow-up project. Recommendation: defer; ship v1 without criteria metric layer.

6. **Strategy config: criteriaIds at iteration level only, or strategy level too?** Reflection has `reflectionTopN` only at iteration level (no strategy-level fallback). Tactic guidance has both (strategy-level + per-iteration override). For criteria, do we need strategy-level + override, or just iteration-level? Recommendation: iteration-level only — keeps schema simple; strategies that use criteria evaluation across all iterations can repeat the same `criteriaIds` array per iteration.

7. **Variant.tactic field: static `'criteria_driven'` or per-criteria-marker?** Per Key Finding 4, we proposed static `'criteria_driven'`. Confirm: does the user want lineage-graph color-coded by which-criteria-was-weakest (per-invocation marker, ~30 colors needed) or by agent class (single color, simple)? Recommendation: static `'criteria_driven'` for v1; per-criteria color coding can be added via `getAttributionDimension` chart label later.
