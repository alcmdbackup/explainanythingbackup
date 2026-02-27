# Analyze Test Suite Research

## Problem Statement
Assess the existing test suite including critical tests and all tests across unit, integration, and E2E tiers. Look for ways to reduce flakiness, update testing-related documentation, and identify gaps that need to be plugged.

## Requirements (from GH Issue #582)
- Assess existing test suite including critical tests and all tests
- Unit, integration, E2E tiers
- Look for ways to reduce flakiness
- Update testing-related documentation
- Look for gaps that need to be plugged

## High Level Summary

The test suite is substantial (~139 unit test files, 29 integration tests, 37 E2E specs) but the documentation is significantly out of date — file counts, directory trees, and helper listings all diverge from reality. The biggest flakiness source is **77 `networkidle` usages** in admin E2E specs (tracked in issue #548). Coverage thresholds are all 0 (no enforcement). There are 23 skipped tests across all tiers, missing unit tests for 2 services, and several integration tests that are pure-logic (no DB) misclassified as integration. CI has no explicit timeouts on most jobs and `tsconfig.ci.json` excludes test files from type checking.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/testing_pipeline.md

## Code Files Read

### Configuration
- `jest.config.js` — unit test config, jsdom env, coverage thresholds at 0
- `jest.setup.js` — global mocks, polyfills, console suppression
- `jest.shims.js` — OpenAI Node shims (has debug console.log)
- `jest.integration.config.js` — node env, maxWorkers: 1, 30s timeout
- `jest.integration-setup.js` — dotenv, Pinecone/OpenAI global mocks, real Supabase
- `playwright.config.ts` — 4 projects, tmux server management, timeout tiers
- `tsconfig.ci.json` — excludes all test files from tsc

### CI/CD Workflows
- `.github/workflows/ci.yml` — PR pipeline with change detection, sharded E2E
- `.github/workflows/e2e-nightly.yml` — daily production tests, Chromium+Firefox
- `.github/workflows/post-deploy-smoke.yml` — post-deploy @smoke tests

### Test Helpers & Utilities
- `src/testing/utils/integration-helpers.ts` — DB setup/teardown, test context
- `src/__tests__/e2e/helpers/wait-utils.ts` — polling waits, page stability
- `src/__tests__/e2e/helpers/api-mocks.ts` — SSE streaming mocks, route interception
- `src/__tests__/e2e/helpers/error-utils.ts` — safe wait/visibility/screenshot helpers
- `src/__tests__/e2e/helpers/test-data-factory.ts` — explanation creation, auto-tracking cleanup
- `src/__tests__/e2e/setup/global-setup.ts` — health check, test data seeding, admin seeding
- `src/__tests__/e2e/setup/global-teardown.ts` — [TEST] prefix cleanup, tracked ID cleanup
- `src/__tests__/e2e/setup/auth.setup.ts` — dead code (never referenced by any project)
- `src/__tests__/e2e/fixtures/auth.ts` — per-worker Supabase auth, cookie injection
- `src/__tests__/e2e/fixtures/base.ts` — Vercel bypass, unrouteAll teardown
- `src/__tests__/e2e/fixtures/admin-auth.ts` — admin auth fixture

### Page Object Models
- `src/__tests__/e2e/helpers/pages/BasePage.ts`
- `src/__tests__/e2e/helpers/pages/SearchPage.ts`
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts`
- `src/__tests__/e2e/helpers/pages/ImportPage.ts`
- `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts`
- `src/__tests__/e2e/helpers/pages/LoginPage.ts`
- `src/__tests__/e2e/helpers/pages/admin/AdminBasePage.ts`

### ESLint Rules
- `eslint-rules/` — 5 flakiness rules (no-networkidle, no-wait-for-timeout, no-silent-catch, no-test-skip, max-test-timeout)

### All 29 integration test files (first 50 lines each)
### All 37 E2E spec files (structure and tagging)
### All 32 service test files in src/lib/services/

---

## Key Findings

### 1. Documentation vs Reality — Major Discrepancies

| Item | testing_overview.md | testing_setup.md | Actual |
|------|-------------------|-----------------|--------|
| Unit test files | 150+ | 60+ | ~139 |
| Integration test files | 20 | 19 (18+1) | 29 (28+1) |
| Integration listed in dir tree | — | 14 files | 28 files |
| E2E spec files | 34 | 23 | 37 |
| E2E total tests | "170+" and "163" (self-contradicting) | 163 | ~230-250 estimated |
| @critical tagged tests | 10 | 10 | 10 via `tag:` (correct), but admin specs embed `@critical` in name strings instead |
| `src/testing/mocks/` | — | 4 files | 9 files (5 undocumented: @anthropic-ai/sdk, openskill, d3-dag, d3, openai-helpers-zod) |
| `evolution-test-helpers.ts` | referenced | listed at `src/testing/utils/` | **Actually at `evolution/src/testing/`** (wrong path in docs) |
| E2E helpers/pages/ | — | 5 POMs | 6 POMs + admin/ subdir |
| E2E fixtures/ | — | auth.ts only | auth.ts + admin-auth.ts + base.ts |
| E2E setup/ | — | auth.setup.ts only | 4 files (global-setup, global-teardown, auth.setup, vercel-bypass) |
| Undocumented npm scripts | — | — | test:integration:critical, test:e2e:critical, test:e2e:full, test:eslint-rules |

### 2. Flakiness — E2E (Most Critical)

**77 `networkidle` usages** across admin E2E specs (all have eslint-disable comments referencing issue #548):
- `AdminBasePage.goto()` — called by every admin test navigation
- `admin-hall-of-fame.spec.ts` — 20 occurrences
- `admin-evolution-visualization.spec.ts` — 7 occurrences
- `admin-evolution.spec.ts` — 8 occurrences
- `admin-elo-optimization.spec.ts` — 8 occurrences
- Various other admin specs

**10 permanently skipped E2E tests** (test.skip):
- `auth.spec.ts` — logout (Server Action bug)
- `auth.unauth.spec.ts` — localStorage/sessionStorage remember-me tests
- `search-generate.spec.ts` — tag assignment, save-to-library button
- `regenerate.spec.ts` — rewrite dropdown
- `admin-auth.spec.ts` — non-admin redirect
- `action-buttons.spec.ts` — 3 rewrite/edit with tags tests

**@critical tag inconsistency**: Admin specs put `@critical` in the test name string (e.g., `'page loads @critical'`) rather than using Playwright's `{ tag: '@critical' }`. This works because `grep: /@critical/` matches name strings too, but it's fragile — renaming the test silently drops it from critical runs.

**Other E2E issues**:
- `auth.setup.ts` is dead code — never referenced by any Playwright project
- `fixtures/auth.ts` has hardcoded fallback credentials (`abecha@gmail.com` / `'password'`)
- `debug-publish-bug.spec.ts` runs in the main suite with a 120s timeout (debug spec shouldn't be in CI)
- `ResultsPage.ts` has 3 silent `.catch(() => {})` calls that can hide failures
- `api-mocks.ts` has 8 debug `console.log('[MOCK-DEBUG]')` statements left in
- `global-setup.ts` has 7 debug `console.log('[DEBUG]')` statements
- `mockAISuggestionsPipeline()` is marked `@deprecated` but still present
- CSS class selectors used in some POMs (`.text-red-700`, `.diff-accept-btn`, `.animate-spin`) instead of `data-testid`
- `UserLibraryPage.navigate()` has no post-navigate wait
- `LoginPage.clickSubmit()` has no post-action wait (Rule 12 violation)
- `ImportPage.clickProcess()` and `clickPublish()` have no post-action waits

### 3. Flakiness — Unit Tests

**Wall-clock timing assertion** in `findMatches.test.ts:490-497`:
```typescript
const duration = Date.now() - startTime;
expect(duration).toBeLessThan(1000);
```
Will fail on slow CI machines.

**Timing-dependent fire-and-forget test** in `userLibrary.test.ts:93`:
```typescript
await new Promise(resolve => setTimeout(resolve, 10)); // arbitrary 10ms
```

**`process.env` mutations without proper cleanup**:
- `browserTracing.test.ts` — sets `process.env.NODE_ENV` in `it()` blocks
- `cronAuth.test.ts` — sets `process.env.CRON_SECRET` without beforeEach/afterEach
- `cron/evolution-watchdog/route.test.ts` — sets env at describe scope

**`jest.mock()` inside `describe` block** in `returnExplanation.test.ts:130-135` — `jest.mock()` is hoisted by Babel, so calling it inside `describe` has order-dependent behavior.

**Module singleton test-order dependency** in `browserTracing.test.ts:85-87` — acknowledged in comment as a compromise.

**Debug console.log in `jest.shims.js`** — fires on every test run (lines 4, 10).

### 4. Flakiness — Integration Tests

**Non-deterministic delays** in concurrency tests:
- `request-id-propagation.integration.test.ts:269` — `Math.random() * 10` ms delay
- `session-id-propagation.integration.test.ts:115` — same pattern

**Hardcoded sleep** in `logging-infrastructure.integration.test.ts:169` — 50ms for timing measurement

**`hall-of-fame-actions.integration.test.ts` loads `.env.local`** instead of `.env.test` — will fail in CI environments that only have `.env.test`

**`explanation-update.integration.test.ts`** re-declares its own Pinecone/OpenAI mocks, shadowing the global setup mocks — inconsistent with other test files

**`rls-policies.integration.test.ts`** accepts both empty-result and error for RLS-blocked tables — cannot distinguish enforced-but-silent RLS from missing RLS

### 5. Missing Test Coverage

**Unit tests missing for 2 services**:
- `src/lib/services/linkCandidates.ts` — no test file
- `src/lib/services/sourceSummarizer.ts` — no test file

**Integration tests missing for critical paths**:
- `/api/returnExplanation` route — the primary user-facing API
- `userLibrary.ts` — only basic entry creation tested (in auth-flow)
- `auditLog.ts` — DB persistence untested
- `featureFlags.ts` — DB reads untested
- `sourceDiscovery.ts` / `sourceFetcher.ts` pipeline
- `contentQuality*` services (quality evaluation is a key feature)
- `actions.ts` (main server actions)
- Cron routes (evolution-runner, evolution-watchdog, experiment-driver)

**Misclassified integration tests** (no DB operations, should be unit tests):
- `evolution-agent-selection.integration.test.ts` — pure pipeline wiring
- `strategy-experiment.integration.test.ts` — pure algorithm test

### 6. CI/CD Issues

**No explicit timeout on most CI jobs**: Only `e2e-full` has `timeout-minutes: 30`. The typecheck, lint, unit-tests, integration-critical, e2e-critical, and post-deploy-smoke jobs use GitHub's 360-minute default.

**`integration-full` ignores change detection**: Unlike unit-tests, the production integration run doesn't gate on `path == 'full'`. A docs-only PR to `production` runs all integration tests.

**`tsconfig.ci.json` excludes test files**: Type errors in `*.test.ts` / `*.spec.ts` are invisible to CI typecheck.

**Coverage thresholds all at 0**: Both `jest.config.js` and `jest.integration.config.js` — coverage regressions never blocked.

**No flaky test tracking**: No issue templates, no flaky test dashboard, no retry-based detection.

### 7. 13 Skipped Unit Tests

All in Lexical editor files:
- `importExportUtils.test.ts` — 4 skips (need full Lexical lifecycle)
- `StandaloneTitleLinkNode.test.ts` — 8-9 skips (need DOM/browser integration)

## Open Questions

1. **networkidle migration (#548)**: What's the status of this issue? Is there a plan to migrate the 77 usages to specific waits?
2. **Coverage targets**: Should we set minimum coverage thresholds now, or defer? What level is realistic?
3. **Admin @critical tagging**: Should we fix the name-string approach to use proper `{ tag: '@critical' }` annotations?
4. **debug-publish-bug.spec.ts**: Should this be excluded from CI or moved to a dedicated investigation project?
5. **Hardcoded credentials in auth.ts**: Should we remove the fallback and require env vars?
6. **evolution-test-helpers.ts**: Docs list it at `src/testing/utils/` but it actually lives at `evolution/src/testing/` — docs need path correction.
