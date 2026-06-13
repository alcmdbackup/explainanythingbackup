# MainToProd 20260613 Plan

## Background
mainToProd

## Requirements (from GH Issue #NNN)
mainToProd

## Problem
Routine production release: promote current `main` to `production` via the `/mainToProd` skill.

## Options Considered
- [ ] **Option A: Run /mainToProd** (Recommended): Execute the standard `/mainToProd` skill to merge `main` into `production`.

## Phased Execution Plan

### Phase 1: Run /mainToProd
- [ ] Execute `/mainToProd` skill — merges main into production, resolves conflicts (preferring main), runs lint/tsc/build/unit/ESM/integration/E2E checks, and creates the release PR.
- [ ] Monitor CI checks on the release PR through to green.
- [ ] After PR merges, push updated `main` and `production` to the backup mirror.

## Testing

### Unit Tests
- [ ] Full unit suite executed by `/mainToProd`.

### Integration Tests
- [ ] Full integration suite executed by `/mainToProd`.

### E2E Tests
- [ ] Full E2E suite executed by `/mainToProd`.

### Manual Verification
- [ ] Post-merge verification banner — if release touches `supabase/migrations/**`, confirm migrations applied to prod after the `production` branch push.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] n/a — no code changes in this chore beyond the release branch itself.

### B) Automated Tests
- [ ] `/mainToProd` runs the full local check trio.
- [ ] CI on the release PR.
- [ ] `post-deploy-smoke.yml` smoke specs against live production after the `production` branch deploy.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/environments.md` — verify release-cadence + post-merge-verification guidance remains accurate.
- [ ] `docs/docs_overall/project_workflow.md` — n/a unless workflow itself changed.

## Review & Discussion
[Populated by /plan-review if invoked]
