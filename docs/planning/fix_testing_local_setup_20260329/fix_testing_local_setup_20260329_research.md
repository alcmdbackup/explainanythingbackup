# Fix Testing Local Setup Research

## Problem Statement
Explore how to make local unit, integration, and E2E testing faster, more efficient, and less flaky. Compare to CI approach if needed. Explore multiple shards. Make sure checks run follow similar logic as CI.

## Requirements (from GH Issue #881)
Explore how to make local unit integration and e2e testing faster more efficient and less flaky. Compare to ci approach if needed. Explore multiple shards. Make sure checks run follow similar logic as CI.

## High Level Summary

The local test infrastructure has significant optimization opportunities compared to CI. Key findings:

1. **No parallelization in /finalize** — all checks run sequentially (lint → tsc → build → unit → integration → E2E) while CI runs lint + tsc in parallel
2. **No affected-only testing locally** — CI uses `--changedSince` for unit tests and Playwright supports `--only-changed`; local always runs full suites
3. **No E2E sharding locally** — CI shards non-evolution E2E across 3 parallel jobs; local runs serially
4. **Missing checks** — local skips ESM tests (`test:esm`); CI skips build step
5. **No fast-path detection locally** — CI skips tests for docs-only changes; local always runs everything
6. **No ESLint cache** — `next lint` doesn't use `--cache` flag
7. **tsc incremental is enabled locally** (`tsconfig.json` has `incremental: true`) but /finalize runs plain `npx tsc --noEmit` without `--incremental`
8. **Flakiness mitigation is comprehensive** — 7 custom ESLint rules, safe wait utilities, serial mode on 27/61 E2E specs, defense-in-depth cleanup

## Current State

### Test File Counts
| Tier | Count | Config |
|------|-------|--------|
| Unit (src/) | ~168 files | jest.config.js, jsdom env |
| Unit (evolution/) | ~95 files | jest.config.js, jsdom env |
| Unit (scripts/) | ~3 files | jest.config.js |
| ESM | 1 file | Node test runner via tsx |
| Integration | 35 files | jest.integration.config.js, node env, maxWorkers=1 |
| E2E | 61 files | playwright.config.ts, 2 workers |

### Worker/Parallelism Settings
| Tier | Local Workers | CI Workers |
|------|--------------|-----------|
| Unit | System default (all CPUs) | maxWorkers=2 |
| Integration | maxWorkers=1 (sequential) | maxWorkers=1 |
| E2E | 2 workers, fullyParallel=true | 2 workers per shard, 3 shards for non-evolution |

### E2E Test Distribution
| Directory | Count | Tags |
|-----------|-------|------|
| 09-admin | 33 | @critical, @evolution |
| 06-ai-suggestions | 7 | @skip-prod |
| 04-content-viewing | 6 | @critical |
| Others (auth, search, library, etc.) | 15 | @critical, @smoke |
| **Serial mode specs** | **27/61** | Can't parallelize within describe block |

## Local vs CI Gap Analysis

### Where Local is LESS thorough than CI
| Gap | Local | CI | Impact |
|-----|-------|-----|--------|
| ESM tests | ❌ Not run | ✅ `npm run test:esm` | ESM modules untested locally |
| Affected-only testing | ❌ Full suite always | ✅ `--changedSince` | Local runs unnecessary tests |
| E2E sharding | ❌ Serial (2 workers) | ✅ 3 shards × 2 workers | Local E2E ~3x slower |
| Fast-path detection | ❌ Always runs all | ✅ Skips tests for docs-only | Wasted time on doc PRs |
| tsc incremental caching | ❌ Plain `--noEmit` | ✅ `--incremental` with cache | Slower type checks |
| Integration splitting | ❌ Runs all 35 | ✅ critical/evolution/non-evolution | Runs wrong subset for branch |

### Where Local is MORE thorough than CI (good)
| Feature | Local | CI |
|---------|-------|-----|
| Build step | ✅ `npm run build` | ❌ Not in CI |
| Code simplification | ✅ Agent-driven refactoring | ❌ |
| Code review | ✅ 5 review agents | ❌ |
| Plan verification | ✅ Gates on plan completeness | ❌ |
| Documentation updates | ✅ Auto-updates docs | ❌ |

### CI-only checks not in local
- Change detection (fast/full/evolution-only/non-evolution-only routing)
- Destructive DDL migration check
- Type regeneration from staging DB
- Concurrency control (cancel stale runs)

## Optimization Opportunities

### 1. Parallel lint + tsc (Easy Win)
- lint and tsc are fully independent — can run with bash `&` + `wait`
- Saves ~5-10s per check run
- No package needed (bash background jobs)

### 2. ESLint `--cache` (Easy Win)
- Add `--cache` flag to `next lint` command
- Dramatically faster on re-runs (only checks changed files)

### 3. Jest `--changedSince` for local (Medium)
- `git merge-base HEAD origin/main` works in current repo ✓
- Coverage thresholds auto-disabled with `--changedSince` ✓
- New script: `"test:changed": "jest --forceExit --changedSince=origin/main"`

### 4. Playwright `--only-changed` for local (Medium)
- Native support: `npx playwright test --only-changed=origin/main`
- Can combine with `--grep=@critical` for further filtering

### 5. E2E Sharding locally (Medium-Complex)
- `--shard=N/3` works with existing scripts
- Serial mode preserved within shards ✓
- **Concern**: Multiple shards hitting same dev server causes contention
- **Mitigation**: Use `--workers=1` per shard to reduce load
- Recommended: `npm run test:e2e -- --shard=1/3 --workers=1 &` (3 parallel processes)

### 6. Fast-path detection (Medium)
- Check `git diff --name-only origin/main...HEAD` for code files
- Skip unit/integration/E2E if only docs/migrations changed

### 7. Unified `checks` script (Complex)
- Replace ad-hoc /finalize commands with orchestrated script
- Support flags: `--fast` (docs-only skip), `--full` (with E2E), `--prod` (evolution tests)
- Parallel where possible, collect all exit codes

## Flakiness Mitigation (Already Strong)

### Custom ESLint Rules (7 rules)
| Rule | Prevents |
|------|---------|
| no-wait-for-timeout | Fixed sleeps |
| no-networkidle | Unreliable network waits |
| no-silent-catch | Hidden errors |
| no-test-skip | Disabled tests |
| max-test-timeout | Overly long timeouts |
| require-test-cleanup | Orphaned test data |
| no-hardcoded-tmpdir | Shared temp files |

### Wait Utilities
- `waitForState<T>()` — polls multiple states, returns which succeeded
- `waitForRouteReady()` — ensures route handler registered before navigation
- `waitForPageStable()` — custom stability check (replaces networkidle)

### Error Utilities
- `safeWaitFor()`, `safeIsVisible()`, `safeTextContent()`, `safeScreenshot()`, `safeRace()` — log errors instead of silently swallowing

### Retry Configuration
| Environment | Retries | Timeout |
|-------------|---------|---------|
| Local | 0 | 30s |
| CI | 2 | 60s |
| Production | 3 | 120s |

## CI Pipeline Architecture

### Change Detection Strategy
1. **Fast path** — docs/migrations only → lint + tsc only (~1 min)
2. **Full path** — shared code changed → all tests
3. **Evolution-only** — only evolution code → unit + integration:evolution + e2e:evolution
4. **Non-evolution-only** — only non-evolution code → unit + integration:non-evolution + e2e:non-evolution (3 shards)

### CI Caching
| Cache | Key | Path |
|-------|-----|------|
| npm packages | OS + package-lock.json hash | actions/setup-node |
| tsc incremental | tsconfig.ci.json + package-lock hash | tsconfig.ci.tsbuildinfo |
| Jest transforms | package-lock hash | /tmp/jest-cache |
| Next.js build | package-lock hash | .next/cache |
| Playwright browsers | Playwright version | ~/.cache/ms-playwright |

### CI Parallelization
```
detect-changes
  ↓
typecheck + lint (parallel, always)
  ↓
unit-tests (if not fast path, --changedSince)
  ↓
integration-critical + e2e-critical (parallel, main only)
integration-evolution + e2e-evolution (parallel, evolution path)
integration-non-evolution + e2e-non-evolution×3 (parallel, prod only)
```

## Implementation Research: Keeping Local & CI in Sync

### Key Discovery: The Gap is Smaller Than Expected

CI already uses npm scripts for 9/10 check commands. Only tsc is raw (`npx tsc ...`). The main issues are:
1. **finalize.md has bugs** — references `npm run test:unit` which doesn't exist in package.json
2. **finalize.md uses wrong E2E command** — `npm run test:e2e -- --grep @critical` instead of `npm run test:e2e:critical`
3. **No typecheck npm script** — tsc is called raw in both finalize and CI
4. **ESM tests missing from finalize** — CI runs `npm run test:esm`, finalize doesn't

### Approach: Minimal Changes (Not a `check:*` Namespace)

A full `check:*` namespace is overkill. The real fix is:
1. Add 1 npm script: `typecheck`
2. Fix 3 bugs in finalize.md
3. Add ESM tests to finalize
4. Add sync-point comments to prevent future drift

### Exact Changes Required

#### 1. package.json — Add 1 Script
```json
"typecheck": "tsc --noEmit --project tsconfig.ci.json"
```
- `tsconfig.ci.json` already has `incremental: true` and `tsBuildInfoFile` — tsc reads these automatically
- Both local and CI use same script; CI benefits from incremental cache, local gets it too
- No other script changes needed

#### 2. finalize.md — Fix Step 4 (5 changes)

**Current (BROKEN):**
```bash
npm run lint;                LINT_RC=$?
npx tsc --noEmit;            TSC_RC=$?
npm run build;               BUILD_RC=$?
npm run test:unit;           UNIT_RC=$?
npm run test:integration;    INT_RC=$?
```

**Fixed:**
```bash
npm run lint;                LINT_RC=$?
npm run typecheck;           TSC_RC=$?
npm run build;               BUILD_RC=$?
npm run test;                UNIT_RC=$?
npm run test:esm;            ESM_RC=$?
npm run test:integration;    INT_RC=$?
```

Changes:
- `npx tsc --noEmit` → `npm run typecheck` (use npm script)
- `npm run test:unit` → `npm run test` (bug fix — test:unit doesn't exist)
- Added `npm run test:esm` (was missing, CI runs it)
- Results table: 5 → 6 checks
- Re-run loop: "all 5" → "all 6"

#### 3. finalize.md — Fix Step 5 (E2E)

**Current:** `npm run test:e2e -- --grep @critical`
**Fixed:** `npm run test:e2e:critical`

**Current (full):** `npm run test:e2e`
**Fixed:** `npm run test:e2e:full`

#### 4. finalize.md — Fix Step 0b

**Current:** `npm run test:unit`
**Fixed:** `npm run test`

#### 5. ci.yml — Replace Raw tsc (1 Change)

**Current (line 178):**
```
npx tsc --incremental --tsBuildInfoFile tsconfig.ci.tsbuildinfo --noEmit --project tsconfig.ci.json
```

**Fixed:**
```
npm run typecheck
```

Cache action (lines 172-176) stays unchanged — still caches `tsconfig.ci.tsbuildinfo`.

#### 6. Drift Prevention — Comment Cross-References

Add sync-point comments to finalize.md Step 4 and ci.yml typecheck/integration jobs:

**finalize.md:**
```markdown
<!-- SYNC-POINT: These checks use the same npm scripts as CI.
     CI adds flags: --changedSince (unit), --shard (E2E), --maxWorkers=2
     Finalize runs FULL suites for strict pre-PR verification.
     If you change check commands, update ci.yml and testing_overview.md -->
```

**ci.yml:**
```yaml
# SYNC-POINT: Uses same npm scripts as finalize.md Step 4
# CI adds: --changedSince, --maxWorkers=2, --shard
# If you change test commands, update finalize.md Step 4
```

#### 7. testing_overview.md — Add Parity Table

```markdown
### Check Parity: Local vs CI

| Check | Local (/finalize) | CI (main) | CI (prod) |
|-------|-------------------|-----------|-----------|
| Lint | `npm run lint` | `npm run lint` | `npm run lint` |
| TypeScript | `npm run typecheck` | `npm run typecheck` | `npm run typecheck` |
| Build | `npm run build` | ✗ skipped | ✗ skipped |
| Unit | `npm run test` | `npm run test:ci -- --changedSince` | same |
| ESM | `npm run test:esm` | `npm run test:esm` | `npm run test:esm` |
| Integration | `npm run test:integration` (all) | `:critical` (5 tests) | `:evolution` + `:non-evolution` |
| E2E | `npm run test:e2e:critical` | `npm run test:e2e:critical` | `:evolution` + `:non-evolution --shard` |
```

### Why NOT a `check:*` Namespace

- Only 1 script is missing (typecheck) — adding 7+ `check:*` scripts is overkill
- CI already uses the right npm scripts (9/10)
- Finalize just has 3 bugs to fix
- A namespace creates parallel script names that themselves can drift
- The real problem is documentation/cross-referencing, not script naming

### Why NOT a Shell Script Orchestrator

- /finalize is a Claude Code skill (markdown) — it generates bash inline, doesn't call external scripts
- CI already parallelizes via separate GitHub Actions jobs — a script would lose that granularity
- CI's detect-changes routing would be bypassed by a unified script
- Adding `scripts/run-checks.sh` creates another file to keep in sync

### Answered Open Questions

1. **concurrently vs bash `&`/`wait`?** — Neither needed. Keep /finalize sequential (simple, 60-90s total). CI already parallelizes via job-level concurrency.
2. **E2E shards locally?** — Not worth the complexity. Server contention with multiple shards, auth rate limiting. Keep `test:e2e:critical` for fast feedback.
3. **Unified checks script?** — No. /finalize and CI have legitimately different needs (full vs selective). Sync via shared npm scripts + comments.
4. **Integration tests split by branch?** — No. Finalize runs full suite (strict). CI splits (cost-optimized). Document the intentional difference.
5. **Is `next build` redundant?** — No. Build catches bundle errors tsc doesn't. CI should arguably add it too.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/debugging_skill.md

## Code Files Read
- `.github/workflows/ci.yml` — full CI pipeline with change detection, sharding, caching
- `.github/workflows/e2e-nightly.yml` — nightly E2E against production
- `.github/workflows/post-deploy-smoke.yml` — post-deploy smoke tests
- `jest.config.js` — unit test config (jsdom, all CPUs, /tmp/jest-cache)
- `jest.integration.config.js` — integration config (node, maxWorkers=1, 30s timeout)
- `playwright.config.ts` — E2E config (2 workers, fullyParallel, sharding, retries)
- `package.json` — all test scripts and dependencies
- `tsconfig.json` — base config (incremental=true, noEmit=true)
- `tsconfig.ci.json` — CI config (incremental, custom tsbuildinfo)
- `next.config.ts` — Next.js build config (Sentry, Turbopack)
- `eslint.config.mjs` — ESLint 9 flat config
- `.claude/commands/finalize.md` — /finalize skill (sequential checks)
- `src/__tests__/e2e/setup/global-setup.ts` — E2E global setup (health check, auth, seeding)
- `src/__tests__/e2e/setup/global-teardown.ts` — E2E cleanup (user data, vectors, tracked IDs)
- `src/__tests__/e2e/fixtures/base.ts` — base fixture (unroute cleanup)
- `src/__tests__/e2e/fixtures/auth.ts` — auth fixture (per-worker session caching, retry)
- `src/__tests__/e2e/helpers/wait-utils.ts` — custom wait strategies
- `src/__tests__/e2e/helpers/error-utils.ts` — safe error handling helpers
- `src/__tests__/e2e/helpers/api-mocks.ts` — SSE streaming mocks with unroute
- `src/__tests__/e2e/helpers/test-data-factory.ts` — test data creation and cleanup
- `docs/planning/tmux_usage/ensure-server.sh` — on-demand server management
- `docs/planning/tmux_usage/start-dev-tmux.sh` — tmux server startup
- `jest.setup.js` — unit test mocks and polyfills
- `jest.integration-setup.js` — integration setup with real Supabase
- `eslint-rules/` — 7 custom flakiness prevention rules
- `.claude/commands/finalize.md` — full skill definition (Step 0, 4, 5 check commands)
- `.githooks/pre-commit` — pre-commit hook patterns (error handling, validation)
