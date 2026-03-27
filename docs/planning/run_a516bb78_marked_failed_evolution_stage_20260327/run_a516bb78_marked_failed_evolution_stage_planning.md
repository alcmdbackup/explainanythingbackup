# Run A516bb78 Marked Failed Evolution Stage Plan

## Background
- Run failed
- a516bb78 on stage
- Error - stale claim auto-expired by claim_evolution_run
- Look at full logs using Supabase, see why it was marked as stale/failed

## Requirements (from GH Issue #NNN)
- Run failed
- a516bb78 on stage
- Error - stale claim auto-expired by claim_evolution_run
- Look at full logs using Supabase, see why it was marked as stale/failed

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
- [ ] `evolution/docs/architecture.md` — may need updates to stale detection or heartbeat docs
- [ ] `evolution/docs/data_model.md` — may need updates to run status lifecycle
- [ ] `evolution/docs/reference.md` — may need updates to error handling or watchdog docs
- [ ] `evolution/docs/logging.md` — may need updates to log analysis patterns
- [ ] `docs/docs_overall/debugging.md` — may need updates to evolution debugging section

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
