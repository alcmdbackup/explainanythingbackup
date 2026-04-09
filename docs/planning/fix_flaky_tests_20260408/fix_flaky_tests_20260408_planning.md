# Fix Flaky Tests Plan

## Background
Identify flaky E2E and integration tests across the suite and fix their root causes (race conditions, missing waits, mock cleanup, etc.) following the testing rules in `docs/docs_overall/testing_overview.md`. Stabilize CI by ensuring tests pass deterministically on reruns.

## Requirements (from GH Issue #NNN)
- Identify flaky tests via CI history (recent failures, retries, intermittent passes)
- Reproduce each candidate locally (loop runs against the dev tmux server)
- Root-cause each failure (no symptom-only patches per `/debug` skill)
- Fix per testing rules (`testing_overview.md` Rules 1-18: stable selectors, auto-waiting assertions, no `networkidle`, no fixed sleeps, route mock cleanup, hydration waits, etc.)
- Verify each fix by rerunning the previously flaky test multiple times
- Update docs (`testing_overview.md` rules section, `testing_setup.md` patterns) if new patterns emerge
- Confirm `npm run test:e2e:critical` and `npm run test:integration` are green locally before PR

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
- [ ] **Option A: [Name]**: [Description]
- [ ] **Option B: [Name]**: [Description]
- [ ] **Option C: [Name]**: [Description]

## Phased Execution Plan

### Phase 1: Identify Flaky Tests
- [ ] Pull recent CI run history (`gh run list`) and extract retried/failed E2E + integration specs
- [ ] Build a candidate list with frequency and last-seen timestamps

### Phase 2: Reproduce and Root-Cause
- [ ] For each candidate, run repeated locally (`npx playwright test <spec> --repeat-each=10`)
- [ ] Apply `/debug` four-phase workflow; document root cause per spec

### Phase 3: Fix
- [ ] Apply targeted fixes per testing rules
- [ ] Re-run repeated locally to confirm stability

### Phase 4: Verify and Document
- [ ] Run full critical suite (`npm run test:e2e:critical`, `npm run test:integration`)
- [ ] Update relevant docs if new patterns emerge

## Testing

### Unit Tests
- [ ] [N/A unless flakiness traced to unit-level mock pollution]

### Integration Tests
- [ ] [Per-spec rerun verification — list as identified in Phase 1]

### E2E Tests
- [ ] [Per-spec rerun verification — list as identified in Phase 1]

### Manual Verification
- [ ] Spot-check fixed specs in local dev tmux server

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Each fixed E2E spec passes 10 consecutive local runs

### B) Automated Tests
- [ ] `npm run test:e2e:critical`
- [ ] `npm run test:integration`
- [ ] `npm run lint && npm run typecheck`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/testing_setup.md` — add any new patterns discovered
- [ ] `docs/docs_overall/testing_overview.md` — extend Testing Rules if a new rule is needed
- [ ] `docs/docs_overall/environments.md` — only if env-specific flakiness uncovered
- [ ] `docs/docs_overall/debugging.md` — only if new debugging technique used

## Review & Discussion
[This section is populated by /plan-review]
