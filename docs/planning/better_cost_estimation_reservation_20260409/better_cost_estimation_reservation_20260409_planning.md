# Better Cost Estimation Reservation Plan

## Background
The evolution pipeline's cost estimation for generateFromSeedArticle is inaccurate, leading to budget waste when parallel agents exceed their budgets. The current 1-token-per-4-chars heuristic and fixed output token estimates (1000 for generation, 100 for ranking) don't reflect empirical article lengths. Additionally, parallelism in the generate iteration launches all N agents simultaneously without considering remaining budget, causing agents to fail mid-execution when budget runs out. This project aims to improve cost estimation accuracy using empirical data, establish a feedback loop for estimate validation, and modify the parallel launch strategy to be budget-aware — launching only as many agents as the remaining budget can support, then switching to sequential execution in subsequent iterations to minimize waste.

## Requirements (from GH Issue #NNN)
- Estimate the cost of generateFromSeedArticle as accurately as possible, based on model cost and empirical article lengths. This should account for both generation and ranking parts separately. Use Supabase dev to look at empirical article length, looking at debugging.md to see how to query
- Establish a feedback loop that allows us to evaluate the accuracy of our estimates
- Modify generateFromSeedArticle to handle parallelism more gracefully. To reduce waste, estimate how many you can launch in parallel, without going over the remaining budget. Do slightly less than this.
- In the iteration after this, set maximum parallel = 1 - i.e. go sequentially to reduce waste, until all budget is exhausted or all needed variants are generated.

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
- [ ] `evolution/docs/cost_optimization.md` — update cost estimation section with empirical data and new estimation approach
- [ ] `evolution/docs/architecture.md` — update iteration loop description with budget-aware parallelism
- [ ] `evolution/docs/agents/overview.md` — update generateFromSeedArticle agent docs with new parallel launch strategy
- [ ] `evolution/docs/metrics.md` — document estimation accuracy feedback loop metrics
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — update with new cost estimation metrics

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
