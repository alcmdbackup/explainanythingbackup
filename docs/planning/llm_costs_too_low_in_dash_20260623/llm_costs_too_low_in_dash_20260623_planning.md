# LLM Costs Too Low In Dashboard Plan

## Background
Evolution dashboard / cost reporting says ~$3 spent in the past week, but real total is more like $40-60. Figure out why by querying Supabase dev and making sure tests are adequately accounted for. Backfill if necessary.

## Requirements (from GH Issue #1263)
- The dashboard ("evolution docs say $3 spent in past week") under-reports LLM spend; real total is ~$40-60 for the same window.
- Investigate root cause by querying **Supabase dev** (`npm run query:staging`, read-only) — compare reported vs actual spend.
- Make sure **tests are adequately accounted for** — confirm the `is_test` discriminator isn't wrongly excluding real operational spend (or wrongly including test spend in the "real" figure).
- **Backfill if necessary** — repair historical/missing cost data where a valid join key exists.

## Problem (confirmed via dev DB — see research doc)
The `/admin/costs` dashboard reads ALL its spend numbers from `llmCallTracking` (summary card, by-model, by-user via direct query; stacked/by-entity via the `get_llm_spend_buckets` RPC; daily via the `daily_llm_costs` view). But `llmCallTracking` is **incomplete**: evolution LLM calls almost never write a row (only 10 of 21,841 invocations over 30d on dev; 479/517 recent real invocations still missing — the audit-gap persists). The evolution source of truth lives separately in `evolution_agent_invocations.cost_usd` (+ `evolution_metrics`). Result: `/admin/costs` sees ~$0.006/30d of evolution spend versus ~$38/30d actual. Separately, **89% of evolution cost is genuine test-strategy spend** that is also filtered/invisible. The foundational defect: there is **no single complete cost ledger** — any consumer that reads `llmCallTracking` under-reports total spend by the evolution amount, and this will recur for every new cost surface.

## Goal (per user decision)
Fix `/admin/costs` to stop under-reporting AND do **foundational rework** so a canonical, complete cost source captures **all** spend (evolution + non-evolution) — so current and future cost consumers cannot silently under-report. Scope: Dev only for now.

## Options Considered
- [ ] **Option A: Complete the ledger at the source (write-path fix)**: Make every evolution LLM call reliably write a `llmCallTracking` row (genuinely fail-closed on whatever dev path drops them; resolve Open-Q5 — pre-fix code vs a client that bypasses the `requireTracking` chokepoint). Then `llmCallTracking` is the single complete ledger and ALL consumers become correct automatically. Pros: truest "one ledger, no future under-report"; no read-time reconciliation. Cons: historical gap stays (unbackfillable); must find why writes drop; double-write risk vs `evolution_agent_invocations` needs dedup discipline.
- [ ] **Option B: Canonical unified cost read (view/RPC)**: Build one canonical cost view/RPC that UNIONs non-evolution `llmCallTracking` + evolution `evolution_agent_invocations` (dedup-safe — exclude the few evolution rows that DO exist in `llmCallTracking` to avoid double counting), with `is_test`/category columns. Point every cost consumer (`get_llm_spend_buckets`, `daily_llm_costs`, summary/by-model/by-entity, reconciliation) at it. Pros: correct even across the historical gap; one read contract for all surfaces. Cons: two physical stores persist; attribution/`is_test` parity between the two sources needs care.
- [ ] **Option C: Both (recommended starting point)**: Option B canonical read NOW (fixes the dashboard + all surfaces immediately, incl. history) + Option A write-path hardening so the underlying ledger trends toward completeness going forward. Pros: addresses both "fix now" and "don't recur". Cons: largest scope — sequence carefully.
- [ ] **Option D: Test-spend classification (cross-cutting, needed regardless)**: Ensure the canonical source carries a reliable evolution `is_test`/`is_test_content` discriminator so test vs real spend is a first-class, visible split (not just a filtered-out bucket) — so test money is "adequately accounted for." Folds into whichever of A/B/C is chosen.
- [ ] **Option E (rejected): Backfill `llmCallTracking` rows for the gap window** — documented non-backfillable (no per-call token data / join key). Data already exists in `evolution_agent_invocations`; reconstructing the audit table is not the fix.

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
