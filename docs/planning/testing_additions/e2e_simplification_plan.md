# E2E Test Simplification & Optimization Plan

Implementation plan for reducing E2E test overhead while maintaining coverage.

---

## Executive Summary

| Metric | Current | Target |
|--------|---------|--------|
| Total E2E Tests | 133 | 133 (unchanged) |
| Critical E2E Tests | - | ~50 tagged |
| PR CI Time | ~5 min | ~2 min |
| Main Branch CI | ~5 min | ~3 min (parallel) |
| Integration Tests | 12 | ~60 (future) |

**Goal:** Faster CI feedback on PRs while maintaining full test coverage on main branch merges.

---

## Phase 1: Critical Test Tagging (1 day) ✅ COMPLETE

**Objective:** Enable running a subset of ~50 critical tests for faster PR feedback.

**Status:** Implemented on 2025-12-27
- Tagged 36 tests with `@critical` across all spec files
- Added `chromium-critical` project to playwright.config.ts
- Added npm scripts: `test:e2e:critical`, `test:e2e:full`
- Documented in E2E_TESTING_PLAN.md Section 11

### 1.1 Define Critical Test Criteria

A test is **critical** if it validates:
- Core user authentication flows
- Primary search → generate → view journey
- Save to library functionality
- Basic content display
- Error handling for common failures

A test is **non-critical** if it covers:
- Edge cases and boundary conditions
- Detailed UI state variations
- Comprehensive error scenarios
- AI suggestions (detailed editor interactions)

### 1.2 Add @critical Tags

**Files to modify:**

| Spec File | Total | Tag as Critical | Rationale |
|-----------|-------|-----------------|-----------|
| `smoke.spec.ts` | 1 | 1 | App health |
| `01-auth/auth.spec.ts` | 3 | 3 | Core auth |
| `auth.unauth.spec.ts` | 12 | 5 | Keep redirect tests |
| `02-search-generate/search-generate.spec.ts` | 9 | 6 | Core journey |
| `02-search-generate/regenerate.spec.ts` | 4 | 2 | Basic rewrite |
| `03-library/library.spec.ts` | 10 | 5 | Save & view |
| `04-content-viewing/viewing.spec.ts` | 5 | 4 | Display content |
| `04-content-viewing/tags.spec.ts` | 8 | 2 | Basic tag CRUD |
| `04-content-viewing/action-buttons.spec.ts` | 11 | 3 | Save button |
| `05-edge-cases/errors.spec.ts` | 5 | 2 | Common errors |
| `06-import/import-articles.spec.ts` | 8 | 3 | Import flow |
| `06-ai-suggestions/*` | 56 | 8 | 1-2 per file |
| `debug-publish-bug.spec.ts` | 1 | 0 | Debug only |
| **Total** | **133** | **~44** | |

### 1.3 Implementation Pattern

```typescript
// Example: search-generate.spec.ts
import { test, expect } from '../../fixtures/auth';

test.describe('Search and Generate', () => {
  // Critical - core user journey
  test('should submit query and show streaming content',
    { tag: '@critical' },
    async ({ authenticatedPage }) => {
      // ...
    }
  );

  // Critical - error handling
  test('should handle API error gracefully',
    { tag: '@critical' },
    async ({ authenticatedPage }) => {
      // ...
    }
  );

  // Non-critical - edge case
  test('should not crash with very long query', async ({ authenticatedPage }) => {
    // No tag - runs in full suite only
  });
});
```

### 1.4 Update Playwright Config

```typescript
// playwright.config.ts - Add critical project
projects: [
  // Fast critical-only for PRs
  {
    name: 'chromium-critical',
    testMatch: /^(?!.*\.unauth\.spec\.ts$).*\.spec\.ts$/,
    testIgnore: /auth\.setup\.ts/,
    grep: /@critical/,
    use: { ...devices['Desktop Chrome'] },
  },
  // Existing full projects...
  {
    name: 'chromium',
    testMatch: /^(?!.*\.unauth\.spec\.ts$).*\.spec\.ts$/,
    testIgnore: /auth\.setup\.ts/,
    use: { ...devices['Desktop Chrome'] },
  },
  // ...
]
```

### 1.5 Add NPM Scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test --project=chromium --project=chromium-unauth",
    "test:e2e:critical": "playwright test --project=chromium-critical --project=chromium-unauth",
    "test:e2e:full": "playwright test"
  }
}
```

### 1.6 Deliverables

- [x] Tag ~44 tests with `@critical` (actual: 36 tests)
- [x] Add `chromium-critical` project to playwright.config.ts
- [x] Add `test:e2e:critical` npm script
- [x] Verify critical suite runs in <2 minutes
- [x] Document tagging criteria in E2E_TESTING_PLAN.md

---

## Phase 2: Production Build in CI (0.5 days) ✅ COMPLETE

**Objective:** Use production build for more stable, faster E2E tests in CI.

**Status:** Implemented on 2025-12-27
- Updated webServer to use `npm run build && npm start` in CI
- Increased CI workers from 1 to 2
- Added server health check in global-setup.ts
- Extended CI timeout to 180s for build step

### 2.1 Update Playwright Config

```typescript
// playwright.config.ts
webServer: {
  command: process.env.CI
    ? 'npm run build && npm start -- -p 3008'
    : 'npm run dev -- -p 3008',
  url: 'http://localhost:3008',
  reuseExistingServer: !process.env.CI,
  timeout: process.env.CI ? 180000 : 120000,  // Extra time for build
  env: {
    NEXT_PUBLIC_USE_AI_API_ROUTE: 'true',
    E2E_TEST_MODE: 'true',
  },
},
```

### 2.2 Increase Workers in CI

```typescript
// playwright.config.ts
workers: process.env.CI ? 2 : 2,  // Increase from 1 to 2 with prod build
```

### 2.3 Update CI Workflow

```yaml
# .github/workflows/ci.yml
e2e-test:
  runs-on: ubuntu-latest
  steps:
    - name: Run E2E tests
      run: npm run test:e2e:critical
      env:
        CI: true
        E2E_TEST_MODE: true
```

### 2.4 Deliverables

- [x] Update webServer command for CI
- [x] Increase workers to 2
- [x] Add server health check to global-setup.ts
- [ ] Verify tests pass with production build (requires CI run)
- [ ] Measure time improvement (requires CI run)

---

## Phase 3: CI Workflow Updates (0.5 days) ✅ COMPLETE

**Objective:** Run critical tests on PRs, full suite on main.

**Status:** Implemented on 2025-12-27
- Created `e2e-critical` job for PRs (no sharding, ~36 tests)
- Created `e2e-full` job for main branch (sharded 4x)
- Added TEST_USER_ID to environment variables
- Both jobs depend on integration-tests completing first

### 3.1 Update CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # ... lint, typecheck, unit tests ...

  e2e-critical:
    name: E2E Tests (Critical)
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install chromium
      - name: Run Critical E2E Tests
        run: npm run test:e2e:critical
        env:
          CI: true
          E2E_TEST_MODE: true
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
          TEST_USER_ID: ${{ secrets.TEST_USER_ID }}
          # ... other secrets

  e2e-full:
    name: E2E Tests (Full)
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install chromium firefox
      - name: Run Full E2E Tests
        run: npm run test:e2e:full
        env:
          CI: true
          # ... secrets
```

### 3.2 Keep Nightly Full Suite

```yaml
# .github/workflows/e2e-nightly.yml (unchanged)
# Runs full browser matrix nightly
```

### 3.3 Deliverables

- [x] Update ci.yml with critical/full split
- [x] Add appropriate job conditions
- [ ] Test PR workflow (requires CI run)
- [ ] Test main branch workflow (requires CI run)

---

## Phase 4: Future - Integration Test Migration ⏸️ DEFERRED

**Objective:** Convert non-critical E2E tests to faster integration tests.

**Status:** Reviewed on 2025-12-28 - **DEFERRED** (Not currently needed)

### 4.0 Assessment Finding

After reviewing the codebase, we found **extensive integration test coverage already exists**:

| Existing File | Coverage |
|---------------|----------|
| `promptSpecific.integration.test.tsx` | Accept/reject behavior for AI suggestions |
| `aiSuggestion.pipeline.test.ts` | Full AI pipeline (Steps 1→4) |
| `DiffTagNode.test.ts` | Diff node creation/manipulation |
| `markdownASTdiff.test.ts` | Markdown AST diff parsing |
| `importExportUtils.test.ts` | CriticMarkup preprocessing |
| `pipelineValidation.test.ts` | Pipeline validation logic |

The 56 AI suggestion E2E tests (only 2 @critical) primarily test **browser-level interactions** that cannot be replicated in integration tests:
- Real DOM rendering
- Keyboard shortcuts (Cmd+Z for undo)
- Full React component lifecycle
- Browser event handling

**Conclusion:** Converting these E2E tests would:
- Duplicate existing integration coverage
- Lose valuable browser-level validation
- Require 2-3 days with marginal benefit

**Phases 1-3 achieved the primary goal:** ~36 critical tests for fast PR CI with full coverage on main.

### 4.1 Original Candidates (For Reference)

| E2E Spec | Tests | Status |
|----------|-------|--------|
| AI Suggestions (7 files) | 56 | Already covered by integration tests |
| Tags edge cases | 5 | Covered by `tag-management.integration.test.ts` |
| Action buttons details | 7 | Tests browser-specific behavior |
| Form validation | 5 | Tests browser-specific behavior |

### 4.2 When to Revisit

Trigger Phase 4 only if:
- CI times exceed 5 minutes consistently
- AI suggestion E2E tests become flaky again
- Major refactor of AI suggestions feature
- Team specifically requests faster local test feedback

---

## Implementation Timeline

```
Completed 2025-12-27/28:
├── ✅ Phase 1 - Critical test tagging (36 tests tagged)
├── ✅ Phase 2 - Production build in CI
├── ✅ Phase 3 - CI workflow split (critical for PRs, full for main)
└── ⏸️ Phase 4 - DEFERRED (existing integration tests sufficient)
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| PR CI Time | <3 min | GitHub Actions timing |
| Critical Test Count | 40-50 | `grep -r "@critical" | wc -l` |
| Pass Rate | >99% | CI dashboard |
| Flaky Rate | <1% | Track retry-required tests |

---

## Rollback Plan

If critical-only tests miss regressions:

1. **Quick fix:** Add missed scenario to critical set
2. **Temporary:** Run full suite on PRs until resolved
3. **Long-term:** Review critical criteria

---

## Files Modified

| Phase | Files | Status |
|-------|-------|--------|
| 1 | 16 spec files, playwright.config.ts, package.json, E2E_TESTING_PLAN.md | ✅ Done |
| 2 | playwright.config.ts, global-setup.ts | ✅ Done |
| 3 | .github/workflows/ci.yml | ✅ Done |
| 4 | N/A - Deferred | ⏸️ Deferred |

---

## Related Documents

- `e2e_test_major_fixes.md` - Infrastructure fixes
- `e2e_test_major_fixes_progress.md` - Implementation progress
- `e2e_test_major_fixes_progress_remaining_issues.md` - Issue tracking
- `E2E_TESTING_PLAN.md` - Original E2E testing plan
