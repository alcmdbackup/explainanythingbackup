# Modify Main To Prod Finalize Plan

## Background
Modify mainToProd and finalize skills.

## Requirements (from GH Issue #NNN)
- Avoid failfast, see all things that fail and then try to fix all at once, rather than 1 by 1
- Always run integration/E2E tests locally if possible before pushing
- On any failure, fix failing tests locally, verify they pass locally
- Then proceed to create PR and do CI
- On any failure, fix failing tests locally, verify they pass locally, then resubmit to run FULL CI on GH. Never re-run only failing tests on GH.

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
- [ ] `.claude/commands/mainToProd.md` — mainToProd skill definition, may need behavioral changes
- [ ] `.claude/commands/finalize.md` — finalize skill definition, may need behavioral changes

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
