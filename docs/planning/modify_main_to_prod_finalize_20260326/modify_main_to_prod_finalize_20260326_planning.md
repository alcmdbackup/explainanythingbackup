# Modify Main To Prod Finalize Plan

## Background
Modify mainToProd and finalize skills.

## Requirements (from GH Issue #856)
- Avoid failfast, see all things that fail and then try to fix all at once, rather than 1 by 1
- Always run integration/E2E tests locally if possible before pushing
- On any failure, fix failing tests locally, verify they pass locally
- Then proceed to create PR and do CI
- On any failure, fix failing tests locally, verify they pass locally, then resubmit to run FULL CI on GH. Never re-run only failing tests on GH.

## Problem
Both finalize.md and mainToProd.md use a sequential fail-fast pattern: run one check, if it fails fix it immediately, then move to the next check. This means you never see the full scope of failures at once — you discover them one at a time, which is slow and frustrating. Additionally, E2E tests are optional (gated behind `--e2e` flag) when they should always run locally before pushing. Finally, there's no explicit guidance against using GitHub's "Re-run failed jobs" feature, which can mask issues by running partial CI.

## Options Considered
- [x] **Option A: Edit skill markdown files directly**: Modify the prose instructions in finalize.md and mainToProd.md to change the behavioral patterns. Simple, no code changes needed.
- [x] **Option B: Create wrapper scripts**: Write shell scripts that enforce the "run all checks" pattern and have skills call them. Over-engineered for what is essentially a documentation change.

## Phased Execution Plan

### Phase 1: Modify finalize.md
- [x] **Step 4 restructure**: Replace sequential "fix as you go" with "run all 5 checks, collect all failures, display summary, fix all at once, re-run all"
- [x] **Step 5 E2E**: Change from conditional `--e2e` to always run `npm run test:e2e -- --grep @critical` locally. Keep `--e2e` flag for running FULL E2E suite (`npm run test:e2e`)
- [x] **Step 8b**: Remove `--fail-fast` from `gh pr checks --watch --fail-fast`
- [x] **Step 8d**: Add explicit guidance: "Re-run ALL local checks (not just failing ones). Never use `gh run rerun`. Always push new commits to trigger full CI."
- [x] **Step 8d retry loop**: After fixing locally, re-run ALL checks from Step 4 + Step 5 (E2E critical) before pushing
- [x] **Update Success Criteria** (line 937): Change "E2E critical tests pass (if --e2e flag was provided)" to "E2E critical tests always pass; full E2E suite passes if --e2e flag provided"
- [x] **Update PR body template** (line 791): Update E2E line to reflect critical always runs, full suite with --e2e

### Phase 2: Modify mainToProd.md
- [x] **Step 4 restructure**: Replace "If any fails, fix the issues before proceeding" + "Re-run the failing check" with "run all checks, collect all failures, fix all, re-run all"
- [x] **Step 4.5 E2E**: Remove `--e2e` conditional — always run `npm run test:e2e` for production releases. Keep Step 4.5 as a separate mandatory step (not inlined into Step 4) for clarity
- [x] **Remove --e2e argument**: Update Arguments section (line 13) and argument-hint (line 3) to remove --e2e. Update description (line 2) to mention E2E is now always included
- [x] **Restructure Steps 6-7 for CI monitoring**: Current Step 7 does branch checkout + stash pop (cleanup). Insert CI monitoring BEFORE cleanup. New order: Step 6 (Push + Create PR) → Step 6.2 (CI Monitoring with fix-push-rewatch loop, `timeout 900 gh pr checks --watch` without --fail-fast, max 5 iterations, worst case ~75 min total) → Step 7 (Verify and Cleanup — only after CI passes or user aborts monitoring). Include backup push in fix-push-rewatch loop iterations (matching finalize Step 8d item 6)
- [x] **Add "never gh run rerun" guidance** to the new CI monitoring section
- [x] **Update Co-Authored-By**: Line 124 — change "Claude Opus 4.5" to "Claude Opus 4.6 (1M context)"
- [x] **Update PR body template**: Remove "skipped (no --e2e flag)" language since E2E always runs
- [x] **Update Success Criteria**: Remove "(if --e2e flag was provided)" from E2E line

### Phase 3: Update related documentation
- [x] **docs/docs_overall/testing_overview.md**: Update references to --e2e flag behavior for both skills
- [x] **Commit all changes**

## Testing

### Unit Tests
- [x] N/A — these are markdown-only changes to skill definitions

### Integration Tests
- [x] N/A — no code changes

### E2E Tests
- [x] N/A — no code changes

### Manual Verification
- [x] Read through modified finalize.md and verify the new Step 4 flow makes sense end-to-end
- [x] Read through modified mainToProd.md and verify the new Step 4 + Step 6.2 flow makes sense
- [x] Verify no references to `--fail-fast` remain in either skill
- [x] Verify no references to `gh run rerun` exist in either skill (only "Never use" guidance)
- [x] Verify `--e2e` flag is removed from mainToProd.md argument-hint and Arguments section
- [x] Verify finalize.md still supports `--e2e` for full E2E suite (but runs critical by default)
- [x] Verify YAML frontmatter (description, argument-hint, allowed-tools) remains valid in both files after edits — no broken syntax, no missing dashes, no unclosed quotes
- [x] Verify CI monitoring in mainToProd runs BEFORE Step 7 cleanup (branch checkout + stash pop)
- [x] Verify finalize.md Success Criteria reflects E2E critical always runs
- [x] Verify testing_overview.md accurately describes new E2E behavior for both skills

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes

### B) Automated Tests
- [x] `npm run lint` — verify no markdown lint issues
- [x] `npx tsc --noEmit` — verify no type regressions (shouldn't be affected)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `.claude/commands/mainToProd.md` — primary target: restructure checks, add CI monitoring, remove --e2e gate
- [x] `.claude/commands/finalize.md` — primary target: restructure checks, remove --fail-fast, always run E2E critical
- [x] `docs/docs_overall/testing_overview.md` — update --e2e flag references for both skills

## Rollback Strategy
If the modified skills cause issues in practice (e.g., "run all checks" produces unreadable output or timeouts):
- Both files are tracked in git — revert with `git checkout origin/main -- .claude/commands/finalize.md .claude/commands/mainToProd.md`
- Changes are markdown-only with no code dependencies, so reverting is safe and instant
- No database migrations, no API changes, no deployment artifacts to roll back

## E2E Duration Assessment
- mainToProd will now always run full E2E locally (`npm run test:e2e`): ~5 minutes on typical hardware (2-3 workers)
- finalize will always run E2E critical (`npm run test:e2e -- --grep @critical`): ~1.5 minutes
- These durations are acceptable given that mainToProd is a production release (runs infrequently) and finalize E2E critical is already fast
- If full E2E becomes too slow for mainToProd, the plan can be revised to use `test:e2e:critical` instead — but for production releases, full coverage is preferred

## Review & Discussion

### Iteration 1 (2026-03-27)
**Scores**: Security 4/5, Architecture 3/5, Testing 3/5

**Critical gaps fixed:**
1. [Architecture] Added finalize Success Criteria update to Phase 1 + finalize PR body template update
2. [Architecture] Clarified mainToProd CI monitoring goes BEFORE Step 7 cleanup — restructured Steps 6-7 ordering in Phase 2
3. [Testing] Added YAML frontmatter validation to Manual Verification checklist
4. [Testing] Added Rollback Strategy section
5. [Testing] Added E2E Duration Assessment section

### Iteration 2 (2026-03-27)
**Scores**: Security 5/5, Architecture 4/5, Testing 4/5

**Minor issues addressed:**
1. [Architecture] Clarified Step 4.5 stays as separate mandatory step (not inlined into Step 4)
2. [Architecture] Added description (line 2) update to --e2e removal task
3. [Architecture] Added backup push to CI monitoring fix-push-rewatch loop + timeout documentation (worst case ~75 min)
4. [Architecture] Note: Co-Authored-By update is mainToProd-only (finalize has no hardcoded Co-Authored-By) — intentional asymmetry

### Iteration 3 (2026-03-27)
**Scores**: Security 5/5, Architecture 5/5, Testing 5/5

**✅ CONSENSUS REACHED** — All 3 reviewers voted 5/5. Plan ready for execution.
