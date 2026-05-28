# rename_agents_subagents_evolution_20260508 Research

## Problem Statement

We want a better way to surface the relationship between an "agent" (one row in `evolution_agent_invocations`) and the inner sub-units of work it performs ("subagents"). Wrapper agents like `ReflectAndGenerateFromPreviousArticleAgent` collapse multiple LLM phases (reflection → generation → ranking comparisons) into a single invocation row plus a nested `execution_detail` JSONB, leaving the inner structure opaque to researchers using the admin UI.

The user's framing: `generateFromPreviousArticle` includes generation + ranking; the reflection agent wraps `generateFromPreviousArticle`; the criteria/proposer/iterative-editing wrappers add eval / propose / approve / mirror / drift-recovery layers on top. The hierarchy exists in code but is not legibly exposed.

Despite the project's name ("rename_agents_subagents..."), the research strongly suggests the user can deliver value WITHOUT a global rename. The terminology gap is real, but the bigger payoff is surfacing the existing hierarchy in the UI.

## High Level Summary

Five rounds × 4 parallel Explore agents (20 total) mapped:

1. **Class hierarchy.** 9 concrete agent classes — 3 true wrappers (Reflect+Gen, EvalCriteria+Gen, SinglePassEvalCriteria+Gen) that call inner agent's `.execute()`; 3 quasi-wrappers (ProposerApprover, IterativeEditing, CreateSeedArticle) that orchestrate multiple LLM calls + a `rankNewVariant()` helper but don't call `Agent.execute`; 3 leaves (GFPA, SwissRanking, MergeRatings).

2. **Load-bearing invariant.** Wrappers call inner `.execute()`, NOT `.run()`. This keeps cost in one `AgentCostScope` so `cost_usd` on the wrapper invocation row is accurate. Calling `.run()` would create a second invocation row + scope and split costs. ~10 test files explicitly verify this invariant.

3. **DB hierarchy doesn't exist today.** No `parent_invocation_id` on `evolution_agent_invocations`. The only existing per-LLM-call hierarchy is `llmCallTracking.evolution_invocation_id` (FK on every individual LLM call), with `call_source: 'evolution_v2_<AgentName>'` encoding the phase.

4. **Inner-phase data IS captured** — but in `execution_detail` JSONB, not in queryable rows. Every wrapper writes per-phase cost / duration / detail nested under keys like `reflection.{cost,durationMs,...}`, `generation.{cost,...}`, `ranking.{cost,comparisons[]}`, `evaluateAndSuggest.{cost,...}`, `cycles[i].{proposeCostUsd,approveCostUsd,driftRecoveryCostUsd}`.

5. **Cost attribution is phase-centric, not agent-class-centric.** 12 `AgentName` labels (`generation`, `ranking`, `reflection`, `evaluate_and_suggest`, etc.) map via `COST_METRIC_BY_AGENT` to 9 metric buckets. The same label `evaluate_and_suggest` is emitted by 3 different wrapper classes — the metric tells you which phase ran, not which class orchestrated it.

6. **Admin UI special-cases each wrapper bespokely.** `InvocationDetailContent.tsx` renders 4 / 5 / 6 tabs depending on `agent_name`; `DETAIL_VIEW_CONFIGS` slices `execution_detail` keys via dot-notation; `InvocationTimelineTab.tsx` stacks colored phase bars. None of this is a tree view.

7. **Run Timeline shows wrapper invocations as a single bar.** Identical to a leaf invocation visually. No hint that `reflect_and_generate` contains 3 inner phases.

8. **Logger context already invocation-scoped.** Inner `.execute()` calls reuse the wrapper's invocationId for `evolution_logs.entity_id` AND record `phaseName` (= AgentName label). UI could reconstruct hierarchy from logs without DB changes.

9. **Terminology audit.** "Subagent" appears nowhere in code or docs. Existing canonical doc terms: "wrapper agent" (44x), "delegates to / delegation" (25x), "phase" (150+, overloaded), "cycle" (45x, editing-specific). Code uses "phase" (~392x logging) and "iteration" (~362x orchestrator) most heavily.

10. **Naming mismatch inside the existing system.** Strategy config side: `iterationConfig.agentType: 'reflect_and_generate'` (short). DB row: `agent_name: 'reflect_and_generate_from_previous_article'` (long). UI mapping: `KIND_CONFIG['reflect_generate']` (third form). Three strings for one concept.

11. **Two solution scopes possible:**
    - **Scope A — Pure surfacing (~2-4 h):** add a "Phases" tab or expand-to-reveal mini-bars on the run Timeline. No DB changes. No renames. Lowest risk.
    - **Scope B — Rename + surface (~16-24 h):** above + introduce explicit "subagent" / "wrapper agent / phase / step" vocabulary across class names, AgentName labels, metric names, docs. Breaks `evolution_strategies.config_hash` dedup, requires dual-accept Zod preprocessors (precedent: `baseline → seedVariant`, `strategy → tactic`). HIGH risk.

12. **Free OTel hierarchy is one short patch away.** `src/lib/services/llms.ts` already emits OTel spans per LLM call (Honeycomb destination). Wrappers don't currently `tracer.startActiveSpan` around inner `.execute()`, so child LLM spans are orphaned. ~5-line change in `Agent.run()` would give parent-child trace nesting in Honeycomb for free.

## Documents Read

- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/agents/overview.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/criteria_agents.md
- evolution/docs/curriculum.md
- evolution/docs/data_model.md
- evolution/docs/editing_agents.md
- evolution/docs/entities.md
- evolution/docs/evolution_metrics.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/variant_lineage.md
- evolution/docs/visualization.md
- docs/feature_deep_dives/admin_panel.md
- docs/feature_deep_dives/iterative_planning_agent.md

## Code Files Read

(via Explore subagents)

- `evolution/src/lib/core/Agent.ts` — abstract base; `run()` template-method with cost scope, partial-update invocation tracking, duration timing.
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts` — leaf agent, generation + rankNewVariant.
- `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts` — wrapper, calls inner GFPA `.execute()`.
- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` — wrapper.
- `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.ts` — wrapper.
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts` — quasi-wrapper.
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — quasi-wrapper, multi-cycle.
- `evolution/src/lib/core/agents/SwissRankingAgent.ts`, `MergeRatingsAgent.ts` — leaves.
- `evolution/src/lib/core/agentNames.ts` — `AgentName` type + `COST_METRIC_BY_AGENT` mapping.
- `evolution/src/lib/core/detailViewConfigs.ts` — `DETAIL_VIEW_CONFIGS` map keyed by detailType.
- `evolution/src/lib/schemas.ts` — `agentExecutionDetailSchema` discriminated union, ~12 detailType variants.
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — per-invocation client, `writeMetricMax` calls.
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — `createAgentCostScope`, `getOwnSpent`.
- `evolution/src/lib/pipeline/infra/createEntityLogger.ts` — `EntityLogContext`, invocation-scoped logger.
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — orchestrator, dispatches per `iterationConfigs[]`.
- `evolution/src/lib/metrics/registry.ts` — run/strategy/experiment metric defs, `SHARED_PROPAGATION_DEFS`.
- `evolution/src/lib/cost/getRunCostWithFallback.ts` — 4-layer cost fallback chain.
- `evolution/src/services/logActions.ts`, `invocationActions.ts`.
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — run-level Timeline with iteration cards and `KIND_CONFIG`.
- `evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx` — phase-bar visualization.
- `evolution/src/components/evolution/visualizations/LineageGraph.tsx` — D3 DAG (variant-centric).
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — bespoke 4/5/6-tab layouts.
- `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx`, `InvocationExecutionDetail.tsx`, `InvocationParentBlock.tsx`.
- `src/lib/services/llms.ts` — global LLM gateway, OTel spans per call.
- Various `.test.ts` files (~10 invariant + UI fixture files using full `agent_name` strings).
- `supabase/migrations/20260418*.sql` — variant lineage RPC + index pattern (precedent for self-ref FK design).

## Key Findings

### F1. Wrapper-to-subagent phase trees (current ground truth)

```
GenerateFromPreviousArticle (leaf)
├── generation LLM (label: 'generation')
└── rankNewVariant() helper
    └── ranking LLM × N (label: 'ranking', binary search)

ReflectAndGenerate (wrapper, calls GFPA.execute)
├── reflection LLM (label: 'reflection')
└── GenerateFromPreviousArticle.execute()  [collapsed, no own row]
    ├── generation LLM
    └── ranking LLM × N

EvalCriteriaThenGenerate (wrapper, calls GFPA.execute)
├── evaluate_and_suggest LLM (combined eval + suggest)
└── GenerateFromPreviousArticle.execute()  [collapsed]
    ├── generation LLM (with customPrompt from suggestions)
    └── ranking LLM × N

SinglePassEvaluateCriteriaAndGenerate
   (same shape as above; customPrompt has 3 extra guardrail directives)

ProposerApproverCriteriaGenerate (quasi-wrapper, no inner Agent.execute)
├── evaluate_and_suggest LLM
├── criteria_proposer LLM
├── (validate + drop edits, deterministic)
├── criteria_forward_approver LLM
├── criteria_mirror_approver LLM (optional, gated)
├── (aggregate + apply, deterministic)
└── rankNewVariant() helper
    └── ranking LLM × N

IterativeEditing (quasi-wrapper, no inner Agent.execute)
├── per cycle (1..N, up to 5):
│   ├── iterative_edit_propose LLM
│   ├── (parse + drift check, deterministic)
│   ├── iterative_edit_drift_recovery LLM (optional)
│   ├── (validate guardrails, deterministic)
│   ├── iterative_edit_review LLM
│   └── (apply, deterministic)
└── rankNewVariant() helper (once on final variant)
    └── ranking LLM × N
```

### F2. Existing per-LLM-call hierarchy via `llmCallTracking`

Every LLM call already gets a row with `evolution_invocation_id` FK + `call_source: 'evolution_v2_<AgentName>'`. The "Raw LLM calls" collapsed section in `InvocationParentBlock.tsx` already lists them per invocation, ordered by `created_at`. UI could group by `call_source` to show phase composition without any DB change.

### F3. Cost attribution invariant

`Agent.run()` builds a per-invocation `EvolutionLLMClient` bound to a per-invocation `AgentCostScope`. Every `recordSpend()` from inner `.execute()` calls goes through the SAME scope, so the wrapper's `cost_usd` is the sum of all inner LLM spend. Calling inner `.run()` instead would create a sibling scope and split costs. This is documented and tested.

Side effect: per-purpose metric writes (`generation_cost`, `ranking_cost`, `reflection_cost`, etc.) happen at the LLM-call level via `writeMetricMax`, NOT at the agent-class level. The metric `generation_cost` doesn't tell you whether a leaf GFPA or a wrapping ReflectAndGenerate did the work.

### F4. UI gap inventory (researcher journey for "what did this Reflect+Gen do?")

| # | Need | Where today | Pain |
|---|------|-------------|------|
| 1 | See invocation = 3 phases | Run Timeline | Single bar, no hint of inner structure |
| 2 | Tactic ranking + chosen | Invocation → Reflection Overview tab | OK; missing per-tactic confidence |
| 3 | Generation LLM call (prompt/response) | Invocation → Generation Overview → Raw LLM calls (collapsed) | Phase grouping is ad-hoc string parsing on `call_source` |
| 4 | Ranking comparisons table | InvocationTimelineTab phase bars + (only for non-wrapper GFPA) `comparisons[]` table | Wrapper invocations DON'T render the comparisons table — only sub-bars |
| 5 | Per-phase cost split | Tooltips on InvocationTimelineTab + Run-level Cost Estimates tab | No pivot from "phase X cost $Y" → "the LLM calls that produced $Y" |

### F5. Naming gaps

- `iterationConfig.agentType` short forms vs `agent_name` long forms vs UI `KIND_CONFIG` shortened forms — three strings per concept.
- `iterative_edit_rank_cost` metric defined in registry but NEVER written by any code — dead entry.
- `getRunCostWithFallback.ts` Layer 2 sums only 4 of 9 per-purpose cost metrics — gap that lets iterative_edit / proposer-approver / evaluation costs vanish from the Spent column when the rollup row is missing.
- "Subagent" not used anywhere; "wrapper agent" used 44× in docs and would be the natural canonical term.
- Per R4B, "phase" is overloaded (pipeline stage AND inner-execution-stage), "cycle" already means propose-review-apply pass in editing agents. A new term for "sub-unit-of-work inside a wrapper" might collide.

### F6. Solution options (lowest risk to highest)

**Option α: OTel parent-span hierarchy (~5-line patch).** Wrap inner `.execute()` calls with `tracer.startActiveSpan('agent-name', ...)` so child LLM spans become children. Honeycomb's trace UI then renders a nested timeline for free. Doesn't touch admin UI, but gives ops a hierarchy view immediately.

**Option β: Phases tab on invocation detail (no DB).** Read `execution_detail` keys + group `llmCallTracking` rows by `call_source`. Render an indented tree with phase name / duration / cost / per-LLM-call drill-down. Pure presentation. ~6-8 h.

**Option γ: Multi-segment bars in Run Timeline.** Each wrapper-invocation row becomes a stacked bar with chevron-to-expand into sub-rows showing phase name / duration / cost. Pure presentation. ~10-12 h.

**Option δ: New `evolution_invocation_phases` table.** Wrapper inserts one phase row per inner LLM call (or per logical step). Preserves load-bearing `.execute()` invariant since cost still rolls up to the wrapper invocation. Phase rows are display-only, hierarchy via FK. Migration is additive (no backfill). ~14-18 h.

**Option ε: Rename to formalize vocabulary.** Decide on canonical terms ("wrapper agent" + "phase" or "subagent"), update class names / `AgentName` labels / metric names / `agent_name` DB strings, doc prose, tests. HIGH risk — breaks `config_hash` dedup, requires dual-accept Zod preprocessors. ~16-24 h on top of α/β/γ.

## Open Questions

1. **Scope.** Pure surfacing (Options α + β) vs surfacing + rename (Options α + β + ε)? The research suggests starting with α + β; rename can come later once the hierarchy is visible.
2. **OTel-first or UI-first?** Option α is the cheapest but only benefits Honeycomb users. Option β makes the hierarchy visible to every researcher in the admin UI. Probably both, in series.
3. **Where does the hierarchy live?** New "Phases" tab on invocation detail page (Option β) vs expand-into-sub-rows in run Timeline (Option γ) vs both. Option β is more contained; Option γ touches a higher-traffic surface.
4. **Should `iterative_edit_rank_cost` (dead metric) be deleted, or wired up as part of this project?** It's already in `registry.ts` with propagation defs but never written.
5. **Should `getRunCostWithFallback.ts` Layer 2 be widened to sum all 9 per-purpose metrics, not just 4?** Independent bug; could be bundled here.
6. **Terminology decision.** If we DO rename, the docs already use "wrapper agent" 44 times — adopting it is the lowest-friction choice. Calling inner units "phases" reuses the heaviest existing term but keeps the overload with pipeline-level phases. Calling them "subagents" introduces a new term but breaks no existing usage.
7. **OTel parent-span change: does the existing test for the load-bearing `.execute()` invariant verify it still works after wrapping with `tracer.startActiveSpan`?** Probably yes (cost scope is unchanged), but worth confirming.

## Decision: Keep JSONB as the source of truth (2026-05-08)

We considered three data-layer options for representing wrapper → inner-phase composition:

1. **Status quo — JSONB only.** All sub-unit data lives in `evolution_agent_invocations.execution_detail`. UI derives the tree at render time.
2. **Additive subagents table alongside JSONB.** New display-only `evolution_invocation_phases` (or similar) table holds rows per sub-unit; JSONB still authoritative.
3. **Subagents table as authoritative; drop JSONB.** Full migration to a relational shape with `parent_subagent_id` self-FK.

We discussed (3) explicitly. Headline downsides for (3):

- **Custom per-agent backfill.** ~10K+ existing rows store sub-unit data in 6+ different JSONB shapes (GFPA, ReflectAndGenerate, EvalCriteria, ProposerApprover with `cycles[0]`, IterativeEditing with `cycles[0..N]`, etc.). Each needs a dedicated parser, plus tolerance for the historic NaN/Infinity/legacy-field-name rows already on file.
- **Months of dual-write coexistence.** Realistic phasing (dual-write → backfill → switch readers → stop writing JSONB → drop column) leaves every read site handling both formats during the rollover. ~10 read sites in admin UI plus services.
- **Velocity loss on the hottest area of the codebase.** Wrapper agent shapes have evolved monthly (criteria-driven, single-pass, propose-approve, mirror approver, drift recovery — all in the last 8 weeks). Each was a Zod-discriminated-union extension with no DB migration. Going to table-of-truth makes every new shape a migration + types regen + dual-accept tests.
- **Cost-scope invariant becomes harder to defend.** The load-bearing rule "wrappers call inner `.execute()` not `.run()`" is enforced today by the structural fact that only `Agent.run()` creates an invocation row. With per-sub-unit rows, engineer intuition will reach for "give each sub-unit its own scope" — silently breaks per-purpose cost attribution. Invariant moves from "enforced by code shape" to "enforced by code review."
- **Recursive parent-FK plumbing is cross-cutting.** Threading `ctx.parentSubagentId` through `rankNewVariant()`, per-cycle helpers, mirror-approver helpers, etc. — touches dozens of files; one missed plumb creates orphan rows.
- **Latency regression OR loss of the live-progress benefit.** Per-sub-unit INSERTs add ~5-20 round trips per invocation; batching at finalization erases the live-progress argument that motivated the table in the first place.
- **Rollback nightmare.** Once the JSONB column is dropped, any backfill bug means a reverse backfill — and corrupt rows that JSONB never had become load-bearing.
- **Marginal capability gain.** R5B Option 2 (additive table) already unlocks the only two things table-of-truth uniquely buys: cross-invocation queries and live mid-run progress. The remaining benefit is "JSONB column no longer exists" — code purity, not capability.

(2) is strictly cheaper than (3) and unlocks the same query shapes. Neither (2) nor (3) is needed for the project's stated goal (visibility on completed runs).

**Decision:** Stay on (1) for this project. Re-open the question and consider (2) — never (3) — only if one of these becomes a real product need:

- Live progress mid-run becomes a primary feature, not nice-to-have.
- Cross-invocation analytics that JSONB makes painful (e.g. "slowest L2 ranking subagents across last week's runs grouped by judge model").
- A new agent type emerges whose JSONB shape is irregular enough that it's genuinely hard to query.

If/when we revisit, the migration path stays open: add the table additively alongside JSONB; never authoritative.

## Recommended Direction (for brainstorm phase, not committed)

1. **Phase 1:** Option α (OTel parent-span ~5-line patch) — instant hierarchy in Honeycomb for ops.
2. **Phase 2:** Option β (Phases tab on invocation detail) — visible in admin UI; reuses `execution_detail` + `llmCallTracking`.
3. **Phase 3 (optional):** Option γ (run Timeline multi-segment bars) — only if Phase 2 demand justifies it.
4. **Phase 4 (deferred):** Option ε (rename) — only if a clear vocabulary emerges from Phases 1-3 use. Defer until terminology is proven, not invented.
5. Bundle the two minor cleanups (dead `iterative_edit_rank_cost` metric + Layer 2 fallback gap) into Phase 2.

This sequencing delivers value in week one (Phase 1), validates the UX in week two (Phase 2), and avoids high-risk renaming until the hierarchy is proven useful.
