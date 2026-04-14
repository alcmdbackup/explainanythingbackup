# Reduce Tests Run PRs Main 20260410 Research

## Problem Statement
Cut the number of E2E tests to reduce CI duration and costs. Isolate only the most critical ones for evolution and non-evolution. Also review what runs on /finalize locally to identify savings there too.

## Requirements (from GH Issue #947)
Review what runs on /finalize; cut E2E tests to reduce CI duration and costs; isolate only the most critical ones for evolution and non-evolution.

## High Level Summary

Three independent changes that each reduce test load:

1. **Remove @critical from 13 E2E spec files** — cuts the critical E2E suite from ~40 tests to ~20 (50% reduction). Pure tag cleanup, no logic changes.
2. **Add `grep: /@critical/` to `chromium-unauth` Playwright project** — removes 11 unauth tests that run unconditionally today despite not being tagged @critical. One-line config change.
3. **Change /finalize Step 4C from `test:integration` to `test:integration:critical`** — stops running all 266 integration tests locally before PRs; runs only the 45 critical ones (matching CI behavior). Saves ~5-8 min per /finalize run. Risk is low: /mainToProd always runs the full 266 before production.

Additionally, two high-ROI refinements within the KEEP list:
- **library.spec.ts**: remove describe-level @critical, tag only 3 of 7 tests individually (saves 4 tests)
- **auth.spec.ts**: remove describe-level @critical, tag only 2 of 3 tests individually (saves 1 test)

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md

## Code Files Read
- `.claude/commands/finalize.md` — exact Step 4A/4B/4C/5 commands
- `.claude/commands/mainToProd.md` — confirms full suite runs before production
- `.github/workflows/ci.yml` — exact CI commands, job timeouts, when each runs
- `package.json` — all test:* scripts
- `playwright.config.ts` — all project definitions, grep filters
- `jest.integration.config.js` — maxWorkers: 1, testTimeout: 30s
- All 48+ E2E spec files in `src/__tests__/e2e/specs/` (for tag audit)
- `src/__tests__/integration/` — all 38 files (for inventory)

---

## Key Findings

### 1. What /finalize actually runs today

| Step | Command | Notes |
|------|---------|-------|
| 4A (parallel) | `npm run lint` + `npm run typecheck` + `npm run build` | Build runs in /finalize but NOT in CI |
| 4B (parallel) | `npm run test` + `npm run test:esm` | All unit tests |
| 4C (sequential) | `npm run test:integration` | **ALL 266** integration tests — CI only runs 45 |
| 5 (always) | `npm run test:e2e:critical` | ~40 tests today (see below) |
| 5 (`--e2e` flag) | `npm run test:e2e:full` | Full suite |

### 2. What CI runs on PRs to main

| Check | Command | Notes |
|-------|---------|-------|
| Lint | `npm run lint` | |
| TypeScript | `npm run typecheck` | |
| Build | ✗ skipped | /finalize runs this, CI does not |
| Unit | `npm run test:ci -- --changedSince=origin/main` | Only affected files |
| ESM | `npm run test:esm` | |
| Integration | `npm run test:integration:critical` | **5 files, 45 tests** |
| E2E | `npm run test:e2e:critical` | Same as /finalize step 5 |

### 3. E2E critical suite today: ~40 tests total

`test:e2e:critical` = `playwright test --project=chromium-critical --project=chromium-unauth`

- **chromium-critical**: `grep: /@critical/` on all non-.unauth spec files → ~27 tests
- **chromium-unauth**: NO grep filter → runs ALL 13 tests in `auth.unauth.spec.ts` (only 2 are @critical)
- **Hidden bloat**: 11 unauth tests run unconditionally even though not @critical

### 4. @critical tag inventory

Total @critical tags across all E2E files: **69 tagged test instances** across 33 spec files.

Breakdown after assessment:
- **KEEP @critical**: 34 tests (core user flows — auth, search, save, library, admin CRUD)
- **DOWNGRADE** (remove @critical): 35 tests across 13 files

Within the "KEEP" group, additional refinements possible:
- `library.spec.ts`: all 7 tests tagged via describe-level; only 3 truly critical (page loads, cards render, navigate to results)
- `auth.spec.ts`: all 3 active tests tagged via describe-level; only 2 truly critical (session persists, protected route access)

### 5. Files and exact changes to downgrade

| File | Change | Tests removed |
|------|--------|--------------|
| `01-auth/auth-redirect-security.spec.ts` | Remove `{ tag: '@critical' }` from describe | 7 |
| `04-content-viewing/explore-pagination.spec.ts` | Remove `{ tag: '@critical' }` from describe | 3 |
| `06-import/import-articles.spec.ts` | Remove `{ tag: '@critical' }` from one test | 1 |
| `06-ai-suggestions/suggestions.spec.ts` | Change `['@critical', '@prod-ai']` → `'@prod-ai'` | 1 |
| `09-admin/admin-confirmations.spec.ts` | Remove `{ tag: '@critical' }` from describe | 3 |
| `09-admin/admin-evolution-experiments-list.spec.ts` | Remove `{ tag: '@critical' }` from one test | 1 |
| `09-admin/admin-evolution-invocations.spec.ts` | Remove `{ tag: '@critical' }` from one test | 1 |
| `09-admin/admin-evolution-logs.spec.ts` | Remove `{ tag: '@critical' }` from one test | 1 |
| `09-admin/admin-evolution-runs.spec.ts` | Remove `{ tag: '@critical' }` from one test | 1 |
| `09-admin/admin-strategy-budget.spec.ts` | Remove @critical from describe + 2 individual tests | 3 |
| `09-admin/evolution-ui-fixes.spec.ts` | Remove `{ tag: '@critical' }` from describe | 3 |
| `09-evolution-admin/evolution-admin-critical.spec.ts` | Remove `{ tag: '@critical' }` from describe | 5 |
| `10-accessibility/accessibility.spec.ts` | Remove `{ tag: '@critical' }` from describe | 5 |
| **Total** | | **35 tests removed from @critical** |

Note: `evolution-ui-fixes.spec.ts` and `evolution-admin-critical.spec.ts` have no @evolution tag — after removing @critical they fall to full-suite-only. May want to add `@evolution` tag to keep them running on production PRs.

### 6. Additional refinements (describe → individual test level)

**library.spec.ts** — remove describe-level tag, add individual @critical to 3 of 7:
- KEEP: "should display user library page" + "should display FeedCard components" + "should navigate to results page when clicking card"
- REMOVE: "page title", "saved date on cards", "search bar in navigation", "handle search" (4 tests downgraded)

**auth.spec.ts** — remove describe-level tag, add individual @critical to 2 of 3:
- KEEP: "should persist session after page refresh" + "should access protected route when authenticated"
- REMOVE: "should redirect to home when accessing login while authenticated" (1 test downgraded)

### 7. playwright.config.ts fix for chromium-unauth

```diff
 {
   name: 'chromium-unauth',
   testMatch: /\.unauth\.spec\.ts$/,
+  grep: /@critical/,
   use: {
     ...devices['Desktop Chrome'],
     storageState: { cookies: [], origins: [] },
   },
 },
```

This removes 11 unauth tests from the critical path. The 11 unauth tests still run in `test:e2e` (full suite) and `test:e2e:non-evolution`.

### 8. Integration test counts

| Suite | Files | Tests | Timeout |
|-------|-------|-------|---------|
| `test:integration:critical` (CI on main) | 5 | 45 | 15 min |
| `test:integration:evolution` (CI on production) | ~16 | ~120 | 30 min |
| `test:integration:non-evolution` (CI on production) | ~17 | ~100 | 30 min |
| `test:integration` (all — what /finalize runs today) | 38 | 266 | — |

**maxWorkers: 1** (sequential, DB isolation) means runtime scales linearly with test count.

### 9. Risk assessment for /finalize integration change

Changing /finalize from `test:integration` → `test:integration:critical`:
- **Risk**: Non-critical integration failures only caught at `/mainToProd` time
- **Mitigated by**: `/mainToProd` always runs full 266 integration tests + full E2E suite before merging to production
- **CI on main PRs** already only runs 45 critical tests — so /finalize would match CI behavior
- **Verdict**: Low risk, manageable

### 10. search-generate error-handling test

The @critical-tagged "should handle API error gracefully" test in `search-generate.spec.ts` IS unique E2E coverage — it tests user-facing error UI state (the rendered error message element) which integration tests don't cover. Recommendation: **KEEP @critical** (contradicts earlier round 2 suggestion to move to @smoke).

---

## CI Timing Data (actual GitHub Actions — 3 recent runs)

| Job | Apr 10 run 1 | Apr 10 run 2 | Apr 9 run 3 | Avg |
|-----|-------------|-------------|------------|-----|
| Detect Changes | 6s | 8s | 8s | **7s** |
| Lint | 58s | 67s | 55s | **60s** |
| TypeScript Check | 73s | 68s | 71s | **71s** |
| Unit Tests | 163s | 53s | 83s | **100s** |
| Integration Tests (Critical) | 85s | 65s | 91s | **80s** |
| Integration Tests (Evolution) | 72s | 64s | 62s | **66s** |
| **E2E Tests (Critical)** | **292s** | **343s** | **336s** | **324s (5:24)** |
| **E2E Tests (Evolution)** | **365s** | **467s** | **334s** | **389s (6:29)** |
| Integration Non-Evo / E2E Non-Evo | skipped | skipped | skipped | — |

Run IDs: 24251527370, 24224234941, 24216731464 (all PRs to main, full path)

### Wall-clock critical path

```
Detect (7s) → Lint+TSC (73s) → Units (100s) → [parallel]:
  ├── E2E Critical  (324s avg = 5:24)
  ├── E2E Evolution (389s avg = 6:29)  ← BOTTLENECK on evolution PRs
  ├── Int Critical  (80s)
  └── Int Evolution (66s)

Total wall clock ≈ 9-11 min when evolution code changes
```

### Key insight: E2E Evolution is the bottleneck

On PRs touching evolution code, E2E Evolution (6:29 avg) runs in parallel with E2E Critical (5:24 avg) — so **reducing @critical saves zero wall-clock time** on those PRs. The bottleneck is E2E Evolution.

Reducing E2E Critical still matters for:
1. **Non-evolution PRs** — E2E Critical IS the bottleneck; cuts from 5:24 to ~2:30
2. **GitHub Actions billed minutes** — parallel jobs each consume minutes even if not on critical path
3. **Local /finalize time** — sequential, every second counts

**The biggest wall-clock win for all PRs is reducing E2E Evolution from 6:29.**

---

## E2E Evolution Audit

**22 spec files, ~111 tests total.** All tagged `@evolution`, run on PRs to production and as part of full-suite runs.

### Assessment table

| File | Tests | Seeds DB? | Real LLM? | Recommendation | Specific Change |
|------|-------|-----------|-----------|----------------|-----------------|
| `admin-evolution-run-pipeline.spec.ts` | 11 | YES | **YES** | KEEP core, trim UI | Keep 7 pipeline tests; move 4 pure UI page-load assertions out |
| `admin-evolution-experiment-wizard-e2e.spec.ts` | 4 | YES | NO | MERGE | Merge with `admin-experiment-wizard.spec.ts` (structurally identical) |
| `admin-experiment-wizard.spec.ts` | 4 | YES | NO | DELETE | Duplicate of wizard-e2e above |
| `admin-evolution-experiment-lifecycle.spec.ts` | 2 | YES | NO | DELETE | 1 test skipped (unimplemented), 1 covered by wizard-e2e |
| `admin-evolution-experiments-list.spec.ts` | 9 | YES | NO | MERGE → 3 tests | Micro-assertions on columns/filters; consolidate to: (1) page loads+columns, (2) status filter+row click, (3) breadcrumb nav |
| `admin-evolution-invocation-detail.spec.ts` | 9 | YES | NO | MERGE → 3 tests | "page renders" + "columns visible" = 1 test; row nav = 1 test; detail fields = 1 test |
| `admin-evolution-variants.spec.ts` | 8 | YES | NO | MERGE → 3 tests | "page renders+columns" = 1; "filters" = 1; "nav+pagination" = 1 |
| `admin-evolution-runs.spec.ts` | 7 | YES | NO | MERGE → 3 tests | "list+status filter" = 1; "detail tabs" = 1; "breadcrumb+strategy filter" = 1 |
| `admin-evolution-dashboard.spec.ts` | 4 | YES | NO | MERGE → 2 tests | Seed once; combine "metric cards" + "empty state" into 1; merge detail labels into 1 |
| `admin-evolution-invocations.spec.ts` | 5 | NO | NO | MERGE → 1-2 tests | No DB seeding; pure page-load + filter visibility; collapse to 1 smoke test |
| `admin-evolution-logs.spec.ts` | 4 | YES | NO | MERGE → 2 tests | Combine all filter tests into 1; keep agent-name filter as separate (was @critical) |
| `admin-evolution-arena-detail.spec.ts` | 4 | YES | NO | MERGE → 1 + move | Move Elo rounding test to unit; delete skipped markdown-strip test; keep "columns+sort" as 1 |
| `admin-evolution-cost-split.spec.ts` | 4 | YES | NO | MOVE to integration | Metric propagation (gen vs ranking cost) is integration-level logic; move to `evolution-metrics.integration.test.ts` |
| `admin-evolution-strategy-detail.spec.ts` | 3 | YES | NO | MERGE → 2 tests | "detail loads+metrics" = 1; delete brittle tab-nav test |
| `admin-evolution-v2.spec.ts` | 4 | NO | NO | DELETE | Pure "page loads without crash" smoke tests — no assertions beyond navigation; no DB seeding |
| `admin-evolution-bugfix-regression.spec.ts` | 2 | YES | NO | DELETE + migrate | Move LogsTab regression to logs spec; delete generic safety-net test |
| `admin-evolution-error-states.spec.ts` | 2 | YES | NO | KEEP 1, delete 1 | Keep "failed run shows error message"; delete skipped variants warning |
| `admin-arena.spec.ts` | 5 | YES | NO | MASSIVE trim | Delete all 10 skipped tests + unimplemented "Prompt Bank UI" describe (~300 lines of dead skips); keep 1 active list test |
| `admin-evolution-filter-consistency.spec.ts` | 3 | YES | NO | MERGE → 1 test | All 3 test same filter on different pages; run all assertions in 1 test |
| `admin-evolution-navigation.spec.ts` | 5 | YES | NO | MERGE → 2 tests | "list→detail nav" = 1; "cross-links+breadcrumb" = 1 |
| `admin-evolution-accessibility.spec.ts` | 4 | YES | NO | MOVE to unit | Tests verify table header text + ARIA roles — pure HTML structure, not E2E |
| `admin-strategy-registry.spec.ts` | 2 | YES | NO | MERGE → 1 test | "filter exists" + "filter works" → 1 combined test |

### Estimated reduction

| Category | Current | After |
|----------|---------|-------|
| Files deleted entirely | 0 | 4 (`admin-experiment-wizard`, `admin-evolution-experiment-lifecycle`, `admin-evolution-v2`, dead skips in admin-arena) |
| Tests moved to integration | 0 | 4 (`admin-evolution-cost-split`) |
| Tests moved to unit | 0 | ~5 (accessibility + Elo rounding) |
| Tests consolidated | — | ~40 tests eliminated via merging |
| **Total evolution E2E tests** | **~111** | **~45–50** |
| **Estimated CI time** | **6:29 avg** | **~2:30–3:00** |

### Biggest single wins

1. **`admin-evolution-run-pipeline.spec.ts`** — already the right approach (real LLM, pipeline integrity); just trim 4 pure UI page-load assertions added at end
2. **`admin-experiment-wizard.spec.ts` (DELETE)** — outright duplicate; saves full 4-test beforeAll/afterAll cycle
3. **`admin-evolution-v2.spec.ts` (DELETE)** — 4 "page loads" smoke tests with no assertions; saves beforeAll DB seeding
4. **`admin-arena.spec.ts`** — delete ~300 lines of `test.skip()` blocks for unimplemented UI; saves CI parsing time and test file maintenance burden
5. **Micro-assertion consolidation** (experiments-list 9→3, invocation-detail 9→3, variants 8→3) — each beforeAll seeds DB once; merging eliminates redundant Playwright launches per test

---

## Combined Impact Summary

| Change | Tests removed | Wall-clock CI saved |
|--------|--------------|---------------------|
| Downgrade 13 spec files (@critical → untagged) | 35 E2E tests | ~2:30 on non-evolution PRs (E2E Critical: 5:24→~2:30) |
| Refine library.spec.ts + auth.spec.ts (describe→individual) | 5 E2E tests | included above |
| Add `grep: /@critical/` to chromium-unauth | 11 E2E tests | included above |
| **Simplify E2E Evolution suite** | **~65 tests (111→~45)** | **~4 min (6:29→~2:30)** |
| Change /finalize Step 4C to critical-only integration | 221 integration tests | ~5-8 min local only |
| **Net: E2E Critical** | **~40 → ~18 tests** | **5:24 → ~2:30 on non-evo PRs** |
| **Net: E2E Evolution** | **~111 → ~45 tests** | **6:29 → ~2:30 (bottleneck relieved)** |
| **New wall-clock (evolution PRs)** | — | **~11 min → ~6 min** |

---

## Open Questions

1. Should `evolution-ui-fixes.spec.ts` and `evolution-admin-critical.spec.ts` get `@evolution` tag after losing @critical, so they still run on production PRs?
2. Is the "should handle search from library page" test in library.spec.ts worth keeping @critical?
3. Should the search error-handling test stay @critical (unique E2E coverage) or move to @smoke?
4. For `admin-evolution-run-pipeline.spec.ts` — the 4 UI page-load assertions at the end: should they be kept in the same file (cheaply reusing the seeded pipeline run) or moved out? Keeping them is free since the data is already seeded.
5. `admin-arena.spec.ts` has ~300 lines of `test.skip()` for unimplemented UI — delete them outright or keep as documentation of planned tests?
