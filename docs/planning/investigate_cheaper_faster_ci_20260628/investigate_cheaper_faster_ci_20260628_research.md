# Investigate Cheaper Faster CI Research

<!-- Research findings for evaluating cost-reduction options for the GitHub Actions CI/nightly/post-deploy workflows. -->

## Problem Statement
Investigate ways to save on GitHub Actions cost. GitHub-hosted runners are the default but are expensive per-minute compared to several alternative providers. The repo currently runs a Full-Path CI on PRs to main, a 3-shard Full suite on PRs to production, daily nightly E2E against prod, and per-deploy smoke specs. Reducing per-minute cost or wall-clock time (or both) directly reduces monthly spend and developer-feedback latency.

## Requirements (from GH Issue #1309)
Look into Blacksmith pricing (https://www.blacksmith.sh/pricing) and other options:
- Blacksmith / Depot / BuildJet / RunsOn / Ubicloud / WarpBuild (managed drop-in GHA runners)
- Self-hosted on minicomputer or cheap cloud VMs
- GitHub larger runners (4-core / 8-core)
- Workflow-level optimizations (change detection, sharding, cache reuse, dropping redundant runs)

For each: $/min vs GitHub-hosted, claimed speedup, setup effort, lock-in risk, compatibility (secrets, Docker, Playwright, migrations), annual savings estimate.

## High Level Summary

**Repo is private** (`gh api repos/Minddojo/explainanything → "private": true, "visibility": "private"`), so GitHub-hosted minutes are billable — the investigation is valid.

**Three findings dominate the picture:**

1. **Total spend is modest.** A 14-day workflow-runs sample (1000 runs hit the pagination cap on 2026-06-14 → 2026-06-28) shows ~1,275 min of wall-clock time. Scaling by the ~1.93× job-fanout multiplier seen in a real CI run (37 billable min for 19 min wall-clock with 11 parallel jobs) gives a **conservative monthly estimate of ~4,800–5,500 billable minutes/month**. At GitHub-hosted Linux 2-core ($0.006/min) that's **~$29–33/month** *before* any free-tier credit. A GitHub Team plan includes 3,000 free min/month, so net spend may be **~$11–15/month** today.

2. **Drop-in alternatives offer modest per-minute savings.** Blacksmith / Depot / BuildJet all list **$0.004/min for 2vCPU Ubuntu** — 33% per-minute savings vs GitHub's $0.006/min. Blacksmith and BuildJet additionally claim 2× speedup (Blacksmith's "67% total savings" pitch); Depot pairs runners with a build cache. **Realistic annual savings at our volume: $100–250/year** — material but not large.

3. **Bigger wins are workflow-level, not vendor-level.** Two findings stand out:
   - **`post-deploy-smoke.yml` fires 870 times in 14 days, of which 831 are skipped.** Each skipped run is ~3 sec of inert dispatch, but the sheer count (13× more invocations than CI) signals the `deployment_status` trigger is misconfigured (environments.md explicitly calls this trigger "an inert secondary" preserved for compatibility). Removing it would eliminate ~1,800 skipped runs/month with no coverage loss.
   - **GitHub Actions cache is at ~10.6 GB / 88 entries** — at or above the 10 GB free-tier per-repo cap (Team is 10 GB unless purchased), so cache eviction is silently inflating cold-cache build time.

**Recommendation direction (to be confirmed in /plan-review):**
- Phase 3 (workflow-level cleanup) should land first — likely larger savings than a runner swap and zero vendor risk.
- If a vendor swap is still worth it after Phase 3, pilot **Blacksmith** on the highest-cost job (`e2e-evolution` — 990 sec / 16.5 min in the sampled CI run). Measure observed speedup vs claimed.
- **Self-hosted on minicomputer is not recommended** — the minicomputer already runs the evolution-runner systemd timer + maintenance scheduler; adding CI load could destabilize evolution runs and complicate the runner-pulled-stale-code failure mode (see memory `project_minicomputer_no_auto_pull`).

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md — GitHub Actions section, secrets organization, branch-protection rules
- docs/docs_overall/testing_overview.md — Four-tier strategy, CI vs nightly vs smoke comparison
- docs/feature_deep_dives/testing_setup.md — Cache strategy (tsc + jest + .next/cache), `--changedSince` for unit, build-step decoupling (Rule 21)
- docs/docs_overall/debugging.md

### Relevant Docs (carried in `_status.json`)
- evolution/docs/cost_optimization.md — Evolution LLM cost model (not CI, but documents the project's cost-tracking philosophy)
- evolution/docs/minicomputer_deployment.md — Self-hosted-runner-on-minicomputer prior art; warns runner does NOT auto-pull main (relevant for Option E)
- evolution/docs/architecture.md (partial)
- evolution/docs/data_model.md (partial)
- evolution/docs/reference.md (partial)

## Code Files Read
- `.github/workflows/ci.yml` (745 lines, 16 jobs) — the main CI workflow. Key structure:
  - 2 phase classifier in `detect-changes`: `fast` (docs-only) / `evolution-only` / `non-evolution-only` / `full`
  - Concurrency group with `cancel-in-progress: true` (de-dupes pushes) ✓
  - Most jobs `runs-on: ubuntu-latest`; no use of larger / ARM runners
  - `e2e-non-evolution` is sharded `[1, 2, 3]` (3 shards, not 4 as planning doc assumed)
  - `e2e-evolution` is `max-parallel: 1` (single-row matrix; serial preserved for future test-data race avoidance)
  - All E2E jobs have `timeout-minutes: 30`
- `.github/workflows/e2e-nightly.yml` (319 lines) — daily 06:00 UTC against live production, `timeout-minutes: 45`
- `.github/workflows/post-deploy-smoke.yml` (244 lines) — triggers: `push: [production]` + `workflow_dispatch` + `deployment_status` (the misconfigured one); 2-row matrix per hostname
- `.github/workflows/supabase-migrations.yml` (390 lines) — 5 jobs: 3 lint gates + 2 deploy jobs (staging + production)
- `.github/workflows/e2e-real-ai-smoke.yml` (105) — daily 06:30 UTC, `timeout-minutes: 30`, gates real-AI smoke
- `.github/workflows/evolution-{cost-alarm,nightly-smoke,run-health,test-data-cleanup,tracking-reconciliation}.yml` — all scheduled, all 10–25 min timeouts
- `.github/workflows/verify-seed-reuse.yml` (50) — workflow_dispatch only; small
- `playwright.config.ts:95-99` — `fullyParallel: isProduction ? false : true; workers: process.env.CI ? 2 : 3`. The production-target E2E runs **serial** to avoid rate-limiting against live prod Supabase — a faster runner will NOT speed this up; only the staging-target jobs benefit from CPU upgrades.
- `package.json` scripts:
  - `test:e2e:critical` = `chromium-critical + chromium-unauth` projects only
  - `test:e2e:evolution` = `--grep=@evolution`
  - `test:e2e:non-evolution` = `--grep-invert="@evolution|@skip-prod"`
  - All unit tests use `--maxWorkers=2` on CI

## Key Findings

### 1. Repo is private; investigation is valid
`gh api repos/Minddojo/explainanything` returns `{"visibility": "private", "private": true}`. The default GitHub-hosted Linux 2-core rate is $0.006/min for private repos (per docs/billing/reference/actions-runner-pricing). ARM x64-equivalent is **$0.005/min** (17% cheaper on GitHub itself, no vendor swap needed).

### 2. 14-day workflow-run baseline (1000-row sample, 2026-06-14 → 2026-06-28)

| Workflow | Runs | Wall-clock total | Skipped | Cancelled | Failed |
|---|---:|---:|---:|---:|---:|
| **CI** | 66 | **1,038 min** | 0 | 6 | 22 |
| Post-Deploy Smoke Tests | 870 | 46 min | **831** | 39 | 0 |
| E2E Nightly (Production) | 5 | 93 min | 0 | 0 | 2 |
| Deploy Supabase Migrations | 35 | 35 min | 0 | 0 | 6 |
| E2E Real-AI Smoke | 5 | 42 min | 0 | 0 | 0 |
| Evolution Test Cost Alarm | 5 | 5 min | 0 | 0 | 0 |
| Evolution Run Health | 5 | 5 min | 0 | 0 | 0 |
| Evolution Nightly Smoke | 5 | 5 min | 0 | 0 | 0 |
| Evolution Tracking Reconciliation | 4 | 4 min | 0 | 0 | 4 |
| **TOTAL wall-clock** | 1,000 | **~1,273 min** | 831 | 51 | 34 |

The 1000-row pagination cap was hit, so this is a **lower bound** for that window.

### 3. Wall-clock undercounts billable minutes ~1.93×

Sample: CI run id `28335187356` (PR to main, full path, success) had **15 jobs**, of which 11 ran (4 were skipped because target was `main` not `production`):
- Wall-clock: 19m 15s (20:35:48 → 20:55:03)
- Billable: ~36.6 min sum of job durations
- **Multiplier: 1.93×**

Per-job durations (longest first):
- E2E Tests (Evolution - chromium): **16.5 min** ← longest single job
- Integration Tests (Evolution): 9.3 min
- E2E Tests (Critical): 5.1 min
- Integration Tests (Critical): 1.8 min
- Unit Tests: 1.0 min
- Lint: 1.2 min
- TypeScript Check: 0.9 min
- Everything else: < 30 sec

The evolution E2E job is **far and away the cost driver**, both in absolute minutes and in wall-clock blocking time.

### 4. Monthly billable estimate

Applying the 1.93× multiplier to the 14-day CI total and scaling to 30 days:
- CI: 1,038 × 1.93 × (30/14) ≈ **~4,300 min/month**
- Everything else (wall-clock total ~235 min × ~1.2× since most have 1-2 jobs × 30/14): **~600 min/month**
- **Total: ~4,900 billable min/month**

At GitHub-hosted x64 2-core ($0.006/min): **~$29/month**
- Less ~3,000 free min (Team plan): **~$11/month overage**
- *Caveat*: free-tier consumption is unverified — would need `gh api ... /settings/billing/actions` (returned 404 for our PAT, so admin scope needed).

### 5. Vendor pricing comparison (Ubuntu 2vCPU drop-in)

| Vendor | $/min | Free tier | Claimed speedup | Notes |
|---|---:|---|---|---|
| **GitHub-hosted x64 2-core** | $0.006 | 3,000 min/mo (Team) | 1× baseline | Status quo |
| GitHub-hosted ARM 2-core | $0.005 | Same | Often comparable | `runs-on: ubuntu-24.04-arm` — zero vendor swap, 17% cheaper |
| **Blacksmith** | $0.004 | 3,000 min/mo | 2× ("67% total savings") | `runs-on: blacksmith-2vcpu-ubuntu-2204`. Docker layer cache add-on $0.50/GB/mo. |
| **Depot** | $0.004 | (plan-included min) | No explicit GHA speedup claim | `runs-on: depot-ubuntu-24.04`. Build cache $0.20/GB/mo separately. |
| **BuildJet** | $0.004 | $5 one-time credit | "Half the price of GitHub" | `runs-on: buildjet-2vcpu-ubuntu-2204`. Default 64 vCPU concurrency. |
| GitHub larger 4-core x64 | $0.012 | — | ~2× on CPU-bound | `runs-on: linux_4_core`. Free min do NOT apply. |
| GitHub larger 8-core x64 | $0.022 | — | ~3-4× on CPU-bound | Cost climbs faster than savings for IO-bound work. |

**The key uncertainty**: claimed 2× speed only materializes if jobs are CPU-bound. Our longest jobs are E2E (Playwright + serial mode for production target + waits for Supabase) and Integration (real DB roundtrips). Both are **largely IO-bound**, so observed speedup will likely be **1.2–1.5×, not 2×**.

### 6. Hidden waste: 870 Post-Deploy Smoke runs / 14 days

`post-deploy-smoke.yml` has THREE triggers:
- `push: [production]` — real coverage (1× per prod release)
- `workflow_dispatch` — manual
- `deployment_status` — fires on EVERY Vercel deploy event (preview branches included), all filtered by `if: state==success && environment==Production && target_url contains vercel.app` → **831/870 = 95.5% skipped**

environments.md acknowledges this:
> The original `deployment_status` trigger is retained only as an inert secondary — GitHub anti-recursion drops the `GITHUB_TOKEN`-created Vercel deployment status, so it never fired a workflow run

The `push:[production]` trigger replaced its function. The `deployment_status` trigger is dead weight. **Per-skipped-run billable time is ~3 sec, but 1,800+ skipped runs/month adds ~90 min/month of pure dispatch waste** plus heavy noise in the Actions tab (obscures real failures).

### 7. Cache is near the cap

`gh api repos/Minddojo/explainanything/actions/cache/usage` returns:
- `active_caches_size_in_bytes: 10,648,350,683` (~10.6 GB)
- `active_caches_count: 88`

GitHub's per-repo cache cap is 10 GB on free plans (Team is 10 GB by default; can be upgraded). **We're at the cap**, so cache eviction is happening silently. Every CI job that needs a previously cached `.next/cache`, `tsbuildinfo`, or `~/.cache/ms-playwright` may be paying a cold-start tax. Direct impact on the speed-multiplier claim: vendor speedups assume warm cache.

### 8. Production E2E is bottlenecked by serial Playwright, not CPU

`playwright.config.ts:96` — `fullyParallel: isProduction ? false : true`. When CI targets `production`, the 3-shard non-evolution suite + the evolution suite all run **serial within their shard** to avoid rate-limiting prod Supabase. A faster runner CANNOT compress this — it's wall-time-on-network bound.

### 9. Concurrency groups vary by workflow

- `ci.yml` ✓ has `concurrency.cancel-in-progress: true` (de-dupes pushes within a PR)
- `post-deploy-smoke.yml` has `cancel-in-progress: false` (intentional — multiple deploy events to same SHA each get a run)
- `e2e-nightly.yml`, `e2e-real-ai-smoke.yml`, evolution-* scheduled workflows have NO concurrency group → if a manual `workflow_dispatch` overlaps a scheduled run, both proceed

## Open Questions

1. **Do we have a GitHub Team or Enterprise plan?** Free tier varies (Team = 3,000 min/mo; Enterprise = 50,000). The `gh api ... /settings/billing/actions` endpoint returned 404 — our PAT lacks the required admin scope. Need user to either run that locally or share the plan tier.
2. **What's the observed CI failure-rate / re-run rate?** The 14-day window shows 22 failures + 6 cancels out of 66 CI runs (42% non-success). Re-runs multiply cost. If many failures are pre-existing flake, fixing flakes might be cheaper than swapping runners.
3. **Is the minicomputer's spare capacity actually usable for self-hosted runners?** It already runs evolution-runner systemd timer + maintenance scheduler. Adding CI load risks destabilizing evolution runs. Worth asking before pursuing Option E.
4. **What ARM-incompatible deps are in `package.json`?** Several native modules (`@swc/core`, `sharp`, `next-swc`) historically had ARM gaps. If clean, GitHub ARM ($0.005/min) is the lowest-risk win — same vendor, just a different `runs-on:` label.
5. **Should we drop the `evolution-tracking-reconciliation` workflow?** 4 of 4 runs in the sample window failed (100% failure rate). It's running but not producing useful signal.

## Assessment of completeness

- [x] Problem clearly understood
- [x] All 11 workflows inventoried
- [x] Current baseline measured (with caveats: 1000-row sample cap, multiplier estimated from one run)
- [x] Cost driver identified (CI workflow, dominated by Evolution E2E job)
- [x] Vendor pricing compared
- [x] Hidden waste catalogued (post-deploy-smoke deployment_status trigger, cache at cap)
- [x] Enough context to begin Phase 2 (vendor comparison matrix) and Phase 3 (workflow-level wins)
- [ ] Free-tier consumption unknown (requires admin scope on gh PAT)
- [ ] ARM compatibility unverified
