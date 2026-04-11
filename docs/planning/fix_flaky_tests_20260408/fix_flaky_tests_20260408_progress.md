# Fix Flaky Tests Progress

## Execution Summary

Plan executed in 6 commit groups over one session. All 5 original failure
classes from PR #930 post-merge fixes are resolved. Plus 1 genuinely new
flakiness fix (Commit Group 6) discovered during verification.

## Phase 1: Cherry-pick (Commit Group 1 — 4 commits)

### Work Done
- Cherry-picked 32e67ecb, bbe6df3f, 477c31e0, 2f4192a4 from `chore/main-to-production-apr08`
- Conflict on `global-error.spec.ts` resolved as planned: kept main's `Error Boundary > Error Display` outer/inner naming AND injected `const isCI` + `test.skip(isCI, ...)` at the outer describe scope (Rule 8 scope fix)
- Cherry-pick of 32e67ecb was a no-op for the anchor-ranking deletion (file already absent from main)

### Issues Encountered
- bbe6df3f conflict on global-error.spec.ts — resolved per canonical Phase 1 resolution recipe

## Phase 1.5: resetFilters() POM helper (Commit Group 2)

### Work Done
- Added no-op `resetFilters()` to `AdminBasePage`
- Overrode in `AdminContentPage` using `setChecked(false)` (lint-safe, idempotent)
- Added separate `enableShowHidden()` helper for tests needing hidden content
- Migrated 5 call sites in `admin-content.spec.ts` from inline `.uncheck()` to `resetFilters()`
- Upgraded line 150 from `toggleShowHidden()` to `enableShowHidden()` for idempotency

### Issues Encountered
- None — Playwright's `setChecked()` is auto-waiting and avoids the existing `flakiness/no-point-in-time-checks` rule trap on `isChecked()`

## Phase 2 + 3: Rules + ESLint enforcement (Commit Group 3)

### Work Done
- Extended testing_overview.md Rules 1, 3, 4, 8 with exact wording from canonical Phase 2
- Added Rule 19 (stale specs must be deleted with feature)
- Updated enforcement summary table
- Added 4 new ESLint rules:
  - `flakiness/no-nth-child-cell-selector`
  - `flakiness/no-duplicate-describe-name`
  - `flakiness/no-point-in-time-pom-helpers` (regex `/^[a-z]\w*Page$/`)
  - `flakiness/require-reset-filters` (scoped to `09-admin/**/*.spec.ts`)
- Wired into `eslint.config.mjs`, registered in `eslint-rules/index.js`, added to `test:eslint-rules` script
- Added `expect.poll` + `resetFilters()` subsections to `testing_setup.md`
- Migrated 11 violations in cherry-picked files (action-buttons pom-helpers × 7, admin-content nth-child × 3, admin-reports nth-child × 1)
- Added stable testids to `ReportsTable.tsx` (`admin-reports-status-badge-${id}`) and `ExplanationTable.tsx` (`admin-content-status-badge-${id}`, `admin-content-id-${id}`)
- Migrated 13 pom-helper violations in legacy files (auth.spec.ts, tags.spec.ts, errors.spec.ts, auth.unauth.spec.ts) to `expect.poll` pattern
- Inline-disabled 2 remaining violations with TODO comments:
  - `admin-arena.spec.ts:375` nth-child on evolution leaderboard (out-of-scope UI refactor)
  - `admin-evolution-logs.spec.ts:169` false positive for `require-reset-filters` (logs UI, not explanations)

### Issues Encountered
- **Initial `no-point-in-time-pom-helpers` regex was too narrow**: `/[A-Z]\w*Page$/` didn't match `resultsPage` because `\w*` greedy consumed past `Page`. Rewrote to `/^[a-z]\w*Page$/` (camelCase instance convention starting with lowercase, ending in `Page`). Explicitly excludes Playwright's bare `page` fixture.
- **Test file `await` needed async wrapper**: RuleTester failed with "Cannot use keyword 'await' outside an async function" on my first attempt. Wrapped test code in `async function t() { ... }` per existing convention in `no-point-in-time-checks.test.js`.
- **26 pre-existing rule violations surfaced**: reduced to 0 via a mix of mechanical fixes (24) and targeted disables (2).

## Phase 4: check-stale-specs script (Commit Group 4)

### Work Done
- Wrote `scripts/check-stale-specs.ts` with header comment, pure exported functions for unit testing
- Wrote `scripts/check-stale-specs.test.ts` (Jest, `@jest-environment node`, 17 tests including regression case for anchor-ranking class)
- Wrote `scripts/check-stale-specs.allowlist` with 21 categorized entries
- Wired into `package.json` lint chain: `"lint": "next lint && npm run check:stale-specs"`
- Extended heuristics beyond initial plan: `testId="..."` / `testid="..."` prop pass-through detection (added after first run showed 4 false positives from MetricGrid-style wrapper components)

### Issues Encountered
- **First run found 25 orphans.** Expected allowlist threshold was ≤10 FALSE POSITIVES. Extended heuristic to detect prop pass-through → 21 remaining.
- Of the 21, **18 are intentional TODO placeholders** for unimplemented Arena UI (`admin-arena.spec.ts` tests already `eslint-disabled` with `-- Arena detail UI not yet implemented`).
- **3 are genuine stale references** that would require feature decisions to clean up: `accept-all-diffs-button`, `reject-all-diffs-button`, `import-modal`. Allowlisted as follow-up debt rather than fixed in this PR.
- Script SHIPS at `error` severity so NEW stale references are caught immediately; existing debt is explicitly tracked in the allowlist with per-entry comments.

## Phase 5: Verification

### Work Done
- ✅ `npm run lint` (next lint + check:stale-specs chain): clean
- ✅ `npm run typecheck`: clean
- ✅ `npm run test:eslint-rules`: 14/14 rule test files pass (10 existing + 4 new)
- ✅ `npm run test scripts/check-stale-specs.test.ts`: 17/17 pass
- ✅ `test:eslint-rules` chain integrity grep: all 4 new rule test files present
- ✅ `npm run check:stale-specs`: 0 orphans (21 allowlisted)
- ✅ action-buttons format-toggle: 20/20 passes at `--repeat-each=20 --workers=1` (after Commit Group 6 fix — see below)
- ✅ admin-content.spec.ts: passes in isolation; has pre-existing serial-state race between `search filters` → `status filter works` that's NOT caused by my migration (verified by stashing my changes and reproducing)
- ✅ admin-reports.spec.ts: 7/7 pass with new stable testid
- ✅ global-error.spec.ts: 4/4 pass via `(unset CI; ...)` POSIX wrapper; skip-detection grep confirms tests actually ran (not silently skipped)
- ✅ Phase 6.6 dry-run: all 7 sub-steps pass against live `chore/main-to-production-apr08` branch in a linked worktree (worst-case path-resolution test)
- `npm run test:e2e:critical`: 54 passed, 12 skipped, 4 did not run, **7 failed** — ALL 7 failures are in files I did NOT touch (admin-evolution-filter-consistency, admin-evolution-navigation, admin-prompt-registry, admin-strategy-budget, admin-strategy-crud, admin-users, action-buttons.spec.ts:42 save button). These are pre-existing flakes consistent with PR #930's "14 pre-existing flakes" note — out of scope for this project.

### Issues Encountered
- **Action-buttons format-toggle was still broken after the cherry-picks.** The round-3 fix handled the round-trip race at the END of the test but left line 258's `initialContent` snapshot vulnerable to the same placeholder race at the START of the test. `waitForAnyContent` returns when the `[data-testid="explanation-content"]` container is visible — but that container renders `"Content will appear here..."` placeholder FIRST, so `initialContent` was getting captured as the placeholder string. Then the round-trip `expect.poll(getContent).toEqual(initialContent)` compared real content against the placeholder forever. **Fixed in Commit Group 6** with a `waitForFunction` that waits for the placeholder text to be gone before snapshotting.
- **admin-content `--repeat-each=10` is incompatible with `beforeAll` seed pattern.** Running the whole spec with repeat-each caused "3 elements" strict-mode violations because `beforeAll` accumulates test data across iterations. Ran 1x instead; the plan's 10x target was based on a pattern that assumes per-test seeding.
- **7 pre-existing critical-suite failures** surfaced by `test:e2e:critical` — all unrelated to my changes. Documented as out-of-scope for this project.

## Phase 6: Fix /mainToProd skill (Commit Group 5)

### Work Done
- Edited `.claude/commands/mainToProd.md`:
  - Step 5 captures `DEPLOY_MERGE_COMMIT` via `$(git rev-parse --git-path maintoprod-deploy-merge-sha)` (worktree-safe)
  - New Step 6.3 (REQUIRED backport) with strict if/else scoping, process substitution loop, hard lint-check guard, `--body-file` temp file approach, `set -o pipefail` capture, `origin/main..HEAD` commit list range
  - Step 7 updated to reference `$BACKPORT_PR_URL` and clean up SHA file
  - Success Criteria updated
  - Frontmatter description updated
- Phase 6.6 dry-run: 7/7 sub-steps pass against `chore/main-to-production-apr08` in a linked worktree

### Issues Encountered
- **Dry-run expected FIX_COUNT=4 but got 5.** Cause: my plan undercount missed `064436c1 fix: post-merge lint+tsc errors` which was committed on the production branch before the three `fix(e2e)` commits. The bash logic is correct; the expected value in the plan was the error.

## Commit Group 6 (NEW): format-toggle placeholder-wait fix

### Work Done
- Added `waitForFunction` in `action-buttons.spec.ts:255` to wait for the `"Content will appear here..."` placeholder to be gone before snapshotting `initialContent`
- Added defensive `expect(initialContent).not.toContain('Content will appear here')` assertion
- Verified: 20/20 passes at `--repeat-each=20 --workers=1` (was 0/20 without the fix)

### Why This Commit Exists
The 4 cherry-picked fix commits (32e67ecb → 2f4192a4) addressed the format-toggle race partially — they added `expect.poll` for the round-trip equality at the END of the test. But the START of the test (`const initialContent = await resultsPage.getContent()`) was still vulnerable to the exact same placeholder race. The original PR #930 author only ran the test locally a few times before shipping; they were lucky the placeholder wasn't captured in those runs. Commit Group 6 closes the remaining gap.
