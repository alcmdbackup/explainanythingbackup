# Build LLM Spending Tab In Admin Dash Research

## Problem Statement
Build a LLM spending dashboard. Ensure LLM cost data is tracked appropriately in tables with no nulls, surface spend split by evolution vs. non-evolution and by the entity responsible for calling, improve attribution in code where it is messy, and support viewing spend by hour, day, week, and agent type.

## Requirements (from GH Issue #1238)
- Make sure llms cost data is all tracked appropriately in tables and none are null. Make dashboard split costs by evolution vs. non-evolution, and by entity responsible for calling. if Attribution is messy add code for better attribution. Allowing viewing by hour, day, week and agent type also

## High Level Summary

> **Headline reframing (from the staging data audit).** The requirement says "make sure cost data is tracked appropriately and none are null." But on the staging/dev DB **nulls are essentially a non-issue** (38 null `estimated_cost_usd`, 1 null `model` out of 80,080 rows). The real data-quality problem is **empty-string `model` on ~90% of rows ($123.78 of the ~$179 "total"), driven by integration-test MOCK pollution that carries FAKE estimated costs**. A naive spending dashboard built on this table would report mostly garbage. The genuine work is: (1) separate real spend from test/mock pollution, (2) fix the empty-model attribution, (3) split by evolution/non-evolution + entity, (4) add hour/day/week + agent-type grouping. See **Key Findings**.

### Current state (what already exists)
- **`/admin/costs` page** (`src/app/admin/costs/page.tsx`) already provides: date-range selector (1m/1h/1d/7d/30d/90d), summary cards (total cost/calls/tokens/avg), a daily cost bar chart, cost-by-model table with system pricing, top-users table, a "missing cost" warning + **Backfill Costs** button.
- **`costAnalytics.ts`** (`evolution/src/services/costAnalytics.ts`) server actions: `getCostSummaryAction` (also returns `nullCostCount`), `getDailyCostsAction` (reads `daily_llm_costs` view), `getCostByModelAction`, `getCostByUserAction`, `backfillCostsAction`.
- **`daily_llm_costs` view** — per `DATE(created_at)` × model × userid aggregation.
- **`daily_cost_rollups` table** — already splits spend into `category ∈ {evolution, non_evolution}` via a trigger; routing is by `call_source` prefix (`evolution_*` → evolution). Used by `LLMSpendingGate`.
- **`per_user_daily_cost_rollups`** — per (date, user_id, call_source) totals for the guest $10/day cap.

### Data model — `llmCallTracking` (central spend table)
Defined in `20251109053825_fix_drift.sql:53-67`; cost column added `20260116061036_add_llm_cost_tracking.sql`; evolution FK `20260222100001_llm_tracking_invocation_fk.sql`.

| Column | Nullable | Notes |
|---|---|---|
| `userid` | NO | TEXT; system const `00000000-0000-4000-8000-000000000001` for non-user calls |
| `call_source` | NO | free-form attribution label (e.g. `generateTitleFromUserQuery`, `evolution_judge_eval`) |
| `model` | YES | can be NULL / empty-string (legacy); now guarded by fallback in `llms.ts:584,601` |
| `prompt_tokens`/`completion_tokens`/`total_tokens`/`reasoning_tokens` | YES | nullable if usage missing |
| `estimated_cost_usd` | YES | NULL when `calculateLLMCost` throws (`llms.ts:707-716`, silent 0→NULL); counted as `nullCostCount` |
| `evolution_invocation_id` | YES | FK → `evolution_agent_invocations`; NULL for non-evolution calls |

### Attribution: solid vs. messy
- **Solid:** `call_source` (always non-empty), `userid`, `created_at`, `evolution_invocation_id` (evolution only), evolution/non_evolution routing via `call_source` prefix.
- **Messy / gaps:**
  - **No `agent_name` / entity column for non-evolution calls** — "entity responsible" is only the free-form `call_source` string; no enum, typos not prevented. To group "by agent type" cleanly we likely need a derived/normalized entity dimension (map `call_source` → entity, or add a column).
  - **NULL `model`** — empty-string bucket hides spend (legacy rows; backfillable).
  - **NULL `estimated_cost_usd`** — `nullCostCount`; backfill recalculates but can re-null if calc throws.
  - **Evolution audit-gap window (ACTIVE since 2026-02-23):** `llmCallTracking` rows are missing entirely for evolution runs — per-call audit impossible; only run-level `evolution_metrics.cost` (from `scope.getOwnSpent()`) is trustworthy. Per `cost_optimization.md` caveat box + `investigate_paragraph_rewrite_cost_undershoot_evolution_20260529`. This means an llmCallTracking-only dashboard will UNDER-count evolution spend — must reconcile against `evolution_agent_invocations.cost_usd` / `evolution_metrics`.

### Cost computation path
- Central wrapper `callLLM` (`src/lib/services/llms.ts`, aliased `callLLMModel`/`callOpenAIModel`). Cost via `calculateLLMCost` (`src/config/llmPricing.ts`) using real provider token counts; cache-aware for DeepSeek.
- Evolution per-call cost: `createEvolutionLLMClient.ts` → `recordSpend` → `evolution_agent_invocations.cost_usd` (via `AgentCostScope.getOwnSpent()`), rolled up to `evolution_metrics` per-purpose (`generation_cost`/`ranking_cost`/`reflection_cost`/`seed_cost` + many agent-specific umbrella metrics).
- Evolution per-purpose labels: typed `AgentName` (`evolution/src/lib/core/agentNames.ts`).

### Open questions for planning
1. "Entity responsible for calling" for non-evolution = define a canonical mapping from `call_source` → entity/feature, or add a real `agent_name`/`entity_type` column + backfill.
2. "None are null" — backfill `model` + `estimated_cost_usd`; add NOT NULL guards / triggers at insert time going forward; decide policy for genuinely unknowable legacy rows.
3. Evolution audit-gap: do we fix the missing-INSERT regression (separate concern) or reconcile the dashboard against `evolution_agent_invocations`/`evolution_metrics` as the source of truth for evolution spend?
4. Hour/day/week/agent-type grouping: extend `daily_llm_costs` view (or new RPC) with `date_trunc` granularity + entity/agent dimension; decide where new tab lives (extend `/admin/costs` vs. new tab).

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

### Relevant Docs (to read during /research deep dive)
- evolution/docs/cost_optimization.md (read)
- evolution/docs/data_model.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- docs/feature_deep_dives/admin_panel.md (read)
- docs/feature_deep_dives/metrics_analytics.md
- docs/feature_deep_dives/request_tracing_observability.md

## Key Findings (staging data audit, 2026-06-20)

All figures from `npm run query:staging` against the dev DB (`llmCallTracking`, 80,080 rows). Production not yet audited — blocked pending user approval (see Open Questions).

1. **Nulls are NOT the problem.** Only **38** rows have NULL `estimated_cost_usd`, **1** NULL `model`, **1** NULL `total_tokens`. Literal "none are null" is already ~99.95% true. The existing `backfillCostsAction` already handles the residual.

2. **Empty-string `model` on ~90% of rows is the real attribution defect.** 72,309 / 80,080 rows have `model = ''`. These carry **$123.78** of the ~$179 apparent total; the 7,804 `has_model` rows carry only $55.20.

3. **The empty-model rows are largely integration-test MOCK pollution with FAKE costs.** Sampled `raw_api_response` shows mock fixtures: content `"Unexpected call"` and round token counts (`prompt_tokens:100, completion_tokens:200, total_tokens:300`). This matches memory note `project_llm_test_cost_sources.md` ("Staging model='' bucket = integration MOCK pollution, estimated cost, not real spend"). Mechanism of cost inflation: **empty `model` → `calculateLLMCost` unknown-model fallback pricing ($10/$30 per 1M) → inflated fake cost.** So mock rows both pollute attribution AND distort totals.

4. **Test pollution also lives in the `has_model` bucket.** `evolution_generation_agent` (67 calls, **$33.50**) + `evolution_evaluation_agent` (67 calls, **$20.10**) are on test user `00000000-0000-4000-8000-000000000099` ($53.61 of the $55.20 has-model total), last seen 2026-02-14, at **~$0.50/call** — impossible for their recorded `gpt-4o-mini` ($0.15/$0.60 per 1M would need ~800K tokens/call). Legacy fake/test data. The real recent production-shaped rows (`gpt-4.1-mini`, June 2026) cost fractions of a cent.

5. **`call_source` is the clean, reliable attribution dimension** — ~30 distinct values, all non-empty, meaningful (`evaluateTags`, `generateTitleFromUserQuery`, `generateHeadingStandaloneTitles`, `extractLinkCandidates`, `explanation_summarization`, `findBestMatchFromList`, `evolution_*`, `editor_*`, `oneshot_*`, …). The `evolution_` prefix cleanly separates evolution from non-evolution (already used by `daily_cost_rollups` trigger + `llmSpendingGate`). **This is the right basis for "entity responsible for calling."**

6. **No `agent_name`/`entity_type` column for non-evolution calls** — "entity" today *is* the free-form `call_source` string (no enum, typos unprevented). A canonical TS mapping `call_source → { entityType, category }` (single source of truth, used at insert + in aggregation) is likely better than a new column; revisit once prod cardinality is known.

7. **Empty model is mostly NOT recoverable for mock rows** (the mock `raw_api_response` has no `model` field). For real rows the existing `apiModel` fallback (`llms.ts:584,601`) already populates model — the empty share drops from ~98% (Mar 2026) to ~30% (Jun 2026), so the defect is mostly legacy + ongoing test pollution, not a live production bug.

8. **Empty-cost (`estimated_cost_usd`) silently becomes 0, never NULL, on calc failure** (`llms.ts:703-716`) — so "missing cost" mostly manifests as **$0**, not NULL. The 38 NULLs predate that guard.

9. **Evolution per-call audit gap (per docs, ACTIVE since 2026-02-23):** V2 typed-`AgentName` pipeline rows are largely missing from `llmCallTracking`; evolution run-level cost lives in `evolution_agent_invocations.cost_usd` / `evolution_metrics`. A dashboard reading only `llmCallTracking` will UNDER-count evolution spend → must reconcile against the invocations/metrics tables for evolution totals.

10. **Existing infra is reusable** (Explore-confirmed, with file:line): `costAnalytics.ts` actions all `requireAdmin()`; `daily_llm_costs` view groups by `DATE(created_at), model, userid`; `daily_cost_rollups` trigger already categorizes evolution/non_evolution; `llmCallTrackingSchema` (`schemas.ts:508-523`) is the insert contract; tracking row built at `llms.ts:743-757`; cost page state/charts at `src/app/admin/costs/page.tsx` (date-range `DATE_RANGE_MS` lines 26-35, no `data-testid`s yet — must add). Granularity toggle + entity breakdown have clear insertion points.

## Implications for the Plan (revises _planning.md options)

- The "none are null" requirement is best **re-scoped to "no garbage / no fake-cost pollution + recover/normalize `model`"** — confirm with user.
- Need a **test/mock discriminator** so the dashboard shows *real* spend by default: candidates — (a) exclude known system/test userids (`…000`, `…001`, `…099`), (b) detect mock content/round-token fingerprints, (c) add an `is_test`/`environment` column populated at insert. Production is the environment that actually matters for "spend"; staging will always carry test pollution since tests run against the dev DB.
- Entity dimension: lean toward a **canonical `call_source → entity/category` map in code** (Option A/C hybrid) over a schema column, pending prod `call_source` cardinality.
- Evolution totals must **reconcile against `evolution_agent_invocations`/`evolution_metrics`**, not trust `llmCallTracking` alone.

## Open Questions — RESOLVED (user, 2026-06-20)

1. **Production audit:** ❌ **Stay on staging.** No prod query. Treat prod data quality as an assumption to verify later; plan from the staging audit.
2. **Requirement framing:** ✅ **Reframe to the real problem** — normalize empty `model` (recover where possible) + exclude/flag test-mock pollution, rather than only the ~38 literal nulls.
3. **Test/mock handling + entity dimension:** ✅ **Code map + `is_test` column.** Canonical `call_source → { entityType, category }` map in TS (single source of truth, used at insert + aggregation) **plus** a new `is_test`/`environment` discriminator flag populated at insert time (one migration). Backfill `is_test` for historical rows via the same heuristics (system/test userids `…000`/`…001`/`…099`, mock fingerprints).
4. **Dashboard default:** ✅ **Show everything** — render all rows (incl. test/mock); the `is_test`/category/entity filters let the user narrow manually. (No real-spend-only default.)

### Consequent direction (locked)
- Add `is_test` (or `environment`) column to `llmCallTracking`; populate at insert in `llms.ts`; backfill history.
- Canonical entity map module: `call_source → { entityType, category: 'evolution' | 'non_evolution' }`; reused at insert + in the new aggregation actions.
- Normalize/recover `model`: keep the `apiModel` fallback for live rows; backfill empty model where recoverable; leave irrecoverable mock rows flagged `is_test=true`.
- Aggregation: granularity-aware (`hour|day|week` via `date_trunc`) + dimensions (category, entity, model, `is_test`). Evolution totals reconcile against `evolution_agent_invocations`/`evolution_metrics` for the audit-gap window.
- Dashboard: extend `/admin/costs` with granularity toggle + category/entity/`is_test` filters, all rows shown by default.

## Code Files Read
- src/app/admin/costs/page.tsx (existing cost UI — surveyed via Explore)
- evolution/src/services/costAnalytics.ts (cost server actions — surveyed)
- src/lib/services/llms.ts (callLLM, saveLlmCallTracking, cost calc — surveyed)
- src/lib/services/llmSpendingGate.ts (budget gate, evolution/non_evolution routing — surveyed)
- src/config/llmPricing.ts (calculateLLMCost, pricing — surveyed)
- supabase/migrations/20251109053825_fix_drift.sql, 20260116061036_add_llm_cost_tracking.sql, 20260222100001_llm_tracking_invocation_fk.sql, 20260524000003_add_per_user_daily_cost_rollups.sql, 20260228000001_add_llm_cost_security.sql (schema — surveyed)
