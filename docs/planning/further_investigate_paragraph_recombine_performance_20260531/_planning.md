# Further Investigate Paragraph Recombine Performance Plan

## Background
Further investigate performance of the 5 most recent paragraph recombine runs.

## Requirements (from GH Issue #1153)
Further investigate performance of 5 most recent paragraph recombine runs.

## Problem
The `paragraph_recombine` agent has had several recent investigations into cost accuracy, persistence/display, and effectiveness (20260529–20260530). This project continues that line by examining the 5 most recent paragraph_recombine runs to characterize their actual performance — cost, latency, drop rates, slot/rewrite yield, arena outcomes, and estimation error — and identify any remaining regressions or tuning opportunities. Scope and concrete findings to be refined after /research.

## Options Considered
- [ ] **Option A: Query-only forensic analysis**: Use read-only DB queries against the 5 most recent runs (`evolution_agent_invocations`, `evolution_variants`, `evolution_arena_comparisons`, `evolution_metrics`) to characterize performance; produce a written findings report. No code changes.
- [ ] **Option B: Forensics + targeted fixes**: Same analysis, then fix any concrete regressions found (cost attribution, drop-rate, persistence) with tests.
- [ ] **Option C: Forensics + instrumentation/tooling**: Same analysis, plus add a reusable analysis script/query helper for future paragraph_recombine run audits.

## Phased Execution Plan

### Phase 1: Identify the 5 most recent runs
- [ ] Query `evolution_runs` for the 5 most recent `paragraph_recombine` runs (by `created_at`), capturing run IDs, status, and run-level cost metrics
- [ ] Confirm which environment (staging vs prod) holds the runs of interest

### Phase 2: Per-run performance characterization
- [ ] For each run, pull per-invocation cost/duration and `execution_detail` (per-slot, per-rewrite cost/status/dropReason/temperature/estimationErrorPct)
- [ ] Compute drop-rate by rewrite index (watch index-0 tighten-directive drop rate vs <30% target)
- [ ] Compute cost-estimation error per run (`cost_estimation_error_pct`) and cap-vs-actual ratio
- [ ] Cross-check persisted `evolution_variants` arena columns vs in-memory `execution_detail` truth (matchCount, parent_variant_ids)

### Phase 3: Synthesis & recommendations
- [ ] Summarize findings across the 5 runs (cost, latency, yield, arena outcomes, regressions)
- [ ] Recommend tuning/fixes if warranted (feeds Option B/C decision)

## Testing

### Unit Tests
- [ ] [Only if code changes result — e.g. cost/drop-rate logic test path TBD after /research]

### Integration Tests
- [ ] [Only if code changes result — TBD after /research]

### E2E Tests
- [ ] [Only if code changes result — TBD after /research]

### Manual Verification
- [ ] Re-run the analysis queries and confirm reported numbers reproduce

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A unless a UI/dashboard change results (re-evaluate after /research)

### B) Automated Tests
- [ ] [Specific test command TBD — only if code changes result]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/evolution/paragraph_recombine.md` — add a row to "Recent Investigations" for this analysis
- [ ] `evolution/docs/evolution/cost_optimization.md` — update Paragraph-Recombine Cost section if new tuning lands
- [ ] `evolution/docs/evolution/operations.md` — note any new analysis query/workflow
- [ ] `evolution/docs/evolution/data_model.md` — only if schema understanding changes
- [ ] `evolution/docs/evolution/rating.md` — only if rating/arena findings warrant
- [ ] `evolution/docs/evolution/arena.md` — only if arena findings warrant
- [ ] `docs/feature_deep_dives/evolution_pipeline.md` — only if the pointer set changes

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
