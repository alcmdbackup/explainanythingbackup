# Investigate Sequential Paragraph Recombine Performance Plan

## Background
Investigate performance of most recent 4 paragraph recombine runs on stage and understand why performance is generally negative.

## Requirements (from GH Issue #1220)
Investigate performance of most recent 4 paragraph recombine runs on stage and understand why performance is generally negative.

## Problem
The most recent 4 `paragraph_recombine` runs on staging are scoring negatively (lower than seed paragraphs / negative score deltas / losing arena matches). The root cause is unknown — candidates include 402 wipeouts, high drop rates from per-rewrite filters, cost cap misconfiguration, judge decisiveness issues, structured-output gaps, or regressions from the recently-landed Sequential Context-Aware Generation work (commits e0026d653, 252119c5d, e5d7dbb5d on this branch's parent). We need to quantify the negativity, attribute it to a specific failure mode, and decide whether to fix the agent, the strategy config, or the judging.

## Options Considered
- [ ] **Option A: Pure investigation, no code changes** — produce a finding doc + recommended remediation list, leave fixes for follow-up project. Lowest risk; ships a clear report.
- [ ] **Option B: Investigation + targeted single fix** — if the root cause is unambiguous (e.g. one knob misconfigured), land the one-line fix in the same PR as the report. Faster end-to-end but couples diagnosis with treatment.
- [ ] **Option C: Investigation + framework upgrade** — if the negativity reveals a measurement gap (e.g. judge can't tell winners from losers on paragraph-scale edits), upgrade the framework. Largest scope; only chosen if A/B uncover a systemic measurement failure.

## Phased Execution Plan

### Phase 1: Data Pull (4 most recent staging runs)
- [ ] Query `evolution_runs` for the 4 most recent `paragraph_recombine` runs on staging (filter by strategy with agent_name='paragraph_recombine' OR by run_summary.agent).
- [ ] For each run: pull `status`, `run_summary.stopReason`, `error_code`, total `cost`, variant count, invocation count.
- [ ] Persist a small JSON or markdown table into `_research.md` so the findings are reproducible.

### Phase 2: Per-Invocation Breakdown
- [ ] For each invocation, extract `execution_detail.slots[*].rewrites[*]` — status, dropReason, temperature, costUsd.
- [ ] Aggregate: drop rate per slot, drop reason histogram, mean temperature, mean cost vs estimated cost (`estimationErrorPct`).
- [ ] Flag obvious anomalies (length_under > 50% on a slot, 402s in `execution_detail.generation.error`, cap-vs-actual ≫ 1).

### Phase 3: Arena Scoring Analysis
- [ ] For each run, query `evolution_arena_comparisons` for the slot topics (prompts named `[para] V<parent>%`).
- [ ] Compute per-variant: match_count, wins, losses, draws, Elo delta vs seed.
- [ ] Determine "negative performance" precisely: is mean Elo delta < 0? Is win rate < 50%? Is `score_delta` reported by `evolution_metrics` confirming the negativity?

### Phase 4: Root Cause Attribution
- [ ] Map each run to one of the known failure modes from debugging.md / cost_optimization.md / memory entries.
- [ ] If runs share a failure mode → that's the primary finding. If they diverge → produce a per-run attribution table.
- [ ] Check whether the recent Sequential Context-Aware Generation commits (e0026d653, 252119c5d, e5d7dbb5d) on this branch's parent overlapped any of the 4 runs.

### Phase 5: Findings & Recommendation
- [ ] Write findings into `_research.md` with the data tables.
- [ ] Decide which Option (A / B / C) above applies.
- [ ] If Option B or C: add a sub-phase with the targeted change + tests.

## Testing

### Unit Tests
- [ ] If a code change lands in Phase 5, add a unit test for it (path TBD until Option chosen).

### Integration Tests
- [ ] If a service change lands, extend `src/__tests__/integration/evolution-*.integration.test.ts` to lock in the fix.

### E2E Tests
- [ ] N/A unless Phase 5 changes UI; this is primarily a DB-investigation project.

### Manual Verification
- [ ] Re-run `npm run query:staging` queries from `_research.md` and confirm the findings reproduce on a fresh shell.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — investigation only, no UI work expected in Phase 1-4.

### B) Automated Tests
- [ ] If code lands: `npm run test -- --grep <relevant>` and any added integration spec.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] docs/feature_deep_dives/judge_evaluation.md — update if the finding implicates judge decisiveness
- [ ] docs/feature_deep_dives/metrics_analytics.md — update if the finding implicates metric definitions
- [ ] docs/feature_deep_dives/admin_panel.md — update if a new triage column / view is added
- [ ] docs/feature_deep_dives/search_generation_pipeline.md — update if generation orchestration changes
- [ ] docs/feature_deep_dives/request_tracing_observability.md — update if instrumentation changes
- [ ] docs/feature_deep_dives/error_handling.md — update if an error category is added
- [ ] docs/feature_deep_dives/testing_pipeline.md — update if A/B framework is exercised differently
- [ ] docs/feature_deep_dives/debugging_skill.md — likely: add a "paragraph_recombine negative performance" triage entry similar to existing arena_only-wipeout / cost-undershoot entries
- [ ] evolution/docs/paragraph_recombine.md — update if agent semantics change
- [ ] evolution/docs/cost_optimization.md — update if a new cost lever / failure mode is documented
- [ ] evolution/docs/rating_and_comparison.md — update if rating math interpretation changes
- [ ] evolution/docs/arena.md — update if arena comparison query changes
- [ ] evolution/docs/architecture.md — update if loop topology changes
- [ ] evolution/docs/data_model.md — update if schema additions
- [ ] evolution/docs/metrics.md — update if metric writer changes
- [ ] evolution/docs/evolution_metrics.md — update if new metric definitions
- [ ] evolution/docs/criteria_agents.md — update if criteria gain a new dimension
- [ ] evolution/docs/editing_agents.md — update if editing agent semantics change
- [ ] evolution/docs/multi_iteration_strategies.md — update if iteration knobs change
- [ ] evolution/docs/variant_lineage.md — update if lineage tracking changes
- [ ] evolution/docs/strategies_and_experiments.md — update if strategy registry gets entries
- [ ] evolution/docs/logging.md — update if a new logged field is added
- [ ] evolution/docs/reference.md — update reference index if any API surface changes

## Review & Discussion
_This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
