# Debug LLM Spending Data Issues (Stage) Research

## Problem Statement
Evolution spend is under-counted. Per-call tracking (`llmCallTracking`) shows $0.0000 for a date range, but agent invocations (`evolution_agent_invocations.cost_usd`) record $2.68 for the same range — an audit gap that has been active since 2026-02-23. The admin dashboard cost section also displays an error message, and the spend shown doesn't reconcile with what's actually being paid to providers.

## Requirements (from GH Issue #1246)
- error message shows on cost section of admin dashboard.
- Spending that shows up doesn't remotely reconcile with what I've been paying.
- Also, I want to make sure we have infrastructure in place to capture spending from adhoc tests and various tools like judge lab.

## CORE DIRECTIVE (from user, 2026-06-21)
**Cost tracking must be 100% accurate and FAIL-CLOSED.** Any cost-tracking error must throw immediately and BLOCK progression — never logged-and-swallowed / best-effort. This reverses the current explicit design tradeoff (see Finding 2) and is the central requirement of this project. Saved to memory: `feedback_cost_tracking_fail_closed`.

## High Level Summary
The LLM spend-tracking architecture (PR #1244, `build_llm_spending_tab_in_admin_dash_20260620`) has two parallel cost stores:

1. **`llmCallTracking`** — per-LLM-call rows written at `saveLlmCallTracking` in `src/lib/services/llms.ts`. Carries `model`, branded `call_source`, token counts, `estimated_cost_usd`, optional `evolution_invocation_id`, `is_test`. The `/admin/costs` dashboard reads this via the `get_llm_spend_buckets` RPC.
2. **`evolution_agent_invocations.cost_usd`** — per-invocation cost from `scope.getOwnSpent()`, written by `Agent.run()`. Trustworthy for run-level rollups.

The gap is **confirmed real and large** via staging queries (not the narrow window the doc describes). Evolution per-call tracking captures **~0.02% of actual evolution spend**. Root cause is a combination of a swallowed write error + an ops/deploy gap, both of which the fail-closed directive addresses.

### Verified staging data (2026-06-21, read-only)
| Month | evolution `llmCallTracking` | `evolution_agent_invocations` |
|---|---|---|
| 2026-02 | 1875 rows / $54.03 (**0 linked** — all `evolution_invocation_id` NULL) | (none) |
| 2026-03 | **0 rows** | 716 / $21.30 |
| 2026-04 | **0 rows** | 817 / $2.49 |
| 2026-05 | **0 rows** | 12,778 / $10.79 |
| 2026-06 | 10 rows / $0.006 | 14,095 / $28.23 |

Last 120 days, all tracking: non-evolution real = **52,171 rows / $98.36** (healthy); evolution real = **42 rows / $0.0147** (broken). No `unattributed:*` rows; a few rows have NULL `estimated_cost_usd`.

## Key Findings (verified against code + staging)

1. **HEAD code is correct; the writes still aren't landing in bulk → ops/deploy gap.** The evolution `rawProvider` closure (`evolution/src/lib/pipeline/claimAndExecuteRun.ts:204-228`) passes `trackingDb: supabase` (line 220), `evolutionInvocationId` (line 226), and `onUsage`. So runs on HEAD *should* write linked tracking rows. Yet June has 14,095 invocations but only 10 tracking rows. The bulk of evolution runs come from the **minicomputer, whose evolution-runner systemd timer does NOT git-pull** (see memory `project_minicomputer_no_auto_pull`) — it is almost certainly running pre-fix code where `trackingDb` is not threaded, so `saveLlmCallTracking` falls back to the Next.js-coupled `createSupabaseServiceClient()` (broken outside Next, `llms.ts:163-166`), throws, and the error is swallowed (Finding 2). The trickle of June rows is from staging/CI runs on current code.

2. **The swallow is by design — and is exactly what the directive reverses.** `saveLlmCallTracking` (`llms.ts:167-249`) correctly THROWS on every failure (no client / DB error / Zod error). But its caller `saveTrackingAndNotify` (`llms.ts:256-289`) catches the throw and only re-throws when `isStrictMode()` is true (`llms.ts:156-160` → `EVOLUTION_TRACKING_STRICT === 'true'`). Comment at `llms.ts:251-255`: *"Default behavior in prod still does NOT throw — LLM calls must not fail because tracking failed."* `EVOLUTION_TRACKING_STRICT` is set **only in tests and `evolution/scripts/verifyLlmCallTrackingFix.ts`** — never in staging/prod/minicomputer. So in every real environment, tracking failures are silent. This is the root enabler of the 2-month-plus gap and the direct target of the fail-closed directive.

3. **`evolution_invocation_id` is never populated in historical rows.** Even Feb's 1875 rows have it NULL, so per-call→per-invocation reconciliation is impossible for any historical data; only forward-fixed runs can be audited at the call level.

4. **Dashboard cost-section error — top candidates (live reproduction deferred to execution).** All `costAnalytics.ts` actions return error objects rather than throwing, EXCEPT `getSpendingSummaryAction` → `getSpendingGate().getSpendingSummary()` which is **not** wrapped (`llmCostConfigActions.ts:130-135`) and can throw to the page's bare catch (`page.tsx:159-160`) → generic "Failed to load cost data" banner (`page.tsx:314-317`). The page also only checks `summaryRes.success` for the banner (`page.tsx:156-157`), so other action failures fail silently. The `get_llm_spend_buckets` RPC EXISTS on staging with the 4-arg signature, but is GRANTed to `service_role` only (my readonly probe got `permission denied` — the dashboard uses service_role, so that is NOT the dashboard's error). Reconciliation banner (tracking≪invocations) WILL show and is expected, not the error.

5. **Ad-hoc / tool capture (the third requirement).** Server-action tools route through `callLLM` and DO get tracked: prompt editor (`evolution_prompt_editor`), arena rejudge, weight inference, judge eval (`evolution_judge_eval`). Bypass/uncapped paths: offline `evolution/src/lib/judgeEval/runJudgeEval.ts` and `runPromptEditorConfig.ts` skip the `claimAndExecuteRun.ts` chokepoint (per `cost_optimization.md` 402 section); `oneshotGenerator.ts` self-tracks via its own `trackLLMCall`. CLI scripts that build their own Supabase client must pass `trackingDb` or they hit the same broken-fallback path. Need a full inventory + a coverage guard so a new uncaptured path fails CI.

## Open Questions for Planning
1. ~~**Fail-closed blast radius / scope**~~ **RESOLVED (2026-06-21):** evolution-only, throw immediately, no retry, no escape hatch, retire `EVOLUTION_TRACKING_STRICT`. Main app unchanged. See planning "Locked Decisions". Mechanism: explicit `requireTracking: true` option from the evolution `rawProvider`.
2. **Minicomputer remediation:** code fix alone won't help until the minicomputer pulls. Need an ops step (pull + restart) AND a startup self-check that fails loudly if tracking can't write (RESOLVED to include — planning Phase 2).
3. Exact dashboard error string — reproduce with service-role/admin session (Playwright) in execution Phase 3.
4. Should historical un-linked rows be left as-is (documented caveat) or is a backfill of `evolution_invocation_id` feasible? (Likely not feasible — no join key.)
5. Coverage-guard mechanism for "every LLM call path lands an attributed tracked row" — lint rule extension vs integration test vs runtime registry assertion.

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
- evolution/docs/cost_optimization.md (read in full)
- docs/feature_deep_dives/admin_panel.md (read in full)
- evolution/docs/data_model.md (via Explore agent)
- evolution/docs/evolution_metrics.md (via Explore agent)
- evolution/docs/logging.md (via Explore agent)
- evolution/docs/entities.md (via Explore agent)
- evolution/docs/reference.md (via Explore agent)
- docs/feature_deep_dives/judge_evaluation.md (via Explore agent)

## Code Files Read (verified line numbers)
- `src/lib/services/llms.ts` — `isStrictMode()` 156-160 (`EVOLUTION_TRACKING_STRICT`); `saveLlmCallTracking` 167-249 (THROWS on all failures: no-client 174-187, DB error 210-220, catch→ServiceError 227-248); **`saveTrackingAndNotify` 256-289 — SWALLOWS the throw unless strict (262-277); comment 251-255 "prod does NOT throw"** ← primary fix target.
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — `rawProvider` closure calling `callLLM` 204-228; `trackingDb: supabase` 220; `maxOutputTokens` 224; `evolutionInvocationId` 226; `onUsage` 227+. `supabase = options.db ?? createSupabaseServiceClient()` 121.
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — `complete()` 96/128; wraps `rawProvider.complete` 197 (does NOT itself set trackingDb — it's set in the claimAndExecuteRun rawProvider).
- `evolution/src/services/costAnalytics.ts` — `getSpendByGranularityAction` (RPC call ~123, granularity allow-list 99/119-121), `getCostByEntityAction`, `getEvolutionReconciliationAction` (tracking vs invocations ~683-700). All return error objects.
- `src/lib/services/llmCostConfigActions.ts` — `getSpendingSummaryAction` 130-135 **NOT try-wrapped** (can throw to page); `getLLMCostConfigAction` queries `llm_cost_config`.
- `src/app/admin/costs/page.tsx` — error state, `loadData` only checks `summaryRes.success` 156-157; bare catch 159-160; error banner 314-317.
- `supabase/migrations/20260620000003_get_llm_spend_buckets.sql` + `20260620000004_spend_buckets_granularity_raise.sql` — RPC RAISEs on invalid granularity (000004 lines 24-25); GRANT EXECUTE to service_role only. **Confirmed deployed on staging** (4-arg signature present).
- `src/lib/services/llmCallSource.ts` / `src/lib/services/llmCostAttribution.ts` / `eslint-rules/require-llm-call-source.js` — attribution layers 0/1/3 (per earlier map; spot-verify in execution).
- `evolution/scripts/verifyLlmCallTrackingFix.ts` — only place that sets `EVOLUTION_TRACKING_STRICT=true` (100-121), confirming strict is test-only today.

## Staging queries run (read-only, via `npm run query:staging`)
- evolution tracking by month; invocations cost by month; tracking by `is_test` × evolution-split (120d); top `call_source`s (120d); `pg_proc` check + RPC call (perm-denied as readonly). Results in the table + Key Findings above.
