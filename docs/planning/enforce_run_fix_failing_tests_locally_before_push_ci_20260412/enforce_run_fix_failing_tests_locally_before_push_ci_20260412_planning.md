# Enforce Run Fix Failing Tests Locally Before Push CI Plan

## Background
We want to save on wasteful CI usage during /finalize and /mainToProd. Currently, CI failures result in repeated pushes without local verification, wasting GitHub Actions minutes. We need to add evolution E2E tests to the local /finalize run, enforce local test verification after any CI failure before resubmitting, always fix flaky test root causes rather than applying surface-level fixes, and surface previously broken tests to the user for guidance.

## Requirements (from GH Issue #NNN)
- We want to save on wasteful CI usage during /finalize and /mainToProd
- Add evolution E2E tests to local run for /finalize
- In both /finalize and /mainToProd, for any CI failures
    - Fix the issue
    - Run the failing tests locally to verify they pass
    - Run all tests locally and verify they pass
    - Only then can submit to CI again
- For flaky tests, always fix the root cause, never do surface-level fixes
- For previously broken tests, always surface them to the user to ask what to do

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
- [ ] `docs/docs_overall/testing_overview.md` — may need updates to Check Parity table and E2E workflow sections
- [ ] `docs/feature_deep_dives/testing_setup.md` — may need updates to CI/CD integration section
- [ ] `docs/docs_overall/environments.md` — may need updates to GitHub Actions workflow descriptions
- [ ] `docs/docs_overall/debugging.md` — may need updates if debugging workflow changes
- [ ] `docs/feature_deep_dives/debugging_skill.md` — may need updates if debug skill interaction changes

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
