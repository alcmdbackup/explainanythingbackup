# Reduce E2E Testing LLM Costs Plan

## Background

Reduce LLM spending across the project, with a focus on cutting the staging burn that accumulates from the E2E test pipeline. Last 7 days on staging totaled $18.35, of which 86% ($15.76) was driven by E2E specs inserting pending `evolution_runs` rows that the minicomputer's systemd runner then claims and executes against real LLM providers. Goals: stop test-induced production-equivalent spend, audit the per-PR + nightly E2E cost shape, and reduce ongoing burn without losing test coverage. Secondary: tighten the audit gap so per-call cost can be drilled to `call_source` (out of scope; flagged as follow-up).

## Requirements (from GH Issue #NNN)

Figure out how to reduce LLM spending.

(Description "same as above" — investigation-first scoping; concrete deliverables formalized below after `/research` deepens the cost model.)

## Project decisions (locked in conversation)

- **Test LLM model**: `deepseek-v4-flash` ($0.14 in / $0.28 out per 1M) for `generationModel`, `judgeModel`, `TEST_LLM_MODEL`, and the new Layer-3 nightly smoke. Chosen over qwen-2.5-7b-instruct ($0.10 out) for provider diversification.
- **Architecture**: opt-in column (`allow_test_execution`) on `evolution_runs` rather than naive `is_test_content` exclusion — preserves coverage for integration tests that need to exercise queue-claim semantics.
- **Helper defaults UNCHANGED**: `createTestStrategyConfig` keeps its current `gpt-4.1-mini`/multi-iteration config to avoid breaking the ~50 integration tests that depend on it (Architecture reviewer Iter 1). Pattern A-1 specs already use INLINE configs (verified: 4/4 hard-code `generationModel`); they're the only ones that need DeepSeek + min-config swaps.
- **Atomic deploy**: Phase 2 (migration), Phase 2.5 (Pattern A-1 specs + workflow env), Phase 2.6 (Pattern A-2 opt-in updates) **MUST ship in a single PR**. Migrating in separate PRs would red-line CI between deploys.

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

**Pattern B-1: E2E specs inserting pending rows as fixture only** (4 specs — verified Iter 1)

| Spec | Purpose |
|---|---|
| `src/__tests__/e2e/specs/09-admin/admin-evolution-runs.spec.ts:59` | Inserts `completed`/`failed`/`pending` rows to test status-filter dropdown in admin UI |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-criteria-pipeline.spec.ts` | Comment line 1-3: "Seeds a synthetic invocation directly so this can run on every PR **without a real LLM round-trip**." Inserts run + invocation row directly, no execution |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-matches.spec.ts:27` | Calls `createTestRun({ promptId })` — default `status='pending'`. Used as parent row for arena comparison fixtures; no execution path verified |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-match-rubric-breakdown.spec.ts:26` | Calls `createTestRun({ promptId })` — same as above. Tests rubric breakdown rendering against fixture comparison rows |

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
- [x] **Option B: Claim gate + opt-in column + min-config + cheapest model + nightly smoke + janitor (Recommended — supersedes original B)**: The full architecture detailed below. Saves ~$17/week (94% reduction), preserves all existing test coverage, adds new nightly smoke as the only structural ongoing cost.
- [ ] **Option C: Comprehensive rewrite — mock LLM at runner layer**: Build a mock provider that the runner uses for any `is_test_content=true` strategy. Cleanest long-term but multi-day infrastructure project. Defer to follow-up.
- [ ] **Option D: Audit-gap repair**: Fold the `llmCallTracking` per-call attribution fix into this project. Bigger scope. **Recommendation: spin out as separate follow-up project** per `cost_optimization.md`.
- [ ] **Option E: Cheapest-model swap (stack-able with any of A/B/C)**: Swap `gpt-4.1-mini` → `deepseek-v4-flash` in test helpers + `TEST_LLM_MODEL` in nightly workflow. Stacking option, not a standalone choice.

**Recommended: Option B (which folds in Option E and is structured to allow Option D to be a clean follow-up).**

## Phased Execution Plan

### Phase 1: Quantify + audit (BLOCKING Phase 2 — must complete first)

- [x] Re-confirm the 7-day staging breakdown from `_research.md` against a fresh paginated query (done at /initialize; verify nothing has drifted)
- [x] Run the same 7-day breakdown shape against PROD via `npm run query:prod` to confirm prod cost isolation (staging-only problem or partial bleed?)
- [x] Audit current `e2e-real-ai-smoke.yml` cost over the last 7 nightly runs from GH Actions metadata
- [x] **Read each of the 4 "verify need" Pattern A-2 integration tests in full** and document which need `allow_test_execution: true`:
  - `evolution/src/lib/pipeline/finalize/seed-arena-update.integration.test.ts` → __ verdict
  - `evolution/src/lib/pipeline/finalize/seed-concurrent-race.integration.test.ts` → __ verdict
  - `evolution/src/lib/pipeline/loop/evolution-seed-cost.integration.test.ts` → __ verdict
  - `evolution/src/__tests__/integration/evolution-subagent-metrics-finalization.integration.test.ts` → __ verdict
- [x] Run `grep -rn "claimAndExecuteRun\|targetRunId" src/__tests__ evolution/src/__tests__` to confirm no other callers were missed
- [x] Pre-flight DeepSeek format-validation runs (Phase 2.5's merge-blocking pre-flight) — do these now so Phase 2 can ship with confidence the model swap is safe

### Phase 2: Claim-gate migration + opt-in column

Migration filename: **`supabase/migrations/20260621000001_evolution_claim_gate.sql`** (locked timestamp so it sorts before the Phase 3 fixture migration `20260621000002_evolution_nightly_smoke_fixture.sql`). **Full inline SQL** (preserves SECURITY DEFINER, advisory lock, stale-claim expiry, concurrency cap, REVOKE/GRANT — ported from `20260323000002_fix_stale_claim_expiry.sql` + DROP FUNCTION IF EXISTS for both old overloads):

```sql
BEGIN;

ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS allow_test_execution boolean NOT NULL DEFAULT false;

-- Drop both overloads — defense against env drift even though 20260323000002 dropped (TEXT,UUID).
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID);
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID, INT);

CREATE OR REPLACE FUNCTION claim_evolution_run(
  p_runner_id TEXT,
  p_run_id UUID DEFAULT NULL,
  p_max_concurrent INT DEFAULT 5
)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale_threshold INTERVAL := interval '10 minutes';
BEGIN
  -- Advisory lock serializes all claim attempts (global lock, acceptable for <=5 runners)
  PERFORM pg_advisory_xact_lock(hashtext('evolution_claim'));

  -- Expire stale claimed/running runs before checking concurrency
  UPDATE evolution_runs
  SET status = 'failed',
      error_message = 'stale claim auto-expired by claim_evolution_run',
      runner_id = NULL
  WHERE status IN ('claimed', 'running')
    AND (
      (last_heartbeat IS NOT NULL AND last_heartbeat < now() - v_stale_threshold)
      OR
      (last_heartbeat IS NULL AND created_at < now() - v_stale_threshold)
    );

  -- Atomic concurrency cap check inside the lock
  IF (SELECT count(*) FROM evolution_runs WHERE status IN ('claimed', 'running')) >= p_max_concurrent THEN
    RETURN;
  END IF;

  -- NEW GATE: skip is_test_content strategies on QUEUE claims (p_run_id IS NULL),
  -- bypass on TARGETED claims or explicit per-run opt-in.
  RETURN QUERY
  UPDATE evolution_runs SET status = 'claimed', runner_id = p_runner_id, last_heartbeat = now()
  WHERE id = (
    SELECT r.id
    FROM evolution_runs r
    LEFT JOIN evolution_strategies s ON s.id = r.strategy_id
    WHERE r.status = 'pending'
      AND (
        p_run_id IS NOT NULL                              -- targeted claim: explicit caller, bypass gate
        OR NOT COALESCE(s.is_test_content, false)        -- queue claim: real strategy
        OR r.allow_test_execution = true                  -- queue claim: per-run opt-in
      )
      AND (p_run_id IS NULL OR r.id = p_run_id)
    ORDER BY r.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID, INT) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [x] **Verify the inlined SQL matches the existing function shape** before commit — `diff` against `20260323000002_fix_stale_claim_expiry.sql` to confirm advisory lock + stale-claim path + REVOKE/GRANT are byte-for-byte preserved
- [x] Migration passes `npm run lint:migrations` (idempotency: `CREATE OR REPLACE` + `ADD COLUMN IF NOT EXISTS` ✓)
- [x] `NOTIFY pgrst, 'reload schema';` at end — the new column needs to surface in PostgREST schema cache for TypeScript-typed selects via `supabase gen types` (run `npm run db:types` to regenerate `src/lib/database.types.ts`)
- [x] **Type regen committed in same PR** — the new `allow_test_execution` column lands in `database.types.ts`

### Phase 2.5: Per-spec model swap to DeepSeek V4 Flash (NOT helper-default change)

Pivoted from helper-default approach (Iter 1 Architecture review): Pattern A-1 specs all use INLINE strategy configs, not `createTestStrategyConfig`. Verified each:
- `evolution-seed.prod-ai.spec.ts:18` — `const CHEAP_MODEL = 'google/gemini-2.5-flash'` + lines 46-47 wire it into `generationModel`/`judgeModel`. Spec's header comment notes seed-gen reads model from strategy row, NOT `TEST_LLM_MODEL`.
- `admin-evolution-iterative-editing.spec.ts:53-58` — inline `generationModel: 'gpt-4.1-nano'`, `judgeModel: 'gpt-4.1-nano'`, `budgetUsd: 0.05`
- `admin-evolution-budget-dispatch.spec.ts` — inline `gpt-4.1-nano` (cited Iter 1)
- `admin-evolution-run-pipeline.spec.ts` — inline `gpt-4.1-nano`, `budgetUsd: 0.02`

**Helper `createTestStrategyConfig` defaults UNCHANGED** to avoid regression in ~50 integration tests that depend on the existing `gpt-4.1-mini` / multi-iteration shape.

Per-spec edits (atomic PR with Phase 2):

- [x] **`src/__tests__/e2e/specs/09-admin/evolution-seed.prod-ai.spec.ts:18`** — change `CHEAP_MODEL` constant from `'google/gemini-2.5-flash'` to `'deepseek-v4-flash'`
- [x] **`admin-evolution-iterative-editing.spec.ts`** — swap all `'gpt-4.1-nano'` → `'deepseek-v4-flash'` in the inline strategy config
- [x] **`admin-evolution-budget-dispatch.spec.ts`** — same swap
- [x] **`admin-evolution-run-pipeline.spec.ts`** — same swap
- [x] **`.github/workflows/e2e-real-ai-smoke.yml`** — TWO edits:
  - Line 30: `TEST_LLM_MODEL: deepseek-v4-flash` (was `google/gemini-2.5-flash`)
  - Env block (after `OPENAI_API_KEY`): add `DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}`. (Verified `DEEPSEEK_API_KEY` is in repository secrets per `environments.md` — but the workflow's env block currently omits it; `src/lib/services/llms.ts:336-342` hard-throws when DeepSeek is called without the key.)
- [x] **MERGE-BLOCKING pre-flight**: run DeepSeek format-validation locally for ≥**9 trials (3 prompts × 3 iterations each)** — wider sample per Iter 2 Security review (small samples can miss the 5-15% malformed-JSON failure rate seen in `project_openrouter_structured_output_gap` memory):
  ```bash
  # First verify the model slug — DeepSeek registry id may be 'deepseek-v4-flash' (bare),
  # 'deepseek/deepseek-v4-flash' (OpenRouter slug), or another. Confirm via:
  npx tsx -e "import { MODEL_REGISTRY } from './src/config/modelRegistry'; console.log(Object.keys(MODEL_REGISTRY).filter(k => k.includes('deepseek')));"
  # Use the exact id that comes out. Then:
  for prompt in "water cycle" "photosynthesis" "Federal Reserve"; do
    for i in 1 2 3; do
      npx tsx evolution/scripts/run-evolution-local.ts --model <verified-slug> --prompt "$prompt" --iterations 1 --budget 0.05
    done
  done
  ```
  Each of the 9 runs must produce a variant that passes `FORMAT_RULES` (H1, no bullets, ≥2 sentences/paragraph, 25% short-paragraph tolerance — see `evolution/src/lib/shared/formatValidator.ts`). If ANY 2+ of 9 fail: **abort the DeepSeek swap**, keep `google/gemini-2.5-flash`, file a follow-up to investigate structured-output gap on DeepSeek (per memory `project_openrouter_structured_output_gap`).

### Phase 2.6: Pattern A-2 typed opt-in API + integration-test updates

**Typed API change** (cleaner than raw payload — Iter 1 Architecture suggestion):

- [x] Extend `evolution/src/testing/evolution-test-helpers.ts` `createTestEvolutionRun(supabase, explanationId, overrides)`: caller can pass `allow_test_execution: true` in `overrides` (already supported — overrides spread into the insert; just document it)
- [x] Extend `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` `CreateTestRunOptions` to include `executable?: boolean` (default `false`). When `true`, the helper sets `allow_test_execution: true` on the insert. Type-safe, discoverable in editor.

**Pre-Phase-2 audit** (done in Phase 1 — see below): read each of the 4 "verify need" integration test files and confirm whether queue-claim is actually exercised. The 4 are:
- `evolution/src/lib/pipeline/finalize/seed-arena-update.integration.test.ts`
- `evolution/src/lib/pipeline/finalize/seed-concurrent-race.integration.test.ts`
- `evolution/src/lib/pipeline/loop/evolution-seed-cost.integration.test.ts`
- `evolution/src/__tests__/integration/evolution-subagent-metrics-finalization.integration.test.ts`

**Confirmed updates** (must ship in same PR):

- [x] `src/__tests__/integration/evolution-claim.integration.test.ts` — verified at lines 8-49 to be mock-only (`mockRpc`, `mockFrom` — no real Postgres). Update its existing mocks to assert `allow_test_execution: true` is passed in the insert payload when the test simulates queue-claim, but **the actual SQL gate behavior cannot be verified here**.
- [x] **NEW FILE** `src/__tests__/integration/evolution-claim-gate.integration.test.ts` — real-DB integration test (per Iter 2 Architecture review ARCH-2). Uses `createSupabaseServiceClient()` + actual `claim_evolution_run` RPC + cleanup. Tests:
  - Test row WITHOUT opt-in → queue claim (no `p_run_id`) returns empty
  - Test row WITH opt-in → queue claim returns the row
  - Real-name strategy → queue claim returns the row (regression check)
  - Targeted claim (`p_run_id` passed) on test row without opt-in → returns the row (bypass works)
- [x] `src/__tests__/integration/evolution-empty-run-cost-init.integration.test.ts` — opt-in
- [x] `src/__tests__/integration/evolution-visualization-data.integration.test.ts` — opt-in
- [x] Each of the 4 "verify need" files — opt-in if Phase 1 audit confirms queue-claim use. **Default-to-safe rule (per Iter 2 Testing review)**: if Phase 1 audit cannot definitively determine whether a test exercises queue-claim, ADD the opt-in (`allow_test_execution: true`) — it's harmless on a row that's never queue-claimed.

### Phase 3: Cleanup & monitoring

- [ ] **Janitor — CI job** (decision: CI not systemd timer, per Iter 1 Testing review): new `.github/workflows/evolution-test-data-cleanup.yml` shaped after `evolution-run-health.yml`:
  - Weekly cron (Mondays 06:00 UTC)
  - `environment: staging` (writes via staging service-role secret)
  - **Dependency-ordered deletes** (CORRECTION: per Iter 2 review — `evolution_runs.strategy_id REFERENCES evolution_strategies(id) ON DELETE RESTRICT` (`20260324000001_entity_evolution_phase0.sql:17`). A bulk DELETE on `evolution_strategies` WILL fail with FK violation unless dependents are cleared first. Correct ordering:
    ```sql
    -- Step 1: identify the test strategies older than 14d
    WITH test_strategies AS (
      SELECT id FROM evolution_strategies
      WHERE is_test_content = true
        AND last_used_at < now() - interval '14 days'
      LIMIT 100   -- pagination per Iter 2 Testing review
    ),
    -- Step 2: collect their run IDs
    test_runs AS (
      SELECT id FROM evolution_runs WHERE strategy_id IN (SELECT id FROM test_strategies)
    )
    -- Step 3: delete dependents in FK-safe order. evolution_runs has CASCADE
    -- on most children (variants, invocations, logs, arena_comparisons) per
    -- evolution/docs/data_model.md "CASCADE deletes on run children" — verify
    -- each FK at execution time, but the safe path is:
    --   a) DELETE FROM evolution_runs WHERE id IN test_runs;   -- cascades to children
    --   b) DELETE FROM evolution_prompts WHERE id IN (SELECT prompt_id FROM ...) -- if test-orphaned
    --   c) DELETE FROM evolution_strategies WHERE id IN test_strategies;
    ```
  - Loop until 0 strategies remain or 5 batches exhausted; sleep 250ms between batches; fail with Slack alert on PostgREST 429 or partial-batch error
  - Dry-run default (`--apply` flag explicit); abort on >500 strategies in a single run (sanity)
  - Slack on >50 deletions or any error (reuse `SLACK_WEBHOOK_URL`)
  - Filters by `is_test_content=true` only — `Nightly smoke fixture` strategy is auto-preserved because its name does NOT match `evolution_is_test_name` regex (verified: regex matches `[TEST]`, `[E2E]`, `[TEST_EVO]`, lowercase `test`, or `\d{10,13}` timestamp pattern only)
- [ ] **Alarm — daily**: GitHub Actions cron 18:00 UTC (after staging workday). Query:
  ```sql
  SELECT COALESCE(SUM(inv.cost_usd), 0) AS test_bucket_24h
  FROM evolution_agent_invocations inv
  JOIN evolution_runs r ON r.id = inv.run_id
  JOIN evolution_strategies s ON s.id = r.strategy_id
  WHERE s.is_test_content = true
    AND inv.created_at > now() - interval '24 hours';
  ```
  Thresholds:
  - **$0.05/day** (soft warn) — log only, no Slack
  - **$0.10/day** (hard alarm) — file `[release-health]` issue (pattern from `evolution-run-health.yml:51-63`), Slack alert
  - Baseline expected post-fix: ~$0.04/day from Pattern A-1 spec executions
- [ ] **Layer-3 nightly smoke**: new `.github/workflows/evolution-nightly-smoke.yml`:
  - One workflow, fires nightly at 06:00 UTC (after `e2e-nightly.yml` at 06:00 — schedule at 06:15 to avoid race)
  - `environment: staging`, reuses `SLACK_WEBHOOK_URL` and `DEEPSEEK_API_KEY` secrets
  - `continue-on-error: true` (per `e2e-real-ai-smoke.yml` convention — provider outage tolerance)
  - **Fixture strategy seeded by sibling migration**: locked filename **`supabase/migrations/20260621000002_evolution_nightly_smoke_fixture.sql`** (sorts AFTER claim-gate migration). Full inline SQL with **WHERE NOT EXISTS** to handle BOTH PK and `config_hash` UNIQUE constraint collisions (per Iter 3 Security review):
    ```sql
    BEGIN;
    -- INSERT-WHERE-NOT-EXISTS handles both PK collision AND config_hash UNIQUE constraint
    -- (uq_strategies_config_hash from 20260329000001) without raising. Plain ON CONFLICT (id)
    -- would still fail on a config_hash collision after a hash-drift re-import.
    INSERT INTO evolution_strategies (id, name, label, config, config_hash, status, is_predefined, created_by)
    SELECT
      '00000000-0000-4f00-8f00-000000000fff'::uuid,     -- fixed UUID, valid v4 (position 13='4', position 17='8')
      'Nightly smoke fixture',                          -- does NOT match evolution_is_test_name → is_test_content=false
      'smoke',
      jsonb_build_object(
        'generationModel', 'deepseek-v4-flash',
        'judgeModel', 'deepseek-v4-flash',
        'strategiesPerRound', 1,
        'calibrationOpponents', 2,
        'tournamentTopK', 2,
        'iterationConfigs', jsonb_build_array(
          jsonb_build_object('agentType', 'generate', 'budgetPercent', 100, 'maxAgents', 1)
        ),
        'budgetUsd', 0.05
      ),
      'v2:nightly_smoke_v1',                            -- fixed config_hash
      'active',
      true,
      'system'
    WHERE NOT EXISTS (
      SELECT 1 FROM evolution_strategies
      WHERE id = '00000000-0000-4f00-8f00-000000000fff'::uuid
         OR config_hash = 'v2:nightly_smoke_v1'
    );
    COMMIT;
    ```
  - **Smoke job steps**: insert a new pending run via service-role REST referencing the fixed strategy ID → poll evolution_runs for 15min until `status='completed'` → assert ≥1 row in `evolution_variants` for that run_id + `variant_content` non-empty + `SUM(cost_usd) ≤ $0.05`
  - Expected cost: ~$0.005/night = **$1.83/year**
- [ ] Document in `evolution/docs/cost_optimization.md` under new "Test cost containment" section

### Phase 4: Provider + app cap audit

- [ ] Verify OpenAI/DeepSeek/Anthropic/OpenRouter monthly caps match `docs/docs_overall/llm_provider_limits.md` recommended values
- [ ] Verify `llm_cost_config` daily/monthly/evolution-daily caps in staging + production DBs
- [ ] Confirm `LLMSpendingGate` kill switch reachable via `/admin/costs`
- [ ] Confirm Slack webhook for spend-threshold alerts is configured at provider dashboards (50%/80%/100% notifications)

### Phase 5 (out of scope; flag follow-up project)

- [x] Audit-gap repair: `llmCallTracking` is missing `evolution_*` `call_source` rows since 2026-02-22. Per `cost_optimization.md`, spin out as `fix_evolution_llmcalltracking_audit_gap_<date>` — multi-day investigation, not in this project's critical path.

## Atomic deploy requirement

Phase 2 + 2.5 + 2.6 + Phase 3 nightly-smoke fixture migration MUST ship in **ONE PR**. Reasoning (Iter 1 Architecture):
- Migration alone → integration tests using queue claim (Pattern A-2) break instantly
- Phase 2.5 alone (DeepSeek + spec edits) without migration → no cost savings on test-strategy claims
- Phase 2.6 alone without migration → opt-in column doesn't exist; INSERT fails on unknown column

Same-PR rollout means the test surface flips cleanly between two consistent states. Phase 3 (janitor + alarm + smoke workflow) CAN ship as a follow-up PR — it's additive and doesn't depend on the gate.

### Atomic-PR file manifest (Iter 2 Architecture review ARCH-5)

Reviewer-friendly checklist of every file touched in the single PR:

**Migrations (2)**:
- `supabase/migrations/20260621000001_evolution_claim_gate.sql` (NEW)
- `supabase/migrations/20260621000002_evolution_nightly_smoke_fixture.sql` (NEW)

**Generated** (auto from migration via `npm run db:types`):
- `src/lib/database.types.ts` (regen — `allow_test_execution` column appears)

**Pattern A-1 E2E specs (4)** — inline config swap to `deepseek-v4-flash`:
- `src/__tests__/e2e/specs/09-admin/evolution-seed.prod-ai.spec.ts` (also update `CHEAP_MODEL` constant line 18)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`
- `src/__tests__/e2e/specs/09-admin/admin-evolution-budget-dispatch.spec.ts`
- `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`

**Workflow** (add DEEPSEEK_API_KEY + change TEST_LLM_MODEL):
- `.github/workflows/e2e-real-ai-smoke.yml`

**Helpers** (typed opt-in API):
- `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` (`CreateTestRunOptions.executable?: boolean`)

**Pattern A-2 integration tests** (confirmed list — opt-in updates):
- `src/__tests__/integration/evolution-claim.integration.test.ts` (mock-only — assertion updates)
- `src/__tests__/integration/evolution-claim-gate.integration.test.ts` (NEW real-DB)
- `src/__tests__/integration/evolution-empty-run-cost-init.integration.test.ts`
- `src/__tests__/integration/evolution-visualization-data.integration.test.ts`
- Plus any of the 4 "verify need" files Phase 1 audit confirms

**Verification script**:
- `evolution/scripts/checkTestStrategyCost.ts` (NEW — see body in Verification section below)

**Documentation** (8 files — see Documentation Updates section). All ship in the same PR for consistency.

**Excluded from atomic PR** (separate follow-up PR, additive only):
- `.github/workflows/evolution-test-data-cleanup.yml` (janitor)
- `.github/workflows/evolution-cost-alarm.yml` (daily alarm)
- `.github/workflows/evolution-nightly-smoke.yml` (Layer-3 smoke)

## Rollback plan

If the gate breaks the minicomputer runner in production:

1. **Revert migration**: ship `<ts>_revert_claim_evolution_run_gate.sql` that re-applies the previous `claim_evolution_run` body (without the gate predicate). DO NOT drop `allow_test_execution` column — existing rows with `false` continue to behave as before; future cleanup can drop it.
2. **Revert spec changes**: standard PR revert restores the 4 Pattern A-1 specs to `gpt-4.1-nano`/`google/gemini-2.5-flash` configs.
3. **Disable `evolution-nightly-smoke.yml`**: `workflow_dispatch` only or comment out the `schedule:` trigger. Keep the fixture strategy row — janitor doesn't touch it.

If only the DeepSeek swap fails (format validation, structured output, etc.):
- Pre-flight Phase 1 catches this — DO NOT merge if any prompt fails format validation
- If somehow merges and red-fails: revert Phase 2.5 spec changes + workflow env. Keep the gate migration (it's independent and correct).

If `evolution-nightly-smoke.yml` consistently red-fails post-merge:
- Disable workflow, file `[release-health]` issue
- Manual queue: insert a pending run pointing at the fixture strategy, monitor via admin UI

If Phase 1 audit missed a Pattern A-2 integration test that uses queue-claim, and post-merge CI goes red (per Iter 3 Security review):
- **Fix-forward, NOT revert.** Add `allow_test_execution: true` to the missed fixture insert. Ship as a follow-up PR within hours
- The migration revert path is more disruptive than necessary — the default-to-safe rule at Phase 2.6 minimizes this risk to begin with
- Document the missed test in `_progress.md` so the inventory grows complete

## Verification: 7-day post-merge cost check

Concrete operational details (Iter 1 Testing review):

- **Script body** (`evolution/scripts/checkTestStrategyCost.ts`, sketch):
  ```ts
  import { createClient } from '@supabase/supabase-js';
  import * as dotenv from 'dotenv';
  dotenv.config({ path: '.env.local' });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const days = Number(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] ?? 7);
  const threshold = Number(process.argv.find(a => a.startsWith('--threshold='))?.split('=')[1] ?? 0.50);
  const since = new Date(Date.now() - days*86400000).toISOString();
  // Paginate evolution_agent_invocations + join via run_id → strategy_id
  // SUM cost_usd where strategy.is_test_content=true
  // Compare vs threshold; print JSON; exit 1 if over
  ```
- **Environment**: staging (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`)
- **Run T+7d after merge**: GitHub Issue auto-created by deferred `workflow_dispatch` 7 days post-merge (cleanest), or manual reminder in `_progress.md`.
- **Success threshold**: `total_test_bucket_usd < $0.50/7d` (current $15.76/7d; fix targets ≤$0.30/7d so $0.50 leaves headroom)
- **Failure action**: file `[release-health]` issue with the query output + investigation runbook

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
- [x] No new unit-testable code paths (migration + helper config changes). Existing tests must not regress.

### Integration Tests
- [x] `src/__tests__/integration/evolution-claim.integration.test.ts` (updated) — add cases:
  - Test fixture without `allow_test_execution` → queue claim skips
  - Test fixture WITH `allow_test_execution=true` → queue claim succeeds
  - Real-name strategy → queue claim succeeds (unchanged)
  - Targeted claim on test fixture (no opt-in) → succeeds (bypass)
- [x] `evolution-watchdog.integration.test.ts` — confirm watchdog still converts stale pending to failed despite the gate (it doesn't go through claim_evolution_run; uses its own update path)
- [x] Re-run all integration tests in `Pattern A-2` after adding `allow_test_execution: true`

### E2E Tests
- [x] Re-run all 4 Pattern A-1 specs — they use targeted claim, should work unchanged
- [x] Re-run all Pattern B specs — they assert against fixture rows; gate prevents racing runner claims (more reliable, not less)
- [x] Run `evolution-seed.prod-ai.spec.ts` with new `deepseek-v4-flash` config — confirm DeepSeek output passes format validation

### Manual Verification
- [ ] Insert a `[TEST]`-name strategy + pending run on staging; wait 2 systemd timer cycles; confirm `runner_id` stays NULL
- [ ] Insert same fixture but with `allow_test_execution: true`; confirm runner DOES claim
- [ ] Insert real-name strategy + pending run; confirm runner claims (regression check)
- [ ] Hit `/api/evolution/run` with `targetRunId` pointing at a `[TEST]` strategy run — confirm it claims (bypass works)

## Verification

### ⚠️ MANDATORY: `/finalize` before `gh pr create`

This PR touches `supabase/migrations/**` → **high-blast PR gate** per CLAUDE.md. Per the PR-Creation Gate spec:
- `.claude/push-gate.json` is REQUIRED for HEAD
- `npm run test:gate` alone does NOT unlock the high-blast gate
- Bypass `DISABLE_PR_GATE=true` is only for emergencies

Run `/finalize` to write the gate; the standard `/finalize` flow runs lint + tsc + build + unit + ESM + integration + e2e:critical + migration:verify, then writes the push-gate.

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes

### B) Automated Tests
- [ ] `npm run test:integration -- --grep "claim"` — passes including new opt-in cases
- [ ] `npm run test:e2e:evolution` — all evolution E2E specs pass (Pattern A-1 + B specs)
- [ ] `npm run migration:verify` — new migration applies cleanly on ephemeral postgres
- [ ] **7-day post-merge cost check**: run `npx tsx evolution/scripts/checkTestStrategyCost.ts --days 7` from a clean checkout 7 days after merge; assert `< $0.50/7d`
- [ ] **Cost-alarm test**: deliberately trigger >$0.10 of test-bucket spend in a day; confirm `[release-health]` issue is filed
- [ ] **`/finalize` is MANDATORY before `gh pr create`** — this PR touches `supabase/migrations/**` → high-blast gate per CLAUDE.md → `.claude/push-gate.json` required. `npm run test:gate` alone does NOT unlock; run `/finalize` to write the gate.

## Documentation Updates

- [ ] `evolution/docs/cost_optimization.md` — add "Test cost containment" section with claim-gate behavior, `allow_test_execution` column semantics, janitor + alarms
- [ ] `evolution/docs/minicomputer_deployment.md` — document that the runner now skips `is_test_content` strategies (and the opt-in column override)
- [ ] `evolution/docs/data_model.md` — document new `evolution_runs.allow_test_execution` column + updated `claim_evolution_run` RPC behavior
- [ ] `evolution/docs/entities.md` — add `allow_test_execution` column to the `evolution_runs` schema reference
- [ ] `evolution/docs/architecture.md` — note the claim-gate architectural change in the runner-lifecycle section
- [ ] `evolution/docs/reference.md` — update `claim_evolution_run` reference + helper signatures (`executable?: boolean` param)
- [ ] `evolution/docs/strategies_and_experiments.md` — note `[FIXTURE]` strategy lifecycle for the nightly smoke
- [ ] `docs/feature_deep_dives/admin_panel.md` — note that `/admin/evolution/runs` may show stale `[TEST]` pending rows until janitor sweeps
- [ ] `docs/docs_overall/testing_overview.md` — Test Data Management section: E2E specs are free to insert pending evolution_runs without burning provider $$ (and how to opt in via `executable: true` for integration tests that need queue-claim)
- [ ] `docs/docs_overall/llm_provider_limits.md` — refresh recommended caps if Phase 4 finds drift
- [ ] `docs/feature_deep_dives/testing_setup.md` — document `executable?: boolean` parameter on `CreateTestRunOptions`; note that the 4 Pattern A-1 specs now use `deepseek-v4-flash` inline

## Review & Discussion

*This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration.*
