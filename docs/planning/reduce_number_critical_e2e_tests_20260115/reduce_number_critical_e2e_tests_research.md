# Reduce Number Critical E2E Tests Research

## Problem Statement
The codebase has ~39 E2E tests marked with `@critical` tag that run on every PR to `main`. The goal is to understand the current state of critical test categorization to enable reducing CI pipeline time while maintaining test coverage for essential paths.

## High Level Summary
- **Total E2E tests**: 163 tests across 22 spec files
- **@critical tagged tests**: 39 tests across 15 files
- **CI behavior**: PRs to `main` run only `@critical` tests; PRs to `production` run full suite with 4-way sharding
- **Test selection**: Playwright `grep: /@critical/` pattern filters tests at runtime

The `@critical` tag is applied at the individual test level (not describe blocks), and tests are distributed across authentication, search/generation, content viewing, library management, error handling, AI suggestions, import, and sources features.

## Documents Read
- `docs/docs_overall/testing_overview.md` - Testing tiers, CI/CD workflow, GitHub secrets
- `docs/feature_deep_dives/testing_setup.md` - Test configuration, directory structure, mocking patterns

## Code Files Read
- `playwright.config.ts` - 4 test projects including `chromium-critical` with grep filter
- `.github/workflows/ci.yml` - CI jobs for critical vs full E2E tests
- `package.json` - npm scripts for `test:e2e` and `test:e2e:critical`
- All 22 E2E spec files (see inventory below)

---

## E2E Test Architecture

### How Critical Tests Are Selected

1. **Playwright Config** (`playwright.config.ts:102-111`):
   ```typescript
   {
     name: 'chromium-critical',
     grep: /@critical/,  // Filters tests with @critical tag
     // ...
   }
   ```

2. **CI Workflow** (`.github/workflows/ci.yml`):
   - **PRs to `main`**: `npm run test:e2e:critical` → runs `chromium-critical` project
   - **PRs to `production`**: `npm run test:e2e -- --shard=${{ matrix.shard }}/4` → full suite

3. **npm Scripts** (`package.json:19-20`):
   ```json
   "test:e2e": "playwright test --project=chromium --project=chromium-unauth",
   "test:e2e:critical": "playwright test --project=chromium-critical --project=chromium-unauth"
   ```

### Tag Application Pattern

Tests use Playwright's tag option:
```typescript
test('test name', { tag: '@critical' }, async ({ page }) => {
  // test code
});

// Multiple tags
test('another test', { tag: ['@critical', '@smoke'] }, async ({ page }) => {
  // test code
});
```

---

## @critical Tests by File

| File | @critical Count | Test Names |
|------|-----------------|------------|
| `auth.unauth.spec.ts` | 5 | login page loads, redirect from protected route, require auth for library, login with valid credentials, show error with invalid credentials |
| `search-generate.spec.ts` | 5 | submit query and redirect, show title during streaming, display content after streaming, handle API error, preserve query in URL |
| `action-buttons.spec.ts` | 3 | save to library, show already saved state, enter edit mode |
| `viewing.spec.ts` | 4 | load by ID, display title, save button state, preserve ID in URL |
| `auth.spec.ts` | 3 | persist session after refresh, access protected route, redirect when authenticated |
| `import-articles.spec.ts` | 3 | import ChatGPT content, disable Process when empty, cancel and clear form |
| `tags.spec.ts` | 2 | display existing tags, preserve tags after refresh |
| `errors.spec.ts` | 2 | not display on 500, recover from error state |
| `suggestions.spec.ts` | 1 | display AI suggestions panel |
| `editor-integration.spec.ts` | 1 | show deletion diff in editor |
| `add-sources.spec.ts` | 1 | include sources when submitting search |

**Total: 39 @critical tests**

*(Note: Original count was 28, updated to 39 after re-scanning codebase)*

---

## Complete E2E Test Inventory

### By Category

| Category | Files | Test Count | @critical |
|----------|-------|------------|-----------|
| Authentication | 2 | 18 | 8 |
| Search & Generation | 2 | 15 | 5 |
| Library Management | 1 | 10 | 0 |
| Content Viewing | 3 | 28 | 9 |
| Error Handling | 2 | 10 | 2 |
| AI Suggestions | 7 | 65 | 2 |
| Import Articles | 1 | 9 | 3 |
| Sources | 1 | 6 | 1 |
| Logging | 1 | 8 | 0 |
| Smoke | 1 | 3 | 3 |
| Debug | 1 | 1 | 0 |

### Other Tags in Use

- `@smoke` - Post-deployment smoke tests (3 tests)
- `@skip-prod` - Skip in production/nightly runs (~30 tests)
- `@prod-ai` - Tests using real AI APIs (~4 tests)

---

## CI Pipeline Configuration

### Critical E2E Job (`e2e-critical`)
- **Trigger**: PRs to `main`
- **Command**: `npm run test:e2e:critical`
- **Sharding**: None (single job)
- **Browser**: Chromium only

### Full E2E Job (`e2e-full`)
- **Trigger**: PRs to `production`
- **Command**: `npm run test:e2e -- --shard=${{ matrix.shard }}/4 --max-failures=1`
- **Sharding**: 4-way with `fail-fast: true`
- **Browser**: Chromium (production matrix)

### Timeouts

| Environment | Test Timeout | Expect Timeout |
|-------------|--------------|----------------|
| Production | 120s | 60s |
| CI | 60s | 20s |
| Local | 30s | 10s |

---

## GitHub Actions Cost Analysis

Data collected from recent CI runs (January 14-15, 2026).

### Cost Split by Job (PRs to `main` - Critical E2E only)

| Job | Avg Duration | % of Total | Runs in Parallel? |
|-----|--------------|------------|-------------------|
| TypeScript Check | ~50s | 8% | Yes (with lint, unit) |
| Lint | ~46s | 8% | Yes (with tsc, unit) |
| Unit Tests | ~1m 55s | 20% | Yes (with tsc, lint) |
| Integration Tests | ~2m | 21% | Sequential (after unit) |
| **E2E Critical** | **~4m 27s** | **43%** | Sequential (after integration) |

**Total per PR to main: ~9-10 minutes billable**

### Cost Split (PRs to `production` - Full E2E with 4 shards)

| Job | Duration | % of Total |
|-----|----------|------------|
| TypeScript + Lint + Unit | ~2m (parallel) | 9% |
| Integration Tests | ~1m 12s | 5% |
| **E2E Full (4 shards)** | **~18m 18s total** | **86%** |

**Total per PR to production: ~22 minutes billable**

### Sample CI Run Data

#### Run 21035586163 (PR to main)
| Job | Start | End | Duration |
|-----|-------|-----|----------|
| TypeScript Check | 14:56:00 | 14:56:48 | 48s |
| Lint | 14:55:59 | 14:56:49 | 50s |
| Unit Tests | 14:55:59 | 14:57:54 | 1m 55s |
| Integration Tests | 14:58:06 | 15:00:22 | 2m 16s |
| E2E Critical | 15:00:27 | 15:05:08 | 4m 41s |

#### Run 20985733373 (PR to production - Full E2E)
| Job | Start | End | Duration |
|-----|-------|-----|----------|
| TypeScript Check | 07:14:43 | 07:15:38 | 55s |
| Lint | 07:14:43 | 07:15:30 | 47s |
| Unit Tests | 07:14:43 | 07:16:34 | 1m 51s |
| Integration Tests | 07:16:46 | 07:17:58 | 1m 12s |
| E2E Full Shard 1/4 | 07:18:02 | 07:22:16 | 4m 14s |
| E2E Full Shard 2/4 | 07:18:01 | 07:24:23 | 6m 22s |
| E2E Full Shard 3/4 | 07:18:02 | 07:21:59 | 3m 57s |
| E2E Full Shard 4/4 | 07:18:02 | 07:21:47 | 3m 45s |

### Monthly Cost Estimate

Assuming 70 PRs/month:

| PR Target | Minutes/PR | Monthly Minutes | % of Free Tier (2000 min) |
|-----------|------------|-----------------|---------------------------|
| main (critical) | 10 min | 700 min | 35% |
| production (full) | 22 min | 1,540 min | 77% |
| **Mixed (90% main, 10% prod)** | ~11.2 min | ~784 min | **39%** |

### Cost Reduction Impact

Reducing E2E Critical tests would have the following impact:

| Scenario | E2E Duration | Total CI Time | Savings |
|----------|--------------|---------------|---------|
| Current (28 tests) | ~4m 27s | ~10m | baseline |
| 20 tests (-29%) | ~3m 11s | ~8m 44s | ~13% |
| 15 tests (-46%) | ~2m 23s | ~7m 56s | ~21% |
| 10 tests (-64%) | ~1m 35s | ~7m 8s | ~29% |

*Estimates based on linear scaling of ~9.5s per critical test*

---

## Key Observations

1. **Tag granularity**: @critical is applied at individual test level, not describe blocks
2. **Distribution**: Critical tests cover core user journeys - auth, search, viewing, save
3. **AI suggestions gap**: Only 2 of 65 AI suggestion tests are marked @critical
4. **Library coverage**: 0 of 10 library tests are marked @critical
5. **Smoke overlap**: smoke.spec.ts tests are tagged both `@critical` and `@smoke`

---

## File Locations

| Resource | Path |
|----------|------|
| Playwright config | `playwright.config.ts` |
| CI workflow | `.github/workflows/ci.yml` |
| E2E specs | `src/__tests__/e2e/specs/` |
| Test helpers | `src/__tests__/e2e/helpers/` |
| Auth fixture | `src/__tests__/e2e/fixtures/auth.ts` |
| Testing docs | `docs/docs_overall/testing_overview.md` |
