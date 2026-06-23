# Debug Failing Nightly E2E Progress

## Research Phase (2026-06-11)

### Work Done
- 12 subagents across 3 rounds:
  - **Round 1 (forensic data gathering):** pulled failed-job logs from run 27086143604; read release-health issue #1172; built nightly history timeline; mapped all relevant commits 06-01..06-10.
  - **Round 2 (hypothesis verification):** read prior PR #1177 forensics doc; read PR #1179 cost-reduction project; queried prod DB for `evolution_runs` + `llmCallTracking` evidence; analyzed release-health detection-gap.
  - **Round 3 (cross-ref + synthesis):** surveyed 6 prior nightly investigation folders for pattern; spec-by-spec status of every PR #1177 recommendation; instrumentation-gap analysis at code-line granularity; drafted postmortem.
- All findings consolidated into `_research.md` with file:line citations.
- Postmortem paragraph (below) ready for `_planning.md` Review & Discussion section.

### Issues Encountered
- Annotations API `HTTP 403: Resource not accessible by personal access token` — worked around via job-log download.
- Prod `llmCallTracking` table is empty (0 rows total); the schema also lacks `status`/`error_message` columns. Failed LLM calls are not recorded anywhere. Diagnosis fell back to `evolution_runs` + memory note `project_evolution_e2e_openai_quota.md` + the prior forensics doc's evidence chain.

### User Clarifications
- None yet. One open decision (in `_research.md` Open Questions #1): should this project ship the three small in-scope follow-ups (richer release-health body, nightly quota pre-flight, runbook note), or close as research-only and let a separate project handle them?

---

## Postmortem (2026-06-07 nightly E2E failure)

On 2026-06-07, all four nightly prod E2E matrix jobs (public chromium/firefox, evolution chromium/firefox) failed at AI service boundaries during an OpenAI account-level 429 quota event between ~07:34–08:17 UTC, triggered by the Judge Lab #1170 batch sweep (merged 2026-06-06) draining the shared OpenAI key — staging hit the same wall 6.5h earlier (01:07Z) on the same key. Public specs failed at `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts:40` with `"Streaming failed: Error communicating with AI service"` (mapped from raw 429 by `src/lib/errorHandling.ts:69-74`); evolution specs (`admin-evolution-iterative-editing.spec.ts:189`, `admin-evolution-run-pipeline.spec.ts:198`) polled `evolution_runs.status='failed'` after 8 prod runs died at seed-gen with `error_code='missing_seed_article'`. Detection was effectively blind: auto-filed release-health issue #1172 carried only a run-page link, and the Slack `Notify on failure` payload is equally bare, so the on-call had to manually open the run to learn anything. Forensics landed in `docs/planning/fix_still_broken_nightly_e2ee_20260607/` (PR #1177, merged 06-08T02:01Z) with ~90% confidence after adversarial refutation. Partial structural fix in `docs/planning/reduce_e2e_openai_test_costs_20260607/` (PR #1179, merged 06-08T14:25Z) dropped firefox from the nightly matrix, added `e2e-real-ai-smoke.yml` using cheap Gemini via OpenRouter with daily-budget pre-flight, and mocked PR-CI evolution seed-gen. Residual risk remains: deployed-prod nightly still calls real OpenAI on `gpt-4.1-mini`/`nano`, so the same shared-key 429 path can still red a future nightly; `evolution_runs.error_details` was NULL on the 06-07 rows because the raw 429 body was caught and discarded, and `llmCallTracking` only records successful calls. This follows 05-31 (also red, also untriaged) — two real-AI red nights inside a month signal the burn-vs-reliability tension isn't yet resolved.

## Follow-up issues (ranked)

**P0 — structural**
1. **Isolate prod-nightly OpenAI key from Judge Lab / staging traffic** — shared-key quota cross-contamination is the literal root cause and PR #1179 didn't touch it. *(separate project)*
2. **Persist raw provider error bodies into `evolution_runs.error_details` on seed-gen failure** — the 429 body was caught and discarded at `claimAndExecuteRun.ts:362` (4th arg of `markRunFailed` omitted). Column already exists. *(separate project)*

**P1 — instrumentation / detection**
3. **Enrich release-health issue body with failing-spec names + first error line** — requires uploading `test-results/` artifact and a small `jq` step in `notify-release-health`. *(THIS project if user approves)*
4. **Add failed-call row to `llmCallTracking` (status + error_code columns)** — quota events currently invisible. *(separate project — schema change)*
5. **Pre-flight OpenAI quota probe in `e2e-nightly.yml` (mirror the OpenRouter daily-budget gate from `e2e-real-ai-smoke.yml`)** — would have skip-with-reason'd the 06-07 run instead of producing 4 red jobs. *(THIS project if user approves)*

**P2 — hardening**
6. **Auto-triage rule: two real-AI red nights in 30 days opens a tracking issue.** *(separate project)*
7. **Document the staging-leads-prod-by-Nh shared-key signal in the nightly runbook.** *(THIS project if user approves)*
