# Investigate Paragraph Rewrite Cost Undershoot Evolution Plan

## Background
Investigate why paragraph rewrite invocations are undershooting their budget by so much by querying Supabase stage.

## Requirements (from GH Issue #NNN)
Investigate why paragraph rewrite invocations are undershooting their budget by so much by querying Supabase stage.

## Problem
Paragraph rewrite (`paragraph_recombine`) invocations on staging are consistently coming in well below their reserved per-invocation budget. The projector's expected envelope at default knobs (12 slots × 3 rewrites × 8 comparisons) is ~$0.011/variant with a $0.40 per-invocation cap and a 0.9× pre-final-ranking gate — but actual spend on recent staging runs has been substantially smaller. The goal of this project is to query staging Supabase, quantify the gap, and identify whether the cause is (a) projector over-estimation, (b) a per-slot self-abort firing too early, (c) systematic LLM-call short-circuits (e.g. `length_under` drops skipping per-slot ranking), or (d) cost-attribution bookkeeping under-counting real spend. Refine after `/research`.

## Options Considered
- [ ] **Option A: Projector recalibration**: If the projector is conservatively over-estimating, recalibrate `estimateParagraphRecombineCost` and/or the underlying `EMPIRICAL_OUTPUT_CHARS` / `OUTPUT_TOKEN_ESTIMATES` for `paragraph_rewrite` and `paragraph_rank` against measured staging data (or rely on the existing `evolution_cost_calibration` shadow path).
- [ ] **Option B: Per-slot budget rebalance**: If per-slot self-abort or pre-final-ranking gate is firing too early (e.g. one slot blows budget and starves siblings), raise the per-slot or invocation thresholds, or change the per-slot budget allocation strategy.
- [ ] **Option C: Drop-rate-driven short-circuit fix**: If `length_under` (or other validator) drops are causing many slots to skip ranking entirely, address the upstream rewrite quality so the budget is actually spent on ranking instead of left unspent.
- [ ] **Option D: Cost-attribution audit**: If `paragraph_recombine_cost` is silently under-counting (e.g. the once-per-invocation SUM write loses per-call live writes because the per-slot LLM client has no db/runId), fix the bookkeeping rather than the dispatch.
- [ ] **Option E: No-op (projector is right, undershoot is acceptable)**: Document the cost envelope and the reasons real runs land below it; close without code changes.

## Phased Execution Plan

### Phase 1: Query staging and quantify the gap
- [ ] Use `npm run query:staging` to enumerate recent `paragraph_recombine` invocations on staging: invocation id, run id, `cost_usd`, `execution_detail.slots[*].spentUsd`, slot count, per-slot drop counts, surfaced count, and the configured `perInvocationCap`.
- [ ] For each invocation, compute `(reserved_per_invocation_cap - actual_invocation_cost)` and `(projected_cost - actual_invocation_cost)`. Aggregate the distribution across the population of paragraph_recombine invocations.
- [ ] Compare `evolution_metrics` `paragraph_recombine_cost` rollup at run level to the SUM of `evolution_agent_invocations.cost_usd` for those invocations to detect rollup vs invocation drift (the metric-write-once-per-invocation path can mask issues).
- [ ] Pull per-slot stats from `execution_detail.slots[*]`: how many slots aborted via the 0.9× self-abort gate vs completed; per-slot rewrite drop counts (especially `length_under`); whether the pre-final-ranking gate (`0.9 × perInvocationCap`) fired and short-circuited the article-level ranking.

### Phase 2: Trace the cost path in code
- [ ] Re-read `ParagraphRecombineAgent.ts` cost gating: `perSlotBudgetUsd = perInvocationCap / paragraphCount`, per-slot `AgentCostScope` nesting, self-abort threshold, and the `getOwnSpent() >= 0.9 × perInvocationCap` pre-final-ranking gate.
- [ ] Verify the rollup write path: agent writes the run-level metric ONCE per invocation as the SUM of the two phase-cost accumulators (`'paragraph_rewrite'` + `'paragraph_rank'`) via `writeMetricMax`. Confirm whether the per-slot LLM client has db/runId wired (per the doc note, it does not — per-call live writes don't fire).
- [ ] Verify `estimateParagraphRecombineCost` math matches the projector's `EstPerAgentValue.paragraphRecombine` and that wizard preview vs runtime agree.

### Phase 3: Pick a fix (or no-op) and ship it
- [ ] Based on Phase 1+2 evidence, pick from Option A–E above. Document the choice and rationale.
- [ ] If a code change is needed: update agent / projector / cost-tracker plumbing accordingly, add regression tests, and verify on staging.
- [ ] Update `evolution/docs/paragraph_recombine.md` Cost envelope / Failure modes sections with the actual measured numbers and the chosen mitigation.

## Testing

### Unit Tests
- [ ] If projector math changes: `evolution/src/lib/pipeline/infra/estimateCosts.test.ts` — assert the new math against fixed inputs.
- [ ] If self-abort / pre-final-ranking thresholds change: `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.test.ts` — assert the new gating threshold and per-slot budget allocation.
- [ ] If cost-attribution bookkeeping changes: extend the existing `ParagraphRecombineAgent.test.ts` rollup-write test (the one that asserts the SUM-write via `writeMetricMax`).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-paragraph-recombine-accumulation.integration.test.ts` — if cost-write behavior changes, extend to assert the persisted `paragraph_recombine_cost` metric matches the SUM of `evolution_agent_invocations.cost_usd` for the invocations in the run (round-trip parity check).

### E2E Tests
- [ ] N/A unless a UI surface is added (e.g. exposing per-invocation projected-vs-actual on the invocation detail page's Cost Estimates tab).

### Manual Verification
- [ ] After landing the fix (if any), trigger a new paragraph_recombine run on staging and re-run the Phase 1 query. Confirm the undershoot gap is closed (or, if Option E, that the documentation matches the steady-state behavior).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A unless Phase 3 adds a UI surface. If it does: load `/admin/evolution/invocations/<new-invocation>` and assert the projected-vs-actual cost is rendered correctly via the local server (`ensure-server.sh`).

### B) Automated Tests
- [ ] `npm run query:staging -- "<query from Phase 1>"` (read-only diagnostic; not a test gate)
- [ ] `npm test` (affected evolution unit tests)
- [ ] `npm run test:integration` (paragraph-recombine accumulation if touched)
- [ ] `npm run lint`, `npm run typecheck`, `npm run build`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/debugging.md` — possibly extend the paragraph_recombine debugging triage table with cost-undershoot symptoms.
- [ ] `docs/docs_overall/testing_overview.md` — no expected updates unless test-tier or rules change.
- [ ] `docs/feature_deep_dives/testing_setup.md` — no expected updates unless a new test helper lands.
- [ ] `evolution/docs/README.md` — no expected updates.
- [ ] `evolution/docs/architecture.md` — possibly clarify the per-slot vs invocation cost-cap interplay.
- [ ] `evolution/docs/data_model.md` — no expected updates unless a metric or column is added.
- [ ] `evolution/docs/agents/overview.md` — possibly update the `ParagraphRecombineAgent` cost-stack subsection.
- [ ] `evolution/docs/cost_optimization.md` — update the "Paragraph-Recombine Cost" subsection with the empirical undershoot finding and any recalibration.
- [ ] `evolution/docs/rating_and_comparison.md` — no expected updates.
- [ ] `evolution/docs/strategies_and_experiments.md` — no expected updates.
- [ ] `evolution/docs/metrics.md` — possibly update the `paragraph_recombine_cost` metric description if the write path changes.
- [ ] `evolution/docs/arena.md` — no expected updates.
- [ ] `evolution/docs/entities.md` — no expected updates.
- [ ] `evolution/docs/reference.md` — no expected updates unless a new env var or kill switch lands.
- [ ] `evolution/docs/visualization.md` — possibly update if a UI surface is added.
- [ ] `evolution/docs/minicomputer_deployment.md` — no expected updates.
- [ ] `evolution/docs/curriculum.md` — no expected updates.
- [ ] `evolution/docs/logging.md` — no expected updates.
- [ ] `evolution/docs/paragraph_recombine.md` — update Cost envelope + Failure modes tables with empirical numbers and any mitigation. Highest-priority doc for this project.
- [ ] `evolution/docs/variant_lineage.md` — no expected updates.
- [ ] `evolution/docs/multi_iteration_strategies.md` — no expected updates.
- [ ] `evolution/docs/criteria_agents.md` — no expected updates.
- [ ] `evolution/docs/editing_agents.md` — no expected updates.
- [ ] `evolution/docs/evolution_metrics.md` — no expected updates unless the metric write/read shape changes.

## Review & Discussion
(Populated by `/plan-review`.)
