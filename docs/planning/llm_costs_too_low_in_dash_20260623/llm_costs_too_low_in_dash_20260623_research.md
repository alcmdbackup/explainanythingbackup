# LLM Costs Too Low In Dashboard Research

## Problem Statement
Evolution dashboard / cost reporting says ~$3 spent in the past week, but real total is more like $40-60. Figure out why by querying Supabase dev and making sure tests are adequately accounted for. Backfill if necessary.

## Requirements (from GH Issue #1263)
- The dashboard ("evolution docs say $3 spent in past week") under-reports LLM spend; real total is ~$40-60 for the same window.
- Investigate root cause by querying **Supabase dev** (`npm run query:staging`, read-only) — compare reported vs actual spend.
- Make sure **tests are adequately accounted for** — confirm the `is_test` discriminator isn't wrongly excluding real operational spend (or wrongly including test spend in the "real" figure).
- **Backfill if necessary** — repair historical/missing cost data where a valid join key exists.

## High Level Summary (UPDATED — confirmed with dev DB queries 2026-06-23)

**Verdict: the discrepancy is real and has TWO independent causes, both confirmed with data on the Dev DB (`npm run query:staging`).**

### The numbers (Dev DB, as of 2026-06-23)
| Window | `evolution_agent_invocations.cost_usd` (truth) | of which **real** (non-test strategy) | of which **test** strategy | `llmCallTracking` evolution_% (what `/admin/costs` sees) |
|---|---|---|---|---|
| 7d | **$22.52** (10,057 inv) | **$2.89** | $19.67 (9,262 inv) | **$0.24** |
| 30d | **$37.97** (21,819 inv) | $4.16 | $33.82 (20,270 inv) | **$0.006** |
| 90d | **$69.07** (31,972 inv) | — | — | — |

This explains the user's report exactly:
- **"$3 in the past week"** = the **real (non-test) evolution spend** ≈ **$2.89/7d**.
- **"$40-60 real total"** = total invocation spend including test runs ≈ **$38/30d → $69/90d**.

### Cause 1 — Audit-gap: `/admin/costs` cannot see evolution spend at all
- The `/admin/costs` headline ("Total Cost") reads **`llmCallTracking`** via `getCostSummaryAction` (`evolution/src/services/costAnalytics.ts:160`), default range **30d**, include-test toggle **default ON**.
- But evolution LLM calls almost never write `llmCallTracking` rows on Dev: only **10 of 21,841** invocations (30d) have a matching `evolution_invocation_id` tracking row. The evolution slice of `llmCallTracking` totals **$0.006/30d**.
- This is the documented audit-gap (2026-02-23 → 2026-06-21, `cost_optimization.md`). **It persists even now**: in the last 3 days, **479 of 517** real-strategy invocations still lack a tracking row — so the fail-closed `requireTracking` fix is NOT effective on whatever path writes Dev evolution runs (CI/E2E/manual, not the prod minicomputer).
- The `/admin/evolution-dashboard` "Total Cost" tile reads the **source of truth** (`evolution_metrics` → `getRunCostsWithFallback`), so it is correct; only the `/admin/costs` page under-reports evolution.

### Cause 2 — Test spend is real money but invisible / unaccounted
- **89% of evolution invocation spend on Dev is from `is_test_content=true` strategies** ($33.82 of $37.97 over 30d). These are genuine E2E/integration fixtures (`[TEST] strategy_<timestamp>_<rand>`, each ~122 invocations making **real** LLM calls), NOT real strategies false-flagged by the timestamp regex.
- Daily timeline: test spend spiked on **06-15 ($4.87), 06-20 ($11.04), 06-21 ($7.43)** then **collapsed to ~$0.2-0.4/day after the 06-21 claim-gate** (`20260621000001`) — so the gate is working going forward, but the prior ~30 days of test spend ($33.82) is the bulk of the "$40-60".
- This is the "make sure tests are adequately accounted for" requirement: test runs burn real LLM money that is (a) filtered out by the test-content toggle, and (b) invisible to `/admin/costs` anyway due to Cause 1.

### "Backfill if necessary" — likely NOT a row-backfill
The source of truth (`evolution_agent_invocations.cost_usd`) ALREADY holds the cost. The gap is the **dashboard read path**, not missing data. Reconstructing the missing `llmCallTracking` rows is documented as **not backfillable** (no per-call token data, no join key). So the fix is read-path + test-spend surfacing, NOT a backfill of `llmCallTracking`.

---

### Original hypothesis notes (for reference)
Two cost-data systems exist and can disagree, which is the likely source of the discrepancy:

1. **`llmCallTracking`** (per-call audit; `estimated_cost_usd`, `is_test`, `call_source`) — read by the `/admin/costs` dashboard via the `get_llm_spend_buckets(p_granularity, p_start, p_end, p_include_test)` RPC → `getSpendByGranularityAction` / `getCostByEntityAction` (`evolution/src/services/costAnalytics.ts` + `src/lib/services/costAnalytics.ts`). `call_source` is folded to an entity/category via `attributeCallSource` (`src/lib/services/llmCostAttribution.ts`).
2. **`evolution_agent_invocations.cost_usd`** + run-level `evolution_metrics` rollups (`cost`, `generation_cost`, `ranking_cost`, `seed_cost`) — the source of truth for evolution pipeline spend, written live via `writeMetricMax` and `scope.getOwnSpent()`.

**Leading hypotheses (to confirm by querying dev):**
- **H1 — Evolution audit-gap window.** `cost_optimization.md` documents that `llmCallTracking` rows are *missing* for most evolution runs in **2026-02-23 → 2026-06-21** (best-effort write that silently swallowed failures; minicomputer ran pre-fix code). The fail-closed fix (`requireTracking`) landed 2026-06-21, **but the minicomputer must `git pull` + restart to run it** (see [[project_minicomputer_no_auto_pull]]). "Past week" = 2026-06-16 → 06-23 straddles the fix date, so if the minicomputer hasn't pulled, recent evolution calls are STILL dropping their `llmCallTracking` rows → dashboard reads ~$3 while `evolution_agent_invocations.cost_usd` shows the true ~$40-60. **The doc says this window is NOT backfillable (rows were never written; no join key)** — verify whether that holds for the most-recent week or whether a join key (run_id / invocation timestamp) makes a partial backfill possible.
- **H2 — `is_test` over-tagging.** `is_test` means "NOT real operational spend." A regression where real evolution/offline spend (system userids `…000`/`…001`) is tagged `is_test=true` would hide it whenever the dashboard's Include-test toggle is off (and from the Summary/By-Model/By-User queries). `debug_llm_spending_data_issues_stage_20260621` already moved `isTestLlmCall` off userid-based tagging — confirm staging rows reflect the fix.
- **H3 — Reconciliation gap surfaced but not summed.** `getEvolutionReconciliationAction` compares the `llmCallTracking` evolution total vs `evolution_agent_invocations.cost_usd`; the audit-gap banner exists. Confirm the dashboard's headline number reads the under-counting path.

**Reconciliation query (run on dev):** for `created_at > now() - interval '7 days'`, compare
`SUM(llmCallTracking.estimated_cost_usd)` (split by `is_test`, by `call_source LIKE 'evolution_%'`)
against `SUM(evolution_agent_invocations.cost_usd)` and the run-level `evolution_metrics` `cost` rows.

**Backfill tooling already present:**
- `evolution/scripts/backfillInvocationCostFromTokens.ts` — repairs `evolution_agent_invocations.cost_usd` + run rollups from `llmCallTracking` (`--dry-run` default, `--apply`, `--run-id`).
- `evolution/scripts/backfillRunCostMetric.ts` — backfills rollup `cost` rows for legacy runs.
- `scripts/backfillLlmIsTest.ts` — backfills the `is_test` discriminator on historical `llmCallTracking` rows.
- `costAnalytics.backfillCostsAction` — populates NULL `estimated_cost_usd`.
- Caveat: the per-call (`llmCallTracking`) audit-gap window is documented as NOT backfillable (no join key). Backfill direction here is likely the OPPOSITE — derive the dashboard total from `evolution_agent_invocations`, not reconstruct missing `llmCallTracking` rows.

**Note on the scratch probe scripts** carried into this branch (`scripts/probe-openai.{ts,mjs}`) — unrelated OpenAI probes from a prior branch; not part of this investigation.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md (esp. "Backfilling historical cost inaccuracies" + "Bug A / Bug B")

### Relevant Docs (discovered in step 2.7)
- evolution/docs/cost_optimization.md (audit-gap caveat, LLMSpendingGate, cost aggregation, `get_llm_spend_buckets`, `is_test` discriminator)
- evolution/docs/metrics.md (`evolution_metrics` EAV, per-purpose cost split, `getRunCostsWithFallback`)
- evolution/docs/evolution_metrics.md (stub; reflection/iterative-edit/evaluation cost metrics)
- evolution/docs/data_model.md (llmCallTracking / evolution_agent_invocations schema, `get_run_total_cost`, `evolution_run_costs` view, `is_test_content`)
- evolution/docs/reference.md (cost-tracker.ts, createEvolutionLLMClient.ts, costAnalytics.ts key files)
- docs/feature_deep_dives/admin_panel.md (/admin/costs page: tabs, granularity, Include-test toggle, audit-gap banner, backfill button)
- docs/feature_deep_dives/metrics_analytics.md (user-engagement metrics — lower relevance)

## Code Files Read (via Explore agent, with file:line)
- `src/app/admin/costs/page.tsx` — headline "Total Cost" card (line ~443) ← `getCostSummaryAction`; default range **30d** (line ~73); include-test toggle **default ON** (line ~80); audit-gap amber banner fires when `invocationCost > trackingCost * 1.5` (lines ~286-295).
- `evolution/src/services/costAnalytics.ts` — `getCostSummaryAction` reads `llmCallTracking` (line ~160), filters `is_test=false` ONLY when `includeTest===false` (line ~174); `getSpendByGranularityAction`/`getCostByEntityAction` → `get_llm_spend_buckets` RPC; `getDailyCostsAction` → `daily_llm_costs` view (no `is_test` column, comment line ~257); `getEvolutionReconciliationAction` (lines ~692-731) compares `llmCallTracking` evolution_% vs `evolution_agent_invocations.cost_usd`.
- `supabase/migrations/20260620000003_get_llm_spend_buckets.sql` — RPC SUMs `estimated_cost_usd` from `llmCallTracking`, filter `(p_include_test OR is_test = false)`, `date_trunc` bucket.
- `supabase/migrations/20260116061036_add_llm_cost_tracking.sql` — `daily_llm_costs` view (no `is_test`).
- `src/lib/services/llmCostAttribution.ts` — `attributeCallSource` (evolution_* → category `evolution`); `isTestLlmCall` (lines ~86-95) driven by runtime signals (`NODE_ENV=test`, `E2E_TEST_MODE`, `LLM_TRACKING_TEST_RUNTIME`, `call_source` in `integration_test`/`generation`, mock fingerprint) — **NOT userid**.
- `src/lib/services/llms.ts` — `saveLlmCallTracking` (lines ~166-246): `is_test = trackingData.is_test ?? isTestLlmCall(...)`.
- `src/app/admin/evolution-dashboard/page.tsx` + `evolution/src/services/evolutionVisualizationActions.ts` (`getEvolutionDashboardDataAction`, default `filterTestContent=false`) → `evolution/src/lib/cost/getRunCostWithFallback.ts` (`getRunCostsWithFallback`, Layer1 `evolution_metrics.cost` → Layer2 sum of per-purpose costs). **This surface reads the source of truth.**

## Key Findings
1. **Two cost surfaces, only one is gapped.** `/admin/costs` reads `llmCallTracking` (audit table) → near-zero for evolution. `/admin/evolution-dashboard` reads `evolution_metrics`/`evolution_agent_invocations` (truth) → correct.
2. **Audit-gap is near-total and ongoing on Dev.** 10/21,841 invocations (30d) have a tracking row; 479/517 recent (3d) real invocations lack one. The fail-closed `requireTracking` fix is not effective on the Dev-writing path.
3. **Real evolution spend is genuinely small (~$2.89/7d).** The user's "$3" is correct for real (non-test) spend.
4. **Test strategies dominate cost (89%, $33.82/30d) and are genuine tests**, not false-positives of the timestamp regex. This is the "$40-60". Each `[TEST] strategy_*` runs ~122 real LLM-calling invocations.
5. **The 06-21 claim-gate works going forward** — test spend collapsed from ~$11/day to ~$0.3/day after it landed. The $33.82 is mostly pre-gate history.
6. **Data already exists; this is a read-path + classification problem, not a backfill problem.** `llmCallTracking` rows for the gap window are unbackfillable (no token data / join key).

## Resolved Decisions (user, 2026-06-23)
- **Surface in scope:** `/admin/costs` page (the `llmCallTracking`-based one — broken for evolution). (Q1)
- **Deliverable:** fix the `/admin/costs` read path **AND** do **foundational rework** so that *all* spend (evolution + non-evolution) is captured by a canonical, complete cost source — so future cost consumers cannot silently under-report. (Q2)
- **Environment:** Dev only for now; prod check deferred. (Q4)
- Implication: the goal is a **single complete cost ledger / canonical read** rather than a point-fix to one action. The core defect is that `llmCallTracking` is supposed to be the per-call ledger for ALL LLM calls, but evolution calls don't reliably write to it (audit-gap), so every consumer that reads `llmCallTracking` under-reports total spend by the evolution amount. Foundational options to weigh in planning: (A) make evolution calls reliably write `llmCallTracking` so one ledger is complete going forward; (B) a canonical unified cost view/RPC that UNIONs non-evolution `llmCallTracking` + evolution `evolution_agent_invocations` (dedup-safe, no double count); (C) both — fix the write path forward + unified read covering the historical gap.

## Open Questions (Q1/Q2/Q4 resolved above; remaining)
1. ~~**Which exact surface did the user see "$3" on**~~ — `/admin/costs` (llmCallTracking, ~$0 for evolution) or `/admin/evolution-dashboard` with "Hide test content" ON (~$3 real)? This changes the fix emphasis. (Recommend confirming with the user.)
2. **Scope of fix:** make `/admin/costs` read evolution cost from `evolution_agent_invocations` (mirror `getRunCostsWithFallback`) so the headline reflects truth? Or is the deliverable primarily to **surface test vs real spend** so test money is "adequately accounted for"?
3. **Should test-strategy spend be shown as a first-class line** (e.g., a "test" category in the stacked chart / By-Entity tab) rather than only toggled in/out?
4. **Prod vs Dev:** these numbers are Dev. Production (minicomputer → prod DB) evolution spend is separate; should `/admin/costs` on the evolution (prod) host be checked via `npm run query:prod` to confirm the same gap there?
5. **Why is the Dev-writing path still dropping tracking rows post-06-21** — is Dev running pre-fix code, or do these invocations bypass the `requireTracking` chokepoint (e.g., a non-evolution `callLLM` path / different client)?
