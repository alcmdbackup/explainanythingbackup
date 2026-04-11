# Fix Flaky Tests Research

## Problem Statement
PR #930 (`fix(evolution): post-merge pipeline fixes`) was merged to `main` while several non-evolution E2E tests were known-flaky/failing locally (the PR body explicitly notes "142 passed, 14 pre-existing flakes"). CI didn't catch them because PRs to `main` only run `@critical` tagged E2E. The full failures only surfaced when preparing the next `main → production` release on `chore/main-to-production-apr08`, where they were patched in 4 successive commits (`32e67ecb` → `bbe6df3f` → `477c31e0` → `2f4192a4`).

This project investigates each of those failures, classifies them against the testing rules in `docs/docs_overall/testing_overview.md`, and proposes new rules / ESLint enforcement so the same class of flake doesn't regress.

## Scope: which tests broke
Source: `git log` on `chore/main-to-production-apr08` for fix commits authored after PR #930 merged (commit `f1e26fa2`).

| # | Spec | Test | Symptom | Root cause | Fix commit |
|---|------|------|---------|------------|------------|
| 1 | `04-content-viewing/action-buttons.spec.ts:250` | "preserve content when toggling between markdown and plaintext modes" | `getContent()` returned `''` in plaintext mode | In plaintext mode the content lives in `<textarea data-testid="raw-markdown-editor">`, NOT in `[data-testid="explanation-content"]` | `bbe6df3f` (round 2) |
| 1b | same | same | After toggling back to markdown, `[data-testid="explanation-content"]` briefly shows the placeholder string `"Content will appear here..."` before re-mount | No wait for re-render to complete | `477c31e0` (round 3) — added `waitForFunction` for placeholder gone |
| 1c | same | same | Strict `expect(...).toEqual()` raced the React re-mount | Point-in-time assertion against streaming/re-rendering DOM | `2f4192a4` (round 4) — replaced with `expect.poll(getContent).toEqual(initialContent)` |
| 2 | `09-admin/admin-content.spec.ts:52` | "search filters explanations" | Seeded `[TEST]…` row not found | `ExplanationTable` defaults `filterTestContent=true`, hides `[TEST]%` rows | `32e67ecb` |
| 2b | `09-admin/admin-content.spec.ts:115` | "hide and restore from table" | Same `filterTestContent` issue | Same | `bbe6df3f` |
| 2c | `09-admin/admin-content.spec.ts:115` | "hide and restore from table" | After page reload (second `gotoContent()`) the row was hidden again | React state reset on reload — `showHidden` defaulted back to `false` | `477c31e0` |
| 2d | `09-admin/admin-content.spec.ts:159` | "hide and restore from modal" | `filterTestContent` | Same as 2 | `bbe6df3f` |
| 2e | `09-admin/admin-content.spec.ts:199` | "bulk hide selected" | `filterTestContent` | Same as 2 | `bbe6df3f` |
| 3 | `05-edge-cases/global-error.spec.ts` | "Error Recovery" (~line 90), "Normal Operation" (~line 116) | Tests redirected to login in CI; `/test-global-error` is auth-gated when `NODE_ENV=production` (CI build is prod) | Two stacked `test.describe('Error Boundary', () => { ... })` blocks. The `test.skip(isCI, ...)` was inside the **inner** describe only, so the **outer** describe's tests ran in CI without the skip applied | `bbe6df3f` — hoisted skip to outer describe |
| 4 | `09-admin/admin-reports.spec.ts:65` | "filterByStatus" | Status badges read empty / wrong | `td:nth-child(4)` selector pointed at the **Details** column; `ReportsTable` has 7 columns (ID, Explanation, Reason, Details, Status, Reported, Actions) — the Status column is `(5)` after a column was added | `32e67ecb` — changed to `(5)` |
| 5 | `09-admin/admin-evolution-anchor-ranking.spec.ts` (entire file) | all tests | Could never pass | The "anchor" concept was removed in the parallel-pipeline rewrite (#929), but the spec (added in #855) was never deleted alongside the feature removal | `32e67ecb` — file deleted |

## High Level Summary

Five distinct failure classes, all caught only post-merge because CI on PRs to `main` runs only `@critical`-tagged E2E. None of them are "true" Heisenbugs — each has a deterministic root cause that maps cleanly onto either an existing testing rule (violated, but not enforced by lint) or a gap that should become a new rule.

**Headline conclusion:** the existing rules in `testing_overview.md` would have caught **3 of 5** classes if they'd been enforced rigorously. The remaining 2 classes (UI default-filter-state, stale specs for removed features) are gaps that warrant new rules and/or ESLint plugins.

## Rule Mapping: Existing Rules vs. Each Failure

`docs/docs_overall/testing_overview.md` lists 18 testing rules. Mapping each post-merge failure to the relevant rule:

| Failure | Existing rule violated | Enforced today? | Notes |
|---------|------------------------|-----------------|-------|
| **#1c** action-buttons strict `toEqual` race | **Rule 4** "Make async explicit — use auto-waiting assertions, not point-in-time checks" | Yes — ESLint `flakiness/no-point-in-time-checks` | The lint rule must not have caught `expect(await getContent()).toEqual(...)` because `getContent()` is a custom POM helper. The lint rule needs to recognize `await pomMethod()` patterns inside `expect(...)` as point-in-time, or POMs need to return locators that the caller awaits with `expect(locator)`. |
| **#1, #1b** action-buttons placeholder/textarea | (none directly) | n/a | This is an "interpret the rendered DOM correctly" gotcha. Loosely related to **Rule 18** ("wait for hydration proof") — the test waited for the toggle button state but not for content re-render to complete. |
| **#2/#2b–e** admin-content filterTestContent default | **Rule 1** "Start from a known state every test" | No (philosophy only) | The test seeded data correctly but did NOT reset the **UI's** filter defaults. "Known state" is currently interpreted as DB+session only — should extend to UI default toggles when interacting with filtered list views. |
| **#3** global-error stacked describe + skip | **Rule 8** "Avoid `test.skip()`" + structural | Partially — `flakiness/no-test-skip` lints `test.skip()` usage but the rule allows the eslint-disable escape hatch this file uses. ESLint does not detect that the `skip` is in the wrong scope. | Two `test.describe('Error Boundary', () => {)` blocks with the **same name** stacked — confusing and bug-prone. No rule prevents this. |
| **#4** admin-reports `td:nth-child(4)` | **Rule 3** "Use stable selectors only" | No — Rule 3 is documentation-only | `td:nth-child(N)` is exactly the kind of "brittle CSS based on layout" Rule 3 forbids. There is no ESLint rule enforcing this. |
| **#5** admin-evolution-anchor-ranking stale spec | (none) | No | No rule covers "spec for removed feature must be deleted with the feature." |

## Proposed New Rules / Enforcement

### Rule A — Forbid `nth-child` table-cell selectors in E2E (extends Rule 3)

**Why:** `admin-reports.spec.ts` broke when a column was added because the test used `td:nth-child(4)`. This is a recurring pattern: table column counts change, and any spec selecting cells by ordinal position breaks silently (the wrong column happens to be non-empty so the test fails on a content assertion, not a "not found" error).

**Proposal:**
- New ESLint rule `flakiness/no-nth-child-cell-selector` that flags `td:nth-child(\d+)` and `tr:nth-child(\d+)` inside `locator()` / `page.locator()` arguments in `**/*.spec.ts`.
- Allow `:nth-of-type` for non-table tags via opt-in.
- Acceptable replacements: `data-testid` on each cell, ARIA roles+names (`getByRole('cell', { name: ... })`), or `getByRole('columnheader', { name: 'Status' })` indexing.

**Code change required (App):** add `data-testid` to each `<td>` in `ReportsTable` (and similar admin tables) so tests can target by name.

### Rule B — Reset UI default filters when seeding test data into filtered list views

**Why:** Four `admin-content` tests broke at once because `ExplanationTable` defaults `filterTestContent=true`, hiding the very rows the tests just seeded. Tests **must** put the UI into a known state (filters off, sorts default, pagination at page 1) immediately after navigation, before asserting on seeded rows.

**Proposal:**
- Extend **Rule 1** ("Start from a known state every test") to call out UI default state explicitly.
- New POM convention: every admin list page POM must expose `resetFilters()` (uncheck filter checkboxes, clear search input, etc.) and tests must call it after `goto()` and before any seeded-row assertion.
- Add data-testids: `admin-content-filter-test-content` was added in `32e67ecb` — extend the same convention to all default filter checkboxes.
- Optional ESLint rule `flakiness/require-reset-filters` that flags admin spec files where a `goto<Page>()` is followed by a `locator(...).filter({ hasText: '[TEST]' })` without an intervening `resetFilters()` call.

### Rule C — No stacked `test.describe` blocks with identical names

**Why:** `global-error.spec.ts` had two `test.describe('Error Boundary', () => {)` nested inside each other. The `test.skip(isCI)` was inside the inner one, so outer-describe tests escaped the skip. Same-named stacked describes are also confusing in test output (`Error Boundary > Error Boundary > test name`).

**Proposal:**
- New ESLint rule `flakiness/no-duplicate-describe-name` that flags identical describe-name strings in the same parent scope or nested directly inside one another.
- Add to **Rule 8** discussion: "If you use `test.skip(condition, ...)` for a whole scope, the skip applies only to siblings inside the **same describe**, not to nested describes. Place the skip in the outermost describe you want it to cover."

### Rule D — Detect stale specs for removed features

**Why:** `admin-evolution-anchor-ranking.spec.ts` lived for ~10 days after the feature it tested was removed. CI couldn't catch this because the spec just failed (and was tagged so it didn't run on PR-to-main). It surfaced only post-merge.

**Proposal (lightweight):**
- Add a `npm run check:stale-specs` script that grep-validates each spec file's primary `data-testid` selectors exist somewhere in `src/components/`. If a spec references a `data-testid` no component renders, fail and ask the author to delete or fix the spec.
- Run this script in CI on PRs to `main` (it's fast — pure grep, no build needed).
- Alternatively / additionally, surface broken specs via the post-merge nightly E2E run with a failure-budget threshold (>3 failing specs in nightly = open auto-issue).

### Rule E — Strengthen Rule 4 (auto-waiting assertions) to cover POM helpers

**Why:** The action-buttons round-4 fix replaced `expect(await resultsPage.getContent()).toEqual(initialContent)` with `expect.poll(() => resultsPage.getContent()).toEqual(initialContent)`. The current ESLint `flakiness/no-point-in-time-checks` rule presumably matches `page.textContent()` / `locator.innerText()` / etc., but cannot see inside a custom POM helper.

**Proposal:**
- Extend `flakiness/no-point-in-time-checks` to flag `expect(await <anyAwaitedCall>).toEqual/toBe/toContain(...)` where the awaited expression is **not** an `expect(locator).<assertion>` chain. The fix is one of:
  - `await expect(locator).toHaveText(...)` (preferred — auto-retrying)
  - `await expect.poll(() => helper()).toEqual(...)` (when content needs computation)
- Document the `expect.poll` pattern as the canonical way to assert against POM helper return values.
- POM convention: helpers that return derived data (like `getContent()` which strips HTML) should be called inside `expect.poll`, never inside `expect(await ...)`.

## Documents Read

### Core Docs
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

### Relevant Docs (manually tagged)
- `docs/feature_deep_dives/testing_setup.md` — confirms 4-tier strategy + critical/full split, `@critical` parameter form
- `docs/docs_overall/testing_overview.md` — full Rules 1-18 + ESLint enforcement matrix; this is the doc the proposed rules will amend
- `docs/docs_overall/environments.md` — confirms PRs to `main` run only critical E2E (5 integration + `@critical` E2E), and PRs to `production` run the full 4-shard E2E suite. Explains why post-merge flakiness slips through.
- `docs/docs_overall/debugging.md` — `/debug` 4-phase workflow used implicitly in fix commits

## Code Files Read
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` (lines 230-300) — the format-toggle test and 3 rounds of fixes
- `src/__tests__/e2e/specs/05-edge-cases/global-error.spec.ts` (lines 1-60) — stacked describes
- `src/__tests__/e2e/specs/09-admin/admin-content.spec.ts` (commit diffs) — filterTestContent fixes
- `src/__tests__/e2e/specs/09-admin/admin-reports.spec.ts` (commit diff line 65) — `td:nth-child` fix
- Commits inspected: `32e67ecb`, `bbe6df3f`, `477c31e0`, `2f4192a4`, `f1e26fa2`

## Key Findings

1. **CI gap is the meta-issue.** PRs to `main` only run `@critical` E2E. Every flake in the table above is in a non-critical spec, which is why they all slipped through. This is intentional (cost) but means flakiness in non-critical specs accumulates between `main → production` releases.
2. **3 of 5 failure classes are existing-rule violations** that ESLint either does not enforce or fails to enforce strictly enough (Rules 1, 3, 4).
3. **2 of 5 are genuine gaps** (default UI filter state, stale specs).
4. **No actual Heisenbug or timing race needed network-level fixes.** Every fix was either a selector change, an assertion-shape change (`expect.poll`), a state-reset, or a scope correction. This suggests the next wave of stabilization should focus on enforcement, not on test infrastructure rewrites.
5. The action-buttons test went through **three** rounds of fixes after the initial post-merge attempt. This is a smell: the first two rounds patched symptoms (textarea read, then placeholder wait), and only round 3 (`expect.poll`) addressed the underlying point-in-time-check anti-pattern. The `/debug` skill's 3-strike rule was effectively triggered here.

## Open Questions

1. **Should new rules be merged in this branch, or in a follow-up?** Adding 5 ESLint rules + extending POM conventions is a meaningful surface area. Could split into two PRs: (a) extend `testing_overview.md` rule text + delete stale specs + fix already-broken assertions; (b) write the new ESLint plugins.
2. **Is there appetite for running the full E2E suite on PRs to `main`?** Cost is the constraint. Alternative: run full suite on a label (`run-full-e2e`) or on a daily schedule against `main`.
3. **Stale-spec detection threshold:** strict grep for `data-testid` may produce false positives (selectors built from variables). Need to decide whether the script is advisory (warn-only) or blocking.
4. **POM helpers returning derived data:** should we deprecate `getContent()`-style helpers in favor of returning `Locator` objects so callers always use `await expect(locator).toHaveText(...)`? This is a larger refactor.
