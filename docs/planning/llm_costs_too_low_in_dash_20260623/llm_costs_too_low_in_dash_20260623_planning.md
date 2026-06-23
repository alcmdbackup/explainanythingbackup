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
- [x] **Option C: Both (CHOSEN, 2026-06-23)**: Option B canonical read NOW (fixes the dashboard + all surfaces immediately, incl. history) + Option A write-path hardening so the underlying ledger trends toward completeness going forward. Pros: addresses both "fix now" and "don't recur". Cons: largest scope — sequence carefully.
- [x] **Option D: Test-spend classification (CHOSEN, 2026-06-23 — cross-cutting)**: Ensure the canonical source carries a reliable evolution `is_test`/`is_test_content` discriminator so test vs real spend is a first-class, visible split (not just a filtered-out bucket) — so test money is "adequately accounted for." Threads through B (view columns) and A (write path).
- [ ] **Option E (rejected): Backfill `llmCallTracking` rows for the gap window** — documented non-backfillable (no per-call token data / join key). Data already exists in `evolution_agent_invocations`; reconstructing the audit table is not the fix.

## Phased Execution Plan (Option C + D)

### Phase 0: Pin down the write-path drop (gates Option A) — Open Q5 [RESOLVED in research; confirm executor in Phase 0]
- [x] Confirmed (research): HEAD wires evolution tracking correctly, but dev runs **today** (`success=true`, cost>0, 0 tracking rows) prove the executing path bypasses the `requireTracking` fail-closed chokepoint — the gap is live, not just history.
- [ ] Identify the executor of dev evolution runs (stale local `processRunQueue` runner on pre-fix code vs the HEAD `/api/evolution/run` route) — distinguishes cause (a) stale runner [operational fix: pull+restart] vs (b) a code path bypassing `saveTrackingAndNotify`.
- [ ] Scope Option A accordingly: operational (runner restart) and/or a code fix for any genuine bypass path. May be a forward-only follow-up — **does not block Option B**.

### Phase 1: Canonical unified cost source (Option B + D)
- [ ] Design a canonical cost read (DB view or RPC, e.g. `llm_spend_unified`) that UNIONs: non-evolution rows from `llmCallTracking` + evolution spend from `evolution_agent_invocations.cost_usd`, **dedup-safe** (exclude the few evolution rows already in `llmCallTracking` to avoid double-count).
- [ ] Carry a first-class `is_test` discriminator (Option D): non-evo from `llmCallTracking.is_test`; evo from strategy `is_test_content`. Expose category (`evolution`/`non_evolution`) + entity attribution.
- [ ] Repoint `get_llm_spend_buckets` (and the summary/by-model/by-entity/daily paths) at the canonical source so every `/admin/costs` surface reflects complete spend.
- [ ] Migration is idempotent + passes `npm run lint:migrations`.

### Phase 2: `/admin/costs` UI — show complete + split spend (Option D)
- [ ] Headline "Total Cost" reflects the canonical total (evolution + non-evolution), no longer ~$0 for evolution.
- [ ] Test vs real shown as a first-class split (stacked chart / By-Entity), not just toggled out.
- [ ] Keep/retire the audit-gap banner depending on whether the canonical read makes it moot.

### Phase 3: Write-path hardening (Option A — if Phase 0 says achievable)
- [ ] Close the dev write-path drop so new evolution calls land a `llmCallTracking` row (or document why it's a forward-only follow-up).
- [ ] Ensure no double-count once both stores carry evolution rows (canonical view dedup must hold).

### Phase 4: Verify + guard against regression
- [ ] Re-run reconciliation on dev; confirm `/admin/costs` total now matches `evolution_agent_invocations` truth and splits test/real correctly.
- [ ] Add a test asserting the canonical source can't silently drop evolution spend (the foundational guarantee).

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
