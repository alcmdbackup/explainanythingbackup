# Fix Failed Nightly Run Progress

## Phase 1: Investigation
### Work Done
- Downloaded and analyzed nightly run logs for Feb 28 and Mar 1 failures
- Identified root cause: PR #589 moved @skip-prod filtering from CLI to config, but nightly YAML (from main) checks out production code which lacks the config change
- Identified flaky home-tabs tests: React state batching causes button to remain disabled when test clicks too fast
- Ran 4 parallel research agents to audit all workflows, deep-dive both issues, and audit docs
- Confirmed 26 @skip-prod AI suggestion tests can NEVER work on production (server actions vs API routes)

### Issues Encountered
- CI log files contained ANSI escape codes making grep unreliable; used Read tool with pagination instead
- Playwright report artifacts (~188MB) timed out on download; used raw log zip (~87KB) instead

### User Clarifications
- None needed — root cause was clear from investigation

## Phase 2: Fix Implementation
### Work Done
1. **e2e-nightly.yml**: Added `--grep-invert="@skip-prod"` back to CLI command (belt-and-suspenders with config-based grepInvert)
2. **home-tabs.spec.ts**: Added `await expect(searchButton).toBeEnabled()` after `fill()` in both search tests
3. **testing_overview.md**: Added @skip-prod to tag table, documented nightly branch behavior (YAML from main, code from production), pre-flight audit, belt-and-suspenders approach, fixed secrets section
4. **testing_setup.md**: Fixed incorrect E2E_TEST_MODE=true reference, documented grepInvert and production secrets, fixed Firefox SSE note

### Verification
- Lint: passed
- TypeScript: passed
- Build: passed (exit 0)

### Issues Encountered
- None
