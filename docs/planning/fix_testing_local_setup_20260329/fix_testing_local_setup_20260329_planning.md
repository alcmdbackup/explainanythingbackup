# Fix Testing Local Setup Plan

## Background
Local test checks (/finalize) and CI checks (ci.yml) have drifted apart. finalize.md has bugs (references nonexistent `test:unit` script, uses wrong E2E command), misses ESM tests, and runs everything sequentially. CI is faster via parallelization, affected-only testing, and sharding — but uses a raw tsc command instead of an npm script. The goal is to align both systems on shared npm scripts as a single source of truth, fix bugs, and add local concurrency for significant speedup.

## Requirements (from GH Issue #881)
Explore how to make local unit integration and e2e testing faster more efficient and less flaky. Compare to ci approach if needed. Explore multiple shards. Make sure checks run follow similar logic as CI.

## Problem
Local checks (/finalize Step 4) and CI (ci.yml) use different commands for the same checks, causing silent drift. finalize.md references `npm run test:unit` which doesn't exist — the actual script is `npm run test`. It calls raw `npx tsc --noEmit` instead of an npm script. It skips ESM tests entirely. And it runs all 5 checks sequentially (~97s) when build, lint, and tsc are completely independent and can all run in parallel. Meanwhile CI is well-optimized with affected-only testing, sharding, and caching — but its tsc command is the only raw invocation not wrapped in an npm script.

## Core Principle: npm Scripts as Single Source of Truth

**Test file patterns and check commands are defined ONCE in `package.json` scripts.** Both /finalize and CI call those same scripts. CI appends flags for its needs (`--changedSince`, `--shard`, `--maxWorkers`). Neither system hardcodes raw tool invocations.

| Check | npm Script (source of truth) | /finalize calls | CI calls (adds flags) |
|-------|------------------------------|-----------------|----------------------|
| Lint | `lint` → `next lint` | `npm run lint` | `npm run lint` |
| TypeScript | `typecheck` → `tsc --noEmit --project tsconfig.ci.json` | `npm run typecheck` | `npm run typecheck` |
| Build | `build` → `next build` | `npm run build` | ✗ skipped |
| Unit | `test` → `jest --forceExit --maxWorkers=4` | `npm run test` | `npm run test:ci -- --changedSince --maxWorkers=2` |
| ESM | `test:esm` → `npx tsx --test ...` | `npm run test:esm` | `npm run test:esm` |
| Integration | `test:integration` → `jest --config ...` | `npm run test:integration` (full) | `:critical` / `:evolution` / `:non-evolution` |
| E2E | `test:e2e:critical` → `playwright test --project=chromium-critical ...` | `npm run test:e2e:critical` | `npm run test:e2e:critical` (+ `:evolution`, `:non-evolution --shard`) |

Intentional differences (CI optimization, not drift):
- CI uses `--changedSince` for unit tests (affected files only)
- CI splits integration tests by path (critical/evolution/non-evolution)
- CI shards E2E non-evolution across 3 parallel jobs
- Local runs full suites for strict pre-PR verification

## Options Considered
- [x] **Option A: Shared Scripts + Aggressive Concurrency**: Add 1 npm script (`typecheck`), fix 3 finalize bugs, add ESM tests, run lint+tsc+build in parallel (they're independent), add `test:changed` for dev workflow. No new packages.
- [ ] **Option B: `check:*` Namespace**: Create 7+ new npm scripts under `check:*` prefix. Overkill — CI already uses the right scripts for 9/10 commands. Adds parallel naming that itself can drift.
- [ ] **Option C: Shell Orchestrator**: Create `scripts/run-checks.sh` called by both. Overkill — CI uses job-level parallelism that a script would bypass. /finalize generates bash inline, doesn't call external scripts.

**Selected: Option A** — fixes the actual problems with minimal changes, adds concurrency for real speedup.

## Phased Execution Plan

### Phase 1: Add/Update npm Scripts + Worker Counts
- [ ] Add `"typecheck": "tsc --noEmit --project tsconfig.ci.json"` to package.json scripts.
  **Note on flag equivalence**: CI currently runs `npx tsc --incremental --tsBuildInfoFile tsconfig.ci.tsbuildinfo --noEmit --project tsconfig.ci.json`. The `--incremental` and `--tsBuildInfoFile` CLI flags are **redundant** — `tsconfig.ci.json` already contains `"incremental": true` and `"tsBuildInfoFile": "tsconfig.ci.tsbuildinfo"`. tsc reads these from the config file automatically. The npm script omits the redundant flags intentionally.
  **Note on npx vs bare tsc**: CI uses `npx tsc`, npm scripts use bare `tsc`. Both resolve to `node_modules/.bin/tsc` — npm scripts automatically add `node_modules/.bin` to PATH. Behavior is identical.
- [ ] Add `"test:changed": "jest --forceExit --maxWorkers=4 --changedSince=origin/main"` to package.json scripts (for dev workflow speed)
- [ ] Update `"test"` script: `"test": "jest --forceExit --maxWorkers=4"` (cap workers; was uncapped = all 6 CPUs)
- [ ] Update `playwright.config.ts` workers: `workers: process.env.CI ? 2 : 3` (3 locally, 2 in CI)
- [ ] Verify `tsconfig.ci.json` already has `incremental: true` and `tsBuildInfoFile` (so both local and CI get incremental builds automatically)
- [ ] Run `npm run typecheck` locally to verify it works
- [ ] Run all 6 checks to baseline current behavior

### Phase 2: Fix finalize.md — Shared Scripts + Concurrency
- [ ] Fix Step 0b: `npm run test:unit` → `npm run test`
- [ ] Fix Step 0b: `npm run test:e2e -- --grep @relevant` → `npm run test:e2e:critical`
- [ ] Fix Step 4 line 641: `npm run test:unit` → `npm run test` (bug fix — test:unit doesn't exist)
- [ ] Fix Step 4 line 639: `npx tsc --noEmit` → `npm run typecheck` (use shared npm script)
- [ ] Fix Step 4: Replace 5 sequential checks with 6 checks using aggressive concurrency.
  **IMPORTANT**: Each phase MUST be a single Bash tool call. Claude Code skill executes bash via the Bash tool — PIDs from background processes do NOT persist across separate tool calls. Each phase block below is one atomic bash command:
  ```bash
  # Phase A: lint + tsc + build ALL in parallel (all independent)
  # ⚠️ This entire block must be ONE Bash tool call
  npm run lint & LINT_PID=$!; npm run typecheck & TSC_PID=$!; npm run build & BUILD_PID=$!; wait $LINT_PID; LINT_RC=$?; wait $TSC_PID; TSC_RC=$?; wait $BUILD_PID; BUILD_RC=$?

  # Phase B: unit + ESM in parallel (ts-jest compiles independently)
  # ⚠️ This entire block must be ONE Bash tool call
  npm run test & UNIT_PID=$!; npm run test:esm & ESM_PID=$!; wait $UNIT_PID; UNIT_RC=$?; wait $ESM_PID; ESM_RC=$?

  # Phase C: integration (sequential — maxWorkers=1, DB conflicts)
  npm run test:integration; INT_RC=$?
  ```
- [ ] Update results table: 5 → 6 checks (add ESM Tests row)
- [ ] Update re-run text: "all 5" → "all 6"
- [ ] Fix Step 5: `npm run test:e2e -- --grep @critical` → `npm run test:e2e:critical`
- [ ] Fix Step 5: `npm run test:e2e` → `npm run test:e2e:full`
- [ ] Add sync-point comment above Step 4 checks referencing package.json as source of truth

### Phase 3: Update ci.yml — Use Shared typecheck Script
- [ ] Replace line 178 raw tsc command with `npm run typecheck`
- [ ] Verify CI cache integrity — concrete check:
  1. Run `npm run typecheck` locally
  2. Confirm `tsconfig.ci.tsbuildinfo` file is created in project root
  3. Run again — confirm it's faster (incremental hit)
  4. Cache action (lines 172-176) caches path `tsconfig.ci.tsbuildinfo` — unchanged, no edits needed
- [ ] Add sync-point comment referencing finalize.md
- [ ] No other ci.yml changes needed (9/10 commands already use npm scripts)

### Phase 4: Add Drift Prevention Documentation
- [ ] Add Check Parity table to `docs/docs_overall/testing_overview.md` (the table from "Core Principle" section above)
- [ ] Add a note explaining intentional differences (CI optimization flags)
- [ ] Update Quick Reference table — add `typecheck` and `test:changed` commands
- [ ] Update `docs/feature_deep_dives/testing_setup.md` Configuration Files table — add typecheck
- [ ] Update `docs/docs_overall/environments.md` Local vs CI table if needed

## Testing

### Unit Tests
- [ ] No new unit tests needed — this is a tooling/config change

### Integration Tests
- [ ] No new integration tests needed

### E2E Tests
- [ ] No new E2E tests needed

### Manual Verification
- [ ] Run `npm run typecheck` — verify it type-checks correctly and creates tsbuildinfo
- [ ] Run `npm run test:changed` — verify it runs only affected tests
- [ ] Run the full 6-check sequence locally with concurrency — verify all pass and output is correct
- [ ] Run `npm run test:e2e:critical` — verify E2E critical works with proper script
- [ ] Push to CI — verify typecheck job passes with `npm run typecheck`
- [ ] Verify tsc incremental cache works (second local run should be faster)

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes

### B) Automated Tests
- [ ] `npm run typecheck` — passes locally
- [ ] `npm run lint` — passes locally
- [ ] `npm run build` — passes locally
- [ ] `npm run test` — passes locally
- [ ] `npm run test:esm` — passes locally
- [ ] `npm run test:integration` — passes locally
- [ ] `npm run test:e2e:critical` — passes locally
- [ ] CI pipeline passes on PR

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/testing_overview.md` — add Check Parity table, add typecheck + test:changed to Quick Reference
- [ ] `docs/feature_deep_dives/testing_setup.md` — add typecheck to Configuration Files, document concurrency model
- [ ] `docs/docs_overall/environments.md` — update Local vs CI Execution table if needed
- [ ] `docs/docs_overall/project_workflow.md` — no changes needed
- [ ] `docs/docs_overall/debugging.md` — no changes needed
- [ ] `docs/feature_deep_dives/debugging_skill.md` — no changes needed

## Concurrency Analysis

### Key Discovery: Build is Independent of Tests

Unit tests use `ts-jest` (compiles TypeScript on-the-fly), not Next.js build output. Integration tests use `jest` with real DB. Neither imports from `.next/`. Both jest configs explicitly ignore `.next/`. ESLint also ignores `.next/`. Therefore **build, lint, and tsc can ALL run in parallel**.

### New Concurrency Model

```
Phase A:  lint ──────────┐
          typecheck ──────┤  ALL THREE in parallel (~45s total, build is bottleneck)
          build ──────────┘
                          ↓
Phase B:  unit tests ────┐
          ESM tests ─────┤  parallel (~20s, unit is bottleneck)
                          ↓
Phase C:  integration ────── sequential (~15s, DB conflicts require maxWorkers=1)
                          ↓
Phase E:  E2E critical ───── after all checks pass (separate step)
```

### Time Comparison

| Approach | lint | tsc | build | unit | ESM | integration | Total |
|----------|------|-----|-------|------|-----|-------------|-------|
| **Current (sequential)** | 5s | 10s | 45s | 20s | 2s | 15s | **~97s** |
| **New (parallel phases)** | ↕ | ↕ | 45s | ↕ | ↕ | 15s | **~80s** |
| | (parallel A) | | (bottleneck) | (parallel B: 20s) | | (sequential) | |

**Savings: ~17s (18% faster)** — and this is free, just bash `&` + `wait`.

### Additional Speed: `test:changed` for Dev Workflow

For iterative development (not /finalize), `npm run test:changed` runs only tests affected by your branch changes:
- Uses `--changedSince=origin/main` (same as CI)
- Coverage thresholds auto-disabled (jest.config.js already handles this)
- Typical speedup: 266 test files → 10-20 test files (~80% faster)

### ESLint Cache: Already Active

`next lint` enables ESLint caching by default (cache at `.next/cache/eslint/`). No script change needed. Re-runs skip unchanged files automatically (~50-70% faster on repeated runs).

### tsc Incremental: Now Active Locally Too

The new `typecheck` script uses `tsconfig.ci.json` which has `incremental: true`. First run creates `tsconfig.ci.tsbuildinfo`; subsequent runs only re-check changed files. Both local and CI benefit from the same cache file.

### Worker Count Changes

**System specs**: Ryzen 5 7640HS (6 CPUs), 19GB RAM.

**Current memory situation**: ~11GB used by 6 Claude Code instances (~6GB), 2 Next.js dev servers (~3.3GB), zombie Playwright processes (~750MB), etc. Available: ~7.8GB. Swap nearly full (3.9/4GB).

After cleanup of idle Claude sessions + zombies, expect ~12GB available.

**Current vs proposed worker counts:**

| Component | Current | Proposed | Memory Impact |
|-----------|---------|----------|---------------|
| Playwright E2E | 2 workers | **3 workers** | +250-400MB |
| Jest unit | default (6 = all CPUs) | **4 workers** (explicit cap) | -400MB to -1GB (was uncapped!) |
| Jest integration | 1 worker | **1 worker** (keep) | No change |

**Why cap Jest at 4 instead of 6**: With 6 workers, Jest alone can consume 3GB+. Capping at 4 (~2GB) leaves headroom for build, dev server, and Playwright. Also avoids thrashing when Phase A (lint+tsc+build) is still running.

**Why Playwright 3 not 4**: Each Chromium instance is 250-400MB. 3 workers = ~1GB. Going to 4 risks Supabase auth rate limiting (more concurrent login attempts) and adds ~400MB for diminishing returns on 61 spec files.

**Implementation:**
- [ ] Add `--maxWorkers=4` to the `test` script in package.json: `"test": "jest --forceExit --maxWorkers=4"`
- [ ] Change `workers: 2` → `workers: 3` in `playwright.config.ts` (local only; CI overrides via env)
- [ ] Add environment check so CI can override: `workers: process.env.CI ? 2 : 3`

**Projected peak memory during /finalize checks:**

```
Phase A (lint+tsc+build parallel):
  lint:      ~200MB (ESLint Node process)
  tsc:       ~300MB (TypeScript compiler)
  build:     ~1.5GB (Next.js + Turbopack)
  Subtotal:  ~2GB

Phase B (unit+ESM parallel):
  Jest (4w): ~1.5GB (4 workers × ~400MB)
  ESM:       ~100MB (single tsx process)
  Subtotal:  ~1.6GB

Phase C (integration):
  Jest (1w): ~500MB
  Subtotal:  ~500MB

Dev server: ~1GB (always running)
─────────────────────────────────
Peak (Phase A): ~3GB on top of dev server
Total at peak:  ~4GB for checks + ~1GB dev server = ~5GB
```

With ~12GB available after cleanup, this leaves **~7GB headroom**. Very safe.

### What We Chose NOT to Do
- **Jest 6 workers (all CPUs)**: Would consume 3GB+ and compete with build/lint/tsc in Phase A. 4 is the sweet spot for 6-CPU/19GB system.
- **Playwright 4+ workers**: Diminishing returns on 61 specs, Supabase rate limiting risk, +400MB per worker.
- **E2E sharding locally**: Multiple Playwright processes hitting same dev server causes contention. Not worth complexity for /finalize.
- **`--changedSince` in /finalize**: /finalize is the pre-PR gate — it should run full suites. `test:changed` is for dev iteration only.

## Rollback Plan

If changes break CI:
1. Revert `package.json` (typecheck script, maxWorkers change)
2. Revert `ci.yml` line 178 back to raw `npx tsc --incremental --tsBuildInfoFile tsconfig.ci.tsbuildinfo --noEmit --project tsconfig.ci.json`
3. Revert `playwright.config.ts` workers back to `workers: 2`

Only 3 files modified in core config. finalize.md and doc changes are non-breaking (Claude Code skill, not runtime code).

## Exclusions

- **`test:eslint-rules`**: Tests custom ESLint rules (7 rule files). Not included in /finalize or CI checks. Dev-only — run manually when modifying eslint-rules/ directory.
- **`test:v1-regression`**: V1 evolution regression tests. Not in /finalize or CI. Run manually for evolution work.
- **`test:e2e:full` scope**: Runs ALL Playwright projects (chromium, chromium-unauth, firefox). This is intentionally broader than `test:e2e` (chromium + chromium-unauth only). The /finalize `--e2e` flag triggers `test:e2e:full` to include firefox — matching CI's nightly browser matrix.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `npm run typecheck` behaves differently than raw tsc | Low | Same flags; tsconfig.ci.json unchanged |
| Parallel lint+tsc+build output interleaving | Low | /finalize captures exit codes via PIDs, not stdout |
| Build + tsc competing for CPU in Phase A | Low | Build is I/O heavy (webpack), tsc is CPU-light with incremental |
| CI cache invalidation on package.json change | Low | Cache key includes package-lock hash; normal behavior |
| `test:changed` misses affected tests | Low | Jest's dependency tracking is mature; full suite in /finalize catches misses |
| Jest 4 workers too aggressive alongside build | Low | Phase B runs AFTER Phase A finishes; no overlap |
| Playwright 3 workers causes auth rate limiting | Low | Auth fixture has retry with exponential backoff; 3 is conservative |
| System memory pressure from parallel phases | Low | Peak ~5GB; ~7GB headroom after cleanup of idle sessions |

## Review & Discussion

### Iteration 1 (3 agents)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 0 |
| Architecture & Integration | 3/5 | 3 — bash PID persistence across tool calls, typecheck flag mismatch, ambiguous Step 4 fix |
| Testing & CI/CD | 4/5 | 2 — no concrete CI cache verification, npx vs tsc equivalence not noted |

**Fixes applied**: Added "must be ONE Bash tool call" constraint with warnings, documented typecheck flag equivalence (CLI flags redundant with tsconfig.ci.json), made Step 4 test:unit fix explicit line item, added 4-step CI cache verification, documented npx vs bare tsc, added rollback plan + exclusions section.

### Iteration 2 (3 agents)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 |
| Architecture & Integration | 5/5 | 0 |
| Testing & CI/CD | 5/5 | 0 |

**✅ CONSENSUS REACHED** — All reviewers 5/5. Plan ready for execution.

**Remaining minor items** (non-blocking, address during implementation):
- Exit-code aggregation logic not shown in bash snippets (finalize skill handles via results table)
- Interleaved stdout from parallel processes (cosmetic, exit codes captured correctly)
- test:changed depends on origin/main being fetched locally
- test:e2e:full is broader than test:e2e (includes firefox) — documented in Exclusions
- CI reference table slightly simplified (omits --cacheDirectory flag)
