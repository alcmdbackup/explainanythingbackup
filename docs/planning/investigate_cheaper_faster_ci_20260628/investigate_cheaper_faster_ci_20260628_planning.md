# Investigate Cheaper Faster CI Plan

<!-- Implementation plan for evaluating and (optionally) adopting a cheaper/faster CI runner setup. -->

## Background
Investigate ways to save on GitHub Actions cost. GitHub-hosted runners are the default but are expensive per-minute compared to several alternative providers. The repo currently runs a Full-Path CI (~2.5–3 min) on PRs to main, a 4-shard Full suite on PRs to production (~5+ min), a daily nightly E2E against prod, and per-deploy smoke specs. Reducing per-minute cost or wall-clock time (or both) directly reduces monthly spend and developer-feedback latency.

## Requirements (from GH Issue #NNN)
Look into this link as well as other options:
- https://www.blacksmith.sh/pricing

Other options to evaluate include (non-exhaustive):
- Blacksmith (drop-in `runs-on: blacksmith-*` replacement, claims 2× faster + cheaper)
- Depot (managed GHA runners + remote build cache)
- BuildJet / RunsOn / Ubicloud (other GHA runner replacements)
- WarpBuild
- Self-hosted GHA runners on the existing minicomputer (zero per-minute cost; capacity-limited)
- Self-hosted via cheap cloud VMs (e.g. Hetzner)
- GitHub larger runners (4-core / 8-core) — sometimes faster end-to-end despite higher per-minute price
- Workflow-level optimizations (better change detection, more granular sharding, cache reuse, dropping redundant runs, killing duplicate triggers, skipping fast-path more aggressively)

For each option, capture:
- $/min vs GitHub-hosted
- Speedup vs GitHub-hosted (claimed and observed where available)
- Setup effort + lock-in risk
- Compatibility caveats (secrets, Docker-in-Docker, Playwright, supabase migrations job)
- Annual savings estimate at our current minutes/month

## Problem
Today the project runs all CI on GitHub-hosted `ubuntu-latest`. At a typical merge rate this generates non-trivial Actions minutes — heaviest on the production-target full E2E shards (4 × ~5 min), nightly, post-deploy smoke, and migration deploys. We don't currently have a baseline of $/month or minutes/month broken down per workflow, nor a comparison of what a drop-in alternative (Blacksmith, Depot, BuildJet, self-hosted) would cost and save. The goal of this project is to produce that comparison and either (a) adopt the best option or (b) document why staying on GitHub-hosted is correct.

## Options Considered
- [ ] **Option A: Blacksmith drop-in (`runs-on: blacksmith-2vcpu-ubuntu-2204` etc.)** — Lowest-effort migration. Claims ~2× speedup on Ubuntu jobs at lower per-minute price. Risk: vendor lock-in is light (single `runs-on:` line) but does add a dependency.
- [ ] **Option B: Depot managed runners + remote build cache** — Pairs the runner swap with Depot's persistent build cache, which can help Next.js + Playwright browser installs. Higher integration cost.
- [ ] **Option C: BuildJet / RunsOn / Ubicloud** — Similar drop-in shape to Blacksmith; comparison-shop on $/min + claimed speedup.
- [ ] **Option D: GitHub larger runners (4-core / 8-core)** — Stay on GitHub but upgrade the slowest jobs. Sometimes net-cheaper when wall-clock drops more than the per-minute multiplier rises.
- [ ] **Option E: Self-hosted runner on existing minicomputer** — Zero per-minute cost; but the minicomputer is already running the evolution-runner systemd timer + maintenance scheduler. Capacity-bound. Useful only if we can dedicate spare cores.
- [ ] **Option F: Self-hosted on a cheap cloud VM (Hetzner CCX13 / similar)** — Predictable monthly cost, low effort to provision; ops burden (security patches, runner registration, autoscaling) is the trade-off.
- [ ] **Option G: Workflow-level cost reduction only (no runner change)** — Tighten change detection, drop redundant nightly browsers, prune `@critical` suite, longer cache TTLs, kill duplicate workflows on `synchronize`. Often the cheapest quick-win.
- [ ] **Option H: Hybrid** — e.g. Blacksmith for the heavy production-shard job + GitHub-hosted for everything else, so a Blacksmith outage doesn't block PRs to main.

## Phased Execution Plan

### Phase 1: Baseline measurement
- [ ] Pull the last 30 days of workflow runs via `gh api repos/Minddojo/explainanything/actions/workflows` + `runs?per_page=100` and aggregate **minutes per workflow per branch target**. Output a single CSV in `docs/planning/investigate_cheaper_faster_ci_20260628/_baseline.csv`.
- [ ] Compute monthly **$ cost** at GitHub-hosted Ubuntu rate ($0.008/min for private repos as of 2026; verify current rate). Record in research doc.
- [ ] Identify the top 3 most-expensive workflow jobs and their wall-clock distribution (p50 / p95).
- [ ] Confirm whether `Minddojo/explainanything` is a public or private repo (public repos = $0 on GitHub-hosted Ubuntu, which would invalidate the whole investigation).

### Phase 2: Vendor comparison matrix
- [ ] Pull live pricing for: Blacksmith (https://www.blacksmith.sh/pricing), Depot, BuildJet, RunsOn, Ubicloud, GitHub larger runners. Write a table to the research doc with $/min, claimed speedup, and per-vendor caveats.
- [ ] For each vendor: identify the **drop-in `runs-on:` syntax** and whether secrets / docker / Playwright work unmodified.
- [ ] Estimate annual savings at our measured minutes/month, assuming the claimed speedup is real.
- [ ] Flag lock-in / outage-blast-radius for each.

### Phase 3: Workflow-level optimizations (Option G, low-risk wins regardless of vendor choice)
- [ ] Audit `ci.yml` for duplicate runs on the same SHA (PR `synchronize` + `push` triggers can fire twice). Add `concurrency.group` + `cancel-in-progress: true` where missing.
- [ ] Re-check the fast-path vs full-path classifier (`detect-changes` job) for any code paths that should NOT trigger full path (e.g. `evolution/docs/*` should be fast-path).
- [ ] Confirm the dedicated `npm run build` step + start-only `webServer` (Rule 21) is in place on every E2E job — under-provisioned webServer timeout was 20% of CI failures in June 2026.
- [ ] Validate the three caches (tsc incremental, jest transforms, `.next/cache`) actually hit on CI — measure cache hit rates via Actions logs.
- [ ] Check if any jobs install Playwright browsers fresh every run rather than restoring from cache.

### Phase 4: Pilot (only if Phase 2 picks a clear winner)
- [ ] Pick the highest-impact + lowest-risk job (likely the production-target full E2E shards) and switch its `runs-on:` to the pilot vendor on a feature branch.
- [ ] Run the pilot job 10 times to measure real-world wall-clock + reliability vs the claimed numbers. Record observed flake rate (Blacksmith etc. have had vendor-side outages).
- [ ] Compare measured speedup to claimed speedup. If observed < 1.3× the per-minute price ratio, abandon and stay on GitHub-hosted.

### Phase 5: Rollout (only if Phase 4 succeeds)
- [ ] Migrate remaining workflows in order of cost-per-month descending.
- [ ] Add a fallback `if: failure()` re-run on GitHub-hosted for the first 2 weeks so a vendor outage doesn't block merges.
- [ ] Update `docs/docs_overall/environments.md` GitHub Actions section + add a "CI vendor" note to `docs/docs_overall/architecture.md` if relevant.
- [ ] Add a monthly cost-report query script under `scripts/` that pulls Actions minutes and prints vendor breakdown.

## Testing

### Unit Tests
- [ ] None — this project changes CI infra, not application code. If a new helper script is added under `scripts/` (Phase 5), give it a `scripts/<name>.test.ts` smoke test.

### Integration Tests
- [ ] None — out of scope.

### E2E Tests
- [ ] No new specs. **Re-run the existing `@critical` suite on every workflow change** to confirm the new runner doesn't regress flakiness — Playwright tests are especially sensitive to runner CPU count and ulimits.

### Manual Verification
- [ ] After every `runs-on:` change, watch the **next 5 actual PRs** and compare wall-clock + failure rate vs the prior 5 PRs.
- [ ] Confirm `supabase-migrations.yml` (Docker-in-Docker for the ephemeral Postgres in `migration-verify-test`) still works on the alternative runner.
- [ ] Confirm secrets (staging + Production environment secrets, repository-level API keys) propagate identically on the new runner.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes. The Playwright E2E suite itself is the change-target; it's exercised by running CI itself.

### B) Automated Tests
- [ ] Phase 1: `gh run list --workflow=ci.yml --limit=100 --json conclusion,startedAt,updatedAt,jobs` (and friends) to gather baseline.
- [ ] Phase 4: trigger the pilot workflow 10 times via `gh workflow run <name> --ref <pilot-branch>` and inspect `gh run view <id> --json jobs,durationMs`.
- [ ] Phase 5: after each `runs-on:` migration, run `npm run typecheck && npm run lint` locally and let CI exercise the suite on the new runner.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/cost_optimization.md` — Add a brief note if a CI-runner change interacts with the evolution job pricing model (probably no overlap, but check).
- [ ] `evolution/docs/minicomputer_deployment.md` — If Option E (self-hosted runner on minicomputer) is chosen, add a section.
- [ ] `docs/docs_overall/environments.md` — GitHub Actions section needs to reflect the new `runs-on:` values + any vendor-specific env vars (NOT in `relevantDocs`, but covered by `.claude/doc-mapping.json` since workflow YAML changes will surface it).
- [ ] `docs/docs_overall/testing_overview.md` — Update CI workflow comparison tables if vendor changes (also doc-mapped).
- [ ] `CLAUDE.md` — Add nothing unless self-hosted runner introduces a workflow-bypass concern (unlikely).

## Review & Discussion
*(Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration.)*
