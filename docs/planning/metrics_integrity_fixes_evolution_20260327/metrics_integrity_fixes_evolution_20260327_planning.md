# Metrics Integrity Fixes Evolution Plan

## Background
Identify gaps in the current evolution metrics implementation. Metrics need to be calculated correctly for all entities, updated when runs fail or are marked failed, displayed on all UI pages, and recomputed when stale. Prior analysis identified a missing `lock_stale_metrics` RPC and `getBatchMetricsAction` not checking stale flags.

## Requirements (from GH Issue #NNN)
- Prior gaps identified
- Metrics are calculated for all entities
    - Confirm for each of 7 entities separately
- Metrics are updated for runs marked as failed by system somehow
- Metrics are updated for runs that fail suddenly
- Metrics are displayed for each list and detail page in the UI
    - Verify this using codebase
    - Verify this using Playwright to look at each section
- Stale metrics get updated correctly
- Make sure we have unit/integration/e2e tests to verify all of the individual points above

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
- [ ] `evolution/docs/metrics.md` — update stale recomputation section with lock RPC details
- [ ] `evolution/docs/arena.md` — update sync section if behavior changes
- [ ] `evolution/docs/data_model.md` — add lock_stale_metrics RPC to Key RPCs section
- [ ] `evolution/docs/architecture.md` — update finalization flow if metrics handling changes
- [ ] `docs/docs_overall/testing_overview.md` — add any new test patterns
- [ ] `docs/docs_overall/environments.md` — note any migration requirements

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
