# Reduce E2E Testing LLM Costs Plan

## Background

Reduce LLM spending across the project, with a focus on cutting the staging burn that accumulates from the E2E test pipeline. Last 7 days on staging totaled $18.51, of which 86% ($15.93) was driven by E2E specs inserting pending `evolution_runs` rows that the minicomputer's systemd runner then claims and executes against real LLM providers. Goals: stop test-induced production-equivalent spend, audit the per-PR + nightly E2E cost shape, and reduce ongoing burn without losing test coverage. Secondary: tighten the audit gap so per-call cost can be drilled to `call_source`.

## Requirements (from GH Issue #NNN)

Figure out how to reduce LLM spending.

(Description "same as above" — investigation-first scoping; concrete deliverables formalized below after `/research` deepens the cost model.)

## Problem

The minicomputer's `processRunQueue.ts` systemd runner claims pending `evolution_runs` rows from staging every 60s, and the `claim_evolution_run` Postgres RPC selects strictly by `status='pending'` without consulting `evolution_strategies.is_test_content`. E2E and integration tests routinely insert `[TEST]`-prefixed strategies + prompts + pending runs as fixtures; the runner can't tell them apart from real work and executes the full pipeline against real providers, burning ~$15/week. The fix is structural — gate the claim RPC on `is_test_content` — but the project should also audit the broader test-cost surface (nightly real-AI smoke, per-PR E2E cadence, cleanup of stale test rows) and tighten cost attribution per memory `feedback_cost_tracking_fail_closed`.

## Options Considered

- [ ] **Option A: Claim-gate migration only**: One migration that adds `JOIN evolution_strategies ... WHERE NOT is_test_content` to `claim_evolution_run`. Minimal scope, ~$15/week saved, ships in a day. No other changes.
- [ ] **Option B: Claim gate + janitor sweep + nightly cost audit (Recommended)**: Option A plus (a) a periodic cleanup of `[TEST]`/`[TEST_EVO]` rows older than N days so staging DB stays clean, (b) a quantified breakdown of nightly real-AI smoke spend with a tunable cap, (c) follow-up alarms when test spend creeps back up.
- [ ] **Option C: Comprehensive rewrite — mock-by-default tests**: Refactor the 5 E2E specs that insert pending runs to use a mock LLM client (Playwright route interception) instead of the real one. Eliminates the burn at source but requires updates to ~5 specs + test infrastructure + risks reducing realism. Likely deferred to a follow-up.
- [ ] **Option D: Audit-gap repair scope-in**: Fold the per-call cost-tracking fix (see `evolution/docs/cost_optimization.md` audit-gap caveat) into this project. Bigger scope; restores per-call drill-down on top of cost reduction. May warrant its own project.

## Phased Execution Plan

### Phase 1: Quantify and validate
- [ ] Confirm 7-day spend numbers on staging via paginated `evolution_agent_invocations` query (already done at /initialize discovery)
- [ ] Re-run the same query on a 30-day window to establish baseline trend
- [ ] Quantify nightly real-AI smoke cost contribution by call_source = `evolution_seed_*` over 14 days
- [ ] Identify all 5 E2E specs that insert pending evolution_runs; check whether any deliberately want real LLM execution
- [ ] Decide on Option A vs B vs C vs D scope with user

### Phase 2: Claim-gate fix (assumes Option A or B)
- [ ] Migration `<ts>_claim_evolution_run_skip_test_content.sql` — `CREATE OR REPLACE FUNCTION claim_evolution_run(...)` that joins `evolution_strategies` and filters `WHERE NOT s.is_test_content` in the inner SELECT
- [ ] Migration must preserve `FOR UPDATE SKIP LOCKED`, `p_run_id` targeted-claim path (UI-triggered retries still work), and `p_max_concurrent` enforcement
- [ ] Add `NOTIFY pgrst, 'reload schema';` if relevant (no — function signature is unchanged, no need)
- [ ] Unit-test the SQL via integration test that inserts a test strategy + pending run and asserts `claim_evolution_run` returns empty (then inserts a real strategy + pending run and asserts it does claim)

### Phase 3: Cleanup & monitoring (Option B)
- [ ] Either extend `cleanupAllTrackedEvolutionData` helper or add a janitor script to hard-delete `[TEST]`/`[TEST_EVO]` strategies + prompts + runs older than 14 days
- [ ] Add an alarm: detect if test spend creeps back up (e.g., daily `SUM(cost_usd) WHERE strategy is_test_content` exceeds $1)
- [ ] Document the runbook in `evolution/docs/cost_optimization.md` under a new "Test cost containment" section

### Phase 4: Provider + app cap audit
- [ ] Verify provider-side monthly caps match `docs/docs_overall/llm_provider_limits.md` recommended values
- [ ] Verify `llm_cost_config` daily/monthly caps in the staging + production `llm_cost_config` table
- [ ] Confirm `LLMSpendingGate` kill switch is reachable from admin UI (`/admin/costs`)

### Phase 5 (optional, scoped separately): Audit-gap repair
- [ ] If Option D agreed: investigate why `llmCallTracking` rows are missing `evolution_*` `call_source` since 2026-02-22 on staging
- [ ] Decision: in-scope here, or spin out as its own project per `cost_optimization.md`

## Testing

### Unit Tests
- [ ] No unit-testable code paths (migration-only); skip

### Integration Tests
- [ ] `src/__tests__/integration/evolution-claim-test-content-filter.integration.test.ts` (new) — verify the claim RPC skips test-content strategies and still claims non-test strategies
- [ ] Re-run `evolution-claim.integration.test.ts` to confirm no regression on the existing claim flow

### E2E Tests
- [ ] Re-run `admin-evolution-iterative-editing.spec.ts` to confirm the test-inserted pending run is no longer claimed
- [ ] Re-run `admin-evolution-run-pipeline.spec.ts` similarly

### Manual Verification
- [ ] Insert a `[TEST]`-strategy pending run on staging, wait 2 systemd timer cycles, confirm `runner_id` stays NULL
- [ ] Insert a real (non-test) strategy pending run, wait 1 cycle, confirm it gets claimed

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — backend RPC change only

### B) Automated Tests
- [ ] `npm run test:integration -- --grep "claim"` — runs both the new test-content-filter test and the existing claim-flow test
- [ ] `npm run test:e2e:evolution` — runs the evolution E2E suite (those specs that insert pending runs)
- [ ] Migration verify: `npm run migration:verify` (ephemeral postgres apply test for the new claim RPC)
- [ ] 7-day post-merge cost check: paginated query of `evolution_agent_invocations` over the week after merge, confirm test-strategy spend drops from ~$15 to ~$0

## Documentation Updates

The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/cost_optimization.md` — add a "Test cost containment" section with the claim-gate behavior + janitor + alarms
- [ ] `evolution/docs/minicomputer_deployment.md` — document that the runner now skips test-content strategies; useful for ops debugging when "why isn't my test fixture run executing?" comes up
- [ ] `evolution/docs/data_model.md` — note the `is_test_content` filter on `claim_evolution_run` alongside the existing trigger
- [ ] `docs/feature_deep_dives/admin_panel.md` — `/admin/evolution/runs` still shows test runs as pending forever; document that this is now expected and the janitor handles them
- [ ] `docs/docs_overall/testing_overview.md` — Test Data Management section can note that E2E specs are free to insert pending evolution runs without burning provider $$
- [ ] `docs/docs_overall/llm_provider_limits.md` — refresh recommended caps if Phase 4 finds drift

## Review & Discussion

*This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration.*
