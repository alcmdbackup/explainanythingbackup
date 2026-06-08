# Fix Still Broken Nightly E2EE Research

## TL;DR (Status & Recommendation)
- **Investigation: complete** (3 rounds × 4 agents). **Code fix: not yet started** — this PR is research/planning only.
- **The premise is wrong (in a good way):** the prior nightly fixes ARE on production and **worked** — nightly was green Jun 1–6. Only **Jun 7** is red.
- **Jun 7 root cause = OpenAI account-quota 429** (ops), triggered by the Judge Lab #1170 batch sweep draining the **shared** OpenAI key (staging 429'd 6.5h before prod). Quota has since **recovered** (live probe = 200).
- **Immediate action = ops:** confirm OpenAI billing headroom + isolate batch tools onto a separate key/budget. No code change resolves a quota outage.
- **Proper durable fix = structural:** move the 3 real-AI specs off the **blocking** nightly path (`@prod-ai` non-blocking lane + seed the `action-buttons` `@critical` save test). Verified this would have made Jun 7 green. Detail + validated design below and in `_planning.md`.

## Problem Statement
Nightly E2E was reported "still broken despite recent attempts to fix it." Investigation (3 rounds × 4 agents) shows the framing is partly mistaken: the prior fixes **worked** (nightly was green 6 consecutive nights, 2026-06-01→06-06), and the single current red night (2026-06-07) has a **completely different, ops-level root cause** than the May episode. The real durable problem is structural: real-AI-dependent specs sit in the **blocking** nightly path, so any OpenAI outage/quota event reds the whole nightly and looks like a code regression.

## Requirements (from GH Issue #1175)
Please look at GH history and see why recent attempts to fix nightly E2E have not worked, and then investigate the proper fix to now make them work.

## High Level Summary

**The starting hypothesis ("prior fixes landed on `main` but were never promoted to `production`, so nightly runs old code") is FALSE.** All four prior nightly fixes (`safe-goto.ts` / NS_BINDING_ABORTED retry, the `e2e-evolution` Firefox matrix, the `notify-release-health` auto-issue job, the `/mainToProd` nightly-red precheck) are byte-identical on both `main` and `production`. They shipped to production in the May 31 release (PR #1146). Production is ~7 days / 61 commits behind main, but those are all *new feature work* — **zero un-promoted nightly fixes**.

**There is no continuous failure streak — there are two distinct episodes:**
- **May 24–31 (8 red nights):** Firefox `NS_BINDING_ABORTED` navigation races + evolution UI-visibility regressions. **Fixed** by PR #1141 (merged 2026-05-30), promoted via PR #1146 (2026-05-31).
- **Jun 1–6: GREEN (6 nights).** The fixes worked. (Caveat below: green nights were retry-masking chronic evolution flakiness.)
- **Jun 7: 1 red night** — a NEW cluster.

**Root cause of the Jun 7 failure (very high confidence, ~90% after adversarial refutation): OpenAI account-level quota/billing 429.** The exact prod log string (`evolution_logs.context.error`, 8 occurrences 07:34–08:17 UTC):
> `429 You exceeded your current quota, please check your plan and billing details. ... https://platform.openai.com/docs/guides/error-codes/api-errors`

- All 8 prod `evolution_runs` on 06-07 ended `status='failed'`, `error_message='Seed generation failed'`, `error_code='missing_seed_article'`, ~8–10s after creation (not a 300s timeout — the run failed fast after 4 retries).
- The public `action-buttons` failure (`Streaming failed: Error communicating with AI service`) is the **same** 429: `src/lib/errorHandling.ts:69-74` maps any error message containing `"api"`/`"openai"` to the generic `LLM_API_ERROR` → `"Error communicating with AI service"`. The 429's URL (`platform.openai.com/...api-errors`) matches.
- Both the public path (`returnExplanation` → `gpt-4.1-mini`) and the evolution path (seed-gen → `gpt-4.1-nano`) use the **same shared `OPENAI_API_KEY`/account** (`src/lib/services/llms.ts:252-258`).

**Why 06-07 specifically — the trigger: the Judge Lab batch-eval feature (#1170).** It merged 2026-06-06 17:16 PT (00:16Z 06-07); its full-grid judge sweep is ~1.4M LLM calls (per its planning doc) routed through the **shared** OpenAI account via `callLLM`. **Staging** began failing with the identical `Seed generation failed` signature at **01:07Z — ~6.5h before prod (07:34Z)** — confirming **account-level** quota exhaustion shared across staging+prod (the minicomputer `processRunQueue.ts` round-robins both off one key). Emergency follow-up #1171 (06-07 08:52 PT) capped seeding after a ~7k-pair topic overflow — direct evidence heavy sweep/seed volume ran that night.

**Ruled out (red herrings for 06-07), each with evidence:** the spend cap ($25 evolution daily — zero recorded spend, never approached), the LLM kill switch (off), the Vercel bypass token (health checks passed), the placeholder `ea-evolution.vercel.app` host (live + healthy, HTTP 200), a main-side regression (prod runs the 5/31 code; the prod-URL is pinned via `ref: production`), and the 06-07 head SHA `ab8ae89` (cosmetic only — prod-pinned checkout).

**Current quota state: RESTORED.** A live single-call OpenAI probe (`gpt-4o-mini`) returns HTTP 200 (no 429). No prod runs since 06-07T08:17 (nightly hasn't re-fired), so DB can't confirm recovery directly; but the account is usable now. (Caveat: probe used the local `.env.local` key; prod likely shares it per the documented single-shared-key design, but this isn't 100% verifiable without Vercel env access.)

**The deeper structural problem (the actual "proper fix" target): real-AI specs are in the BLOCKING nightly path and were retry-masked.** With `retries:3`, evolution real-AI specs flaked-then-passed on 3 of 6 "green" nights (iterative-editing on 06-01, 06-02, 06-05). The blocking nightly result was "one bad retry from red" most nights. `@prod-ai` (testing_overview.md: "real AI, nightly only") is the *intended* isolation mechanism but is **inert in the blocking path**: it's applied to `suggestions.spec.ts` (which nightly never greps) but NOT to the 3 flaky specs, and the nightly grep (`--grep="@critical"|"@evolution" --grep-invert="@skip-prod"`) does not exclude it.

## Key Findings

1. **Prior fixes ARE on production and DID work.** Content-identical on main+production; nightly went green 06-01→06-06. The "unpromoted fix" hypothesis is disproven. (Round 1 + Round 2 agents, file-content diffs.)
2. **Two separate failure episodes, not one streak.** May 24–31 (NS_BINDING/UI, fixed) vs the single Jun 7 night (AI quota). Last green night = 2026-06-06 (run 27055828133).
3. **Jun 7 root cause = OpenAI account-quota 429** (very high confidence). Exact prod-log error string quoted above. Survives adversarial refutation of 6 alternative hypotheses (model 404, wrong provider, Vercel timeout, separate public/evo causes, auth/seed-data, transient-self-resolved) — all refuted except "persistent-vs-self-resolved" which is unprovable (no post-incident run exists).
4. **Trigger = Judge Lab #1170 batch sweeps draining the shared OpenAI account.** Staging failed 6.5h before prod with the same signature → account-level, not prod-specific. #1171 capped seeding.
5. **Exactly 3 real-AI-dependent BLOCKING specs** (the full blast radius): `04-content-viewing/action-buttons.spec.ts:40` (Save flow, `@critical`, public leg — live search+stream, no mock/seed guard); `09-admin/admin-evolution-run-pipeline.spec.ts` and `09-admin/admin-evolution-iterative-editing.spec.ts` (`@evolution`, evolution leg — real `POST /api/evolution/run` + poll `status='completed'`). All other `@critical`/`@evolution` specs are deterministic (client-`page.route` mocks that work in prod, or pre-seeded Supabase fixtures). A handful of other `@evolution` specs (`admin-evolution-debate`, `-cost-estimates-tab`, `evolution-strategy-wizard-tactics`; `-budget-dispatch` is fully skipped) need individual triage but most pre-seed.
6. **`@prod-ai` is the right but inert lever.** Designed to isolate real-AI flakiness; not honored by the nightly grep and not applied to the 3 flaky specs.
7. **Fix would have made 06-07 GREEN.** If the 3 real-AI specs were `@prod-ai`/non-blocking and action-buttons used a seeded fixture, the blocking legs (deterministic only) would not have touched the quota-exhausted account.
8. **Playwright does NOT support repeated `--grep-invert`** (verified in `node_modules/playwright/lib/program.js` — scalar, last-wins). Excluding two tags requires a single alternation regex: `--grep-invert="@skip-prod|@prod-ai"`.
9. **action-buttons Option E is feasible** — the seeded-fixture pattern (`createTestExplanationInLibrary` + `goto('/results?explanation_id=…')`) already exists in the same file's sibling tests; only the save-flow `@critical` test does a live search+stream.
10. **A non-blocking `@prod-ai` lane needs its own alert.** `continue-on-error: true` jobs don't mark the workflow failed, so the existing `notify-release-health`/Slack steps (keyed on job `failure()`) won't fire — the lane needs a step-outcome-gated informational alert, else real-AI failures go silent (re-creating the documented "silent outage" risk).
11. **Latent risks (hardening follow-ups, not 06-07 causes):**
    - The `@skip-prod` BLOCKING audit hardcodes 8 filenames; `admin-evolution-prompt-editor.spec.ts:47` (on `main`, not yet released) route-mocks a prod-nonexistent endpoint `**/api/evolution/prompt-editor` and lacks `@skip-prod` — it will fail the next prod nightly. A dynamic audit must target **prod-nonexistent/test-only endpoints**, NOT all `page.route` (client-route mocks legitimately work in prod — `search-generate.spec.ts` would false-positive).
    - The prod evolution host string is duplicated (`src/config/hostnames.ts:15` placeholder + `e2e-nightly.yml:33`) with no CI tie — silent break if the domain changes.
    - `429 insufficient_quota` is misclassified as a *transient* error (`classifyError`/`isTransientError`) → wastes 4 retries; and the run-level `error_message` is the generic "Seed generation failed" (the real 429 lives only in `evolution_logs.context.error`) — triage from `evolution_runs` alone misses the cause.
    - Prod cost telemetry (`llmCallTracking`, `daily_cost_rollups`, `daily_llm_costs`) is entirely empty — the documented audit-gap (active since 2026-02-23, evolution/docs/cost_optimization.md) — limiting future quota forensics.

## Open Questions
1. **Ops:** Who owns the OpenAI account billing, and is the monthly usage-limit headroom being raised? Should the Judge Lab batch tool run on a **separate OpenAI key/budget** so a sweep can't starve the nightly (and staging) again?
2. Confirm prod's Vercel `OPENAI_API_KEY` is the same key the probe used (shared-key design says yes; not directly verifiable here).
3. Scope confirmation: do `admin-evolution-debate` / `-cost-estimates-tab` / `evolution-strategy-wizard-tactics` actually trigger live AI, or pre-seed? (Triage during planning before finalizing the `@prod-ai` set.)
4. Should the blocking-context `playwright.config.ts` `grepInvert` also exclude `@prod-ai` (defense-in-depth) so a full-suite run doesn't accidentally re-include real-AI specs?

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md — nightly workflow behavior (runs `main` YAML, checks out `production`, tests live prod URL); release-cadence + 62-day prod-drift history; `[release-health]` auto-issue + `/mainToProd` nightly-red precheck.
- docs/docs_overall/testing_overview.md — `@critical`/`@evolution`/`@prod-ai`/`@skip-prod` tag semantics; nightly = Chromium+Firefox, real AI, no E2E_TEST_MODE.
- docs/feature_deep_dives/testing_setup.md — `safeGoto`/`abortableEffect`, Firefox matrix, spec inventory.
- docs/docs_overall/debugging.md — NS_BINDING_ABORTED root-cause note; prod read-only query workflow.

### Relevant Docs (all evolution docs — per project scope)
- evolution/docs/README.md, architecture.md (claimAndExecuteRun, seed-gen retry/fail path, status lifecycle), data_model.md, arena.md, entities.md, agents/overview.md, cost_optimization.md (3-layer budget, `evolution_daily_cap_usd=$25`, audit-gap since 2026-02-23, LLM client retry/backoff), criteria_agents.md, curriculum.md, editing_agents.md, evolution_metrics.md, logging.md, metrics.md, minicomputer_deployment.md (shared `OPENAI_API_KEY` across staging+prod, `processRunQueue.ts` round-robin), multi_iteration_strategies.md, paragraph_recombine.md, prompt_editor.md, rating_and_comparison.md, reference.md (error classes, kill switches, env vars), strategies_and_experiments.md, variant_lineage.md, visualization.md.

## Code / Config Files Read (via agents)
- `.github/workflows/e2e-nightly.yml` — cron `0 6 * * *`; `ref: production` (line 64); matrix {chromium,firefox}×{public→`@critical`@explainanything.vercel.app, evolution→`@evolution`@ea-evolution.vercel.app}; `fail-fast:false`, `max-parallel:1`; `--grep-invert="@skip-prod"` (line ~186); `NO E2E_TEST_MODE` (line 59); BLOCKING `@skip-prod` audit (hardcoded 8 files, lines ~146-176); `/api/health` health check; `notify-release-health` job (lines ~234-278); Slack alert (lines ~196-228).
- `playwright.config.ts` — projects (chromium/firefox/chromium-unauth/chromium-guest-auto); `isProduction = baseURL.includes('vercel.app')`; `grepInvert:/@skip-prod/` (prod-gated, line ~226); `retries:3`, test timeout 120000, expect 60000; `webServer` disabled when `BASE_URL` set; global-setup runs Vercel bypass + prod seeding.
- `src/lib/errorHandling.ts:69-74` — `categorizeError` → `LLM_API_ERROR` "Error communicating with AI service" for any "api"/"openai" message.
- `src/lib/services/llms.ts` — `getOpenAIClient()` single shared `OPENAI_API_KEY` (lines 252-258); `DEFAULT_MODEL='gpt-4.1-mini'`; prefix-based provider routing.
- `src/lib/services/llmSpendingGate.ts` — daily/monthly/kill-switch gate (not the cause; defaults kill switch off when `llm_cost_config` empty).
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — seed-gen retry loop → `markRunFailed(…, 'Seed generation failed', 'missing_seed_article')` (line ~362); ops errors swallowed into `{claimed:true,error}` (lines ~236-244).
- `evolution/src/lib/pipeline/classifyError.ts` — `429`/`RateLimitError` classed transient (the over-retry of `insufficient_quota`).
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` (Save flow `:40`, `waitForStreamingComplete` `:53`; seeded sibling pattern `:24-31`,`:116-130`).
- `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` (`POST /api/evolution/run` `:146`, poll `:165-168`) and `admin-evolution-iterative-editing.spec.ts` (`:160`, poll 300000ms `:176-179`).
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts:88` (`throw new Error('Streaming failed: ...')`).
- `src/__tests__/e2e/helpers/api-mocks.ts:24,42` (`isProductionEnvironment`, `mockReturnExplanationAPI` client-route mock works in prod).
- `src/config/hostnames.ts:14-15` (placeholder `PROD_EVOLUTION_HOST`).
- `src/__tests__/e2e/specs/09-admin/admin-evolution-prompt-editor.spec.ts:47` (untagged route-mock of prod-nonexistent endpoint — latent next-release failure).
- Prod DB (read-only `npm run query:prod`): `evolution_runs` (8 failed 06-07), `evolution_logs.context.error` (the 429 string), `llm_cost_config`/`daily_cost_rollups`/`llmCallTracking` (empty), staging mirror (failed 01:07Z).
- `node_modules/playwright/lib/program.js` (`--grep-invert` is scalar/last-wins).

## Investigation Method
3 rounds × 4 parallel agents (12 total): Round 1 = nightly-log forensics, prior-fix PR history, main-vs-production diff, workflow config map. Round 2 = root-cause (prod DB/logs), AI-spec flakiness history, failing-spec code + fix options, config-risk verification. Round 3 = live quota status + why-now, adversarial refutation of the 429 conclusion, full real-AI blocking-spec inventory, fix-design validation + completeness critic.
