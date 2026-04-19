# MainToProdB 20260418 Plan

## Background
Standard mainToProd merge — merge main into production branch, resolve any conflicts preferring main, run all checks (lint, tsc, build, unit, ESM, integration, E2E), and create a PR targeting production.

## Requirements (from GH Issue #NNN)
- Merge main into production branch
- Resolve conflicts preferring main
- Run lint/tsc/build/unit/ESM/integration/E2E checks
- Create PR targeting production

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
- [ ] `docs/docs_overall/testing_overview.md` — testing tiers and CI/CD workflows
- [ ] `docs/docs_overall/environments.md` — environment configuration
- [ ] `docs/docs_overall/debugging.md` — debugging tools and workflows
- [ ] `docs/feature_deep_dives/testing_setup.md` — test configuration and patterns

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
