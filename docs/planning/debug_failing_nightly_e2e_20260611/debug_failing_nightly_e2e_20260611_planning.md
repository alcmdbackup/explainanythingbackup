# Debug Failing Nightly E2E Plan

## Background
Figure out why the last nightly E2E run failed. Nightly E2E (`.github/workflows/e2e-nightly.yml`) runs at 06:00 UTC against live prod, uses real AI, and tests Chromium + Firefox across both hostnames. The most recent failure is 2026-06-07 (run `27086143604`) — all four matrix jobs failed; the 4 nights since (06-08 through 06-11) are green. The streak of post-failure greens suggests someone already patched it; investigation should also identify the fix so we capture the lesson before closing.

## Requirements (from GH Issue #1199)
figure out why last nightly e2e failed

## Problem
The 2026-06-07 nightly failed across the full matrix (Chromium+Firefox × public+evolution). Annotations are inaccessible via the current PAT, so root cause must be reconstructed from job logs, the auto-filed `[release-health]` issue, and the run's Playwright report artifacts. Once root cause is identified, we need to verify that whatever change made nights 06-08+ green is a durable fix (not an environmental flake that could recur) and write up the postmortem so the next nightly red surfaces faster.

## Options Considered
- [ ] **Option A: Log-first forensics** — Pull the failed jobs' logs, parse for first error per job, classify (cross-cutting vs per-spec), then bisect git history between 06-06 and 06-08 to find the regression-and-fix pair. Pros: deterministic, hits root cause. Cons: log download / parsing time.
- [ ] **Option B: Reproduce locally via `@smoke` + nightly grep** — Check out the 06-07 commit on `production` and re-run the failing specs locally against prod with `RUN_PROD_AI=1`. Pros: confirms repro before claiming a cause. Cons: burns real-AI spend; some failures (deploy state, env var rotation) won't repro locally.
- [ ] **Option C: Assume known-cause + write up runbook** — Pattern-match against known nightly failure modes (OpenAI 429, Firefox `NS_BINDING_ABORTED`, Vercel bypass cookie, deploy state) using memory + recent docs, write a triage runbook, close. Pros: cheap. Cons: leaves the actual 06-07 root cause unverified — explicitly rejected as the primary path.

## Phased Execution Plan

### Phase 1: Triage the 2026-06-07 failure
- [ ] Pull job logs for run `27086143604` (4 failed jobs) via `gh run view 27086143604 --log-failed > /tmp/nightly_27086143604_failed.log`, or per-job `gh api repos/Minddojo/explainanything/actions/jobs/<job_id>/logs`.
- [ ] Pull the auto-filed `[release-health] Nightly E2E failed — 2026-06-07` GitHub issue body — `gh issue list --label release-health --search "2026-06-07"`.
- [ ] Extract the first failing test + error message per matrix job. Note whether the 4 failures share a root cause (cross-cutting) or are distinct (per-spec coincidence).
- [ ] Check the Playwright report artifact on the run (`gh run download 27086143604`) for HAR / screenshots / trace.

### Phase 2: Classify root cause
- [ ] Map the failure signature against known modes:
  - OpenAI 429 quota — look for "Seed generation failed" / "rate_limit_exceeded" / "insufficient_quota"
  - Vercel deploy state — look for HTTP 500 / 404 / health check failures pre-spec
  - Vercel automation bypass — look for redirect-to-login / Vercel SSO interstitial
  - Firefox `NS_BINDING_ABORTED` — look for the abort signature; both browsers failed though, so unlikely
  - Test creds / guest password drift — `TEST_USER_*` or guest auto-login failures
  - Recent workflow / config regression — diff `e2e-nightly.yml`, `playwright.config.ts`, smoke specs, admin POMs between `2026-06-06..2026-06-08`
- [ ] Pick the most-likely cause and identify supporting evidence.

### Phase 3: Identify the fix
- [ ] `git log --oneline --since 2026-06-07 --until 2026-06-09` on `main` and `production` to find commits between the failure and the first green night.
- [ ] Inspect PRs merged 06-07 → 06-08 for fixes touching nightly-related code/config (workflow file, Playwright config, smoke / @critical / @evolution specs, deploy / env-var changes).
- [ ] If no obvious fix landed: the failure was environmental (provider outage, quota window, transient deploy). Document and move to Phase 4.

### Phase 4: Postmortem + runbook
- [ ] Write a short postmortem in `_progress.md`: timeline, root cause, fix (or "environmental, no code change"), detection latency, what would have caught it sooner.
- [ ] If a missing detection signal is found, propose a follow-up issue (don't add it to this PR's scope — this project is debugging, not feature work).

## Testing

### Unit Tests
- [ ] None expected — this is a forensics project. If root cause is a code regression that didn't trip a unit test, propose the test in the postmortem follow-up.

### Integration Tests
- [ ] None expected.

### E2E Tests
- [ ] If root cause is per-spec and a fix is needed, re-run the specific failing spec locally via `npx playwright test <spec> --grep <test name>` and via the `@critical` / `@evolution` suites against the production URL with `RUN_PROD_AI=1` to mirror nightly conditions.

### Manual Verification
- [ ] After analysis: trigger a manual nightly via `gh workflow run e2e-nightly.yml` to confirm the fix holds and produce a fresh green run.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A unless a UI regression is identified; if so, run the offending spec headed locally.

### B) Automated Tests
- [ ] `npx playwright test --grep @critical` (against local server) if a `@critical` spec was implicated.
- [ ] `npx playwright test --grep @evolution` if an `@evolution` spec was implicated.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] docs/feature_deep_dives/debugging_skill.md — only if root cause exposes a missing pattern in the `/debug` skill's environment-aware tool suggestions.
- [ ] docs/feature_deep_dives/request_tracing_observability.md — only if the investigation uncovers a gap in requestId correlation across Sentry / Honeycomb / logs.
- [ ] evolution/docs/logging.md — only if the failure touched an evolution admin spec and its log/observability docs need a correction.
- [ ] docs/docs_overall/environments.md (Release-alert Slack channel section) — if the Slack alert / release-health issue surfaced too late and a process tweak should be documented.

## Review & Discussion
(Populated by `/plan-review` if/when run.)
