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

### Phase 0: Root-cause the runner write-path bypass (gates Option A) — Open Q5
Research established (do NOT re-litigate; pick up from here):
- [x] Executor = the minicomputer evolution-runner (`processRunQueue.ts`, systemd 60s). It is **NOT stale** (worktree0 on post-fix `de2113413`); `claimAndExecuteRun.ts:204-223` routes calls through `callLLM` with `requireTracking:true` + `trackingDb` + `evolutionInvocationId`.
- [x] **Wrong-target hypothesis FALSIFIED** (read-only prod query): prod `llmCallTracking` has 0 evolution rows — writes go to neither DB.
- [x] Conclusion: the runner's evolution LLM calls **never invoke `saveTrackingAndNotify`** (success=true + no rows on either DB + no dead-letters). The ~$0.04/30d evolution rows on staging come from the `/api/evolution/run` route, not the runner.
- [ ] **Remaining (code-level `/debug`):** trace why the runner's agents don't use the `requireTracking`-configured `rawProvider` — prime suspect is `Agent.run()`'s per-invocation `EvolutionLLMClient` rebuild (`Agent.ts:~129-141`) dropping `requireTracking`/`trackingDb`, and the `EVOLUTION_FK_THREADING_ENABLED` interaction. Confirm against a live local run.
- [ ] Decide Option A landing here vs forward-only follow-up — **does not block Option B**.

### Phase 1: Canonical unified cost source (Option B + D)
- [ ] Design a canonical cost read (DB view or RPC, e.g. `llm_spend_unified`) that UNIONs: non-evolution rows from `llmCallTracking` + evolution spend from `evolution_agent_invocations.cost_usd`, **dedup-safe** (exclude the few evolution rows already in `llmCallTracking` to avoid double-count).
- [ ] Carry a first-class `is_test` discriminator (Option D): non-evo from `llmCallTracking.is_test`; evo from strategy `is_test_content`. Expose category (`evolution`/`non_evolution`) + entity attribution.
- [ ] Repoint `get_llm_spend_buckets` (and the summary/by-model/by-entity/daily paths) at the canonical source so every `/admin/costs` surface reflects complete spend.
- [ ] Migration is idempotent + passes `npm run lint:migrations`.

### Phase 2: `/admin/costs` UI — show complete + split spend (Option D)
- [ ] Headline "Total Cost" reflects the canonical total (evolution + non-evolution), no longer ~$0 for evolution.
- [ ] Test vs real shown as a first-class split (stacked chart / By-Entity), not just toggled out.
- [ ] Keep/retire the audit-gap banner depending on whether the canonical read makes it moot.

### Phase 3: Write-path hardening — the "can't silently under-report" guarantee (Option A, 3 layers)
The foundational ask: evolution writes `llmCallTracking` going forward, and *anything* that calls an LLM without recording spend is caught. Three complementary enforcement layers (no single layer is sufficient — see rationale below):

- [ ] **Layer 1 — Runtime fail-closed by default.** Flip `requireTracking` from opt-in to default-on (`src/lib/services/llms.ts:286` `?? false` → fail-closed default, at minimum for all evolution call sites; evaluate system-wide). A call that *reaches* `callLLM` but can't record spend then throws instead of silently continuing. Catches the "went through the chokepoint, write failed" class.
- [ ] **Layer 2 — Close the runner bypass + keep the static CI guard.** Fix the Phase-0 root cause so the runner's calls actually traverse the `requireTracking` chokepoint. Verify `npm run check:llm-coverage` (`scripts/check-llm-call-coverage.ts`, already wired into `npm run lint`) would catch the bypass class (direct SDK / direct `llmCallTracking.insert`); extend its patterns/allowlist if the runner path is a new shape. Catches "bypasses the chokepoint entirely" (the only layer that can — a runtime guard can't fire on a path it never reaches).
- [ ] **Layer 3 — Reconciliation assertion (NEW — catches the silent-divergence class that slipped past Layers 1+2).** Assert that every `evolution_agent_invocations` row with `cost_usd > 0` has ≥1 joining `llmCallTracking` row. Wire as: (a) a run-finalization check that flags divergence, and/or (b) a scheduled monitor (mirror `evolution-run-health.yml`) that files a `[release-health]` issue when the per-week tracked-vs-invocation evolution totals diverge beyond a threshold. This is the durable guarantee — it would have caught the current bug, which was wired-correctly-but-silently-not-writing.
- [ ] Ensure no double-count once both stores carry evolution rows (canonical view dedup must hold).

**Rationale (why 3 layers):** Layer 1 throws only for calls that reach the chokepoint; Layer 2 (static CI) is the only thing that can see a call that bypasses the chokepoint; Layer 3 catches the residual "configured correctly yet no row appears" case that neither a runtime throw nor a static scan detects — exactly the failure mode observed in this investigation.

### Phase 4: Verify + guard against regression
- [ ] Re-run reconciliation on dev; confirm `/admin/costs` total now matches `evolution_agent_invocations` truth and splits test/real correctly.
- [ ] Confirm all three Phase-3 enforcement layers are live (Layer 1 default-on throw, Layer 2 coverage guard green, Layer 3 reconciliation assertion wired) — the foundational "can't silently under-report" guarantee.

## Testing

### Unit Tests
- [ ] `src/lib/services/costAnalytics.test.ts` — canonical-source path returns evolution spend from `evolution_agent_invocations` when `llmCallTracking` evolution rows are absent; non-evolution still from `llmCallTracking`; no double-count for the few evolution rows present in both (Phase 1/B).
- [ ] `src/lib/services/llmCostAttribution.test.ts` — `attributeCallSource` folds evolution sources correctly; test/real category split (Option D).
- [ ] `src/lib/services/llms.test.ts` — **Layer 1**: with `requireTracking` now default-on, a tracking-write failure on an evolution call throws (does not silently return); explicit non-evolution opt-out still allowed if we keep one.
- [ ] `scripts/check-llm-call-coverage.test.ts` (existing) — **Layer 2**: extend so the runner's provider-call shape is covered by a bypass pattern (or consciously allowlisted with a documented reason).

### Integration Tests
- [ ] `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` (existing) — extend to assert the canonical source equals `SUM(evolution_agent_invocations.cost_usd)` for evolution + `SUM(llmCallTracking)` for non-evolution over a window, dedup-safe.
- [ ] **Layer 3** reconciliation assertion test — seed an evolution run with `cost_usd>0` invocations and assert the reconciliation check flags the divergence when no `llmCallTracking` row exists, and passes when rows are present.

### E2E Tests
- [ ] (If UI changes) `src/__tests__/e2e/specs/09-admin/admin-evolution-cost-split.spec.ts` — `/admin/costs` headline reflects evolution truth (non-zero); test vs real split renders.

### Manual Verification
- [ ] `npm run query:staging` reconciliation query before/after shows the gap closed.
- [ ] After Phase 0/3 fix: trigger one local evolution run and confirm its `cost_usd>0` invocations now have joining `llmCallTracking` rows (Layer 1+2 effective).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Load `/admin/costs` on a local server; confirm past-7-day total matches the reconciliation truth (only if dashboard read-path changes).

### B) Automated Tests
- [ ] `npm run test:unit -- costAnalytics`
- [ ] `npm run test:unit -- llms` (Layer 1 default-on requireTracking)
- [ ] `npm run check:llm-coverage` (Layer 2 guard green)
- [ ] `npm run test:integration -- --grep "cost-attribution"` (canonical parity + Layer 3 reconciliation)

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
