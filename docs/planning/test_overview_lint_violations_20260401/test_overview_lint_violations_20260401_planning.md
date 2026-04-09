# Test Overview Lint Violations Plan

## Background
Review all lint rules, upgrade warn→error where appropriate, fix all violations. Review testing rules (Rules 1-18) and ensure they are all enforced via lint and hooks, then fix any violations found. Also address recent CI flakiness patterns by adding new enforcement rules.

## Requirements (from GH Issue #917)
I want to review all of my lint rules, and set them all to error instead of warn if appropriate then fix all violations. Also I want to review my testing rules and make sure they are all enforced via lint and hooks, then review for any violations.

## Problem
The codebase has 380 lint warnings and 0 errors across 92 files. All violations are at warn level, meaning they don't block CI. Three flakiness rules that catch real bugs (point-in-time checks, hardcoded tmpdir, hydration waits) are at warn when they should be error. One implemented rule (no-duplicate-column-labels) is not configured at all. 12 E2E specs violate Rule 13 (serial mode for beforeAll suites) with no automated enforcement. The promise/catch-or-return rule has zero violations but remains at warn from a completed migration.

## Options Considered
- [x] **Option A: Phased approach** — Upgrade ready rules first, fix violations, then add new rules. Keeps PRs reviewable and CI green throughout.
- [x] **Option B: Big bang** — Upgrade all rules and fix all violations in one pass. Risky — could break CI during fixes.
- [x] **Option C: Rules only** — Only upgrade/add rules, don't fix violations. Leaves 380 warnings unfixed.

## Phased Execution Plan

### Phase 1: Upgrade Flakiness Rules to Error + Fix Violations
- [x] Upgrade `flakiness/no-point-in-time-checks` from warn → error in `eslint.config.mjs`
- [x] Fix 28 `no-point-in-time-checks` violations (replace point-in-time DOM checks with auto-waiting assertions)
- [x] Upgrade `flakiness/no-hardcoded-tmpdir` from warn → error in `eslint.config.mjs`
- [x] Fix 16 `no-hardcoded-tmpdir` violations (use per-worker paths or `os.tmpdir()`)
- [x] Upgrade `flakiness/require-hydration-wait` from warn → error in `eslint.config.mjs`
- [x] Fix any `require-hydration-wait` violations in POM files
- [x] Run full CI-equivalent checks: `npm run lint && npm run typecheck && npm test`
- [x] **Rollback if lint fails**: revert the severity upgrade (warn→error) in `eslint.config.mjs`, keep the violation fixes, re-run lint to confirm green, then investigate which fixes were incorrect

### Phase 2: Configure Missing Rule + Fix Unconfigured Gaps
- [x] Add `flakiness/no-duplicate-column-labels: "error"` to `eslint.config.mjs` — requires a NEW config block since the `flakiness` plugin is currently only registered for spec/e2e file patterns. Add a standalone block:
  ```js
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "evolution/src/**/*.ts", "evolution/src/**/*.tsx"],
    plugins: { flakiness: flakinessRules },
    rules: { "flakiness/no-duplicate-column-labels": "error" },
  }
  ```
- [x] Upgrade `promise/catch-or-return` from warn → error (zero current violations, migration complete)
- [x] Upgrade `design-system/enforce-prose-font` from warn → error (only 3 violations)
- [x] Fix 3 `enforce-prose-font` violations (change `font-display` → `font-body` on prose elements)
- [x] Upgrade `no-restricted-syntax` (untyped createClient) from warn → error
- [x] Expand `no-restricted-syntax` scope to include `evolution/scripts/**/*.ts`
- [x] Fix 33 untyped `createClient()` violations (add `<Database>` type parameter)
- [x] Remove 5 stale/unused `eslint-disable` directives
- [x] Fix 2 `react-hooks/exhaustive-deps` warnings (real bugs — stale closures in `results/page.tsx` and `TextRevealPlugin.tsx`)
- [x] Run full CI-equivalent checks: `npm run lint && npm run typecheck && npm test`
- [x] **Rollback if lint fails**: revert severity upgrades, keep violation fixes, re-run lint

### Phase 3: Fix Rule 13 Violations (Serial Mode)
- [x] Add `adminTest.describe.configure({ mode: 'serial' })` to 12 evolution admin E2E specs:
  - [x] `admin-evolution-invocation-detail.spec.ts`
  - [x] `admin-evolution-variants.spec.ts`
  - [x] `admin-evolution-experiments-list.spec.ts`
  - [x] `admin-evolution-bugfix-regression.spec.ts`
  - [x] `admin-evolution-error-states.spec.ts`
  - [x] `admin-evolution-strategy-detail.spec.ts`
  - [x] `admin-evolution-filter-consistency.spec.ts`
  - [x] `admin-evolution-accessibility.spec.ts`
  - [x] `admin-evolution-arena-detail.spec.ts`
  - [x] `admin-evolution-dashboard.spec.ts`
  - [x] `admin-evolution-runs.spec.ts`
  - [x] `admin-evolution-navigation.spec.ts`
- [x] Run the 12 modified spec files directly to verify serial mode doesn't break them:
  ```bash
  npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-{dashboard,runs,variants,invocation-detail,experiments-list,bugfix-regression,error-states,strategy-detail,filter-consistency,accessibility,arena-detail,navigation}.spec.ts
  ```
- [x] Also run `npm run test:e2e:critical` to verify no regressions in critical suite
- [x] **Rollback if E2E fails**: revert `mode: 'serial'` additions, investigate which spec has test-order dependency issues

### Phase 4: Create New ESLint Rule — `require-serial-with-beforeall`
- [x] Create `eslint-rules/require-serial-with-beforeall.js`:
  - Detect `test.describe` / `adminTest.describe` blocks containing `beforeAll` / `test.beforeAll`
  - Check for `test.describe.configure({ mode: 'serial' })` in same block
  - Report error if `beforeAll` exists without serial config
  - Handle nested describe blocks (only check the block containing beforeAll)
- [x] Create `eslint-rules/require-serial-with-beforeall.test.js` with valid/invalid cases
- [x] Add rule to `eslint.config.mjs` — MERGE into existing spec files config block (lines 46-57) alongside `max-test-timeout`, `no-test-skip`, `require-test-cleanup`, `no-point-in-time-checks`:
  ```js
  // In the existing { files: ["**/*.spec.ts", "**/*.spec.tsx"], ... } block:
  "flakiness/require-serial-with-beforeall": "error",
  ```
- [x] Export rule from `eslint-rules/index.js` (add to existing exports object)
- [x] Run full CI-equivalent checks: `npm run lint && npm run typecheck && npm test`
- [x] Verify no false positives across the E2E suite (27 compliant + 12 fixed = 0 violations expected)

### Phase 5: Create New ESLint Rule — `warn-slow-with-retries`
- [x] Create `eslint-rules/warn-slow-with-retries.js`:
  - Detect `test.slow()` calls inside `test.describe` blocks
  - Check if the same describe block (or parent) has `test.describe.configure({ retries: N })` where N ≥ 2
  - Report warning: "test.slow() combined with retries ≥ 2 can cause timeouts up to Ns per test. Consider reducing retries or fixing the underlying speed issue."
  - Calculate and display the max possible timeout (baseTimeout × 3 × (retries + 1))
- [x] Create `eslint-rules/warn-slow-with-retries.test.js` with valid/invalid cases
- [x] Add rule to `eslint.config.mjs` — MERGE into the same spec files config block as Phase 4:
  ```js
  // In the existing { files: ["**/*.spec.ts", "**/*.spec.tsx"], ... } block:
  "flakiness/warn-slow-with-retries": "warn",
  ```
  Note: deliberately kept at warn (advisory), not error — `test.slow()` + retries is a code smell, not always wrong
- [x] Export rule from `eslint-rules/index.js` (add to existing exports object)
- [x] Run full CI-equivalent checks: `npm run lint && npm run typecheck && npm test`
- [x] Expect ~8 new warnings from `warn-slow-with-retries`, review each for legitimacy

### Phase 6: Design System Violations (Lower Priority)
- [x] Fix 3 `@next/next/no-img-element` warnings (SourceProfile, SourceCard, SourceCombobox)
- [x] Assess remaining design system warnings (285 across 3 rules) — defer bulk fix to separate project or fix incrementally
- [x] Keep `no-tailwind-color-classes` (135), `prefer-design-radius` (78), `enforce-heading-typography` (72) at warn for now
- [x] Document decision in research doc: these require systematic migration, not per-violation fixes

### Phase 7: Update Documentation
- [x] Update `docs/docs_overall/testing_overview.md`:
  - Add Rule 13 to enforcement table: `ESLint flakiness/require-serial-with-beforeall`
  - Update enforcement status for Rules 4, 11, 18 from "warn" to "error"
  - Add new rule for timeout cascade detection
  - Update column label uniqueness enforcement status
- [x] Update `docs/feature_deep_dives/testing_setup.md` with new rule descriptions

## Testing

### Unit Tests
- [x] `eslint-rules/require-serial-with-beforeall.test.js` — test new rule with valid/invalid AST cases
- [x] `eslint-rules/warn-slow-with-retries.test.js` — test new rule with valid/invalid AST cases

### Integration Tests
- [x] No new integration tests needed (lint rules are tested via ESLint rule tester)

### E2E Tests
- [x] Run `npm run test:e2e:critical` after Phase 3 to verify serial mode changes don't break tests

### Manual Verification
- [x] Run `npm run lint` after each phase — verify warning count decreases and no new errors
- [x] Final `npm run lint` should show: 0 errors, ~285 warnings (design system only)

## Verification

### A) Playwright Verification (required for UI changes)
- [x] No UI changes — skip Playwright verification

### B) Automated Tests
- [x] `npm run lint` — target: 0 errors, ~285 remaining design-system warnings
- [x] `npm run typecheck` — no new type errors
- [x] `npm test` — all unit tests pass (including new rule tests)
- [x] `npm run test:e2e:critical` — E2E critical tests pass with serial mode fixes

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/docs_overall/testing_overview.md` — update enforcement table with new rule severities and new rules
- [x] `docs/feature_deep_dives/testing_setup.md` — add descriptions for new custom rules

## Review & Discussion

### Iteration 1 (3 agents)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 0 |
| Architecture & Integration | 3/5 | 2 — ESLint flat config block for `no-duplicate-column-labels`; new rule config merge strategy |
| Testing & CI/CD | 3/5 | 3 — No rollback plan; E2E verification only runs critical subset; no CI-equivalent dry-run |

**Fixes applied:**
1. Added explicit config block specification for `no-duplicate-column-labels` (new standalone block with flakiness plugin for src files)
2. Specified merge strategy for Phase 4/5 rules (merge into existing spec files config block at lines 46-57)
3. Added rollback plan to Phases 1, 2, 3 (revert severity upgrade, keep fixes, re-run lint)
4. Added direct execution of all 12 modified spec files in Phase 3 verification
5. Replaced "run lint, tsc, unit tests" with full CI-equivalent `npm run lint && npm run typecheck && npm test`

### Iteration 2 (3 agents)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 |
| Architecture & Integration | 5/5 | 0 |
| Testing & CI/CD | 4/5 | 0 — minor: Phases 4-5 missing CI-equivalent check, brace expansion portability |

**Fixes applied:**
1. Added `npm run lint && npm run typecheck && npm test` to Phases 4 and 5
2. Minor issues noted but non-blocking (brace expansion, Phase 6 rollback)

### Iteration 3 (1 agent — Testing re-review)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 (carried from iteration 2) |
| Architecture & Integration | 5/5 | 0 (carried from iteration 2) |
| Testing & CI/CD | 5/5 | 0 |

**CONSENSUS REACHED** — All 3 reviewers at 5/5. Plan ready for execution.
