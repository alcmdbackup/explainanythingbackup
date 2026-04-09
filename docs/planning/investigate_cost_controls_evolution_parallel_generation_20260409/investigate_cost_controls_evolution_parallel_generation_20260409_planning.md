# Investigate Cost Controls Evolution Parallel Generation Plan

## Background
The new parallel generate-rank pipeline dispatches N agents in parallel, which changes how budget consumption and cost tracking work compared to the sequential pipeline. This project investigates whether the current two-layer budget model (V2CostTracker + LLMSpendingGate) correctly handles concurrent reservations, potential overspending, and cost attribution across N parallel GenerateFromSeedArticleAgent invocations.

## Requirements (from GH Issue #NNN)
1. Verify V2CostTracker reserve() is safe under N parallel agents
2. Verify LLMSpendingGate handles concurrent reservations correctly
3. Identify any cost tracking gaps or missing metrics
4. Check that generation_cost/ranking_cost split works under parallel dispatch
5. Ensure discarded variant costs are still captured
6. Review orphaned reservation cleanup for parallel runs

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
- [ ] `evolution/docs/cost_optimization.md` — update if cost control mechanisms change for parallel runs
- [ ] `evolution/docs/architecture.md` — update if parallel budget flow changes
- [ ] `evolution/docs/arena.md` — update if arena sync behavior changes
- [ ] `evolution/docs/data_model.md` — update if schema changes are needed
- [ ] `evolution/docs/entities.md` — update if entity relationships change
- [ ] `evolution/docs/rating_and_comparison.md` — update if rating/cost split changes
- [ ] `evolution/docs/strategies_and_experiments.md` — update if strategy cost aggregation changes
- [ ] `evolution/docs/metrics.md` — update if new metrics are added
- [ ] `evolution/docs/logging.md` — update if logging changes under parallel dispatch
- [ ] `evolution/docs/agents/overview.md` — update if agent budget interaction changes
- [ ] `evolution/docs/reference.md` — update env vars or config if changed
- [ ] `evolution/docs/visualization.md` — update if cost display changes
- [ ] `docs/docs_overall/llm_provider_limits.md` — update if provider limit recommendations change
- [ ] `docs/docs_overall/testing_overview.md` — update if new test coverage is added
- [ ] `docs/feature_deep_dives/error_handling.md` — update if new error codes are introduced

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
