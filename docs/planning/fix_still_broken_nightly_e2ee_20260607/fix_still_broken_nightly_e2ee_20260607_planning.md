# Fix Still Broken Nightly E2EE Plan

## Background
Nightly E2E is still broken despite recent attempts to fix it. Multiple prior projects shipped structural fixes (Firefox `safeGoto`/`NS_BINDING_ABORTED`, the `e2e-evolution` Firefox PR matrix, auto-filed `[release-health]` issues, the `/mainToProd` nightly-red precheck) yet the nightly run keeps failing. This project investigates why those attempts have not worked and lands the proper fix.

## Requirements (from GH Issue #1175)
Please look at GH history and see why recent attempts to fix nightly E2E have not worked, and then investigate the proper fix to now make them work.

## Problem
Research (3 rounds × 4 agents, see `_research.md`) **disproved the starting hypothesis**: the prior nightly fixes ARE on `production` (byte-identical with `main`, shipped via PR #1146 on 2026-05-31) and they **worked** — nightly was green 2026-06-01→06-06. The "still broken" is a SINGLE red night (2026-06-07) with a different, ops-level cause: **OpenAI account-level quota 429** (`429 You exceeded your current quota`), triggered by the **Judge Lab batch-eval feature (#1170)** draining the **shared `OPENAI_API_KEY`** (staging 429'd 6.5h before prod with the same `Seed generation failed` signature). The quota has since recovered (live probe returns 200).

The real durable problem is **structural**: exactly 3 real-AI-dependent specs (`action-buttons.spec.ts` Save flow `@critical`; `admin-evolution-run-pipeline` + `admin-evolution-iterative-editing` `@evolution`) sit in the **blocking** nightly path. Any OpenAI outage/quota event therefore reds the whole nightly and looks like a code regression. These were already retry-masked-flaky on 3 of 6 "green" nights. The `@prod-ai` tag is the intended isolation lever but is **inert** (not applied to these specs, not honored by the nightly grep).

## Options Considered
- [ ] **Option A: Ops-only (refill OpenAI quota)**: Top up / raise the OpenAI account monthly limit and isolate the Judge Lab batch tool onto a separate key/budget. Fixes the immediate red night but does NOT stop the next quota blip from reding the blocking nightly. Necessary but insufficient.
- [ ] **Option B (RECOMMENDED): Structural — move real-AI specs out of the blocking path**: Tag the 3 real-AI specs `@prod-ai`; exclude `@prod-ai` from the blocking legs via the single-regex `--grep-invert="@skip-prod|@prod-ai"` (Playwright does NOT support repeated `--grep-invert`); run `@prod-ai` in a separate `continue-on-error` job WITH its own informational alert (the existing `notify-release-health`/Slack won't fire on a non-blocking job). Refactor the `action-buttons` `@critical` save test to use a seeded fixture (pattern already in-file) so the critical signal (save UI/API) stays deterministic-blocking. This would have made 06-07 green.
- [ ] **Option C (RECOMMENDED, pairs with B): Harden detection + audit**: Add a fail-fast AI/quota health probe BEFORE the real-AI lane so "AI infra down (ops)" is distinguishable from "tests broke (code)"; convert the hardcoded 8-file `@skip-prod` audit to a dynamic scan targeting **prod-nonexistent/test-only endpoints** (not all `page.route`), and tag the already-untagged `admin-evolution-prompt-editor.spec.ts` before it hits the next prod release.
- [ ] **Option D (smaller follow-ups)**: Surface the real LLM error onto `evolution_runs.error_message` (currently generic "Seed generation failed"; the 429 lives only in `evolution_logs`); stop classifying `insufficient_quota` 429 as a retryable transient; single-source the duplicated prod evolution host string.

**Likely plan = A (ops, immediate) + B + C (durable structural).** D items are low-cost hardening to fold in.

## Phased Execution Plan

### Phase 1: Forensics (read-only) — ✅ COMPLETE (see `_research.md`)
- [x] Pulled last ~15 nightly runs; conclusion+date per run (green 06-01→06-06, red 06-07; May 24–31 separate fixed episode).
- [x] Extracted the 06-07 failing specs, browser, and error class (run 27086143604; 3 specs, both browsers, AI-service errors).
- [x] Reviewed prior nightly-fix PRs (#1141, #1146, #1081, #1124) — confirmed shipped + promoted to production 2026-05-31.
- [x] `git diff origin/production..origin/main` on nightly paths — prior fixes byte-identical on both branches (hypothesis disproven).
- [x] Checked `[release-health]` issues (#1145, #1172) + confirmed OpenAI 429 quota cause via prod DB/logs; `VERCEL_AUTOMATION_BYPASS_SECRET` valid.

### Phase 2: Ops fix (immediate)
- [ ] Confirm OpenAI account billing/quota is topped up and current (probe already returns 200). Surface the account owner if action is needed.
- [ ] Isolate the Judge Lab batch tool onto a separate OpenAI key or hard budget so a sweep can't starve nightly/staging again (or confirm #1171's seed cap is sufficient).

### Phase 3: Structural fix (durable) — code/config
- [ ] Tag the 3 real-AI specs `@prod-ai` (triage `admin-evolution-debate`/`-cost-estimates-tab`/`strategy-wizard-tactics` for live-AI use; add if confirmed).
- [ ] `e2e-nightly.yml`: change blocking legs to `--grep-invert="@skip-prod|@prod-ai"`; add a non-blocking (`continue-on-error`) `@prod-ai` job with its OWN step-outcome-gated informational alert.
- [ ] Refactor `action-buttons.spec.ts:40` save test to a seeded fixture (`createTestExplanationInLibrary`) so `@critical` stays deterministic; move the live search+stream variant to `@prod-ai`.
- [ ] Add a fail-fast AI/quota health probe before the real-AI lane (distinct ops-vs-code alert).
- [ ] Convert the `@skip-prod` BLOCKING audit to a dynamic scan (target prod-nonexistent/test-only endpoints, allow-list client `page.route` mocks); tag `admin-evolution-prompt-editor.spec.ts`.
- [ ] (Option D) Surface real LLM error onto `evolution_runs.error_message`; stop retrying `insufficient_quota`; single-source the prod evolution host string.

### Phase 4: Verify + harden
- [ ] Run the affected specs locally (Chromium; Firefox where relevant) to confirm the deterministic refactors pass without live AI.
- [ ] Trigger `e2e-nightly.yml` via `workflow_dispatch` and confirm the BLOCKING legs are green (the `@prod-ai` lane may stay red until quota is fully topped up — that's the intended non-blocking behavior).
- [ ] Update memory [[project_evolution_e2e_openai_quota]] with the structural fix + the `@prod-ai`-not-honored detail + the Judge Lab shared-key spike mechanism.

## Testing

### Unit Tests
- [ ] [TBD after diagnosis — only if the fix touches unit-tested code]

### Integration Tests
- [ ] [TBD after diagnosis]

### E2E Tests
- [ ] `src/__tests__/e2e/specs/**` — the specific specs identified as failing in nightly; run locally (`npm run test:e2e`) on Chromium, and Firefox where the failure is Firefox-specific.

### Manual Verification
- [ ] Trigger `e2e-nightly.yml` via `workflow_dispatch` and confirm a green run end-to-end (both browsers).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run the affected E2E specs against a local server via `npm run test:e2e` (Chromium; Firefox for Firefox-specific failures). N/A if the fix is purely workflow/ops config.

### B) Automated Tests
- [ ] `gh run watch <nightly-dispatch-id>` after a manual `workflow_dispatch` — confirm the nightly job concludes `success` on both browsers.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/environments.md` — nightly workflow / release-cadence / `[release-health]` sections, if the cause is process-related (likely).
- [ ] `docs/docs_overall/testing_overview.md` + `docs/feature_deep_dives/testing_setup.md` — nightly behavior, `@skip-prod`/`safeGoto`/Firefox-matrix notes, if specs/config change.
- [ ] `evolution/docs/reference.md` / `evolution/docs/architecture.md` — only if the fix touches evolution pipeline or its E2E specs.
- [ ] (Remaining evolution docs are tracked for context per project scope; update only those actually affected.)

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
