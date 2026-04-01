# Test Overview Lint Violations Research

## Problem Statement
Review all lint rules, upgrade warn→error where appropriate, fix all violations. Review testing rules (Rules 1-18 from testing_overview.md) and ensure they are all enforced via lint and hooks, then fix any violations found.

## Requirements (from GH Issue #917)
I want to review all of my lint rules, and set them all to error instead of warn if appropriate then fix all violations. Also I want to review my testing rules and make sure they are all enforced via lint and hooks, then review for any violations.

## High Level Summary

The codebase has **380 total lint warnings** and **0 lint errors** across **92 files**. There are **8 warn-level rules** across 3 categories (flakiness, design-system, promise handling), **1 unconfigured rule** (no-duplicate-column-labels), and **12 E2E spec files** violating the serial mode testing rule (Rule 13). The flakiness warn rules are ready for error upgrade; design-system rules need violation fixes first. A completed silent errors initiative means promise/catch-or-return is also near-ready for error upgrade.

---

## Current ESLint Configuration

### Config File: `eslint.config.mjs` (flat config, ESLint 9)

**Extends/Plugins:**
- `next/core-web-vitals`, `next/typescript` (via FlatCompat)
- `eslint-plugin-promise`
- Custom: `flakiness` (11 rules in `eslint-rules/index.js`)
- Custom: `design-system` (9 rules in `eslint-rules/design-system.js`)

### Custom ESLint Plugins

**Flakiness Prevention (11 rules):**
1. `no-wait-for-timeout` — ERROR — Disallows waitForTimeout/fixed sleeps
2. `max-test-timeout` — ERROR — Blocks test.setTimeout > 60s
3. `no-test-skip` — ERROR — Disallows test.skip()
4. `no-silent-catch` — ERROR — Blocks .catch(() => {})
5. `no-networkidle` — ERROR — Blocks waitForLoadState('networkidle')
6. `no-hardcoded-base-url` — ERROR — Blocks hardcoded localhost URLs
7. `require-test-cleanup` — ERROR — Requires afterAll cleanup for DB imports
8. `no-point-in-time-checks` — **WARN** — Flags page.textContent(), isVisible() etc.
9. `no-hardcoded-tmpdir` — **WARN** — Flags hardcoded /tmp/ paths
10. `require-hydration-wait` — **WARN** — Requires waitFor between goto and click in POMs
11. `no-duplicate-column-labels` — **NOT CONFIGURED** (rule exists but missing from config)

**Design System (9 rules):**
- 5 at ERROR: no-hardcoded-colors, no-arbitrary-text-sizes, prefer-design-system-fonts, prefer-warm-shadows, no-inline-typography
- 4 at WARN: no-tailwind-color-classes, prefer-design-radius, enforce-heading-typography, enforce-prose-font

**Other Rules:**
- `promise/catch-or-return` — **WARN** — Unhandled promises
- `no-empty` — ERROR — Empty catch blocks (allowEmptyCatch: false)
- `no-restricted-syntax` (untyped createClient) — **WARN** — scripts/ and __tests__/ only
- `@typescript-eslint/explicit-function-return-type` — **WARN** — evolution/ prod code only
- `no-restricted-imports` — ERROR — evolution boundary enforcement

---

## Lint Violation Summary

**Total: 380 warnings, 0 errors across 92 files**

### Violations by Rule (exact counts from `npm run lint`)

| Rule | Severity | Violations | Category |
|------|----------|-----------|----------|
| `design-system/no-tailwind-color-classes` | warn | 135 | Design system |
| `design-system/prefer-design-radius` | warn | 78 | Design system |
| `design-system/enforce-heading-typography` | warn | 72 | Design system |
| `no-restricted-syntax` (untyped createClient) | warn | 33 | Type safety |
| `flakiness/no-point-in-time-checks` | warn | 28 | E2E flakiness |
| `flakiness/no-hardcoded-tmpdir` | warn | 16 | E2E flakiness |
| Unused `eslint-disable` directives | warn | 5 | Cleanup |
| `design-system/enforce-prose-font` | warn | 3 | Design system |
| `@next/next/no-img-element` | warn | 3 | Next.js |
| `react-hooks/exhaustive-deps` | warn | 2 | React hooks (real bugs) |

**Note:** 75% of warnings (285/380) come from 3 design-system rules. The 2 `react-hooks/exhaustive-deps` warnings are real bugs (stale closures/cleanup issues).

---

## Warn-Level Rules: Upgrade Recommendations

### HIGH PRIORITY — Upgrade to ERROR

| Rule | Current | Recommended | Rationale |
|------|---------|-------------|-----------|
| `flakiness/no-point-in-time-checks` | warn | **ERROR** | Catches async racing with hydration (Rule 4, testing_overview.md). Existing eslint-disables are 100% justified. |
| `flakiness/no-hardcoded-tmpdir` | warn | **ERROR** | Prevents data loss in parallel CI (Rule 11). Low violation count. |
| `flakiness/require-hydration-wait` | warn | **ERROR** | Critical hydration race bug prevention (Rule 18). Only applies to POM files. |
| `no-duplicate-column-labels` | **OFF** | **ERROR** | Rule exists but not configured. No current violations. Prevents duplicate column headers. |

### MEDIUM PRIORITY — Upgrade after review

| Rule | Current | Recommended | Rationale |
|------|---------|-------------|-----------|
| `promise/catch-or-return` | warn | **ERROR** | Silent errors initiative completed. 12/14 production catches have logging. Only 2 undocumented (Sentry flush). |
| `no-restricted-syntax` (createClient) | warn | **ERROR** | 39 violations but straightforward fix (add `<Database>` type). Also expand scope to `evolution/scripts/`. |

### LOWER PRIORITY — Keep WARN (fix violations first)

| Rule | Current | Recommended | Rationale |
|------|---------|-------------|-----------|
| `design-system/no-tailwind-color-classes` | warn | KEEP WARN | ~543 violations. Too many to fix immediately. |
| `design-system/prefer-design-radius` | warn | KEEP WARN | ~182 violations. Gradual migration needed. |
| `design-system/enforce-heading-typography` | warn | CONSIDER ERROR | ~100 violations but concentrated in known files. |
| `design-system/enforce-prose-font` | warn | **ERROR** | Only ~14-20 violations. 99.7% compliance. Safest to upgrade. |
| `@typescript-eslint/explicit-function-return-type` | warn | KEEP WARN | Only 5 violations (all React components). Low value to upgrade. |

---

## Testing Rules Enforcement Matrix (Rules 1-18)

### Rules with ESLint Enforcement

| Rule | ESLint Rule | Severity | Status |
|------|------------|----------|--------|
| Rule 2: No fixed sleeps | `flakiness/no-wait-for-timeout` | error | ✅ Enforced |
| Rule 4: No point-in-time checks | `flakiness/no-point-in-time-checks` | **warn** | ⚠️ Should be error |
| Rule 6: Short timeouts | `flakiness/max-test-timeout` | error | ✅ Enforced |
| Rule 7: No silent errors | `flakiness/no-silent-catch` | error | ✅ Enforced |
| Rule 8: No test.skip | `flakiness/no-test-skip` | error | ✅ Enforced |
| Rule 9: No networkidle | `flakiness/no-networkidle` | error | ✅ Enforced |
| Rule 11: Per-worker temp files | `flakiness/no-hardcoded-tmpdir` | **warn** | ⚠️ Should be error |
| Rule 16: E2E cleanup for DB imports | `flakiness/require-test-cleanup` | error | ✅ Enforced |
| Rule 17: No hardcoded URLs | `flakiness/no-hardcoded-base-url` | error | ✅ Enforced |
| Rule 18: Wait for hydration | `flakiness/require-hydration-wait` | **warn** | ⚠️ Should be error |
| Column label uniqueness | `no-duplicate-column-labels` | **OFF** | ❌ Not configured |

### Rules with Hook Enforcement

| Rule | Hook | Type |
|------|------|------|
| Rule 7: No silent errors | `block-silent-failures.sh` (PreToolUse) | Blocking |
| Rule 8: No test.skip | `check-test-patterns.sh` (PostToolUse) | Warning |
| Rule 9: No networkidle | `check-test-patterns.sh` (PostToolUse) | Warning |

### Rules with Code Review / Fixture Enforcement Only

| Rule | Mechanism | Violations Found |
|------|-----------|-----------------|
| Rule 1: Known state | Test design + factory | 0 (by design) |
| Rule 3: Stable selectors | Code review | Not audited |
| Rule 5: Mock external deps | Test design | 0 (by design) |
| Rule 10: Unregister route mocks | Fixture teardown (base.ts, auth.ts) | 0 ✅ |
| Rule 12: POM waits after actions | Code review | Not audited |
| Rule 13: Serial mode for beforeAll | Code review | **12 violations** ❌ |
| Rule 14: Unroute before route | Code review | 0 ✅ |
| Rule 15: Restore global.fetch | Code review | 0 ✅ |

---

## Critical Violations Found

### 1. Rule 13: 12 E2E Specs Missing `mode: 'serial'`

All in `src/__tests__/e2e/specs/09-admin/`:
1. `admin-evolution-invocation-detail.spec.ts`
2. `admin-evolution-variants.spec.ts`
3. `admin-evolution-experiments-list.spec.ts`
4. `admin-evolution-bugfix-regression.spec.ts`
5. `admin-evolution-error-states.spec.ts`
6. `admin-evolution-strategy-detail.spec.ts`
7. `admin-evolution-filter-consistency.spec.ts`
8. `admin-evolution-accessibility.spec.ts`
9. `admin-evolution-arena-detail.spec.ts`
10. `admin-evolution-dashboard.spec.ts`
11. `admin-evolution-runs.spec.ts`
12. `admin-evolution-navigation.spec.ts`

**Pattern:** All use `adminTest.describe()` with `adminTest.beforeAll()` that creates shared DB state (strategies, prompts, runs) — but missing `adminTest.describe.configure({ mode: 'serial' })`.

**Compliant example:** `admin-evolution-anchor-ranking.spec.ts` correctly has `adminTest.describe.configure({ mode: 'serial' })` on line 15.

### 2. Unconfigured Rule: `no-duplicate-column-labels`

Rule exists in `eslint-rules/index.js` with test coverage, but is never activated in `eslint.config.mjs`. testing_overview.md line 60 documents it as enforced. No current violations in codebase, but no protection against future regressions.

### 3. Untyped createClient Scope Gap

The `no-restricted-syntax` rule for untyped `createClient()` only covers `scripts/**` and `src/__tests__/**`. Missing:
- `evolution/scripts/` (6+ untyped calls: processRunQueue, run-evolution-local, backfill scripts)
- `src/app/` (currently compliant but no protection)

---

## Eslint-Disable Comment Analysis

**Total:** ~142 eslint-disable comments in src/

| Category | Count | Justification Rate |
|----------|-------|-------------------|
| Flakiness rules | 80 (56%) | 96-100% justified with detailed comments |
| TypeScript rules | 52 | 0% justified (lazy bypasses in tests/debug) |
| React/Next rules | 11 | 0% justified (low impact) |
| Design system rules | 0 | Exceptions handled via config, not comments |

**Key insight:** Flakiness rule disables are exemplary — nearly all have detailed explanatory comments. Upgrading warn→error would NOT cause a flood of new eslint-disable comments.

---

## Enforcement Pipeline

```
Local Dev → Pre-commit Hook → CI (GitHub Actions)
              │                    │
              ├─ Secrets scan      ├─ npm run lint (ALL rules)
              ├─ @ts-ignore block  ├─ npm run typecheck
              ├─ Migration check   ├─ Unit/Integration/E2E tests
              │                    │
              └─ NO LINT ❌        └─ BLOCKS PR on failure ✅
```

**Gap:** Pre-commit hook does NOT run ESLint. Lint enforcement relies entirely on CI.

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md — Testing rules 1-18, enforcement summary table
- docs/feature_deep_dives/testing_setup.md — Test configuration, mocking patterns
- docs/docs_overall/environments.md — CI/CD workflows, GitHub Actions
- docs/feature_deep_dives/error_handling.md — Error code system
- docs/feature_deep_dives/maintenance_skills.md — Automated health monitoring
- docs/docs_overall/debugging.md — Debugging tools and workflows
- evolution/docs/* — All 14 evolution docs read during initialization

### Planning Docs
- docs/planning/silent_errors_20251231/ — Completed initiative for promise/catch enforcement

## Code Files Read
- `eslint.config.mjs` — Main ESLint flat config
- `eslint-rules/index.js` — 11 custom flakiness rules
- `eslint-rules/design-system.js` — 9 custom design system rules
- `eslint-rules/no-duplicate-column-labels.js` — Unconfigured rule
- `.claude/settings.json` — Hook configurations
- `.claude/hooks/*.sh` — 11 hook scripts
- `.githooks/pre-commit` — Pre-commit hook (secrets, TS anti-patterns, migrations)
- `.github/workflows/ci.yml` — CI pipeline
- `package.json` — Script definitions
- `src/__tests__/e2e/specs/09-admin/*.spec.ts` — E2E specs with serial mode violations
- `src/__tests__/e2e/helpers/api-mocks.ts` — Route mock patterns
- `src/__tests__/e2e/fixtures/base.ts`, `auth.ts` — Fixture teardown patterns

---

## Recent CI Flakiness Analysis

Analyzed recent PRs (#902, #905, #913, #915) and CI runs for flakiness patterns.

### Root Causes Fixed in Recent PRs

| # | Bug | Root Cause | Fix | Existing Rule? |
|---|-----|-----------|-----|---------------|
| 1 | Content never renders | `isMountedRef` not reset in React 18 strict mode double-mount | Reset ref in effect setup | No (docs guidance added) |
| 2-3 | Admin tests hit wrong port | Hardcoded `localhost:3008` fallback in POMs | Relative paths + baseURL | **Rule 17** created (PR #913) |
| 4 | Evolution 404 dead code | Missing catch-all route | Added `[...slug]/page.tsx` | No (infra fix) |
| 5 | Strategy CRUD validation | Unicode ellipsis vs ASCII dots mismatch | Fixed string literal | No (one-off) |
| 6-8 | Admin nav clicks before hydration | POM clicked sidebar before React hydrated | Direct URL navigation | **Rule 18** created (PR #913) |
| 9 | Search-generate content race | Point-in-time `hasContent()` check | Auto-waiting `toBeVisible()` | **Rule 4** (existing) |
| 10 | Schema drift (5 issues) | Stale column refs after migrations | Typed factories + assertions | No rule (see below) |

### Flakiness Patterns NOT Covered by Existing Rules

#### 1. Serial Mode Missing (Rule 13) — **12 violations found**
E2E specs with `beforeAll` shared state but missing `mode: 'serial'`. All in `09-admin/`:
- Causes: parallel tests racing on shared mutable DB state
- **Recommendation: Create ESLint rule `flakiness/require-serial-with-beforeall`**
- ESLint feasibility: HIGH — detect `beforeAll` without `describe.configure({ mode: 'serial' })`
- 27 compliant files already use the pattern correctly

#### 2. Schema/Type Drift — **No enforcement**
Supabase silently ignores unknown columns on insert. Hand-written interfaces drift from `database.types.ts`.
- Caused 5 deterministic failures in PR #905
- Fixed with compile-time type assertions + typed `createClient<Database>()`
- **Already addressed by `no-restricted-syntax` rule** (needs scope expansion + error upgrade)

#### 3. `.first()` Without Specificity — **50+ instances**
Specs use `.first()` as band-aid for ambiguous selectors instead of specific `data-testid` selectors.
- e.g., `locator('text=Elo').first()` when "Elo" and "Elo ± σ" both match
- **Potential rule: `flakiness/no-ambiguous-first`** — flag `.first()` without `data-testid` context
- Priority: LOW — `.first()` is correct workaround, but indicates selector fragility

#### 4. Excessive Timeouts as Band-Aids — **14 instances ≥ 30s**
Some tests set `{ timeout: 60000 }` as workaround instead of fixing underlying timing issue.
- `auth.unauth.spec.ts`: 5x `{ timeout: 60000 }` for redirect waits
- `test.slow()` used 61 times — can cascade with retries (180-360s per test)
- **Potential rule: `flakiness/warn-slow-with-retries`** — flag `test.slow()` + `retries ≥ 2` combination
- Priority: MEDIUM — catches timeout cascade pattern

### Recommended New ESLint Rules

| Rule | Priority | What It Catches | Violation Count |
|------|----------|----------------|----------------|
| `flakiness/require-serial-with-beforeall` | **HIGH** | `beforeAll` without `mode: 'serial'` in describe blocks | 12 specs |
| `flakiness/warn-slow-with-retries` | MEDIUM | `test.slow()` + `retries ≥ 2` timeout cascade | 8+ files |
| `flakiness/no-ambiguous-first` | LOW | `.first()` without `data-testid` — selector fragility | 50+ instances |

### Patterns Already Well-Handled

- **Rule 10 (route mock cleanup)**: Fixture teardown handles this automatically — 0 violations
- **Rule 14 (unroute before route)**: All helpers in `api-mocks.ts` are compliant — 0 violations
- **Rule 15 (restore global.fetch)**: All 7 test files correctly restore — 0 violations
- **Hydration waits**: Rule 18 created in PR #913, enforced via ESLint
- **Hardcoded URLs**: Rule 17 created in PR #913, enforced via ESLint

---

## Open Questions

1. Should design-system warn rules be fixed in this project or deferred to a separate project?
2. Should a new ESLint rule be created for Rule 13 (beforeAll requires serial mode)?
3. Should the `no-restricted-syntax` (createClient) rule scope be expanded to all source files?
4. Should the pre-commit hook be enhanced to run eslint on staged files (lint-staged)?
5. Should `flakiness/require-serial-with-beforeall` be a new rule or should the 12 violations just be fixed manually?
6. Is the `.first()` pattern worth an ESLint rule or is it acceptable?
