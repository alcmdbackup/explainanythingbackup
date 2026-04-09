# Investigate Recent Evolution Runs Plan

## Background
This project investigates recent evolution pipeline runs to verify the parallel generate-rank architecture (implemented in generate_rank_evolution_parallel_20260331) is working correctly in production. We will analyze run data end-to-end including agent invocations, structured logs, and metrics to identify any bugs or deviations from the expected behavior. The goal is to debug pipeline issues and ensure the orchestrator-driven iteration model (generate → swiss → swiss → ...) is functioning as designed.

## Requirements (from GH Issue #NNN)
Look at runs end-to-end including invocations, logs, metrics and explore if it's working properly as per our plan file in generate_rank_evolution_parallel_20260331.

## Problem
[3-5 sentences describing the problem — to be refined after /research]

## Options Considered
- [ ] **Option A: Database query investigation**: Query evolution_runs, evolution_variants, evolution_agent_invocations, evolution_metrics, and evolution_logs directly to find anomalies
- [ ] **Option B: Admin UI visual inspection**: Use Playwright to navigate the admin evolution pages and visually inspect run data
- [ ] **Option C: Combined approach**: Use database queries for systematic data analysis and Playwright for UI/UX verification

## Phased Execution Plan

### Phase 1: Data Collection
- [ ] Query recent evolution runs (last 10-20 completed runs) to understand their status, stop reasons, and cost
- [ ] Query evolution_agent_invocations to verify generate + swiss + merge iteration pattern is present
- [ ] Query evolution_metrics to verify metrics are being computed and propagated correctly
- [ ] Query evolution_logs to check for any errors or unexpected warnings
- [ ] Check evolution_variants for `persisted` column and surfaced/discarded stats

### Phase 2: Deep Analysis
- [ ] Cross-reference invocation patterns against expected generate → swiss loop from plan
- [ ] Verify strategy effectiveness data in run_summary matches expected format
- [ ] Check arena sync — are winning variants being synced with `synced_to_arena=true`?
- [ ] Verify metrics propagation to strategy/experiment level
- [ ] Check for any budget-exceeded runs and analyze patterns

### Phase 3: Issue Resolution
- [ ] Document any bugs or deviations found
- [ ] Implement fixes for confirmed issues
- [ ] Verify fixes with targeted tests

## Testing

### Unit Tests
- [ ] [To be determined based on findings]

### Integration Tests
- [ ] [To be determined based on findings]

### E2E Tests
- [ ] [To be determined based on findings]

### Manual Verification
- [ ] Query prod/staging databases to verify data integrity
- [ ] Visual inspection of admin UI using Playwright

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Navigate admin evolution dashboard to verify run display
- [ ] Check run detail pages for correct invocation/metrics display

### B) Automated Tests
- [ ] Run evolution integration tests: `npm run test:integration -- --grep "evolution"`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/architecture.md` — update if pipeline behavior differs from documented
- [ ] `evolution/docs/data_model.md` — update if schema differs from documented
- [ ] `evolution/docs/metrics.md` — update if metrics system has issues
- [ ] `evolution/docs/arena.md` — update if arena sync has issues
- [ ] `evolution/docs/rating_and_comparison.md` — update if rating mechanics differ
- [ ] `evolution/docs/strategies_and_experiments.md` — update if strategy aggregates have issues
- [ ] `evolution/docs/logging.md` — update if logging behavior differs
- [ ] `evolution/docs/entities.md` — update if entity relationships differ
- [ ] `evolution/docs/agents/overview.md` — update if agent behavior differs
- [ ] `evolution/docs/cost_optimization.md` — update if cost tracking has issues
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — update if metrics deep dive needs updating

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
