# Fix Testing Local Setup Plan

## Background
Explore how to make local unit, integration, and E2E testing faster, more efficient, and less flaky. Compare to CI approach if needed. Explore multiple shards. Make sure checks run follow similar logic as CI.

## Requirements (from GH Issue #NNN)
Explore how to make local unit integration and e2e testing faster more efficient and less flaky. Compare to ci approach if needed. Explore multiple shards. Make sure checks run follow similar logic as CI.

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
- [ ] `docs/docs_overall/testing_overview.md` — may need updates to local testing commands/strategy
- [ ] `docs/feature_deep_dives/testing_setup.md` — may need updates to test configuration
- [ ] `docs/docs_overall/environments.md` — may need updates to local vs CI differences
- [ ] `docs/docs_overall/project_workflow.md` — may need updates to workflow steps
- [ ] `docs/docs_overall/debugging.md` — may need updates to debugging procedures
- [ ] `docs/feature_deep_dives/debugging_skill.md` — may need updates to debugging skill

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
