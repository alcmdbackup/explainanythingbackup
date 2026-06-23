# LLM Costs Too Low In Dashboard Plan

## Background
Evolution dashboard / cost reporting says ~$3 spent in the past week, but real total is more like $40-60. Figure out why by querying Supabase dev and making sure tests are adequately accounted for. Backfill if necessary.

## Requirements (from GH Issue #NNN)
- The dashboard ("evolution docs say $3 spent in past week") under-reports LLM spend; real total is ~$40-60 for the same window.
- Investigate root cause by querying **Supabase dev** (`npm run query:staging`, read-only) — compare reported vs actual spend.
- Make sure **tests are adequately accounted for** — confirm the `is_test` discriminator isn't wrongly excluding real operational spend (or wrongly including test spend in the "real" figure).
- **Backfill if necessary** — repair historical/missing cost data where a valid join key exists.

## Problem
The `/admin/costs` dashboard reads per-call spend from `llmCallTracking` (via the `get_llm_spend_buckets` RPC), while the evolution pipeline's source-of-truth cost lives in `evolution_agent_invocations.cost_usd` + run-level `evolution_metrics`. A documented audit-gap (2026-02-23 → 2026-06-21) means evolution runs are missing `llmCallTracking` rows, and the fail-closed fix requires the minicomputer to pull + restart. The dashboard likely reads the under-counting path and/or excludes spend mis-tagged `is_test=true`, producing the ~$3 vs ~$40-60 gap. The fix must first confirm the true gap on dev, then either correct the dashboard read path, re-tag `is_test`, and/or backfill where a join key exists.

## Options Considered
- [ ] **Option A: Diagnose-first (query dev, no code change yet)**: Run reconciliation queries on staging/dev to quantify the gap and pin the exact cause (audit-gap vs is_test vs read-path) before touching code. Pros: evidence-driven, avoids wrong fix. Cons: none — this is the mandatory first phase.
- [ ] **Option B: Fix the dashboard read path**: If the headline number reads `llmCallTracking` only, make the evolution portion fall back to `evolution_agent_invocations.cost_usd` (like `getRunCostsWithFallback`) so the dashboard reflects true spend even during the audit gap. Pros: durable, surfaces real money. Cons: reconciliation/attribution semantics need care.
- [ ] **Option C: Re-tag `is_test`**: If real spend is mis-tagged test, run `scripts/backfillLlmIsTest.ts` to correct historical rows + verify the runtime `isTestLlmCall` fix is deployed. Pros: cheap, targeted. Cons: only helps if H2 is the cause.
- [ ] **Option D: Backfill missing cost data**: Where a join key exists (run_id/invocation), backfill via `backfillInvocationCostFromTokens.ts` / `backfillRunCostMetric.ts`. Pros: repairs history. Cons: documented audit-gap window may be unbackfillable (no join key) — confirm before promising.

## Phased Execution Plan

### Phase 1: Diagnose on Supabase dev (read-only)
- [ ] Run reconciliation query: last 7 days `SUM(llmCallTracking.estimated_cost_usd)` split by `is_test` and `call_source LIKE 'evolution_%'` vs `SUM(evolution_agent_invocations.cost_usd)` vs run-level `evolution_metrics.cost`.
- [ ] Quantify the gap and attribute it to one of H1 (audit-gap), H2 (is_test over-tag), H3 (read-path) — or a combination.
- [ ] Identify exactly which query/RPC the dashboard headline ("$3 / past week") reads, and trace it in `costAnalytics.ts` + `get_llm_spend_buckets`.
- [ ] Determine whether the missing rows have a usable join key (backfillable) for the relevant window.

### Phase 2: Implement the correct fix (depends on Phase 1 findings)
- [ ] If H3/read-path: add an `evolution_agent_invocations` fallback to the dashboard's evolution total (mirror `getRunCostsWithFallback`).
- [ ] If H2/is_test: verify deployed `isTestLlmCall`; run `scripts/backfillLlmIsTest.ts` (dry-run → apply) to correct historical rows.
- [ ] If H1/backfillable: run the appropriate backfill script (`--dry-run` then `--apply`).
- [ ] Document any unbackfillable window explicitly (per the existing caveat) rather than silently leaving the gap.

### Phase 3: Verify + guard against regression
- [ ] Re-run the reconciliation query on dev; confirm dashboard total now matches `evolution_agent_invocations` truth (~$40-60).
- [ ] Confirm the audit-gap banner / reconciliation action reflects the corrected state.
- [ ] Add/extend a test so the dashboard total can't silently undercount evolution spend again.

## Testing

### Unit Tests
- [ ] `src/lib/services/costAnalytics.test.ts` — dashboard total includes evolution `evolution_agent_invocations` fallback when `llmCallTracking` rows are missing (if Option B taken).
- [ ] `src/lib/services/llmCostAttribution.test.ts` — `attributeCallSource` folds evolution sources correctly (if touched).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` (existing) — extend to assert reconciliation `llmCallTracking` vs `evolution_agent_invocations` parity for non-test rows.

### E2E Tests
- [ ] (If UI changes) `src/__tests__/e2e/specs/09-admin/admin-evolution-cost-split.spec.ts` — dashboard headline reflects evolution truth.

### Manual Verification
- [ ] `npm run query:staging` reconciliation query before/after shows the gap closed.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Load `/admin/costs` on a local server; confirm past-7-day total matches the reconciliation truth (only if dashboard read-path changes).

### B) Automated Tests
- [ ] `npm run test:unit -- costAnalytics`
- [ ] `npm run test:integration -- --grep "cost-attribution"`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/cost_optimization.md` — update the audit-gap caveat with the final past-week resolution + any backfill performed.
- [ ] `docs/feature_deep_dives/admin_panel.md` — note any dashboard read-path / fallback change.
- [ ] `evolution/docs/metrics.md` — if the cost read path changes.
- [ ] `evolution/docs/evolution_metrics.md` — currently a stub; fill in if cost rollups are touched.
- [ ] `evolution/docs/data_model.md` — if any cost schema/RPC changes.
- [ ] `evolution/docs/reference.md` — if `costAnalytics.ts` behavior changes.
- [ ] `docs/feature_deep_dives/metrics_analytics.md` — likely no change (user-engagement metrics).

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
