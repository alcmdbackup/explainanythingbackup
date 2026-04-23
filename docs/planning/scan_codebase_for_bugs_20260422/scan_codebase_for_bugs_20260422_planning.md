# Scan Codebase For Bugs Plan

## Background
Scan my evolution codebase for bugs until you find 100.

## Requirements (from GH Issue #NNN)
Scan my evolution codebase for bugs until you find 100.

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
- [ ] `evolution/docs/README.md` — may need bug-scan findings noted
- [ ] `evolution/docs/architecture.md` — may need updates if architectural bugs surface
- [ ] `evolution/docs/data_model.md` — may need updates if schema/RLS bugs surface
- [ ] `evolution/docs/entities.md` — may need updates if entity-registry bugs surface
- [ ] `evolution/docs/arena.md` — may need updates if arena sync/load bugs surface
- [ ] `evolution/docs/rating_and_comparison.md` — may need updates if rating/parse bugs surface
- [ ] `evolution/docs/strategies_and_experiments.md` — may need updates if bootstrap/propagation bugs surface
- [ ] `evolution/docs/curriculum.md` — low priority; update only if major doc drift
- [ ] `evolution/docs/cost_optimization.md` — likely affected (cost tracker + spending gate are hot spots)
- [ ] `evolution/docs/metrics.md` — likely affected (stale-metric cascades, writeMetricMax semantics)
- [ ] `evolution/docs/logging.md` — may need updates if swallowed-error bugs surface
- [ ] `evolution/docs/visualization.md` — may need updates if admin UI filter/pagination bugs surface
- [ ] `evolution/docs/minicomputer_deployment.md` — may need updates if deploy/watchdog bugs surface
- [ ] `evolution/docs/reference.md` — may need updates (file inventory + error classes)
- [ ] `evolution/docs/agents/overview.md` — may need updates if agent lifecycle bugs surface
- [ ] `docs/docs_overall/debugging.md` — may need new debugging patterns from findings
- [ ] `docs/docs_overall/testing_overview.md` — may need new flakiness rules from findings
- [ ] `docs/feature_deep_dives/testing_setup.md` — may need updates if mock/test-factory bugs surface

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
