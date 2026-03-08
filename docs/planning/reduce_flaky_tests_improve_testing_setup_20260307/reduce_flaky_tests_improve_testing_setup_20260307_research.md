# Reduce Flaky Tests Improve Testing Setup Research

## Problem Statement
Fix any flaky tests across the test suite, then look for ways to improve the test setup and test rules so that testing is faster and more reliable.

## Requirements (from GH Issue #670)
- Fix any flaky tests (E2E, integration, unit)
- Look for ways to improve test setup for faster execution
- Look for ways to improve test rules for more reliable testing
- Update testing documentation to reflect changes

## High Level Summary

Research across 4 rounds of 4 agents (16 total) examined all 36 E2E specs, 28 integration tests, 177 unit tests, CI workflows, ESLint rules, and prior flaky test work. The codebase has strong testing foundations with good enforcement, but has specific gaps in mock cleanup, CI caching, ESLint rule coverage, and flaky test visibility. Prior work (Feb 24 project) fixed the most critical E2E flakiness issues; this project should focus on unit/integration reliability, CI speed, lint rule hardening, and flaky test reporting.

## Prior Work: fix_flaky_production_tests_20260224

A prior project already addressed many E2E flakiness issues:
- Fixed application bug in `getExplanationByIdImpl()` (hidden content)
- Changed `restoreMocks: false` → `true` in jest.integration.config.js
- Created `eslint-rules/no-networkidle.js` + disabled 71 violations
- Fixed POM waits in ResultsPage.ts, UserLibraryPage.ts
- Fixed shared temp file race conditions (append-only format)
- Added route cleanup to all 3 E2E fixtures (base.ts, auth.ts, admin-auth.ts)
- Replaced networkidle in import-articles.spec.ts

**Deferred items from that project:**
- Admin page networkidle migration (now 95% done — only 2 remaining instances)
- Shard rebalancing (30% variance between shards)
- Comprehensive POM enforcement pattern

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md — 12 testing rules, CI/CD workflows
- docs/docs_overall/environments.md — Environment configs, CI secrets
- docs/feature_deep_dives/testing_setup.md — Four-tier strategy, test utilities
- docs/feature_deep_dives/testing_pipeline.md — A/B testing pipeline
- docs/docs_overall/debugging.md — Debugging workflow, tmux servers

### Prior Project Docs
- docs/planning/fix_flaky_production_tests_20260224/ — Full research, planning, progress

## Code Files Read

### E2E Test Files (all 36 specs + helpers + fixtures)
- src/__tests__/e2e/specs/**/*.spec.ts — All 36 spec files
- src/__tests__/e2e/fixtures/auth.ts, base.ts, admin-auth.ts
- src/__tests__/e2e/helpers/api-mocks.ts, error-utils.ts, wait-utils.ts, test-data-factory.ts, suggestions-test-helpers.ts
- src/__tests__/e2e/helpers/pages/*.ts — All POM files
- src/__tests__/e2e/setup/global-setup.ts, global-teardown.ts, vercel-bypass.ts

### Configuration Files
- playwright.config.ts — E2E config (retries, timeouts, projects, sharding)
- jest.config.js — Unit test config
- jest.integration.config.js — Integration test config (already has clearMocks/restoreMocks)
- jest.setup.js, jest.integration-setup.js, jest.shims.js
- tsconfig.ci.json — CI TypeScript config

### ESLint Rules
- eslint-rules/index.js, no-networkidle.js, no-wait-for-timeout.js, no-silent-catch.js, no-test-skip.js, max-test-timeout.js
- eslint.config.mjs — Rule registration and file patterns

### CI Workflows
- .github/workflows/ci.yml — PR testing pipeline
- .github/workflows/e2e-nightly.yml — Nightly production tests
- .github/workflows/post-deploy-smoke.yml — Post-deploy verification

### Hooks
- .claude/hooks/check-test-patterns.sh — Test pattern warnings
- .claude/hooks/block-silent-failures.sh — Error swallowing prevention
- .claude/settings.json — Hook configuration

## Key Findings

### Finding 1: Unit test mock cleanup is inadequate
- **70% of unit test files (157/224) have no afterEach cleanup**
- 59 files have mocks without `jest.resetAllMocks()` or `jest.restoreAllMocks()`
- jest.config.js has NO `clearMocks`, `resetMocks`, or `restoreMocks` settings
- Integration config already has both `clearMocks: true` and `restoreMocks: true`
- **Risk assessment**: 20 specific files would break if `restoreMocks: true` added globally — they set mockReturnValue at module level without beforeEach re-initialization
- **Fix**: Add `clearMocks: true` to jest.config.js (safe), then fix 20 files before adding `restoreMocks: true`

### Finding 2: CI pipeline can be 40-60% faster with caching
- No Next.js build artifact caching (.next/cache) — **45-60s wasted per full run**
- No tsc incremental cache in CI — **15-20s wasted**
- No Jest cache preservation — **10-15s wasted**
- Unit test workers at 2, could be 4 — **40-50% faster unit tests**
- Total estimated savings: **2-3 minutes per full CI run**

### Finding 3: ESLint flakiness rules have gaps
- **0/5 flakiness rules have tests** (design-system rules do have tests)
- `no-wait-for-timeout` doesn't catch `await new Promise(r => setTimeout(r, N))` — 6 uncaught instances
- `no-networkidle` doesn't catch template literals
- `no-silent-catch` doesn't catch `async () => {}` or `() => []` patterns
- Rule 11 (per-worker temp files) has no lint enforcement — 7 hardcoded `/tmp/` paths found
- Rule 12 (POM waits after actions) has no enforcement at all

### Finding 4: Remaining E2E violations are well-managed
- All monitored violations (networkidle, waitForTimeout, test.skip, .catch) have proper eslint-disable comments
- Only 4 networkidle calls remain (2 in skipped tests, 2 with eslint-disable)
- Admin networkidle migration is 95% complete (47/49 calls use domcontentloaded)
- Only 2 waitForTimeout calls remain (both in utilities with eslint-disable)

### Finding 5: Integration tests have specific fragility patterns
- 8 of 28 integration test files have issues
- Database race conditions: missing waits between insert and subsequent query
- `jest.clearAllMocks()` only clears call history, not implementations — should use `resetAllMocks()`
- Test order dependencies in manual-experiment and evolution-pipeline tests
- Module-level mocks without re-setup in beforeEach

### Finding 6: CI has 83% failure rate on deploy branches
- E2E Shard 2/3 has highest failure rate for non-evolution tests
- Shard imbalance: 30% variance (73 vs 82 vs 63 tests per shard)
- suggestions.spec.ts (24 tests) is the single largest file, creating bottleneck in Shard 2
- 2-3 retries mask true flakiness — no flaky test reporting exists

### Finding 7: No flaky test detection/reporting
- Playwright JSON reporter captures retry data but it's not analyzed
- No JUnit XML reporting configured
- No trend tracking for test reliability
- Custom Playwright reporter (~150 LOC) would surface tests passing only after retries

### Finding 8: New ESLint rules are implementation-ready
- `no-fixed-sleep`: Catches `await new Promise(r => setTimeout(r, N))` — spec complete with AST visitors and test cases
- `no-hardcoded-tmpdir`: Catches `/tmp/` without worker index — spec complete
- Both follow existing rule patterns (meta + create visitor + messageId)
- Tests should follow design-system rule test pattern

## Open Questions

1. Should we add `clearMocks: true` globally to jest.config.js now (safe) and defer `restoreMocks: true` until 20 files are fixed?
2. Should we prioritize CI speed (caching) or reliability (lint rules/mock cleanup) first?
3. Should we create the flaky test reporter in this project or defer?
4. Should we tackle shard rebalancing (explicit shard config vs alphabetical)?
5. Should we add tests for all 5 existing flakiness ESLint rules?
