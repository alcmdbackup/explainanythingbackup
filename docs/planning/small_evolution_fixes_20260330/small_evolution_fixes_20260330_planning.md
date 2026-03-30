# Small Evolution Fixes Plan

## Background
Fix environment naming inconsistencies and incorrect env variable references across the codebase. The GitHub environment is called "Staging" but code and docs reference it as "Development". Also ensure we reference TEST_USER_EMAIL env variable consistently, not an admin email env variable.

## Requirements (from GH Issue #TBD)
1. Eliminate any reference to "Development environment" in GitHub Actions/secrets context — should be "Staging"
2. Ensure TEST_USER_EMAIL is used consistently, not admin email env variable — look for both of these across codebase

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
- [ ] `docs/docs_overall/environments.md` — rename Development environment references to Staging
- [ ] `docs/docs_overall/testing_overview.md` — rename Development environment references to Staging
- [ ] `docs/feature_deep_dives/testing_setup.md` — rename Development environment references to Staging

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
