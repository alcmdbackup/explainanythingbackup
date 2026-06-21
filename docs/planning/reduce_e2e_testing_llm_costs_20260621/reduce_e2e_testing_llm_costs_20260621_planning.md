# Reduce E2E Testing LLM Costs Plan

## Background

Reduce LLM spending across the project, with a focus on cutting the staging burn that accumulates from the E2E test pipeline. Last 7 days on staging totaled $18.35, of which 86% ($15.76) was driven by E2E specs inserting pending `evolution_runs` rows that the minicomputer's systemd runner then claims and executes against real LLM providers. Goals: stop test-induced production-equivalent spend, audit the per-PR + nightly E2E cost shape, and reduce ongoing burn without losing test coverage. Secondary: tighten the audit gap so per-call cost can be drilled to `call_source` (out of scope; flagged as follow-up).

## Requirements (from GH Issue #NNN)

Figure out how to reduce LLM spending.

(Description "same as above" — investigation-first scoping; concrete deliverables formalized below after `/research` deepens the cost model.)

## Project decisions (locked in conversation)

- **Test LLM model**: `deepseek-v4-flash` ($0.14 in / $0.28 out per 1M) for `generationModel`, `judgeModel`, `TEST_LLM_MODEL`, and the new Layer-3 nightly smoke. Chosen over qwen-2.5-7b-instruct ($0.10 out) for provider diversification.
- **Architecture**: opt-in column (`allow_test_execution`) on `evolution_runs` rather than naive `is_test_content` exclusion — preserves coverage for integration tests that need to exercise queue-claim semantics.
- **Min-config defaults**: `createTestStrategyConfig` returns single-iteration single-tactic config with `budget_cap_usd: 0.02` ceiling.

## Problem

The minicomputer's `processRunQueue.ts` systemd runner claims pending `evolution_runs` rows from staging every 60s, and the `claim_evolution_run` Postgres RPC selects strictly by `status='pending'` without consulting `evolution_strategies.is_test_content`. E2E and integration tests routinely insert `[TEST]`-prefixed strategies + prompts + pending runs as fixtures; the runner can't tell them apart from real work and executes the full pipeline against real providers, burning ~$15/week. The fix is structural — gate the claim RPC — but must preserve coverage for tests that genuinely want to verify pipeline execution.

## Test surface inventory (Pattern A vs B)

Classification of every test that inserts pending `evolution_runs` rows or invokes the runner code path. Performed by grep across `src/__tests__/`, `evolution/src/__tests__/`, and `evolution/scripts/`.

### Pattern A — needs runner to claim + execute the pending row

These tests verify behavior that requires the pipeline to actually run (real or mocked LLM, but executed end-to-end). They MUST continue to work after the gate ships.

**Pattern A-1: E2E specs using TARGETED claim via `/api/evolution/run`** (4 specs)

These insert a pending run, then POST `targetRunId` to `/api/evolution/run`, which calls `claimAndExecuteRun({ runnerId, runId })` synchronously inside the API route handler. The RPC's `p_run_id` parameter routes around the queue entirely.

| Spec | Triggers via | Real LLM cost per run? |
|---|---|---|
| `src/__tests__/e2e/specs/09-admin/evolution-seed.prod-ai.spec.ts:102` | `/api/evolution/run` POST | Yes — `@prod-ai` tag, explicitly real-LLM |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-budget-dispatch.spec.ts:64` | `/api/evolution/run` POST | Yes — tests budget enforcement during real dispatch |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts:160` | `/api/evolution/run` POST | Yes — verifies variant production |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts:146` | `/api/evolution/run` POST | Yes — full pipeline e2e |

**These need NO opt-in column** — targeted claim bypasses the queue gate automatically (see migration sketch below).

**Pattern A-2: Integration tests using QUEUE claim** (4-6 tests)

These call `claimAndExecuteRun({ runnerId })` without `runId` to exercise the queue-pickup path. LLM is mocked at the Jest layer (per `docs/feature_deep_dives/testing_setup.md` — "Integration: OpenAI mocked"), so no real money is spent. But the gate breaks them unless they opt in.

| Test | Purpose | Action |
|---|---|---|
| `src/__tests__/integration/evolution-claim.integration.test.ts:76` | Tests `claim_evolution_run` RPC + concurrency limits | Add `allow_test_execution: true` to fixture runs |
| `src/__tests__/integration/evolution-empty-run-cost-init.integration.test.ts` | Tests cost initialization during claim | Add `allow_test_execution: true` |
| `src/__tests__/integration/evolution-visualization-data.integration.test.ts:67,111` | Inserts pending + calls runner to verify visualization | Add `allow_test_execution: true` |
| `evolution/src/lib/pipeline/finalize/seed-arena-update.integration.test.ts` | Tests seed arena sync via runner | Add `allow_test_execution: true` (likely) |
| `evolution/src/lib/pipeline/finalize/seed-concurrent-race.integration.test.ts` | Tests concurrent seed-row race | Add `allow_test_execution: true` (likely) |
| `evolution/src/lib/pipeline/loop/evolution-seed-cost.integration.test.ts` | Tests seed cost flow via runner | Add `allow_test_execution: true` (likely) |
| `evolution/src/__tests__/integration/evolution-subagent-metrics-finalization.integration.test.ts` | Tests metric finalization via runner | Add `allow_test_execution: true` (likely) |

(Specific need for opt-in confirmed only where lines were inspected; the 4 "likely" entries need verification during Phase 2 execution.)

### Pattern B — fixture data only, never wants execution

These insert pending rows AS DATA (to test admin UI rendering, watchdog cleanup, cancel_experiment semantics, etc.) and explicitly do NOT want the runner to touch them. The naive gate is correct for them — they automatically benefit, no changes needed.

**Pattern B-1: E2E specs inserting pending rows as fixture only** (2 specs)

| Spec | Purpose |
|---|---|
| `src/__tests__/e2e/specs/09-admin/admin-evolution-runs.spec.ts:59` | Inserts `completed`/`failed`/`pending` rows to test status-filter dropdown in admin UI |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-criteria-pipeline.spec.ts` | Comment line 1-3: "Seeds a synthetic invocation directly so this can run on every PR **without a real LLM round-trip**." Inserts run + invocation row directly, no execution |

**Pattern B-2: Integration tests inserting pending rows for assertion** (4+ tests)

| Test | Purpose |
|---|---|
| `src/__tests__/integration/evolution-cancel-experiment.integration.test.ts:66` | Pending row + 2 other statuses; tests `cancel_experiment` RPC transitions them to `cancelled` |
| `src/__tests__/integration/evolution-experiment-create-complete.integration.test.ts:95` | Pending row as fixture for experiment-creation flow |
| `src/__tests__/integration/evolution-visualization-data.integration.test.ts:67` | Pending row as data point for visualization rendering |
| `src/__tests__/integration/evolution-watchdog.integration.test.ts:140,164` | Pending row + stale `last_heartbeat`; tests watchdog converts to `failed`. Wants the runner NOT to claim — the gate is exactly what this test now expects |

**Pattern B-3: Specs/tests that never insert pending status** (majority of admin-evolution-*.spec.ts files)

The ~20 other admin-evolution-* specs in the inventory grep (e.g., `admin-arena.spec.ts`, `admin-evolution-dashboard.spec.ts`, `admin-evolution-experiments-list.spec.ts`, etc.) reference `evolution_runs` but only INSERT with `status='completed'` or update existing rows. Already safe; nothing changes.

### Summary table

| Pattern | Count | Real LLM cost today | Real LLM cost post-fix |
|---|---:|---|---|
| A-1 (E2E targeted claim) | 4 | ~$0.20/run × N CI runs/day | **~$0.01-0.02/run** (min-config + $0.02 cap) |
| A-2 (integration queue claim) | 4-7 | $0 (LLM mocked) | $0 (LLM mocked, opt-in to bypass gate) |
| B-1 (E2E pending fixture) | 2 | ~$0.20 ONLY if runner races to claim | $0 (gate skips) |
| B-2 (integration pending fixture) | 4+ | ~$0.20 ONLY if runner races to claim | $0 (gate skips) |
| B-3 (no pending insertion) | ~20 | $0 | $0 |

## Options Considered

- [ ] **Option A: Claim-gate migration only**: One migration adds `is_test_content` filter to `claim_evolution_run`. Saves ~$15/week. No spec changes.
- [ ] **Option B: Claim gate + opt-in column + min-config + cheapest model + nightly smoke + janitor (Recommended — supersedes original B)**: The full architecture detailed below. Saves ~$17/week (94% reduction), preserves all existing test coverage, adds new nightly smoke as the only structural ongoing cost.
- [ ] **Option C: Comprehensive rewrite — mock LLM at runner layer**: Build a mock provider that the runner uses for any `is_test_content=true` strategy. Cleanest long-term but multi-day infrastructure project. Defer to follow-up.
- [ ] **Option D: Audit-gap repair**: Fold the `llmCallTracking` per-call attribution fix into this project. Bigger scope. **Recommendation: spin out as separate follow-up project** per `cost_optimization.md`.
- [ ] **Option E: Cheapest-model swap (stack-able with any of A/B/C)**: Swap `gpt-4.1-mini` → `deepseek-v4-flash` in test helpers + `TEST_LLM_MODEL` in nightly workflow. Stacking option, not a standalone choice.

**Recommended: Option B (which folds in Option E and is structured to allow Option D to be a clean follow-up).**

## Phased Execution Plan

### Phase 1: Quantify + audit

- [ ] Re-confirm the 7-day staging breakdown from `_research.md` against a fresh paginated query (done at /initialize; verify nothing has drifted)
- [ ] Run the same 7-day breakdown shape against PROD via `npm run query:prod` to confirm prod cost isolation (staging-only problem or partial bleed?)
- [ ] Audit current `e2e-real-ai-smoke.yml` cost over the last 7 nightly runs from GH Actions metadata
- [ ] Read the 4-7 Pattern A-2 integration tests in full to confirm each genuinely needs queue-claim semantics vs. could refactor to targeted-claim

### Phase 2: Claim-gate migration + opt-in column

- [ ] Migration `<ts>_claim_evolution_run_skip_test_content.sql`:
  ```sql
  ALTER TABLE evolution_runs
    ADD COLUMN IF NOT EXISTS allow_test_execution boolean NOT NULL DEFAULT false;

  CREATE OR REPLACE FUNCTION claim_evolution_run(
    p_runner_id TEXT,
    p_run_id UUID DEFAULT NULL,
    p_max_concurrent INT DEFAULT 5
  )
  RETURNS SETOF evolution_runs AS $$
  ...
  RETURN QUERY
  UPDATE evolution_runs SET status='claimed', runner_id=p_runner_id, last_heartbeat=now()
  WHERE id = (
    SELECT r.id
    FROM evolution_runs r
    LEFT JOIN evolution_strategies s ON s.id = r.strategy_id
    WHERE r.status = 'pending'
      AND (
        p_run_id IS NOT NULL                              -- targeted claim: bypass gate (caller is explicit)
        OR NOT COALESCE(s.is_test_content, false)        -- queue claim: real strategies only
        OR r.allow_test_execution = true                  -- queue claim: explicit opt-in for integration tests
      )
      AND (p_run_id IS NULL OR r.id = p_run_id)
    ORDER BY r.created_at ASC LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
  END;
  $$;
  ```
- [ ] Preserve `FOR UPDATE SKIP LOCKED`, `p_max_concurrent` enforcement, and stale-claim expiry path (port from `20260323000002_fix_stale_claim_expiry.sql`)
- [ ] Idempotency lint passes (`CREATE OR REPLACE FUNCTION` + `ADD COLUMN IF NOT EXISTS`)
- [ ] No PostgREST cache reload needed — function signature unchanged

### Phase 2.5: Min-config + cheapest-model helper change

- [ ] Update `evolution/src/testing/evolution-test-helpers.ts:206-223` `createTestStrategyConfig`:
  ```ts
  config: {
    generationModel: 'deepseek-v4-flash',
    judgeModel: 'deepseek-v4-flash',
    strategiesPerRound: 1,
    calibrationOpponents: 2,
    tournamentTopK: 2,
    iterationConfigs: [{ agentType: 'generate', budgetPercent: 100, maxAgents: 1 }],
  }
  ```
- [ ] Update `createTestEvolutionRun` (lines ~250+) — change `budget_cap_usd` default from `5.0` to **`0.02`**
- [ ] Update `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` `createTestRun` — same `budget_cap_usd: 0.02` default
- [ ] Update `.github/workflows/e2e-real-ai-smoke.yml:30` — `TEST_LLM_MODEL: deepseek-v4-flash` (currently `google/gemini-2.5-flash`)
- [ ] Quick local test: run `evolution-seed.prod-ai.spec.ts` against `deepseek-v4-flash` to confirm DeepSeek handles the format-validation path (must produce valid markdown article with proper headings)
- [ ] Confirm `DEEPSEEK_API_KEY` is set in CI environment (it should be — per `environments.md` Repository Secrets table)

### Phase 2.6: Pattern A-2 opt-in updates

- [ ] In each Pattern A-2 integration test file, add `allow_test_execution: true` to the run-row insert payload
- [ ] Files (confirmed from inventory):
  - `src/__tests__/integration/evolution-claim.integration.test.ts`
  - `src/__tests__/integration/evolution-empty-run-cost-init.integration.test.ts`
  - `src/__tests__/integration/evolution-visualization-data.integration.test.ts`
  - `evolution/src/lib/pipeline/finalize/seed-arena-update.integration.test.ts` (verify need)
  - `evolution/src/lib/pipeline/finalize/seed-concurrent-race.integration.test.ts` (verify need)
  - `evolution/src/lib/pipeline/loop/evolution-seed-cost.integration.test.ts` (verify need)
  - `evolution/src/__tests__/integration/evolution-subagent-metrics-finalization.integration.test.ts` (verify need)
- [ ] Each helper that creates a queue-claimable test fixture takes a new optional `allowTestExecution?: boolean` flag (default false)

### Phase 3: Cleanup & monitoring

- [ ] **Janitor**: weekly CI job or systemd timer (TBD) that deletes:
  - `evolution_strategies WHERE is_test_content = true AND last_used_at < now() - interval '14 days'`
  - CASCADE handles runs/variants/invocations/comparisons
  - Dry-run default; `--apply` flag explicit
- [ ] **Alarm**: daily query — if `SUM(invocation cost) WHERE strategy.is_test_content = true AND created_at > now() - 24h` exceeds **$0.10**, file `[release-health]` issue (same plumbing as nightly E2E alerts)
- [ ] **Layer-3 nightly smoke**: new `.github/workflows/evolution-nightly-smoke.yml`:
  - One workflow, fires nightly at 6 AM UTC (or shortly after `e2e-nightly.yml`)
  - Inserts a pending run pointing at a pre-seeded `[FIXTURE]` real-classified strategy (NOT `[TEST]`) with `generationModel: deepseek-v4-flash`, min-config, `budget_cap_usd: 0.05`
  - Watcher polls 15 min for `status='completed'`
  - Asserts: ≥1 row in `evolution_variants`, content non-empty, `SUM(cost_usd) ≤ $0.05`
  - Slack alert on failure
  - Expected cost: ~$0.005/night = **$1.83/year**
- [ ] Document in `evolution/docs/cost_optimization.md` under new "Test cost containment" section

### Phase 4: Provider + app cap audit

- [ ] Verify OpenAI/DeepSeek/Anthropic/OpenRouter monthly caps match `docs/docs_overall/llm_provider_limits.md` recommended values
- [ ] Verify `llm_cost_config` daily/monthly/evolution-daily caps in staging + production DBs
- [ ] Confirm `LLMSpendingGate` kill switch reachable via `/admin/costs`
- [ ] Confirm Slack webhook for spend-threshold alerts is configured at provider dashboards (50%/80%/100% notifications)

### Phase 5 (out of scope; flag follow-up project)

- [ ] Audit-gap repair: `llmCallTracking` is missing `evolution_*` `call_source` rows since 2026-02-22. Per `cost_optimization.md`, spin out as `fix_evolution_llmcalltracking_audit_gap_<date>` — multi-day investigation, not in this project's critical path.

## Updated cost projection

| | Current | Phase 2 (gate only) | + Phase 2.5 (min-config + DeepSeek) | + Phase 3 (full plan) |
|---|---:|---:|---:|---:|
| Pattern B claims (queue-races) | ~$0.50/week | $0 | $0 | $0 |
| `[TEST] strategy_*` queue claims | $14.72 | **$0** | $0 | $0 |
| `[TEST_EVO]` queue claims | $1.04 | **$0** | $0 | $0 |
| Pattern A-1 (E2E targeted) | ~$2/week | ~$2 | **~$0.30** | ~$0.30 |
| Pattern A-2 (integration mocked) | $0 | $0 | $0 | $0 |
| Layer-3 nightly smoke (NEW) | n/a | n/a | n/a | $0.05 |
| Real non-test production | $0.39 | $0.39 | $0.39 | $0.39 |
| **Staging total** | **~$18.65** | **~$2.39** | **~$0.69** | **~$0.74** |
| **Reduction vs current** | (baseline) | 87% | **96%** | **96%** |

## Testing

### Unit Tests
- [ ] No new unit-testable code paths (migration + helper config changes). Existing tests must not regress.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-claim.integration.test.ts` (updated) — add cases:
  - Test fixture without `allow_test_execution` → queue claim skips
  - Test fixture WITH `allow_test_execution=true` → queue claim succeeds
  - Real-name strategy → queue claim succeeds (unchanged)
  - Targeted claim on test fixture (no opt-in) → succeeds (bypass)
- [ ] `evolution-watchdog.integration.test.ts` — confirm watchdog still converts stale pending to failed despite the gate (it doesn't go through claim_evolution_run; uses its own update path)
- [ ] Re-run all integration tests in `Pattern A-2` after adding `allow_test_execution: true`

### E2E Tests
- [ ] Re-run all 4 Pattern A-1 specs — they use targeted claim, should work unchanged
- [ ] Re-run all Pattern B specs — they assert against fixture rows; gate prevents racing runner claims (more reliable, not less)
- [ ] Run `evolution-seed.prod-ai.spec.ts` with new `deepseek-v4-flash` config — confirm DeepSeek output passes format validation

### Manual Verification
- [ ] Insert a `[TEST]`-name strategy + pending run on staging; wait 2 systemd timer cycles; confirm `runner_id` stays NULL
- [ ] Insert same fixture but with `allow_test_execution: true`; confirm runner DOES claim
- [ ] Insert real-name strategy + pending run; confirm runner claims (regression check)
- [ ] Hit `/api/evolution/run` with `targetRunId` pointing at a `[TEST]` strategy run — confirm it claims (bypass works)

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes

### B) Automated Tests
- [ ] `npm run test:integration -- --grep "claim"` — passes including new opt-in cases
- [ ] `npm run test:e2e:evolution` — all evolution E2E specs pass (Pattern A-1 + B specs)
- [ ] `npm run migration:verify` — new migration applies cleanly on ephemeral postgres
- [ ] **7-day post-merge cost check**: paginated query of `evolution_agent_invocations` over the week after merge; confirm test-strategy spend (`is_test_content=true` strategies) drops from ~$15.76 to ~$0
- [ ] **Cost-alarm test**: deliberately trigger >$0.10 of test-bucket spend in a day; confirm `[release-health]` issue is filed

## Documentation Updates

- [ ] `evolution/docs/cost_optimization.md` — add "Test cost containment" section with claim-gate behavior, `allow_test_execution` column semantics, janitor + alarms
- [ ] `evolution/docs/minicomputer_deployment.md` — document that the runner now skips `is_test_content` strategies (and the opt-in column override)
- [ ] `evolution/docs/data_model.md` — document new `evolution_runs.allow_test_execution` column + updated `claim_evolution_run` RPC behavior
- [ ] `evolution/docs/reference.md` — update `claim_evolution_run` reference + helper signatures
- [ ] `docs/feature_deep_dives/admin_panel.md` — note that `/admin/evolution/runs` may show stale `[TEST]` pending rows until janitor sweeps
- [ ] `docs/docs_overall/testing_overview.md` — Test Data Management section: E2E specs are free to insert pending evolution_runs without burning provider $$ (and how to opt in if needed)
- [ ] `docs/docs_overall/llm_provider_limits.md` — refresh recommended caps if Phase 4 finds drift
- [ ] `docs/feature_deep_dives/testing_setup.md` — document `createTestStrategyConfig` new defaults (DeepSeek, min-config, $0.02 budget cap)

## Review & Discussion

*This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration.*
