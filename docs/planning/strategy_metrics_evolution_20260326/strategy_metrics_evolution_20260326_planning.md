# Strategy Metrics Evolution Plan

## Background
The evolution pipeline's `persistRunResults` finalization step does not propagate metrics (run_count, total_cost, avg_final_elo, best_final_elo) to the parent strategy entity after a run completes. The E2E test `admin-evolution-run-pipeline.spec.ts:237` ("strategy metrics were propagated") consistently fails in CI. The run completes successfully, variants are created, invocations recorded, and run-level metrics are computed, but `evolution_metrics` for entity_type='strategy' is empty. Additionally, the arena leaderboard shows raw mu and sigma values which are hard to interpret without knowing the Elo conversion factor.

## Requirements (from GH Issue #848)
1. Fix `persistRunResults.ts` to call `propagateMetricsToParents()` after writing run-level metrics, cascading to parent strategy and experiment entities
2. Ensure the E2E test at `admin-evolution-run-pipeline.spec.ts:237` ("strategy metrics were propagated") passes
3. Update the arena leaderboard UI to show Elo uncertainty range (e.g. "1200 ± 45") instead of raw mu and sigma columns, which are hard to interpret without knowing the conversion factor

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
- [ ] **Option A: [Name]**: [Description]
- [ ] **Option B: [Name]**: [Description]
- [ ] **Option C: [Name]**: [Description]

## Phased Execution Plan

### Phase 1: [Phase Name]
- [ ] [Actionable item with specific deliverable]
- [ ] [Actionable item with specific deliverable]

### Phase 2: [Phase Name]
- [ ] [Actionable item with specific deliverable]
- [ ] [Actionable item with specific deliverable]

## Testing

### Unit Tests
- [ ] [Test file path and description, e.g. `src/lib/services/foo.test.ts` — test X behavior]

### Integration Tests
- [ ] [Test file path and description, e.g. `src/__tests__/integration/foo.integration.test.ts` — test Y flow]

### E2E Tests
- [ ] [Test file path and description, e.g. `src/__tests__/e2e/specs/foo.spec.ts` — verify Z end-to-end]

### Manual Verification
- [ ] [Manual verification step description]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check — run on local server via ensure-server.sh]

### B) Automated Tests
- [ ] [Specific test file path to run, e.g. `npm run test:unit -- --grep "foo"` or `npx playwright test src/__tests__/e2e/specs/foo.spec.ts`]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/architecture.md` — may need update to finalization flow
- [ ] `evolution/docs/strategies_and_experiments.md` — strategy aggregate computation
- [ ] `evolution/docs/metrics.md` — metrics propagation documentation
- [ ] `evolution/docs/visualization.md` — arena leaderboard UI changes
- [ ] `evolution/docs/arena.md` — arena display format changes

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
