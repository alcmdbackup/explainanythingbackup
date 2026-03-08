# Update Finalize Main To Prod To Run E2E Tests Research

## Problem Statement
Update the /finalize and /mainToProd skills to include E2E test execution as part of their workflow. Currently these skills run lint, tsc, build, unit, and integration tests but skip E2E tests, which means E2E regressions can slip through to main and production. Adding E2E test runs will catch browser-level issues before code is merged.

## Requirements (from GH Issue #675)
1. Update /finalize skill to run E2E tests (critical tagged) after unit/integration tests pass
2. Update /mainToProd skill to run full E2E suite before creating the PR to production
3. Handle E2E test failures gracefully — report results clearly and stop the workflow
4. Ensure tmux dev servers are properly managed during E2E runs within these skills
5. Performance research: benchmark E2E test execution time and resource usage on a GMKtec M6 Ultra (Ryzen 7640HS, 32GB RAM) to ensure it doesn't bottleneck the workflow
6. Determine optimal number of Playwright shards for local execution on this hardware
7. Update relevant documentation (testing_overview.md, environments.md) if needed

## High Level Summary

E2E tests can be added to /finalize and /mainToProd without significant performance impact. The critical E2E suite completes in ~1.5 minutes with 2 workers (default), adding minimal overhead to an already multi-minute finalization workflow. The system's 3 physical cores are the bottleneck — 3 workers is optimal, 4+ causes degradation from memory pressure.

The /finalize command already has an `--e2e` flag (Step 5) that runs `npm run test:e2e -- --grep @critical` but it's optional. The /mainToProd command has no E2E step at all. Both commands are defined in `.claude/commands/` as markdown skill files.

## Hardware Profile (GMKtec M6 Ultra - Actual Measurements)

| Spec | Value |
|------|-------|
| CPU | AMD Ryzen 5 7640HS (3 physical cores, 6 threads visible to VM) |
| RAM | ~9-19GB dynamic (VM on 32GB host, kernel allocates on demand) |
| Swap | 4GB (2GB typically in use) |
| Available RAM at idle | ~5-6GB |

**Note:** System runs as a VM with 3/6 cores of the host's 6/12 cores. RAM is dynamically allocated by the hypervisor.

## Performance Benchmarks (E2E Critical Suite)

### Worker Count vs Performance

| Workers | Wall Time | CPU User | CPU Sys | Peak RAM | Failures | Notes |
|---------|-----------|----------|---------|----------|----------|-------|
| 1 | 2m 36s | 31s | 16s | ~5.8 GB | 1 | Baseline, sequential |
| **2** | **1m 29s** | **31s** | **10s** | **~6.7 GB** | **1** | **Default, stable** |
| **3** | **1m 22s** | **42s** | **21s** | **~6.7 GB** | **2** | **Fastest, matches cores** |
| 4 | 1m 41s | 50s | 27s | ~5.1 GB* | 1+flaky | RAM pressure, slower |

*4 workers: RAM was constrained to ~9.4GB total, causing swap pressure and test flakiness.

### Key Metrics
- **E2E critical test count:** 52 tests (29-30 pass, 1 persistent failure, 19-22 skipped)
- **RAM overhead per Chromium worker:** ~500-800MB
- **Base Playwright overhead:** ~150MB
- **Total E2E overhead (2 workers):** ~1.7GB above baseline
- **Server startup time:** ~2s (if ensure-server.sh runs, server already exists)

### Recommendation: 2-3 Workers
- **2 workers** (current default): Most stable, 1.5 min, no flakiness
- **3 workers**: 7 seconds faster but slightly more CPU-intensive, marginal gain
- **4+ workers**: Actively harmful on this hardware — causes swap thrashing and flakiness

## Current Skill Analysis

### /finalize (`/.claude/commands/finalize.md`)
- **Location:** `.claude/commands/finalize.md`
- **Steps:** Plan assessment → Test coverage verification → Commit → Rebase → Code simplification → Code review → Checks (lint/tsc/build/unit/integration) → E2E (optional) → Docs → Push → PR → CI monitor
- **E2E handling:** Step 5 exists but is opt-in via `--e2e` flag. Runs `npm run test:e2e -- --grep @critical`
- **Change needed:** Make E2E critical tests run by default (remove opt-in requirement), or at minimum make it the recommended default

### /mainToProd (`.claude/commands/mainToProd.md`)
- **Location:** `.claude/commands/mainToProd.md`
- **Steps:** Setup → Merge main → Resolve conflicts → Checks (lint/tsc/build/unit/integration) → Commit → Push → PR
- **E2E handling:** None — no E2E step exists
- **Change needed:** Add full E2E suite (`npm run test:e2e`) after unit/integration checks pass, before commit

### Playwright Configuration (`playwright.config.ts`)
- **Projects:** chromium-critical (grep @critical), chromium (full), chromium-unauth, firefox
- **Workers:** 2 (hardcoded)
- **Server discovery:** Uses `ensure-server.sh` → Claude instance JSON → baseURL
- **npm scripts:**
  - `test:e2e:critical` → `playwright test --project=chromium-critical --project=chromium-unauth`
  - `test:e2e` → `playwright test --project=chromium --project=chromium-unauth`
  - `test:e2e:full` → `playwright test` (all projects including firefox)

### Server Management
- `ensure-server.sh` auto-starts a tmux dev server on demand
- Server info written to `/tmp/claude-instance-{id}.json`
- Idle watcher kills server after 5 min inactivity
- **Risk:** If idle watcher kills server during long test runs, tests hang silently
- **Mitigation needed:** Touch the idle timestamp during E2E test execution, or extend timeout

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — doc structure and reading order
- docs/docs_overall/architecture.md — system design, data flow, tech stack
- docs/docs_overall/project_workflow.md — complete project workflow

### Relevant Docs
- docs/docs_overall/testing_overview.md — E2E test tagging strategy (@critical, @smoke), CI/CD pipeline, test rules
- docs/docs_overall/environments.md — CI secrets, E2E config per environment, backup mirror info
- docs/docs_overall/debugging.md — tmux server management, ensure-server.sh flow, idle watcher behavior

## Code Files Read
- `.claude/commands/finalize.md` — Full /finalize skill definition (865 lines)
- `.claude/commands/mainToProd.md` — Full /mainToProd skill definition (177 lines)
- `playwright.config.ts` — Playwright configuration (167 lines)
- `package.json` — E2E npm scripts (test:e2e, test:e2e:critical, etc.)

## Key Findings

1. **/finalize already supports E2E** via `--e2e` flag (Step 5), but it's opt-in. Making it default adds ~1.5 min to the workflow.
2. **/mainToProd has no E2E support** at all. Adding full E2E suite would add ~3-5 min (full suite is larger than critical).
3. **2 workers is optimal** for this hardware. 3 workers gives marginal speed improvement but more CPU usage. 4+ workers is harmful.
4. **Server management is fragile** — the idle watcher can kill the server during long test runs, causing silent hangs. The ensure-server.sh needs to touch the idle timestamp or the watcher needs a "test in progress" signal.
5. **22 tests are skipped** in the critical suite — this is expected behavior (tests without @critical tag filtered by project config, plus legitimate skips).
6. **1 persistent test failure** in `search-generate.spec.ts:110` — "should display full content after streaming completes" fails consistently across all worker counts. This is a pre-existing issue, not caused by this project.
7. **The full E2E suite (39 files)** would take significantly longer than the critical suite. For /mainToProd, running `test:e2e` (chromium + chromium-unauth) is the right scope — full (including firefox) would be too slow.

## Decisions (from user)

1. **/finalize**: Keep `--e2e` as opt-in flag (no change to default behavior)
2. **/mainToProd**: Add `--e2e` flag that runs the **full** E2E suite (`npm run test:e2e` — all chromium + chromium-unauth)
3. **Fix the persistent test failure** in `search-generate.spec.ts:110` as part of this project
4. **Fix idle watcher** to prevent server kills during E2E runs

## Root Cause: search-generate.spec.ts Failure

**Error:** "User query not found for ID: 91001"

**Flow:**
1. Mock SSE stream returns `explanationId: 90001`, `userQueryId: 91001`
2. After streaming, client does `router.push('/results?explanation_id=90001&userQueryId=91001')`
3. The redirected page's useEffect calls `getUserQueryByIdAction(91001)` — a real server action, not mocked
4. Query ID 91001 doesn't exist in DB → error displayed

**Fix options:**
- **A)** Mock server actions at network level (POST intercept with Next.js action headers) — complex, fragile
- **B)** Verify content presence during/right after streaming, before redirect re-renders — simplest
- **C)** Have the test also mock the page.route for Next.js server action calls — moderate complexity

**Recommended:** Option B — check `hasContent()` right after streaming ends but before the redirect triggers a DB reload. The test's purpose is to verify "content displays after streaming" — it doesn't need to verify the post-redirect DB load.
