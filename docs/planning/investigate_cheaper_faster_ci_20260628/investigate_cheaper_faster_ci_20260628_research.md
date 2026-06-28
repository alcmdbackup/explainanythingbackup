# Investigate Cheaper Faster CI Research

<!-- Research findings for evaluating cost-reduction options for the GitHub Actions CI/nightly/post-deploy workflows. -->

## Problem Statement
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

## High Level Summary
*(To be populated during /research execution.)*

Initial scope: the repo has three CI workflow families — `ci.yml` (PRs), `e2e-nightly.yml` (daily), `post-deploy-smoke.yml` (every prod deploy) — plus a `supabase-migrations.yml` deploy job and `evolution-run-health.yml` daily detector. All run on `ubuntu-latest` (GitHub-hosted). The dominant minute-consumers are PR CI (run on every push to every PR) and the production-PR full E2E (4 shards × ~5 min). Nightly + post-deploy are low-frequency. We already minimize cost via change detection (fast-path lint+tsc only when only docs change), `--changedSince` unit tests, parallelization, build caching, and shard timeouts.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs
- evolution/docs/cost_optimization.md — Evolution pipeline cost model (LLM, not CI), but documents the project's general approach to cost gating and kill switches.
- evolution/docs/minicomputer_deployment.md — Existing self-hosted compute pattern (systemd + tmux); evidence that the team is already comfortable running a "minicomputer" outside Vercel. A GHA self-hosted runner could co-exist here.
- evolution/docs/architecture.md (partial) — Pipeline structure context.
- evolution/docs/data_model.md (partial) — Cost tracking schema context.
- evolution/docs/reference.md (partial) — Env-var and CLI conventions.

## Code Files Read
*(To be populated during /research execution. Will include `.github/workflows/*.yml`, `playwright.config.ts`, `jest.config.js`, `jest.integration.config.js`, `scripts/lint-migrations-idempotent.ts`, `package.json`.)*
