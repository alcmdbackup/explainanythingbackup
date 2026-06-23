# Look For CI Flakiness Stability Issues Research

## Problem Statement
Look at recent CI runs as well as `docs/docs_overall/testing_overview.md`, `docs/docs_overall/environments.md`, and `docs/feature_deep_dives/testing_setup.md` and look for ways to make tests less flaky and more reliable. Amend the testing overview if necessary with any new findings.

## Requirements (from GH Issue #NNN)
- Look at recent CI runs (GitHub Actions: `ci.yml`, `e2e-nightly.yml`, `post-deploy-smoke.yml`, `supabase-migrations.yml`) to identify recurring flakiness / stability patterns.
- Review the three named docs for existing flakiness rules and coverage gaps:
  - `docs/docs_overall/testing_overview.md`
  - `docs/docs_overall/environments.md`
  - `docs/feature_deep_dives/testing_setup.md`
- Look for concrete, systematic ways to make tests (unit / ESM / integration / E2E) less flaky and more reliable.
- Amend `docs/docs_overall/testing_overview.md` (and adjacent docs) if necessary with any new findings — prefer systematic + enforceable (ESLint rule / hook / CI check) mechanisms over one-off patches.

## High Level Summary
[To be populated during /research — analysis of recent CI run history + the named docs.]

Initial framing notes (pre-research):
- `testing_overview.md` already encodes 19 flakiness rules, most enforced by ESLint `flakiness/*` rules + hooks. New findings should slot into this rule/enforcement table rather than living as prose.
- Known stability surfaces to investigate from recent-run history: E2E retries masking real flakes (`retries: 2` in CI), `[TEST]`/`[TEST_EVO]` data cleanup races, per-worker temp-file collisions, hydration/streaming races, OpenRouter 402 / OpenAI 429 quota failures surfacing as "seed generation failed", nightly real-AI nondeterminism, post-deploy smoke health-check timing.
- Cloud/CI env reliability: Node `fetch()` proxy issue (`NODE_USE_ENV_PROXY=1`) is web-only but relevant to CI-vs-local divergence.

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

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/cloud_env.md — Claude Code web-env proxy/network issues affecting CI/E2E reliability
- docs/feature_deep_dives/error_handling.md — transient error classification + retry strategy (test robustness)
- docs/feature_deep_dives/request_tracing_observability.md — request-ID tracing for debugging intermittent failures

## Code Files Read
- [to be populated during /research]
