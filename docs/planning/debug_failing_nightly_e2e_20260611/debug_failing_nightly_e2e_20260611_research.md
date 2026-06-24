# Debug Failing Nightly E2E Research

## Problem Statement
Figure out why the last failing nightly E2E run failed. Most recent failure: **2026-06-07 run [27086143604](https://github.com/Minddojo/explainanything/actions/runs/27086143604)** — all four matrix jobs (chromium+firefox × public+evolution) failed simultaneously between ~07:34–08:17 UTC. The 4 nights since (06-08 → 06-11) are all green.

## Requirements (from GH Issue #1199)
figure out why last nightly e2e failed

## High Level Summary

**Root cause (very high confidence, already diagnosed pre-investigation):** OpenAI account-level 429 quota event during the nightly real-AI window, triggered by the Judge Lab #1170 batch sweep (merged 2026-06-06) draining the shared `OPENAI_API_KEY`. Staging hit the same 429 wall **6.5h before prod** (staging 01:07Z → prod 07:34Z) — a textbook shared-key early-warning signal that nobody saw because nightly is the only place that surfaces it.

This was already documented in `docs/planning/fix_still_broken_nightly_e2ee_20260607/` (PR #1177, merged 2026-06-08T02:01Z). A partial follow-up fix shipped in `docs/planning/reduce_e2e_openai_test_costs_20260607/` (PR #1179, merged 2026-06-08T14:25Z), but the structural exposure remains: deployed-prod nightly still calls real OpenAI on the prod model, so the same shared-key 429 path can red a future nightly.

**This investigation adds:** independent log forensics that confirm the prior diagnosis byte-for-byte, status verification of every recommendation from PR #1177, instrumentation-gap analysis explaining why the original diagnosis had to rely on indirect inference, and a detection-latency analysis of release-health issue #1172.

## Evidence

### Failure shape (from job logs — Round 1A)
All four matrix jobs failed at AI service boundaries; setup, health checks, auth, and bypass cookies were all clean.

| Job | First failing test | First error |
|---|---|---|
| chromium, public, `@critical` | `04-content-viewing/action-buttons.spec.ts:40` "should save explanation to library when save button clicked" | `Streaming failed: Error communicating with AI service` at `helpers/pages/ResultsPage.ts:88` |
| firefox, public, `@critical` | same | same (byte-identical) |
| chromium, evolution, `@evolution` | `09-admin/admin-evolution-iterative-editing.spec.ts:189` + `admin-evolution-run-pipeline.spec.ts:198` | `expect.poll(evolution_runs.status).toBe("completed")` — received `"failed"`, 300s/120s timeout |
| firefox, evolution, `@evolution` | same | same |

The public-side message `"Error communicating with AI service"` is produced by `src/lib/errorHandling.ts:69-74`, which maps any error whose message contains `"api"` or `"openai"` to the generic `LLM_API_ERROR` code → that user-facing string. The raw 429 body is discarded at this boundary, which is why all four jobs looked like distinct symptoms of the same upstream event.

### Prod-DB evidence (from Round 2C)
Querying production via `npm run query:prod` for `evolution_runs` rows created 2026-06-07 07:00–09:00 UTC returned **8 runs, all failed**:

```
status='failed'
error_code='missing_seed_article'
error_message='Seed generation failed'
error_details=NULL  ← instrumentation gap (see below)
failed_at_iteration=NULL  (failed before iteration 0 — at seed-gen)
```

Control comparison, same 07–09 UTC window on neighboring days:
- 2026-06-06: 2 runs, both completed
- **2026-06-07: 8 runs, all failed** (volume spike consistent with E2E retries hitting throttled API)
- 2026-06-08: 2 runs, both completed
- 2026-06-09: 1 run, completed

`evolution_logs.context.error` (per the PR #1177 forensics doc) recorded the literal 429 body 8 times between 07:34–08:17 UTC:
> `429 You exceeded your current quota, please check your plan and billing details. ... https://platform.openai.com/docs/guides/error-codes/api-errors`

### Temporal context (from Round 1C)
2026-06-07 was a **single-night spike**, not part of a streak. The nightly history shows:
- 2026-04-13 → 2026-05-31: 49 consecutive red nights (the "62-day silent prod-schema drift" era, resolved by PR #1074)
- 2026-06-01 → 2026-06-06: 6 green nights
- **2026-06-07: red** (the one investigated)
- 2026-06-08 → 2026-06-11: 4 green nights, no human intervention visible in the run list (no `workflow_dispatch` reruns)

No companion failures on either side. The 06-08 recovery was the OpenAI quota window cycling, not a code fix.

### Pattern survey of prior nightly investigations (from Round 3A)
Six prior nightly investigation folders exist; each documented a **distinct mode**:

| Date | Mode | Fix |
|---|---|---|
| 2026-01-14 | DB migration: search_path empty on non-SECURITY-DEFINER procs | `ALTER FUNCTION ... RESET search_path` |
| 2026-03-01 | Test-infra config drift: `@skip-prod` moved to config-only, nightly checks out production (30 commits behind) | restore CLI `--grep-invert` |
| 2026-05-23 | 73 unapplied prod migrations + smoke hostname classify regression | PR #1074 + pinned base_url |
| 2026-05-30 | Firefox `NS_BINDING_ABORTED` on chained `page.goto` from `useEffect` fetches | `safe-goto.ts` wrapper + Firefox-in-PR-CI gate |
| **2026-06-07** | **OpenAI shared-key 429 quota event** | **PR #1177 forensics + PR #1179 partial mitigation** |

06-07 is best described as the **first occurrence of a previously-named-but-unmitigated mode** — the mode was anticipated (memory note `project_evolution_e2e_openai_quota.md` predates it), the mitigations were designed (`@prod-ai` lane in `testing_overview.md`), but none had actually shipped to gate the 3 risky specs off the blocking path.

## Fix-completeness status (from Round 3B)

PR #1177's recommendations vs current state on `feat/debug_failing_nightly_e2e_20260611` (which is off `origin/main` from 2026-06-10):

| Recommendation | Status | Evidence |
|---|---|---|
| Move 3 risky specs to `@prod-ai` non-blocking lane | **NOT shipped** | `action-buttons.spec.ts:40` still `@critical` only; `admin-evolution-iterative-editing.spec.ts:33,332` + `admin-evolution-run-pipeline.spec.ts:19` still `@evolution` only |
| Nightly `--grep-invert="@skip-prod\|@prod-ai"` | **NOT shipped** | `e2e-nightly.yml:188` still `--grep-invert="@skip-prod"` |
| Refactor `action-buttons.spec.ts:40` to seeded fixture | **NOT shipped** | Test still does live `search → waitForStreamingComplete` against prod |
| Fail-fast quota probe in nightly | **partial** | `check-daily-llm-budget.ts` runs in `e2e-real-ai-smoke.yml` (the new cheap-model lane) only, NOT in the blocking `e2e-nightly.yml` |
| Persist raw LLM error to `evolution_runs.error_details` | **NOT shipped** | `claimAndExecuteRun.ts:362` still calls `markRunFailed(..., 'Seed generation failed', 'missing_seed_article')` with no `errorDetails` arg |
| Drop firefox from nightly matrix | **shipped** | `e2e-nightly.yml:30-32` (chromium-only via PR #1179) |
| Mock PR-CI evolution seed-gen | **shipped** | `generateSeedArticle.ts:115` early-returns under `E2E_TEST_MODE` |
| Cheap-Gemini smoke lane | **shipped** | `e2e-real-ai-smoke.yml` (new, non-blocking) |
| Isolate prod OpenAI key from Judge Lab batch traffic | **out-of-band ops** | `e2e-nightly.yml:50` + `e2e-real-ai-smoke.yml:41` still use the same `OPENAI_API_KEY` |

**Net assessment:** if the shared OpenAI key 429s during nightly hours again today, **the 2026-06-11 codebase + workflow would still red the nightly the same way**. PR #1179 reduced *aggregate* real-AI burn (firefox dropped, PR-CI mocked, cheap smoke lane added) but did not move any of the 3 risky specs off the blocking deployed-prod path.

## Instrumentation gap (from Round 3C)

The 06-07 investigation took hours because the 429 body was caught and discarded at four points before reaching `evolution_runs.error_details`:

1. `evolution/src/lib/pipeline/setup/generateSeedArticle.ts:125-128, 134-137` — `withTimeout(llm.complete(...))` lets the 429 throw as a plain `Error`, dropping `error.status`/`error.headers`/`error.response.data`.
2. `evolution/src/lib/core/agents/createSeedArticle.ts:125-130, 140-145` — agent catches with `err.message.slice(0, 500)` stuffed into `detail.generation.error`. That detail rides on the `evolution_agent_invocations` row, never the `evolution_runs` row.
3. `evolution/src/lib/core/Agent.ts:212-216` — for non-budget errors, `agent.run()` returns `{ success: false, result: null, ... }`; the original error is intentionally stripped.
4. `evolution/src/lib/pipeline/claimAndExecuteRun.ts:362` — `markRunFailed(db, runId, 'Seed generation failed', 'missing_seed_article')` — the 4th-arg `errorDetails` slot (defined at `markRunFailed:73-100`, written at `:90` to the existing JSONB column) is omitted.

Parallel gap in `llmCallTracking`:
- OpenAI insert: `src/lib/services/llms.ts:714`; Anthropic insert: `:841`. Both sit AFTER the provider returns successfully. On 429 control jumps to `handleLLMCallError` (`:741` / `:866`) which logs+rethrows. **`saveTrackingAndNotify` is never reached on failure.**
- Schema (`src/lib/schemas/schemas.ts:508-523`) has no `status` / `error_message` columns.
- Result: prod `llmCallTracking` had **0 rows** in the failure window (and 0 rows total in our spot-check). Failed LLM calls are completely invisible.

## Detection gap (from Round 2D)

Release-health issue #1172, in full:
> Run: https://github.com/Minddojo/explainanything/actions/runs/27086143604
> Workflow: E2E Nightly (Production) on main
> Failing matrix rows visible in the run page. Triage steps: docs/docs_overall/debugging.md

Zero failing-test names, zero error excerpts. Template introduced by commit `3a28efadb` ("[Project] nightly_e2e_still_failing_20260530", PR #1141) — the design doc treats body content as out-of-scope ("~20 lines bash", "Low risk"). It was a "file the issue at all" win, not a "file a *useful* issue" win.

The Slack `Notify on failure` job (`e2e-nightly.yml:201-233`) is wired but uses an equally minimal payload (site/browser/URL/filter + run link).

Compounding issue: `playwright.config.ts:100-103` has the JSON reporter writing to `test-results/results.json`, but `e2e-nightly.yml:198` only uploads `playwright-report/`, so the JSON report (the source of structured failing-spec data) is not even available to a future notify-step enrichment.

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

### Relevant Docs (in `relevantDocs`)
- docs/feature_deep_dives/debugging_skill.md (tracked, light read during synthesis)
- docs/feature_deep_dives/request_tracing_observability.md (tracked, not directly relevant since the failure surfaced at AI provider boundary, not in our tracing)
- evolution/docs/logging.md

### Prior planning docs consulted during research
- `docs/planning/fix_still_broken_nightly_e2ee_20260607/` (PR #1177) — **the existing forensics doc; conclusive root-cause statement quoted in this research**
- `docs/planning/reduce_e2e_openai_test_costs_20260607/` (PR #1179) — partial mitigation; status verified spec-by-spec
- `docs/planning/fix_broken_nightly_e2e_tests_20260114/` — pattern survey
- `docs/planning/fix_failed_nightly_run_20260301/` — pattern survey
- `docs/planning/smoke_test_and_nightly_e2e_failing_20260523/` — pattern survey
- `docs/planning/nightly_e2e_still_failing_20260530/` — pattern survey + introduced the release-health auto-filer

### Evolution Docs (initial bulk read at /initialize)
README, architecture, reference (truncated), data_model, agents/overview (head), logging (full), minicomputer_deployment (head), cost_optimization (head), rating_and_comparison (head), arena (head), metrics (head), entities (head), visualization (head), strategies_and_experiments (head), curriculum (head). Remaining deep-dive evolution docs (paragraph_recombine, criteria_agents, editing_agents, multi_iteration_strategies, evolution_metrics, prompt_editor, variant_lineage) not loaded; none surfaced as relevant during the investigation.

## Code Files Read (paths only — direct or via subagents)
- `.github/workflows/e2e-nightly.yml`
- `.github/workflows/e2e-real-ai-smoke.yml`
- `.github/workflows/post-deploy-smoke.yml`
- `playwright.config.ts`
- `src/lib/errorHandling.ts` (lines 69-74 — the 429 → user-facing-string mapper)
- `src/lib/services/llms.ts` (lines 714, 741, 841, 866 — successful-call-only insert path)
- `src/lib/schemas/schemas.ts` (lines 508-523 — llmCallTracking schema)
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts:40`
- `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts:33,189,332`
- `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts:19,198`
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts:88`
- `evolution/src/lib/pipeline/setup/generateSeedArticle.ts:115,125-128,134-137`
- `evolution/src/lib/core/agents/createSeedArticle.ts:125-130,140-145`
- `evolution/src/lib/core/Agent.ts:212-216`
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts:362`
- `evolution/src/lib/pipeline/finalize/markRunFailed.ts` (`:73-100`)

## Key Findings (numbered)

1. **The 06-07 nightly failed because of an OpenAI account-quota 429.** Same root cause as predicted by `project_evolution_e2e_openai_quota.md`. Triggered by Judge Lab batch eval (PR #1170) draining the shared OpenAI key; staging signaled it 6.5h before prod.
2. **It was already diagnosed.** PR #1177's research doc explains it byte-for-byte. The user's question "why did the last nightly fail" has a written, signed-off answer in the repo.
3. **The fix is partial.** PR #1179 reduced aggregate real-AI burn but did not move the 3 risky specs (`action-buttons.spec.ts:40`, `admin-evolution-iterative-editing.spec.ts`, `admin-evolution-run-pipeline.spec.ts`) off the blocking deployed-prod nightly path. **Same root cause can still red a future nightly.**
4. **The shared OpenAI key is the single point of failure.** Judge Lab batch jobs, staging integration tests, PR-CI, and prod-nightly all share one `OPENAI_API_KEY`. Any batch tool that drains the daily quota reds prod nightly.
5. **The instrumentation gap is reproducible.** `evolution_runs.error_details` was NULL on all 8 failed rows; `llmCallTracking` only records successful calls. A 30-second `SELECT error_details FROM evolution_runs WHERE status='failed'` should have answered the question instantly but didn't.
6. **Detection is blind.** Auto-filed release-health issue #1172 contains a link and nothing else. Slack alerts mirror it. The JSON reporter output isn't even uploaded as an artifact, so even a future enrichment can't run on past artifacts.
7. **Auto-triage is broken too.** Issues #1145 (05-31) and #1172 (06-07) both still open with 0 comments. Filing the issue is not the same as someone reading it.
8. **2026-06-07 was a one-night spike**, not a streak. Recovery (06-08 green) was passive — OpenAI quota window cycling, not a deploy.

## Open Questions

1. **Should we land the small structural follow-ups in this project, or stop at the postmortem?** Round 3D recommends folding three small items into THIS project — (P1 #3) richer release-health issue body, (P1 #5) nightly OpenAI quota pre-flight, (P2 #7) runbook note about staging-leads-prod signal — and spinning off the bigger ones (key isolation, error-detail persistence, llmCallTracking failure rows) as separate projects. Needs user direction.
2. **Did the Slack `Notify on failure` job actually fire on 06-07?** Only checkable via Slack history (or by extending logging in the workflow). Not in-repo verifiable.
3. **Are there other batch tools beyond Judge Lab that could trip the same quota?** A separate sweep of `evolution/scripts/` for entry points that hit the shared key would surface them.
