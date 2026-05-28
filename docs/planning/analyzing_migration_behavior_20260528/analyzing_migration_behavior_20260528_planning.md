# Analyzing Migration Behavior Plan

## Background
The project deploys Supabase SQL migrations from `supabase/migrations/` via GitHub Actions, with staging auto-deploy on PR/main and production deploy gated to the `production` branch. A 62-day silent prod-schema drift incident and a non-idempotent `ADD CONSTRAINT` trip-wire (PR #1073/#1074) motivated an idempotency lint, a Docker-based local `migration:verify` harness, and PR-creation gating for migration-touching branches. This project audits that whole lifecycle — local testing, staging/prod deploy, idempotency enforcement, existing-migration cleanup, and bug prevention — and reviews GH history for past migration bugs to inform improvements.

## Requirements (from GH Issue — TBD)
I want to analyze how we're handling migrations. E.g. how we are testing migrations locally, how we are doing it in staging/prod. How to protect against idempotency failures e.g. by enforcing using hooks or lint. How to clean up our existing migrations. How we can better prevent migration bugs. Analyze GH history to see what migration related bugs we've had.

## Problem
Migration handling is spread across CI workflows, lint scripts, a Docker verify harness, push/PR gates, and convention. It is unclear how complete the current safeguards are, where idempotency enforcement still has gaps, whether the existing migration backlog can be consolidated/cleaned safely, and what classes of migration bugs have actually bitten us historically. This project produces an analysis (not necessarily a code change) that maps the current state, catalogs past bugs from GH history, and recommends concrete prevention/cleanup improvements.

## Options Considered
- [ ] **Option A: [Name]**: [Description]
- [ ] **Option B: [Name]**: [Description]

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
- [ ] [Manual verification step]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check — likely N/A for an analysis project]

### B) Automated Tests
- [ ] [Specific test file path or command to run]

## Documentation Updates
- [ ] [Doc path — brief note on what may change]

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
