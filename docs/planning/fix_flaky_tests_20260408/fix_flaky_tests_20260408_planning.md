# Fix Flaky Tests Plan

## Background
PR #930 was merged to `main` while several non-evolution E2E tests were known-flaky/failing locally (the PR body explicitly noted "142 passed, 14 pre-existing flakes"). The fixes were made on `chore/main-to-production-apr08` (commits `32e67ecb` → `2f4192a4`) but **never merged back to `main`** — they only exist on the production-prep branch.

The root cause of the "fixes never reach main" problem is a gap in the `/mainToProd` skill: it merges main → production via a deploy branch, runs checks, fixes any failures on the deploy branch, opens a PR `--base production`, and then exits — with no step that backports the fixes to main. Every `/mainToProd` run that uncovers fixes (which is most of them) leaves main dirty until someone notices.

This project (a) brings the existing fixes into `main` so the next branch off main is clean, (b) extends `testing_overview.md` rules to cover the failure classes that slipped through, (c) adds ESLint rules so the same patterns get caught at lint-time on every PR going forward, and (d) fixes `/mainToProd` so post-merge fixes always backport to main automatically (strict mode — `/mainToProd` does not return successfully unless the backport PR was created or zero fixes were needed). CI gap (PRs to `main` only run `@critical` E2E) is **explicitly out of scope** per user direction.

## Requirements
1. **Reapply the flaky-test fixes** from `chore/main-to-production-apr08` onto `main` via this branch (cherry-pick of 4 commits covering 5 distinct failure classes)
2. **Update `docs/docs_overall/testing_overview.md`** with new/extended rules (see proposals below)
3. **Add ESLint enforcement** for each new rule that has a mechanizable check
4. **Add a stale-spec checker script** for the one rule that can't be expressed as ESLint
5. **Fix `/mainToProd` skill** to require a backport PR to main for any post-merge fixes (strict mode — skill does not return successfully without the backport)
6. **Verify** by running lint, the affected specs, the full critical E2E + integration suites, and a runbook walkthrough of the updated `/mainToProd` skill
7. **Out of scope:** changes to CI workflows, full-E2E-on-main PRs, POM `getContent()` deprecation refactor

## Problem
Five distinct E2E failure classes were patched post-merge of PR #930. Mapping each to `testing_overview.md`:
- 3 of 5 violate **existing rules** (Rule 1, 3, 4) that ESLint either doesn't enforce or doesn't catch in their specific manifestation
- 2 of 5 are **genuine gaps** (UI default-filter state; stale specs for removed features)

The fixes themselves are already known-good — they just need to be ported to `main`. The bigger value is enforcement so the same patterns can't recur.

## Options Considered

### How to bring fixes into main
- [x] **Option A: Cherry-pick 4 commits from `chore/main-to-production-apr08` (CHOSEN)** — preserves authorship + commit messages + the round-1/2/3 debugging trail. Cherry-pick is the standard mechanism for backporting fixes from a release branch to mainline; the "duplicate commit" risk doesn't apply because `chore/main-to-production-apr08` flows forward to `production` only, never back to `main`. Order: `32e67ecb`, `bbe6df3f`, `477c31e0`, `2f4192a4`.
- [ ] **Option B: Squash into one fix commit** — cleaner history but loses the round-1/2/3 trail that documents *why* the action-buttons fix needed three iterations.
- [ ] **Option C: Merge `chore/main-to-production-apr08` into this branch** — drags in the release marker commit (`e1811526`) and any other unrelated work on that branch.
- [ ] **Option D: Rewrite from scratch on this branch** — pointless duplication; fixes are already validated.

### How to add the new ESLint rules
- [x] **Option A: Add all 4 rules in this PR alongside fixes (CHOSEN)** — atomic; prevents regressions in the same PR that fixes them. Single PR is ~150 LOC of fixes + ~400 LOC of rules + tests; manageable.
- [ ] **Option B: Split into two PRs (fixes first, rules second)** — fixes-first PR would land without the lint guardrail. No benefit at this size.

### Stale-spec detection
- [x] **Option A: `npm run check:stale-specs` script (CHOSEN)** — pure grep over `data-testid` references, no build needed, fast (<2s). Run-fix-then-wire-in sequence (see Phase 4): run on current codebase first, fix or whitelist false positives, only wire into `npm run lint` after a clean run.
- [ ] **Option B: ESLint custom rule** — overkill; ESLint is AST-aware and `data-testid` matching is a runtime string concern.
- [ ] **Option C: Skip this rule** — leaves the `admin-evolution-anchor-ranking.spec.ts` gap unaddressed.

### Stale-spec script: blocking vs advisory at first
- [x] **CHOSEN: blocking from day one, with run-fix-then-wire-in to ensure clean baseline.** Run the script first, fix or whitelist false positives, *then* wire it into `npm run lint`. If the whitelist after Phase 4 step 3 has fewer than ~10 entries, ship it blocking. If more than ~10, that's a signal the heuristic is too crude — at that point redesign (add prefix-matching for interpolated testids) rather than ship a noisy rule. Acceptable to let Phase 4 slip into a follow-up PR if the codebase is dirtier than expected, but expected to be fast (~50 spec files, ~500 testids).
- [ ] **Alternative: advisory (warn-only) first, promote later** — rejected because nobody looks at warn-only output and the rule provides zero value if ignored.

### `require-reset-filters` ESLint rule severity
- [x] **CHOSEN: `error` from day one, with contingency to downgrade to `warn` only if Phase 5 verification surfaces more than 3 false positives in the existing `09-admin/**/*.spec.ts` corpus.** Reasoning: every other rule in the `flakiness` plugin is `error`; an outlier `warn` rule trains people to ignore lint output; the cost of a false positive is one `eslint-disable` line with a comment, and the cost of a false negative is the four `admin-content` failures we just lived through.
- [ ] **Alternative: `warn` first, promote to `error` after a clean baseline** — rejected because everything else in `flakiness` is `error` and consistency matters.

### `/mainToProd` backport: strict vs best-effort
- [x] **CHOSEN: strict.** `/mainToProd` does not return successfully unless the backport PR to main was either created or explicitly determined unnecessary (zero fix commits beyond the merge commit). The operator gets a clear "go merge this" pointer at the end. Strict eliminates the "humans forget to follow up" failure mode that caused this entire project.
- [ ] **Alternative: best-effort (open backport PR but don't block on it)** — rejected because forgetting is exactly what produced the flakes-on-main problem in the first place.

## Phased Execution Plan

### Phase 1: Cherry-pick the 5 fixes from `chore/main-to-production-apr08`

**VERIFIED via dry-run on `origin/main`:** commits `32e67ecb`, `477c31e0`, and `2f4192a4` apply cleanly. Commit `bbe6df3f` **conflicts on `src/__tests__/e2e/specs/05-edge-cases/global-error.spec.ts`** because main already restructured the file: the inner `test.describe('Error Boundary')` was renamed to `test.describe('Error Display')` (so the same-name-stack bug is partially fixed on main), but main is **missing** the `const isCI = !!process.env.CI` constant and the `test.skip(isCI, ...)` at the top of the outer describe, so the auth-gated `/test-global-error` route still fails in CI. We need to apply only the skip-related portion of `bbe6df3f`'s global-error hunk on top of main's renamed structure.

Note: `32e67ecb`'s deletion of `admin-evolution-anchor-ranking.spec.ts` is a no-op on main (the file is already absent from main); the cherry-pick still applies cleanly because git treats "delete a file that doesn't exist" as a no-op merge. No action needed beyond the standard cherry-pick.

- [ ] `git cherry-pick 32e67ecb` — admin-content `filterTestContent` (line 52), admin-reports `nth-child(4→5)`, no-op delete of `admin-evolution-anchor-ranking.spec.ts`, add `data-testid="admin-content-filter-test-content"`
- [ ] `git cherry-pick bbe6df3f` — **expected conflict on `global-error.spec.ts`**. Resolution:
  1. Open `src/__tests__/e2e/specs/05-edge-cases/global-error.spec.ts` in the conflict state
  2. Keep main's `test.describe('Error Boundary', () => { test.describe('Error Display', () => { ... }) })` outer/inner naming intact
  3. From `bbe6df3f`'s side, take ONLY:
     - The comment block: `// /test-global-error is only accessible in dev mode (middleware excludes it from auth only when NODE_ENV !== 'production'). Skip in CI production builds.`
     - `const isCI = !!process.env.CI;` constant
     - The `// eslint-disable-next-line flakiness/no-test-skip -- debug route auth-excluded only in dev mode` comment
     - `test.skip(isCI, 'Debug route requires dev mode (auth-excluded only when NODE_ENV !== production)');` placed as the **first statement of the outer `test.describe('Error Boundary')` block**, NOT the inner `Error Display` describe (this is the Rule 8 scope fix)
  4. `git add src/__tests__/e2e/specs/05-edge-cases/global-error.spec.ts && git cherry-pick --continue`
  5. The other files in `bbe6df3f` (admin-content.spec.ts lines 115/159/199, action-buttons textarea read) should apply cleanly — verify with `git cherry-pick --continue` output
- [ ] `git cherry-pick 477c31e0` — action-buttons `waitForFunction` for placeholder + admin-content `showHidden` toggle after reload
- [ ] `git cherry-pick 2f4192a4` — action-buttons `expect.poll` replacing strict `toEqual`
- [ ] Run `npm run lint && npm run typecheck` to confirm clean cherry-pick (note: lint is `next lint` only at this stage; the new flakiness rules from Phase 3 are not yet wired in)
- [ ] **Commit boundary:** these 4 cherry-picks form **Commit Group 1** (the bug fixes), kept distinct from later commits so the new ESLint rules in Phase 3 can be reverted independently if they misfire post-merge

### Phase 1.5: Add `resetFilters()` POM helper

This phase exists to break the chicken-and-egg between Phase 1 (cherry-picks reference filter resets via inline `.uncheck()` calls) and Phase 3's new `require-reset-filters` ESLint rule (which expects a `resetFilters` identifier). Adding the helper now means Phase 3's rule has something to recognize and the cherry-picked specs can be migrated to use it (in this same phase) so the rule doesn't immediately flag them.

- [ ] Read `src/__tests__/e2e/helpers/pages/admin/AdminBasePage.ts` to confirm it exists and find a suitable injection point
- [ ] Add a `resetFilters()` method to `AdminBasePage.ts` with a **no-op default body** plus a JSDoc comment: `/** Subclasses override to reset their default filter state. Base class is no-op so non-filtered admin pages work. */`
- [ ] Override `resetFilters()` in `AdminContentPage.ts` to use Playwright's auto-waiting **idempotent** state setters, NOT `isChecked()`-then-uncheck. The `isChecked()` pattern would be flagged by the existing `flakiness/no-point-in-time-checks` rule (verified: `isChecked` is on the rule's hardcoded method list, and the rule's escape clause only allows `await isChecked()` in `VariableDeclarator`/`AssignmentExpression` parent nodes, NOT in `if (await ...)` test conditions). Use `setChecked(false)` instead — it's auto-waiting, idempotent, and lint-safe:
  ```typescript
  async resetFilters(): Promise<void> {
    // setChecked is auto-waiting + idempotent — safe to call regardless of current state
    await this.page
      .locator('[data-testid="admin-content-filter-test-content"]')
      .setChecked(false);
  }

  // Separate helper for tests that need hidden content visible
  async enableShowHidden(): Promise<void> {
    await this.page
      .locator('[data-testid="admin-content-show-hidden"]')
      .setChecked(true);
  }
  ```
  Decision (resolves Phase 1.5 minor open question): keep `enableShowHidden()` as a SEPARATE helper, NOT folded into `resetFilters()`. Rationale: not every test needs hidden content visible, so folding it into `resetFilters()` would surprise other tests. The `admin-content.spec.ts` test at line 115 (which needs both reset AND show-hidden after reload) calls both helpers explicitly.
- [ ] Override `resetFilters()` in `AdminReportsPage.ts` if it has any default filters. ReportsTable has a status filter; reset using the same `setChecked` / state-setter pattern, NOT `isChecked()`. If `AdminReportsPage` has no default filters, leave it inheriting the no-op base implementation.
- [ ] **Update the cherry-picked specs from Phase 1 to call `resetFilters()` instead of inline `.uncheck()`:**
  - `admin-content.spec.ts` lines 52, 115, 159, 199 — replace each inline filter-toggle with `await adminContentPage.resetFilters()`
  - This should be a small mechanical refactor; the inline calls came from the original commits when no helper existed
- [ ] Run `npm run lint && npm run typecheck` again
- [ ] **Commit boundary:** **Commit Group 2** — POM helper + spec migration. Separate commit so it can be reverted independently from the cherry-picks if the helper API turns out wrong.

### Phase 2: Update `testing_overview.md` rules

Each rule edit below includes the **exact wording** to add. The base rules in `testing_overview.md` are unchanged; only the new sub-clauses / paragraphs / examples are appended.

- [ ] **Extend Rule 1** ("Start from a known state every test") — append:

  > **UI default state counts as known state.** For tests that interact with filtered, sorted, or paginated list views, after navigation but before asserting on seeded rows, explicitly reset:
  > - default filter checkboxes (e.g. "Hide test content" → uncheck)
  > - search input (clear it)
  > - sort/order (click default header)
  > - pagination (return to page 1)
  >
  > Provide a `resetFilters()` POM helper for any admin list page used by tests, and call it immediately after `goto<Page>()`. The four `admin-content.spec.ts` failures in PR #930 post-merge were all caused by `ExplanationTable.filterTestContent` defaulting to `true` and hiding the very `[TEST]`-prefixed rows the tests had just seeded — DB was correct, UI default was not.

- [ ] **Extend Rule 3** ("Use stable selectors only") — append:

  > **Forbidden: ordinal table cell selectors.** `td:nth-child(N)` and `tr:nth-child(N)` silently break when columns are added, removed, or reordered. The resulting failure is content-based (wrong assertion on wrong column), not "not found", which makes it harder to diagnose. Use one of:
  > - `getByRole('cell', { name: 'Status' })` (preferred — semantic + stable across reorders)
  > - `[data-testid="status-cell"]` per cell
  > - `getByRole('columnheader', { name: 'Status' })` to find the column index dynamically, then index siblings
  >
  > The `admin-reports.spec.ts:65` failure in PR #930 post-merge was exactly this: `td:nth-child(4)` pointed at the **Details** column after a column was added; the Status badges the test was reading were actually in column `(5)`.

- [ ] **Extend Rule 4** ("Make async explicit") — append:

  > **POM helper return values are point-in-time too.** Custom POM helpers that return `Promise<string>` (or any computed value) are point-in-time checks when used like `expect(await helper()).toEqual(x)` — the helper runs once, the value is captured, and the assertion never retries. Two correct patterns:
  >
  > 1. **Preferred:** rewrite the helper to return a `Locator`, then `await expect(locator).toHaveText(x)` so Playwright auto-retries.
  > 2. **When the value needs computation** (parsing HTML, joining text from multiple elements, stripping whitespace): use `expect.poll`:
  >    ```typescript
  >    // Wrong — point-in-time, races with re-render
  >    expect(await resultsPage.getContent()).toEqual(initialContent);
  >
  >    // Right — Playwright retries the helper until it matches or timeout
  >    await expect
  >      .poll(() => resultsPage.getContent(), { timeout: 10000 })
  >      .toEqual(initialContent);
  >    ```
  >
  > The `action-buttons.spec.ts:250` "Format Toggle preserve content" test went through three rounds of fixes before landing on `expect.poll`. Rounds 1 and 2 patched symptoms (read from textarea, wait for placeholder gone); only round 3 fixed the underlying point-in-time-check anti-pattern. If round 1 had used `expect.poll` immediately, the other two rounds would not have been necessary.

- [ ] **Extend Rule 8** ("Avoid `test.skip`") — append:

  > **`test.skip(condition, ...)` scope is the surrounding `describe`, not all nested children.** When `test.skip` is legitimately used (with the `eslint-disable` comment), it applies only to tests that are **direct siblings** of the skip call inside the same `describe` block. It does **not** apply to tests inside nested inner describes' siblings, and it does **not** apply to tests in describes that contain the describe with the skip. Place the skip in the outermost `describe` you want it to cover.
  >
  > **Forbidden: same-name stacked describes.** Nesting `test.describe('Error Boundary', () => { test.describe('Error Boundary', () => { ... }) })` is confusing in test output (`Error Boundary > Error Boundary > test name`) and trivially leads to scope-related skip bugs. If you must nest, give each level a distinct name. The `global-error.spec.ts` "Error Recovery" / "Normal Operation" failures in PR #930 post-merge happened because the inner `describe('Error Boundary')` had `test.skip(isCI, ...)` but the outer `describe('Error Boundary')`'s direct child tests escaped the skip and ran in CI against an auth-gated debug route, where they were redirected to login.

- [ ] **Add Rule 19** "Stale specs must be deleted with the feature":

  > When removing a feature, delete its E2E specs in the same commit/PR as the feature removal. Orphaned specs cannot pass and pollute CI noise once the next branch tries to run them.
  >
  > Enforced by `npm run check:stale-specs`, which fails any PR whose specs reference `data-testid` values that no source file under `src/components/`, `src/app/`, or `evolution/src/` produces. PR #930 post-merge had to delete `admin-evolution-anchor-ranking.spec.ts` (added in #855) because the "anchor" concept was removed in #929 but its 111-line spec was not.

- [ ] **Update the Enforcement Summary table** in `testing_overview.md`:

  | Rule | Enforcement Mechanism | Catch Point |
  |------|-----------------------|-------------|
  | Rule 3 (extended): No `nth-child` cell selectors | ESLint `flakiness/no-nth-child-cell-selector` | Lint (CI + IDE) |
  | Rule 4 (extended): No `expect(await pomHelper())` | ESLint `flakiness/no-point-in-time-pom-helpers` (NEW; complements existing `no-point-in-time-checks`) | Lint (CI + IDE) |
  | Rule 8 (extended): No same-name nested describes | ESLint `flakiness/no-duplicate-describe-name` | Lint (CI + IDE) |
  | Rule 1 (extended): Reset filters in admin list tests | ESLint `flakiness/require-reset-filters` (admin specs only) | Lint (CI + IDE) |
  | Rule 19 (new): No stale specs | `npm run check:stale-specs` script | Lint chain (CI) |

### Phase 3: Add ESLint rules

Each rule follows the existing pattern in `eslint-rules/`: `eslint-rules/<name>.js` (rule), `eslint-rules/<name>.test.js` (test using **plain `node` runner with the ESLint `RuleTester`** — verified by reading `eslint-rules/no-point-in-time-checks.js` and `package.json`'s `test:eslint-rules` script which manually enumerates each test file with `node ...test.js`). New rules must be:
1. Added to `eslint-rules/index.js` `rules:` object exports
2. Wired into `eslint.config.mjs` in the appropriate `files:` block (existing blocks key off `**/*.spec.ts` and `**/e2e/**/*.ts`)
3. Added to the `test:eslint-rules` script in `package.json` so the test suite actually runs them (Jest does NOT auto-discover them)

All new rules: `meta.type: 'problem'` (matches the existing flakiness plugin convention).

**Commit boundary for Phase 3:** all 4 rule additions form **Commit Group 3** (separate from cherry-picks and POM helper). If a rule misfires post-merge, this commit can be reverted on its own without losing the bug fixes.

- [ ] **`flakiness/no-nth-child-cell-selector`** — flag `td:nth-child(\d+)` and `tr:nth-child(\d+)` substrings inside `locator()` / `page.locator()` / `getByText` / `getByRole` / template strings in `**/*.spec.ts`
  - File: `eslint-rules/no-nth-child-cell-selector.js`
  - Test: `eslint-rules/no-nth-child-cell-selector.test.js` — Valid: `getByRole('cell', { name: 'Status' })`, `[data-testid="status-cell"]`. Invalid: `td:nth-child(5)`, `'tr:nth-child(2) td:nth-child(4)'`
  - Wire: `eslint.config.mjs` block matching `src/__tests__/e2e/specs/**/*.spec.ts`
  - Add test file to `package.json` `test:eslint-rules` script chain
- [ ] **`flakiness/no-duplicate-describe-name`** — flag two `test.describe('X', ...)` (or `test.describe.serial('X', ...)`, or `adminTest.describe('X', ...)` — full set of variants) where one is nested directly inside the other with the same name string
  - File: `eslint-rules/no-duplicate-describe-name.js`
  - Test: `eslint-rules/no-duplicate-describe-name.test.js` covers (a) inner+outer same name → error, (b) sibling same name → allowed, (c) different names → allowed, (d) `test.describe.serial` variants, (e) `adminTest.describe` variants
  - Wire: `eslint.config.mjs` block matching `src/__tests__/e2e/specs/**/*.spec.ts`
  - Add to `test:eslint-rules` script
- [ ] **NEW rule `flakiness/no-point-in-time-pom-helpers`** — *(replaces the earlier "extend existing rule" plan because the existing `no-point-in-time-checks.js` walks a hardcoded method list; extending it to recognize arbitrary user-defined POM helpers requires either type information or a name-pattern heuristic, which is meaningfully different from the existing rule's design)*
  - **Detection pattern (TIGHTENED to exclude Playwright's bare `page` fixture):** flag any `expect(await <Identifier>.<Identifier>(...)).<assertion>(...)` where the inner identifier matches the regex `/[A-Z]\w*Page$/` (POM class instance — requires at least one uppercase letter before "Page", so `resultsPage`, `adminContentPage` match but `page` does NOT). Method-name match (`/^get[A-Z]/`) is dropped because it produced too much overlap with non-POM accessor patterns.
  - **Why this regex specifically:** `resultsPage`, `adminContentPage`, `searchPage`, `loginPage` all end in `Page` preceded by a lowercase letter (which `[A-Z]\w*Page$` matches because the `\w*` is greedy and the `Page` suffix anchors the right edge — `searchPage` matches because `S` is the uppercase letter, `\w*` consumes `earch`, `Page` anchors). Playwright's bare `page` fixture does NOT match because there's no uppercase letter anywhere before the final `Page`.
  - Suggestion message: "Replace `expect(await <pomHelper>).toEqual(x)` with `await expect.poll(() => <pomHelper>).toEqual(x)`. See testing_overview.md Rule 4."
  - File: `eslint-rules/no-point-in-time-pom-helpers.js`
  - Test: `eslint-rules/no-point-in-time-pom-helpers.test.js`. Test matrix:
    - **Invalid (must flag):**
      - `expect(await resultsPage.getContent()).toEqual(x)` — POM identifier
      - `expect(await adminContentPage.getRowCount()).toBe(5)` — POM identifier
      - `expect(await searchPage.getResultCount()).toBeGreaterThan(0)` — POM identifier
    - **Valid (must NOT flag — locks the bare-page exclusion):**
      - `expect(await page.title()).toBe('foo')` — Playwright bare fixture
      - `expect(await page.url()).toContain('/results')` — Playwright bare fixture
      - `expect(await page.content()).toContain('hello')` — Playwright bare fixture
      - `await expect.poll(() => resultsPage.getContent()).toEqual(x)` — correct pattern
      - `await expect(locator).toHaveText(x)` — correct pattern
      - `expect(await otherObj.getValue()).toBe(x)` — non-POM identifier (`otherObj` doesn't end in `Page`)
  - Wire: `eslint.config.mjs` block matching `src/__tests__/e2e/specs/**/*.spec.ts`
  - Add to `test:eslint-rules` script
  - **Note:** the existing `flakiness/no-point-in-time-checks` rule is left UNCHANGED. The two rules are complementary: the old one catches hardcoded Playwright methods (`.textContent()`, `.isVisible()`, etc.); the new one catches custom POM helpers.
- [ ] **`flakiness/require-reset-filters`** *(scoped to admin specs, severity `error`)*
  - Detection: in spec files matching the admin glob, walk each `test()` body. If the body contains a string literal starting with `'[TEST]'` AND the same `test()` body (or its enclosing `describe`'s `beforeEach`) does NOT contain a `MemberExpression` whose property name matches `/^reset(Filters|Search)$/` OR a `CallExpression` on `[data-testid="admin-content-filter-test-content"]` ending in `.uncheck()`, flag it.
  - File: `eslint-rules/require-reset-filters.js`
  - Test: `eslint-rules/require-reset-filters.test.js` covers admin-content (the cherry-picked spec, after Phase 1.5 migration), admin-reports, admin-users; valid case has `resetFilters()` in `beforeEach`; invalid case has `[TEST]` literal without it
  - **Wire (explicit):** add a NEW block to `eslint.config.mjs`:
    ```js
    {
      files: ['src/__tests__/e2e/specs/09-admin/**/*.spec.ts'],
      plugins: { flakiness: flakinessRules },
      rules: { 'flakiness/require-reset-filters': 'error' },
    }
    ```
    The full path glob (`src/__tests__/e2e/specs/09-admin/**/*.spec.ts`) is required — a relative `09-admin/**/*.spec.ts` will not match from repo root.
  - Add to `test:eslint-rules` script
  - **Severity contingency:** if Phase 5 verification surfaces more than 3 false positives in the existing `09-admin/**/*.spec.ts` corpus after the Phase 1.5 migration, downgrade to `warn` and document the reason in the planning doc + commit message. Otherwise stay at `error`.

### Phase 4: Add `check:stale-specs` script

**Run-fix-then-wire-in sequence** — do NOT add to `npm run lint` until the script runs cleanly on the current codebase.

- [ ] **Step 4.1:** Add `scripts/check-stale-specs.ts` with a 2-sentence header comment per CLAUDE.md convention. Logic:
  1. **Spec scan glob (strict):** find every `data-testid="..."` literal in `src/__tests__/e2e/specs/**/*.spec.ts` ONLY. Explicitly **exclude** `src/__tests__/e2e/helpers/**` and `src/__tests__/e2e/pages/**` so POM helpers are not scanned as specs.
  2. **Source scan globs (broad):** for each unique testid, grep these directories for `data-testid="<id>"` literal AND `data-testid={\`<id>...\`}` template-literal anchored prefix matches:
     - `src/components/**`
     - `src/app/**`
     - `src/lib/**`
     - `src/hooks/**`
     - `src/editorFiles/**`
     - `src/__tests__/e2e/helpers/pages/**` (POM files emit testids via locator strings, but only count as "source" for testids the POM itself wraps in `data-testid={...}` JSX — skip locator-string mentions)
     - `evolution/src/**` (full subtree, not just `components/`)
  3. **Skip rules** (avoid false positives):
     - Skip any spec testid containing `${` (clearly interpolated — can't statically match)
     - Skip any spec testid in the whitelist file `scripts/check-stale-specs.allowlist` (one prefix per line, `#` comments allowed)
     - When a source file uses a ternary `data-testid={open ? 'foo-open' : 'foo-closed'}`, treat both `'foo-open'` and `'foo-closed'` as defined testids
     - When a source file uses a prop pass-through `<Foo testId='bar' />`, the script cannot statically know `Foo` renders it as `data-testid` — these are expected false positives that go in the whitelist
  4. Print a table of orphaned testids → spec files that reference them
  5. Exit non-zero if any orphans found
- [ ] **Step 4.2:** Add `package.json` script: `"check:stale-specs": "tsx scripts/check-stale-specs.ts"`
- [ ] **Step 4.3:** **Run the script on the current codebase first**, BEFORE wiring it into anything. For each false positive:
  - (a) If the testid is genuinely interpolated/computed and the script's heuristic missed it → add the testid prefix to `scripts/check-stale-specs.allowlist` with a one-line `#` comment explaining why
  - (b) If the spec is genuinely stale → delete the spec or fix it
  - Track the whitelist size; document final count in commit message
- [ ] **Step 4.4:** Decision point based on whitelist size:
  - If whitelist ≤ 10 entries → wire `check:stale-specs` into `npm run lint` chain. Since `lint` is `next lint` (verified in `package.json`), wiring is via a script chain: change to `"lint": "next lint && npm run check:stale-specs"`. This means CI's lint job (in `.github/workflows/ci.yml`) automatically picks up the script with no workflow file edit required.
  - If whitelist > 10 entries → STOP, redesign the script with smarter heuristics (prefix-matching, AST-aware), and re-run from Step 4.3. If a redesign would push this PR significantly larger, document the gap and create a follow-up issue. **The cherry-picks + ESLint rules + rule docs still ship in this PR**; only Phase 4 is cut.
- [ ] **Step 4.5:** Add the `scripts/check-stale-specs.allowlist` file to git with whatever entries Step 4.3 produced
- [ ] **Step 4.6:** Add a unit test in `scripts/check-stale-specs.test.ts` that includes a regression case for the `admin-evolution-anchor-ranking.spec.ts` situation: a fixture spec referencing `data-testid="anchor-ranking-badge"` with no source defining it should fail the script. This validates that the script would have caught the original stale-spec problem. **Test runner:** Jest, with `@jest-environment node` per-file directive — matches the existing `scripts/query-db.test.ts` and `scripts/generate-article.test.ts` convention (verified). Auto-discovered by `jest.config.js` `testMatch: '**/*.test.ts'`, so `npm run test` picks it up automatically; no edit to `package.json` needed.
- [ ] **Commit boundary:** Phase 4 forms **Commit Group 4** — script + whitelist + lint wiring. Separate so a stale-specs misfire can be reverted without affecting cherry-picks or ESLint rules.

### Phase 5: Verify

- [ ] `npm run lint` — must pass with new rules active
- [ ] `npm run typecheck`
- [ ] `npm run test:eslint-rules` — runs the manually-enumerated ESLint rule test chain (verified via `package.json`); must include the 4 new rule test files added in Phase 3
- [ ] `npm run test` (unit, including any tests added under `scripts/`)
- [ ] `npm run check:stale-specs` — must pass
- [ ] **Re-run each previously-flaky spec locally** with high repetition. `playwright.config.ts` has `retries: 0` locally and `retries: 2` in CI; the 0-retry local run is the strict validation we want, so do **NOT** add `--retries=2` to these commands. Per-spec `npx playwright test` commands trigger `ensure-server.sh` automatically via `playwright.config.ts` `globalSetup` (verified at config line ~15) — do NOT pre-start the dev server manually.
  - **action-buttons format-toggle test (the round-3 fix): `--repeat-each=20 --workers=1` SCOPED TO THE FORMAT-TOGGLE TEST ONLY**. Running the entire spec at 20x serialized would be ~80 min wall-clock (≈8 tests × 20 × ~30s); narrowing to the single test brings it to ~10 min while still giving the round-3 fix the rigor it needs. The other tests in the spec only need 1x.

    Use a precise grep that anchors to the exact test name (the test in commit `2f4192a4` is named exactly `should preserve content when toggling between markdown and plaintext modes`). Use the full prefix to avoid matching sibling tests:
    ```bash
    # Targeted: 20x runs of just the format-toggle test (full title prefix anchors uniqueness)
    npx playwright test src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts \
      --grep "should preserve content when toggling" --repeat-each=20 --workers=1
    # Then 1x run of the rest of the spec
    npx playwright test src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts \
      --grep-invert "should preserve content when toggling"
    ```
    Verify uniqueness BEFORE running the 20x: `npx playwright test src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts --grep "should preserve content when toggling" --list` must print exactly 1 test.
  - admin-content: `--repeat-each=10`
    `npx playwright test src/__tests__/e2e/specs/09-admin/admin-content.spec.ts --repeat-each=10`
  - admin-reports: `--repeat-each=10`
    `npx playwright test src/__tests__/e2e/specs/09-admin/admin-reports.spec.ts --repeat-each=10`
  - global-error: `--repeat-each=10` **locally only**. CI mode is skipped per the `test.skip(isCI, ...)` we cherry-picked, so the run will silently no-op if `CI` is set in the operator's shell environment. **Explicitly unset `CI`** for this run, and assert that tests actually executed (not skipped). Use a POSIX-compliant `(unset CI; ...)` subshell instead of GNU-only `env -u CI` so the command works on both Linux (GNU coreutils) AND macOS (BSD env), since the project supports macOS dev:
    ```bash
    # Force CI unset for the duration of the playwright run, POSIX-compliant
    (
      unset CI
      npx playwright test \
        src/__tests__/e2e/specs/05-edge-cases/global-error.spec.ts \
        --repeat-each=10 --reporter=list 2>&1 | tee /tmp/global-error-run.log
    )
    # Sanity check: at least one "passed" line in output (not "skipped")
    grep -q "passed" /tmp/global-error-run.log || \
      { echo "ERROR: global-error tests did not run — CI env may be set or tests are still skipped"; exit 1; }
    ```
    The 10x local validation is the only signal we get for this spec; lint rule `flakiness/no-duplicate-describe-name` is the primary CI safeguard going forward.
- [ ] **Verify non-critical specs touched by the cherry-picks** are not regressed:
  - `npm run test:e2e:critical` — full critical suite (covers anything tagged `@critical`)
  - **Plus** explicit per-spec runs above (these are NOT in the critical suite — verified by absence of `@critical` tag in the four spec files). The per-spec runs ARE the non-critical verification path.
  - Optional broader sanity: `npm run test:e2e:non-evolution` if time permits — uses the existing script (verified in `package.json` line 30: `playwright test --project=chromium --grep-invert="@evolution|@skip-prod" --project=chromium-unauth`). Runs the full non-evolution suite and would catch any sibling-test regression introduced by the cherry-picks. Earlier draft used `npm run test:e2e -- --grep-invert='@evolution'` which is wrong syntax — use the existing script instead.
- [ ] Optional: `npm run test:integration:critical` (no integration tests touched, but cheap to confirm)
- [ ] **Severity contingency check** — count `require-reset-filters` violations after running `npm run lint` against the existing `09-admin/**/*.spec.ts` corpus (post Phase 1.5 migration). If >3, downgrade to `warn` per Phase 3 contingency and document in commit message.
- [ ] **Stale-specs whitelist size check** — count entries in `scripts/check-stale-specs.allowlist`. If >10 after Phase 4 Step 4.3, follow the Phase 4 Step 4.4 redesign branch (defer Phase 4 to a follow-up PR).
- [ ] **Phase 6.6 dry-run completion gate** — Phase 5 cannot be marked complete unless **all 7 sub-steps of Phase 6.6 have passed** with the documented expected output. Cross-reference the Phase 6.6 acceptance criterion explicitly here. If any dry-run sub-step is skipped, this checkbox stays unchecked and the project is not ready to merge.
- [ ] **`test:eslint-rules` chain integrity check** — explicitly grep `package.json` to confirm all 4 new rule test files are in the `test:eslint-rules` script chain: `grep -c 'no-nth-child-cell-selector\.test\.js\|no-duplicate-describe-name\.test\.js\|no-point-in-time-pom-helpers\.test\.js\|require-reset-filters\.test\.js' package.json` must return `4`. The `&&`-chained script would fail loudly on a missing file, but a missing entry would silently skip the test — this grep catches that.

### Phase 6: Fix `/mainToProd` skill to require backport to main

Edit `.claude/commands/mainToProd.md` to add a strict backport step. The skill currently exits after creating the PR `--base production`, leaving any post-merge fixes stranded on the deploy branch.

**Commit boundary:** Phase 6 forms **Commit Group 5** — `.claude/commands/mainToProd.md` edit only. Separate commit so the skill change can be reverted independently if a subtle bug is discovered after the next real release runs.

- [ ] **Step 6.0 (NEW): also edit Step 5 of `mainToProd.md`** to capture the deploy-merge SHA explicitly so Step 6.3 has an unambiguous reference. After the existing `git commit -m "Release: ..."` line, add:

  ```bash
  # Record the deploy-merge SHA for Step 6.3 backport. Use `git rev-parse
  # --git-path` so the path resolves correctly in BOTH primary checkouts
  # (`.git/maintoprod-deploy-merge-sha`) AND linked worktrees, where `.git`
  # is a FILE not a directory and the path becomes
  # `.git/worktrees/<name>/maintoprod-deploy-merge-sha`. Without this,
  # `echo > .git/maintoprod-deploy-merge-sha` fails with "Not a directory"
  # in any worktree invocation.
  DEPLOY_MERGE_COMMIT=$(git rev-parse HEAD)
  SHA_FILE=$(git rev-parse --git-path maintoprod-deploy-merge-sha)
  echo "$DEPLOY_MERGE_COMMIT" > "$SHA_FILE"
  ```

  This replaces the unsafe `git log --merges -1` heuristic from the original Phase 6 draft, which could pick up an unrelated merge commit if Step 6.2d's iteration involved any merge (e.g., conflict-resolution merge during fix-push-watch cycles).

- [ ] **Step 6.1:** Add new **Step 6.3** to `.claude/commands/mainToProd.md` immediately after the existing Step 6.2 (Monitor CI Checks). The step body:

  ```markdown
  ### 6.3. Backport Fixes to Main (REQUIRED)

  After the production PR's CI checks all pass, identify any commits added to
  the deploy branch beyond the deploy-merge SHA captured in Step 5 — these are
  the post-merge fixes from steps 4, 4.5, and 6.2d. Backport them to main.

  This step is REQUIRED. The skill does not return successfully unless either
  (a) a backport PR was created and pushed, or (b) zero fix commits were found
  beyond the deploy-merge SHA (clean release).

  **Step 6.3a — Identify fix commits (uses authoritative `git rev-list --count`, not grep):**

  ```bash
  # Use git rev-parse --git-path so this works in both primary checkouts
  # AND linked worktrees (where .git is a FILE, not a directory)
  SHA_FILE=$(git rev-parse --git-path maintoprod-deploy-merge-sha)
  if [ ! -f "$SHA_FILE" ]; then
    echo "ERROR: $SHA_FILE missing — Step 5 did not run."
    exit 1
  fi
  DEPLOY_MERGE_COMMIT=$(cat "$SHA_FILE")

  # Use git rev-list --count for an authoritative count (NOT `grep -c .` which
  # produces a multi-line "0\n0" when the input is empty)
  FIX_COUNT=$(git rev-list --count "${DEPLOY_MERGE_COMMIT}..HEAD")

  echo "Found $FIX_COUNT fix commits to backport"
  ```

  **Step 6.3b — Branch on FIX_COUNT. CRITICAL: the entire 6.3c-6.3h block must be inside the `else` branch, not a sequence of separate code blocks. If the operator copies this into `mainToProd.md`, they MUST preserve the if/else structure.**

  ```bash
  if [ "$FIX_COUNT" -eq 0 ]; then
    # ============================================================
    # Clean release path
    # ============================================================
    echo "Clean release — zero fix commits. Skipping backport."
    BACKPORT_PR_URL="none — clean release"
  else
    # ============================================================
    # Backport path — Steps 6.3c through 6.3h
    # ============================================================
    FIX_COMMITS=$(git rev-list --reverse "${DEPLOY_MERGE_COMMIT}..HEAD")

    # ---- 6.3c: Create the backport branch off latest main ----
    # Timestamp suffix (HHMM) prevents same-day re-run collision
    git fetch origin main
    BACKPORT_BRANCH="fix/maintoprod-backport-$(date +%b%d-%H%M | tr '[:upper:]' '[:lower:]')"
    git checkout -b "$BACKPORT_BRANCH" origin/main

    # ---- 6.3d: Cherry-pick each fix commit in order ----
    # CRITICAL: use process substitution `< <(...)` NOT a pipe `| while`.
    # A piped while-loop runs in a SUBSHELL, so `exit 1` inside it only kills
    # the subshell — execution would silently fall through to 6.3e/6.3f and
    # produce a broken backport PR on cherry-pick conflict. Process substitution
    # keeps the loop in the parent shell so `exit 1` works as expected.
    while IFS= read -r sha; do
      [ -z "$sha" ] && continue
      if ! git cherry-pick "$sha"; then
        echo "ERROR: cherry-pick conflict on $sha"
        echo "Resolve manually, then run: git cherry-pick --continue"
        echo "After all picks succeed, run steps 6.3e-6.3g manually."
        # Clean up trap before exit so the temp body file (set later) is removed
        rm -f "${BODY_TMP:-}"
        exit 1
      fi
    done < <(printf '%s\n' "$FIX_COMMITS")

    # ---- 6.3e: Run local checks on the backport branch ----
    # Includes build because backport commits often touch components.
    # Hard exit on failure — without this, 6.3f would push a broken PR.
    if ! (npm run lint && npm run typecheck && npm run build && npm run test:unit); then
      echo "ERROR: local checks failed on backport branch — refusing to push."
      echo "Backport branch '$BACKPORT_BRANCH' is left in place for inspection."
      exit 1
    fi

    # ---- 6.3f: Push and create the backport PR ----
    git push -u origin HEAD

    # Backup push — fetch first so --force-with-lease is properly scoped
    git fetch backup 2>/dev/null || echo "WARNING: backup fetch failed; --force-with-lease may degrade"
    git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify || \
      echo "WARNING: backup push failed; continuing"

    # Pre-compute the commit list for the PR body.
    # CRITICAL: use `origin/main..HEAD` NOT `${DEPLOY_MERGE_COMMIT}..HEAD`.
    # The backport branch is based on origin/main (not on the deploy branch),
    # so DEPLOY_MERGE_COMMIT is not an ancestor of HEAD on this branch.
    # Using DEPLOY_MERGE_COMMIT..HEAD here would list every commit reachable
    # from HEAD but not from DEPLOY_MERGE_COMMIT, which inflates with main
    # commits unrelated to the cherry-picks. origin/main..HEAD lists exactly
    # the commits we just cherry-picked.
    COMMIT_LIST=$(git log --format='- %h %s' origin/main..HEAD)

    # Use --body-file with a temp file to AVOID heredoc-in-markdown EOF
    # whitespace bugs entirely. The temp file is shell-trapped for cleanup.
    BODY_TMP=$(mktemp)
    trap "rm -f \"$BODY_TMP\"" EXIT
    {
      echo "## Summary"
      echo ""
      echo "Backports post-merge fix commits from the $(date '+%b %d') main→production"
      echo "release deploy branch back to main, so the next branch off main starts clean."
      echo ""
      echo "## Commits backported"
      echo "$COMMIT_LIST"
      echo ""
      echo "## Why"
      echo "Fixes made on the deploy branch during /mainToProd verification do not"
      echo "automatically reach main. Without this backport, the next feature branch"
      echo "off main reintroduces the same issues."
      echo ""
      echo "## Test plan"
      echo "- [x] Local lint, typecheck, build, unit tests pass"
      echo "- [ ] CI passes on this PR"
      echo ""
      echo "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
    } > "$BODY_TMP"

    # Capture only the PR URL. Recent gh versions print "Creating pull request..."
    # to STDERR before the URL on stdout, so capture stdout only and take the
    # last line in case future gh versions add extra stdout chatter. Use
    # `set -o pipefail` in a subshell so a `gh pr create` failure isn't
    # masked by the `| tail -1` pipe.
    BACKPORT_PR_URL=$(set -o pipefail; gh pr create --base main --head "$BACKPORT_BRANCH" \
      --title "fix: backport mainToProd fixes from $(date '+%b %d') release" \
      --body-file "$BODY_TMP" | tail -1)
    if [ -z "$BACKPORT_PR_URL" ]; then
      echo "ERROR: gh pr create failed or returned empty URL"
      rm -f "$BODY_TMP"
      exit 1
    fi

    rm -f "$BODY_TMP"
    trap - EXIT

    # ---- 6.3g: BACKPORT_PR_URL is now set for Step 7's summary ----

    # ---- 6.3h: No-op — Step 7's `git checkout <original-branch>` handles
    # the return to the operator's starting branch. Original draft tried to
    # `git checkout -` here but that's `@{-1}` which is non-deterministic
    # depending on whether the cherry-pick loop touched the branch state.
  fi
  ```

- [ ] **Step 6.2:** Update **Step 7 (Verify and Cleanup)** in `mainToProd.md` to reference the backport PR and clean up the deploy-merge-SHA file:

  ```markdown
  ### 7. Verify and Cleanup

  ```bash
  # Verify production PR is mergeable
  gh pr view --json mergeable,mergeStateStatus

  # Display final summary
  echo "═══════════════════════════════════════════"
  echo "  /mainToProd complete"
  echo "═══════════════════════════════════════════"
  echo "  Production PR: <url from step 6>"
  echo "  Backport PR:   ${BACKPORT_PR_URL}"
  echo "═══════════════════════════════════════════"

  # Clean up the deploy-merge SHA cache file from Step 5
  # (use the same git-path resolver to handle worktrees correctly)
  rm -f "$(git rev-parse --git-path maintoprod-deploy-merge-sha)"

  # Return to original branch
  git checkout <original-branch>
  git stash pop
  ```
  ```

- [ ] **Step 6.3:** Update the **Success Criteria** section in `mainToProd.md` to add:

  ```
  - Backport PR to main created (if any post-merge fix commits were made),
    OR explicitly noted as "clean release — zero fix commits"
  ```

- [ ] **Step 6.4:** Update the skill's frontmatter `description` field to mention the backport:

  Old: `Merge main into production, resolve conflicts (preferring main), run checks (including E2E), and create PR`

  New: `Merge main into production, resolve conflicts (preferring main), run checks (including E2E), create PR, and backport any post-merge fixes to main`

- [ ] **Step 6.5:** Read through the updated runbook end-to-end and confirm:
  - [ ] The bash logic in 6.0 + 6.3a-6.3h is syntactically correct (no obvious shell errors)
  - [ ] The "zero fix commits" branch (Step 6.3b) is now real bash, not English
  - [ ] The cherry-pick conflict path (Step 6.3d's `if !` branch) gives the operator a clear next-action message
  - [ ] Step 7's summary references `$BACKPORT_PR_URL` and cleans up `.git/maintoprod-deploy-merge-sha`
  - [ ] All variable references match between steps (DEPLOY_MERGE_COMMIT, FIX_COUNT, FIX_COMMITS, BACKPORT_BRANCH, BACKPORT_PR_URL)

- [ ] **Step 6.6 (NEW): Dry-run the new bash logic against the live `chore/main-to-production-apr08` branch.** This branch has exactly the 4 fix commits (`32e67ecb`, `bbe6df3f`, `477c31e0`, `2f4192a4`) plus the original deploy-merge commit (`e1811526 Release: main → production`), making it the perfect smoke-test fixture. The dry-run runs INSIDE a linked worktree, which is also the worst-case path-resolution test for the `.git`-is-a-file bug.

  - [ ] **Precondition check:** confirm `chore/main-to-production-apr08` is not already checked out elsewhere: `git worktree list | grep chore/main-to-production-apr08 && echo "ALREADY CHECKED OUT — use a different branch or remove the existing worktree"`
  - [ ] Check out the branch in a temp worktree: `git worktree add /tmp/maintoprod-dryrun chore/main-to-production-apr08`
  - [ ] `cd /tmp/maintoprod-dryrun`
  - [ ] **Simulate Step 5's SHA capture using the worktree-safe resolver:**
    ```bash
    SHA_FILE=$(git rev-parse --git-path maintoprod-deploy-merge-sha)
    git rev-parse e1811526 > "$SHA_FILE"
    echo "Wrote to: $SHA_FILE"  # should print .git/worktrees/maintoprod-dryrun/maintoprod-deploy-merge-sha
    ```
    If this fails with "Not a directory", the path resolver is broken — fix `mainToProd.md` Step 5 and re-run.
  - [ ] Run **only Step 6.3a's bash**:
    ```bash
    SHA_FILE=$(git rev-parse --git-path maintoprod-deploy-merge-sha)
    DEPLOY_MERGE_COMMIT=$(cat "$SHA_FILE")
    FIX_COUNT=$(git rev-list --count "${DEPLOY_MERGE_COMMIT}..HEAD")
    echo "FIX_COUNT=$FIX_COUNT"
    ```
    Must print `FIX_COUNT=4`.
  - [ ] Run **only Step 6.3b's branch**:
    ```bash
    if [ "$FIX_COUNT" -eq 0 ]; then echo "clean"; else echo "would backport $FIX_COUNT commits"; fi
    ```
    Must print `would backport 4 commits`.
  - [ ] Run **only Step 6.3d's loop in dry-run mode** (echo instead of cherry-pick):
    ```bash
    FIX_COMMITS=$(git rev-list --reverse "${DEPLOY_MERGE_COMMIT}..HEAD")
    printf '%s\n' "$FIX_COMMITS" | while IFS= read -r sha; do
      [ -z "$sha" ] && continue
      echo "would cherry-pick $sha $(git log -1 --format='%s' $sha)"
    done
    ```
    Must print 4 lines, one per fix commit, in commit order (oldest first).
  - [ ] **Test the zero-commit branch** by also dry-running against `origin/main`:
    ```bash
    git checkout origin/main
    SHA_FILE=$(git rev-parse --git-path maintoprod-deploy-merge-sha)
    git rev-parse HEAD > "$SHA_FILE"
    DEPLOY_MERGE_COMMIT=$(cat "$SHA_FILE")
    FIX_COUNT=$(git rev-list --count "${DEPLOY_MERGE_COMMIT}..HEAD")
    echo "FIX_COUNT=$FIX_COUNT"  # must print FIX_COUNT=0
    if [ "$FIX_COUNT" -eq 0 ]; then echo "clean release detected"; fi  # must print
    ```
  - [ ] **Test the heredoc-replacement `--body-file` path** by writing a small body to a temp file and confirming `gh pr create --dry-run` (or `--no-create` if available, otherwise just inspect the body) doesn't mangle multi-line content:
    ```bash
    BODY_TMP=$(mktemp)
    printf '## Summary\n\nLine 1\n\nLine 2 with $special chars and \`backticks\`\n' > "$BODY_TMP"
    cat "$BODY_TMP"  # must print exactly 5 lines, $special and `backticks` literal
    rm "$BODY_TMP"
    ```
  - [ ] Clean up: `cd -; git worktree remove /tmp/maintoprod-dryrun`
  - [ ] **Acceptance criterion:** all 7 dry-run sub-steps print expected output (precondition check, SHA capture, 6.3a count, 6.3b branch, 6.3d loop, zero-commit branch, body-file roundtrip). If any fail, fix the bash in `mainToProd.md` and re-run the affected sub-step. Document the dry-run results in the project commit message for Phase 6. Phase 5 cannot complete until this acceptance criterion is met.

## Testing

### Unit Tests
- [ ] `eslint-rules/no-nth-child-cell-selector.test.js` — RuleTester valid/invalid cases
- [ ] `eslint-rules/no-duplicate-describe-name.test.js` — RuleTester valid/invalid cases
- [ ] `eslint-rules/no-point-in-time-checks.test.js` — extended with `expect(await helper())` invalid case + `expect.poll` valid case
- [ ] `eslint-rules/require-reset-filters.test.js` — RuleTester valid/invalid cases

### Integration Tests
- [ ] None required — no service-layer code changed

### E2E Tests
- [ ] `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` — passes 5x in a row
- [ ] `src/__tests__/e2e/specs/09-admin/admin-content.spec.ts` — passes 5x in a row
- [ ] `src/__tests__/e2e/specs/09-admin/admin-reports.spec.ts` — passes 5x in a row
- [ ] `src/__tests__/e2e/specs/05-edge-cases/global-error.spec.ts` — passes 5x in a row (in CI mode tests should skip; in local dev mode they should run)

### Manual Verification
- [ ] Open `admin-content.spec.ts` and confirm the new `data-testid="admin-content-filter-test-content"` checkbox is targeted by tests
- [ ] Spot-check ESLint rules by introducing a deliberate violation in a sandbox file and confirming the rule fires + the message is helpful
- [ ] Read through updated `.claude/commands/mainToProd.md` end-to-end (Phase 6 step 6.5)

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Each previously-flaky E2E spec passes 5 consecutive local runs (commands above in Phase 5)

### B) Automated Tests
- [ ] `npm run lint` (with new rules)
- [ ] `npm run typecheck`
- [ ] `npm run test` (unit, picks up new ESLint rule unit tests automatically via Jest)
- [ ] `npm run check:stale-specs`
- [ ] `npm run test:e2e:critical`

## Documentation Updates
- [ ] `docs/docs_overall/testing_overview.md` — extend Rules 1, 3, 4, 8 + add Rule 19 + update Enforcement Summary table (Phase 2)
- [ ] `docs/feature_deep_dives/testing_setup.md` — add a short subsection under "E2E Patterns" documenting (a) the `expect.poll` pattern for POM-helper assertions, (b) the `resetFilters()` POM convention with one example
- [ ] `.claude/commands/mainToProd.md` — Phase 6: add Step 6.3 (backport), update Step 7 (cleanup summary), update Success Criteria, update frontmatter description
- [ ] `docs/docs_overall/environments.md` — no changes needed (the `/mainToProd` skill behavior changes but the environment topology doesn't)
- [ ] `docs/docs_overall/debugging.md` — no changes needed

## Review & Discussion
[Populated by /plan-review]
