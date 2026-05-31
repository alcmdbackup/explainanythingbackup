# Nightly E2E Still Failing Research

## Problem Statement
Nightly E2E has failed 5 consecutive nights (5/26–5/30) despite fix PRs landing on main+production. Only one of four matrix jobs fails: `e2e (firefox, evolution, https://ea-evolution.vercel.app, @evolution)`. Chromium passes on the same host; both public-host jobs pass.

## Requirements (from GH Issue #1139)
Same as summary — diagnose why prior fix attempts didn't stop the bleeding and produce an actionable fix order.

## High Level Summary

### What actually failed last night (run 26677629433)
6 tests are listed as "failures," but only **1 is deterministic** — the other 5 are flaky (failed first attempt, passed on retry). Playwright still marks the job failed because the 1 deterministic test exhausted all 4 retries.

| # | Spec : Line | Failure | Status |
|---|---|---|---|
| 1 | `admin-evolution-navigation.spec.ts:83` (goto at 112) | `NS_BINDING_ABORTED` | **DETERMINISTIC** (4/4 retries failed identically) |
| 2 | `admin-evolution-experiments-list.spec.ts:165` (goto at 189) | `NS_BINDING_ABORTED` | flaky (passed on retry) |
| 3 | `admin-evolution-filter-consistency.spec.ts:84` (uncheck at 97) | `Clicking the checkbox did not change its state` | flaky |
| 4 | `admin-evolution-variants.spec.ts:225` (goto at 254) | `NS_BINDING_ABORTED` | flaky |
| 5 | `admin-strategy-wizard.spec.ts:151` (toBeVisible at 166) | `element(s) not found` | flaky |
| 6 | `admin-strategy-wizard.spec.ts:245` (toHaveURL at 282) | URL stuck on `/strategies/new` | flaky |

### Three confirmed root-cause clusters

**Cluster A — Firefox NS_BINDING_ABORTED on chained `page.goto()`** (tests 1, 2, 4) — confidence 0.85
The shared pattern is `goto(list) → click(row) → waitForURL(detail) → goto(list-again)`. The detail page mounts `useEffect` server-action fetches with no AbortController (`evolution/src/components/evolution/tabs/EntityMetricsTab.tsx:119-132`; `evolution/src/components/evolution/tabs/AttributionCharts.tsx:42-57` only does state-cleanup, not network cancel). Firefox aborts these in-flight requests with `NS_BINDING_ABORTED` when the next top-level navigation arrives; Chromium silently coalesces. The pattern is explicitly documented at `evolution/src/components/evolution/sections/EntityDetailTabs.tsx:106-111` as a "known Next.js 15 race diagnosed in commit 7b1240bc." (Note: `EntityDetailTabs` is in `sections/` but the leaf components are in `tabs/`.)

**Cluster B — Controlled-checkbox hydration race** (tests 3, 5) — confidence 0.7
Both specs use `if (await isChecked()) await uncheck()` (or `.click()`) against a raw `<input type=checkbox>` in `EntityListPage.tsx:295-300` with no post-click stability barrier. Under Firefox + cold Vercel function, the setState-triggered re-render lags Playwright's post-click state poll. **Round 3 verdict refuted "just swap `uncheck()` → `setChecked(false)"** as the fix — both Playwright APIs call the identical `_setChecked` codepath (`node_modules/playwright-core/lib/server/dom.js:_setChecked`) and would throw the same error. The real fix is a post-click stability barrier (`expect.not.toBeChecked()` + row `waitFor()`).

**Cluster C — Wizard submit URL-stuck** (test 6) — confidence 0.65
Create-Strategy click at line 280 races a 300ms-debounced `getStrategyDispatchPreviewAction` useEffect at `src/app/admin/evolution/strategies/new/page.tsx:483-539`, OR `handleSubmit` silently returns at line 744 when `iterationErrors`/`configErrors` transiently contain entries during state-recalc after agent-type swap. URL stays at `/strategies/new` through 23 polls × 20s.

### Why yesterday's fixes didn't help (refuting "should have been fixed")

- **PR #1130** "fix(e2e): backport paragraph_recombine wizard fixes" — `git show aaa68841 --name-only` returns only `admin-strategy-crud.spec.ts`. The failing wizard tests live in `admin-strategy-wizard.spec.ts` (different file). **PR #1130 could not have fixed these.**
- **PR #1124** explicitly *accepted* Firefox `NS_BINDING_ABORTED` as "informational" and proposed a one-line nav-retry mitigation at `docs/planning/investigate_recent_broken_tests_main_prod_20260528_planning.md:63` that was **deferred and never implemented** — `grep -r "NS_BINDING" src/__tests__/e2e` returns 0 matches.
- **PR #1127** (auth-redirect callback assert), **PR #1129** (autologin password drift), **PR #1101** (guest auto-login), **PR #1110** (debug service unavailable) — all addressed orthogonal failure classes (auth callbacks, public-host password drift, debug pages). None touched the admin/evolution/Firefox cluster. PR #1129's body even predicted "expect a red nightly tonight."
- **Deploy/cache mismatch refuted at 0.97 confidence**: job log shows checkout of `0eb234e2` on production, byte-equal to main for the relevant files. The fixes ARE on production — they just don't address these failures.

### Recommended fix order (from Round 4 synthesis)

| # | Action | Fixes | Effort | Risk |
|---|---|---|---|---|
| **P6** | Create `src/__tests__/e2e/helpers/safe-goto.ts` wrapping `page.goto()` with NS_BINDING_ABORTED catch + 500ms wait + one retry. Codemod 4 chained-goto sites. Add `expect.not.toBeChecked()` barrier + `waitForLoadState('networkidle', 5s)` before wizard click. | 5–6 of 6 | ~1h | Low |
| **P1** | Add Firefox to PR CI for the existing `e2e-evolution` job (matrix `[chromium, firefox]`, evolution-path PRs only). | Prevents recurrence — would have caught all 6 failures pre-merge | 5-line YAML | Low (after P6) |
| **P5(a)** | Auto-file a GitHub issue on nightly failure (tagged `release-health`, idempotent reuse). | Visibility — environments.md:85 names "attention problem" as the 62-day-outage root cause | ~20 lines bash | Low |
| **P4** | Block `/mainToProd` promotion when latest nightly is red (override flag `PROMOTE_DESPITE_NIGHTLY_RED=true`). | Stops "shipped on red" — would have blocked PR #1137's 5/29 promotion 7h after a known-red nightly | ~15 lines bash | Low (with override) |
| **P3** | Add Firefox to local `test:gate` (`/finalize` Step 5). | Belt-and-suspenders | one-script-line | Low |
| **P2** | Firefox smoke subset on every PR. | Defense-in-depth only — none of the 6 failures are `@smoke` tagged | ~3 min/PR | Low |

### First action this morning
Implement P6 — the deferred nav-retry helper from `investigate_recent_broken_tests_main_prod_20260528_planning.md:63`. This was designed, signed off, and shelved 2 days ago; landing it today closes 4 of 6 failures with a single low-risk PR. Then P1 to make Firefox a blocking signal so this pattern can't recur.

### Open questions for user
1. For Cluster A: are we OK shipping a **test-side** mitigation (nav-retry wrapper) only, or do we also retrofit `AbortController` into `EntityMetricsTab`/`AttributionCharts` as defense-in-depth? (Step 5 in the proposal — Medium risk app code change.)
2. Should the Firefox PR-CI gate (P1) ship in the same PR as P6, or land separately to limit blast radius?
3. Is the `release-health` GitHub issue auto-file (P5a) preferred over fixing the Slack channel attention problem, or do both?

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (user-tagged)
- docs/docs_overall/environments.md — diagnosed 62-day silent outage as "attention problem" (line 85)
- docs/docs_overall/testing_overview.md — Rule 4 (point-in-time check anti-pattern) and `flakiness/no-point-in-time-pom-helpers` lint
- docs/feature_deep_dives/testing_setup.md — `resetFilters()` POM convention + Playwright project matrix
- docs/docs_overall/debugging.md — `/debug` skill and Honeycomb/Sentry tools

### Prior investigation docs harvested
- `docs/planning/smoke_test_and_nightly_e2e_failing_20260523/` — origin of the current matrix (website split)
- `docs/planning/investigate_recent_broken_tests_main_prod_20260528/_planning.md:63` — **the nav-retry mitigation that was deferred**
- `docs/planning/autologin_broken_3rd_night_after_fix_20260529/` — orthogonal (public-host password drift)
- `docs/planning/investigate_paragraph_recombine_invocation_20260529/` — orthogonal
- `docs/planning/make_fixes_paragraph_recombine_20260528/` — touched a different file than the failing wizard spec

## Code Files Read (by agents)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-navigation.spec.ts` (line 112)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-experiments-list.spec.ts` (line 189)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-filter-consistency.spec.ts` (line 97)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts` (line 254)
- `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` (lines 159–166, 245–282)
- `src/__tests__/e2e/fixtures/admin-auth.ts`
- `src/__tests__/e2e/helpers/pages/admin/AdminBasePage.ts`
- `evolution/src/components/evolution/sections/EntityDetailTabs.tsx:106-111, 121-127`
- `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx:119-132`
- `evolution/src/components/evolution/tabs/AttributionCharts.tsx:42-57`
- `evolution/src/components/admin/EntityListPage.tsx:295-300`
- `src/app/admin/evolution/strategies/new/page.tsx:483-539, 744`
- `playwright.config.ts` (firefox project lines 158-165)
- `.github/workflows/e2e-nightly.yml` (ref: production, line 60)
- `.github/workflows/ci.yml` (detect-changes lines 48-66)

## Workflow Output Reference
Full 20-agent transcript (~200 KB JSON): `/tmp/claude-1000/-home-ac-Documents-ac-worktree-37-3/431b2c46-e5ad-4dc5-8f18-2eb5def32a02/tasks/wwjiokiyq.output`
Run ID: `wf_59fe65b1-9ee` · 1.7M tokens · 561 tool uses · 19.5 min
