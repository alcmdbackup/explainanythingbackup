# LLM Costs Too Low In Dashboard Research

## Problem Statement
Evolution dashboard / cost reporting says ~$3 spent in the past week, but real total is more like $40-60. Figure out why by querying Supabase dev and making sure tests are adequately accounted for. Backfill if necessary.

## Requirements (from GH Issue #NNN)
- The dashboard ("evolution docs say $3 spent in past week") under-reports LLM spend; real total is ~$40-60 for the same window.
- Investigate root cause by querying **Supabase dev** (`npm run query:staging`, read-only) — compare reported vs actual spend.
- Make sure **tests are adequately accounted for** — confirm the `is_test` discriminator isn't wrongly excluding real operational spend (or wrongly including test spend in the "real" figure).
- **Backfill if necessary** — repair historical/missing cost data where a valid join key exists.

## High Level Summary
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

## Code Files Read
- (none yet — populated during /research)

### Code files to inspect during /research
- `src/lib/services/costAnalytics.ts` + `evolution/src/services/costAnalytics.ts` — dashboard aggregation actions
- `src/lib/services/llmCostAttribution.ts` — `attributeCallSource`
- `src/lib/services/llmCallSource.ts` / `llmCallTracking` write chokepoint (`saveLlmCallTracking`, `isTestLlmCall`)
- `supabase/migrations/*get_llm_spend_buckets*.sql` — the RPC powering the dashboard
- `evolution/scripts/backfillInvocationCostFromTokens.ts`, `backfillRunCostMetric.ts`, `scripts/backfillLlmIsTest.ts`
- `src/app/admin/costs/page.tsx` — UI headline number
