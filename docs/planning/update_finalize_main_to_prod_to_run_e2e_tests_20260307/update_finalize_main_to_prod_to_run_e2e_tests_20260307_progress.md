# Update Finalize Main To Prod To Run E2E Tests Progress

## Phase 1: Fix search-generate.spec.ts persistent failure
### Work Done
- Replaced `waitForStreamingComplete()` with `waitForStreamingStart()` + content visibility check
- The fix checks content during streaming before the redirect triggers a DB re-fetch with mock IDs
- All 3 critical tests in search-generate.spec.ts pass (previously 1 persistent failure)

### Issues Encountered
None — fix worked on first attempt.

## Phase 2: Fix idle watcher server kills during E2E runs
### Work Done
- Added idle timestamp touch code to `global-setup.ts` (after server readiness check)
- Added idle timestamp touch code to `global-teardown.ts` (at start of function, own try-catch)
- Both guarded by `!process.env.CI` since CI uses webServer, not tmux
- Verified: teardown output shows "✓ Touched idle timestamp for instance 9ca8ce48e92095cc"

### Issues Encountered
None.

## Phase 3: Add --e2e flag to /mainToProd
### Work Done
- Added `argument-hint: [--e2e]` to frontmatter
- Added `$ARGUMENTS` section for flag parsing
- Added Step 4.5: E2E Tests (conditional on --e2e flag)
- Updated Success Criteria with E2E line
- Updated PR body template with E2E status line
- Per user request: E2E failures always fixed and retried, never ask user

### Issues Encountered
- `enforce-bypass-safety.sh` hook blocks edits to `.claude/commands/` in bypass mode
- Resolved by user approving edits manually

## Phase 4: Documentation updates
### Work Done
- Added "E2E Tests in Skill Workflows" section to `testing_overview.md` after Quick Reference
- Added "Server killed during E2E tests" troubleshooting entry to `debugging.md`

### Issues Encountered
None.
