# Scan For Bugs Evolution Plan

## Background
Conduct a comprehensive bug scan across the entire evolution pipeline system — including the core pipeline (generate/rank/evolve loop), budget tracking, arena sync, ranking/rating system, format validation, error handling, server actions, and admin UI actions. Identify bugs, fix them, and write tests to prevent regressions. This covers pipeline logic in `evolution/src/lib/pipeline/`, shared utilities in `evolution/src/lib/shared/`, services in `evolution/src/services/`, and core entity/agent infrastructure in `evolution/src/lib/core/`.

## Requirements (from GH Issue #NNN)
1. Scan all evolution pipeline code for bugs (generate.ts, rank.ts, evolve.ts, claimAndExecuteRun.ts, runIterationLoop.ts, finalize.ts, arena.ts, seed-article.ts)
2. Scan budget/cost tracking code (cost-tracker.ts, llm-client.ts, cost_optimization)
3. Scan ranking/rating system (rating.ts, computeRatings.ts, reversalComparison.ts, comparisonCache.ts, comparison.ts)
4. Scan format validation (formatValidator.ts, formatValidationRules.ts)
5. Scan server actions (evolutionActions.ts, arenaActions.ts, entityActions.ts, invocationActions.ts, experimentActionsV2.ts, strategyRegistryActionsV2.ts, logActions.ts, costAnalytics.ts)
6. Scan entity/agent infrastructure (Entity.ts, Agent.ts, metricCatalog.ts, entityRegistry.ts, agentRegistry.ts)
7. Scan error handling paths (errors.ts, errorClassification.ts, types.ts error classes)
8. Fix all identified bugs
9. Write unit tests for each fix to prevent regression

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
- [ ] `evolution/docs/README.md` — update if structural changes made
- [ ] `evolution/docs/reference.md` — update if file inventory changes
- [ ] `evolution/docs/logging.md` — update if logging changes
- [ ] `evolution/docs/architecture.md` — update if pipeline flow changes
- [ ] `evolution/docs/data_model.md` — update if schema changes
- [ ] `evolution/docs/agents/overview.md` — update if agent behavior changes
- [ ] `evolution/docs/cost_optimization.md` — update if budget logic changes
- [ ] `evolution/docs/rating_and_comparison.md` — update if rating logic changes
- [ ] `docs/docs_overall/debugging.md` — update if debugging workflow changes
- [ ] `docs/feature_deep_dives/testing_setup.md` — update if test infrastructure changes

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
