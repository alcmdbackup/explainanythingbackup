# Maintenance Skills Plan

## Background
We want to have skills that run processes periodically to help maintain the health of the project. Each skill should initialize itself fully and proceed through running 4 rounds of research with 4 agents each, before returning research findings for user feedback. These should run automatically in worktrees using tmux where possible.

## Requirements (from GH Issue #TBD)
- Overall instructions
    - Each of these should initialize itself fully and proceed through running 4 rounds of research with 4 agents each, before returning research findings for user feedback.
    - Prefer to do this automatically in a worktree using TMUX if possible, and alert user that these are being run
- Add a maintenance doc covering maintenance
- Specific skills
    - Refactor and simplify
        - Look at how to re-architect and simplify evolution codebase to make it easier to understand and maintain. Delete and confirmed dead code.
    - Test gap coverage
        - Look for gaps and issues with unit, integration, and e2e tests for evolution. Assess what runs on pushes to main vs. production
    - Update documentation
        - Look for gaps in documentation across both evolution docs and main docs directories and then make the necessary updates
    - Gaps in TS coverage
        - In evolution codebase, all key functions and DB reads/writes have inputs and outputs typed
    - Bug verification - reading code
        - Read through codebase to find bugs
    - Bugs and UX issue testing via manual verification
        - Use playwright to open evolution admin dashboard in stage and look for bugs as well as UX/usability issues

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
- [ ] `docs/docs_overall/project_workflow.md` — may need updates for new maintenance skill workflow
- [ ] `docs/docs_overall/debugging.md` — may reference new maintenance processes
- [ ] `docs/feature_deep_dives/testing_setup.md` — test gap coverage skill may update testing docs
- [ ] `docs/docs_overall/testing_overview.md` — test gap coverage findings
- [ ] `docs/docs_overall/environments.md` — if maintenance skills need environment config
- [ ] `docs/feature_deep_dives/debugging_skill.md` — bug verification skill may relate
- [ ] `docs/docs_overall/instructions_for_updating.md` — doc update skill may affect this
- [ ] `evolution/docs/architecture.md` — refactor/simplify skill may update this

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
