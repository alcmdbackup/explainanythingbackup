# Remove Firefox Stage Merges Plan

## Background
Stop requiring Firefox on stage merges. The PR-CI pipeline for stage (PRs to `main`) currently runs a Firefox browser matrix on the `e2e-evolution` job whenever evolution/admin paths change, which slows down stage merges and forces fixes for Firefox-only flakiness before merge. Firefox coverage will remain in the nightly E2E suite, not blocking PR merges.

## Requirements (from GH Issue #NNN)
stop requiring firefox on stage merges

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
- [ ] **Option A: [Name]**: [Description]
- [ ] **Option B: [Name]**: [Description]
- [ ] **Option C: [Name]**: [Description]

## Phased Execution Plan

### Phase 1: [Phase Name]
- [ ] [Actionable item with specific deliverable]

### Phase 2: [Phase Name]
- [ ] [Actionable item with specific deliverable]

## Testing

### Unit Tests
- [ ] [Test file path and description]

### Integration Tests
- [ ] [Test file path and description]

### E2E Tests
- [ ] [Test file path and description]

### Manual Verification
- [ ] [Manual verification step description]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check — run on local server via ensure-server.sh]

### B) Automated Tests
- [ ] [Specific test file path to run]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- (none — user requested standard docs only; doc-mapping.json file-pattern matching will catch updates to environments.md / testing_overview.md / testing_setup.md if CI workflow changes warrant)

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
