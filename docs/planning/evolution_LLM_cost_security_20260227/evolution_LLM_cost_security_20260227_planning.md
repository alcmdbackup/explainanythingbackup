# Evolution LLM Cost Security Plan

## Background
Ensure that no bugs or compromised API keys can ever allow LLM spending beyond a pre-specified limit. Implement multiple levels of safeguards spanning provider-level hard caps, application-level global caps, per-run budget hardening, and monitoring/alerting to create defense-in-depth cost protection for the evolution pipeline and all LLM usage.

## Requirements (from GH Issue #591)

### L1 - Provider-Level Hard Caps
- Set spending limits directly at OpenAI/DeepSeek/Anthropic dashboards as ultimate backstop
- No application code can bypass these limits — even fully compromised keys are capped
- Document the current provider limit settings and recommended values

### L2 - Application Global Caps
- Daily + monthly aggregate spending limits tracked in the database
- Global kill switch that halts ALL LLM calls system-wide
- Separate caps for evolution vs non-evolution LLM usage
- Configurable limits via admin UI or environment variables

### L3 - Per-Run Caps (hardening existing infrastructure)
- Existing CostTracker per-run budget enforcement (already implemented)
- Add: max concurrent runs cap to prevent runaway parallel spending
- Add: per-batch total budget enforcement
- Add: auto-pause when global daily cap is approached

### L4 - Monitoring & Alerting
- Honeycomb/observability alerts at 50%/80%/95% of daily cap
- Anomaly detection for unusual per-minute spend rates
- Slack/email notifications when thresholds are breached

## Problem
The codebase has zero global spending limits for LLM calls. 12+ non-evolution call sites have no budget enforcement at all — a bug, infinite loop, or compromised API key could generate unlimited spending. Even the well-protected evolution pipeline lacks cross-run aggregation (100 simultaneous $5 runs = $500 with no limit). Provider-level spending limits are not documented or verified as configured. The existing `llmCallTracking` table records every call but is never read back for enforcement — it's purely passive analytics. There is no kill switch, no daily cap, no alerting, and no anomaly detection.

## Options Considered

### Option A: Application-only enforcement (global gate at callLLMModelRaw)
- **Pros**: Single chokepoint catches 100% of calls, can enforce per-category caps
- **Cons**: Does not protect against compromised keys used outside the application
- **Verdict**: Necessary but not sufficient — need provider limits too

### Option B: Provider-only enforcement (dashboard limits)
- **Pros**: Cannot be bypassed by any application bug
- **Cons**: Coarse-grained (monthly only), no per-category control, no kill switch
- **Verdict**: Good backstop but too blunt for daily operations

### Option C: Defense-in-depth (all 4 levels) ← SELECTED
- L1: Provider dashboard limits as ultimate backstop
- L2: Application global gate with daily/monthly caps + kill switch
- L3: Per-run hardening (concurrent run limits, batch budgets)
- L4: Monitoring with Honeycomb triggers for proactive alerts
- **Pros**: No single point of failure, layered protection
- **Cons**: More implementation work
- **Verdict**: Correct approach for the "no scenario allows overspend" requirement

### Global gate implementation options:
1. **Per-call DB query** — Too slow (~5-15ms per call), unacceptable latency
2. **In-memory TTL cache + DB rollup table** ← SELECTED — ~0ms cache hit, 2-5ms miss, O(1) lookup
3. **Redis cache** — Overkill for single-server deployment, adds infrastructure dependency
4. **Materialized view with periodic refresh** — Refresh lag creates enforcement gaps

### Daily rollup strategy options:
1. **PostgreSQL AFTER INSERT trigger** ← SELECTED — Atomic, 2-5ms overhead, zero-lag
2. **Application-level increment after each call** — Race conditions, missed updates on crashes
3. **Periodic aggregation cron** — Lag between insert and enforcement (unacceptable)

## Design Decisions

### Fail-closed vs fail-open
When the `daily_cost_rollups` or `llm_cost_config` table is unreachable (DB outage), the gate **fails closed** (blocks all LLM calls). Rationale: this is a cost-security feature — allowing unbounded spend during an outage defeats the purpose. Availability impact is acceptable because a DB outage already breaks most app functionality.

### Kill switch cache-busting
The kill switch TTL is 5s (not 30s like spending totals) to minimize the delay between toggling and enforcement. Additionally, the `toggleKillSwitch` server action calls `spendingGate.invalidateCache()` for immediate in-process effect.

### SDK retry amplification
The global gate check runs once at `callLLMModelRaw()` entry. SDK-level retries (up to 3 per call) happen inside `routeLLMCall()` and are invisible to the gate. Each retry incurs real cost but only one gate check occurs. This is a **known limitation** accepted because: (a) provider limits (L1) cap total spend regardless, (b) the per-call cost delta from retries is small (~$0.02 for gpt-4.1-mini), and (c) adding gate checks inside SDK retry loops requires forking the SDK or wrapping each attempt, which is disproportionate complexity. The `saveLlmCallTracking` call records the actual total cost including retries, so the rollup table reflects true spend.

### Deployment model & cross-instance enforcement
The app runs on **Vercel serverless**. Module-level singletons reset per cold start. The in-memory TTL cache is a **performance optimization only** — it reduces DB queries for warm instances but does NOT provide cross-instance TOCTOU protection.

**Cross-instance enforcement** is handled at the DB level: `checkBudget()` calls a Supabase RPC (`check_and_reserve_llm_budget`) that atomically:
1. Reads current `total_cost_usd` from `daily_cost_rollups` for today
2. Compares against the cap from `llm_cost_config`
3. If under cap, atomically increments a `reserved_usd` column on `daily_cost_rollups`
4. Returns `{allowed: boolean, daily_total: number, daily_cap: number}`

The in-memory cache short-circuits this RPC when the cached daily total is well below the cap (>10% headroom). When within 10% of the cap, every call hits the DB RPC for atomic enforcement. This provides both performance (cache hits in normal operation) and correctness (DB-atomic reservation near the cap).

The `reserved_usd` column is decremented by `reconcileAfterCall()` which replaces the reservation with actual cost by updating the `total_cost_usd` and decrementing `reserved_usd`. Stale reservations (from crashed function instances) are cleared by a 5-minute TTL — reservations older than 5 minutes are ignored in the cap check.

### Pre-call cost estimation
Estimated cost for the reservation is derived from `calculateLLMCost()` using a conservative token estimate (max_tokens from model config for completion, 1000 tokens for prompt). If estimation is unavailable, a fixed reservation of $0.05 is used (covers 99%+ of gpt-4.1-mini calls).

### saveLlmCallTracking failure handling
If `saveLlmCallTracking` fails (currently swallowed by try/catch):
- The DB trigger won't fire, so `daily_cost_rollups.total_cost_usd` won't increment
- The DB reservation (`reserved_usd`) from `checkBudget()` remains active (not reconciled)
- This is **fail-safe**: the stale reservation counts toward the cap, making enforcement more conservative (blocking calls earlier than necessary)
- After the 5-minute reservation TTL, the reservation expires, creating a gap equal to the actual cost of that call
- **Known limitation**: This gap is bounded by single-call cost (~$0.03 for gpt-4.1-mini, ~$0.50 for gpt-4.1) and requires both a tracking failure AND a near-cap state to matter. Provider limits (L1) remain the ultimate backstop.

## Phased Execution Plan

### Phase 1: Database Foundation (migration + rollup table)
**Goal**: Create the `daily_cost_rollups` table and PostgreSQL trigger so all LLM spending is atomically tracked in a queryable format.

**Files to create/modify**:
- `supabase/migrations/YYYYMMDD_add_daily_cost_rollups.sql` — New migration:
  - Create `daily_cost_rollups` table: `(date DATE, category TEXT, total_cost_usd NUMERIC(12,6), reserved_usd NUMERIC(12,6) DEFAULT 0, reserved_at TIMESTAMPTZ, call_count INTEGER, PRIMARY KEY (date, category))`
  - Create `llm_cost_config` table: `(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT)`
  - Add RLS policies: `daily_cost_rollups` read-only for authenticated, write via service_role only; `llm_cost_config` read for authenticated, write restricted to service_role
  - Seed config rows: `daily_cap_usd` (default: 50), `monthly_cap_usd` (default: 500), `evolution_daily_cap_usd` (default: 25), `kill_switch_enabled` (default: false)
  - Create AFTER INSERT trigger on `llmCallTracking` (create trigger FIRST, then backfill — trigger handles new rows, backfill handles old, ON CONFLICT deduplicates):
    ```sql
    INSERT INTO daily_cost_rollups (date, category, total_cost_usd, call_count)
    VALUES (
      CURRENT_DATE,
      CASE WHEN NEW.call_source LIKE 'evolution_%' THEN 'evolution' ELSE 'non_evolution' END,
      COALESCE(NEW.estimated_cost_usd, 0),
      1
    )
    ON CONFLICT (date, category) DO UPDATE SET
      total_cost_usd = daily_cost_rollups.total_cost_usd + COALESCE(EXCLUDED.total_cost_usd, 0),
      call_count = daily_cost_rollups.call_count + 1;
    ```
  - Create `check_and_reserve_llm_budget` RPC for atomic cross-instance enforcement:
    ```sql
    CREATE FUNCTION check_and_reserve_llm_budget(
      p_category TEXT, p_estimated_cost NUMERIC, p_reservation_ttl_minutes INTEGER DEFAULT 5
    ) RETURNS JSONB AS $$
    DECLARE
      v_row daily_cost_rollups;
      v_cap NUMERIC;
      v_effective_reserved NUMERIC;
      v_effective_total NUMERIC;
    BEGIN
      -- Get or create today's row with row-level lock
      INSERT INTO daily_cost_rollups (date, category, total_cost_usd, call_count, reserved_usd, reserved_at)
      VALUES (CURRENT_DATE, p_category, 0, 0, 0, now())
      ON CONFLICT (date, category) DO NOTHING;

      SELECT * INTO v_row FROM daily_cost_rollups
      WHERE date = CURRENT_DATE AND category = p_category FOR UPDATE;

      -- Get cap from config
      SELECT (value->>'value')::NUMERIC INTO v_cap FROM llm_cost_config
      WHERE key = CASE WHEN p_category = 'evolution' THEN 'evolution_daily_cap_usd' ELSE 'daily_cap_usd' END;

      -- Expire stale reservations (older than TTL)
      v_effective_reserved := CASE
        WHEN v_row.reserved_at < now() - (p_reservation_ttl_minutes || ' minutes')::interval THEN 0
        ELSE COALESCE(v_row.reserved_usd, 0)
      END;

      v_effective_total := v_row.total_cost_usd + v_effective_reserved + p_estimated_cost;

      IF v_effective_total > v_cap THEN
        RETURN jsonb_build_object('allowed', false, 'daily_total', v_row.total_cost_usd, 'daily_cap', v_cap);
      END IF;

      -- Reserve
      UPDATE daily_cost_rollups SET reserved_usd = v_effective_reserved + p_estimated_cost, reserved_at = now()
      WHERE date = CURRENT_DATE AND category = p_category;

      RETURN jsonb_build_object('allowed', true, 'daily_total', v_row.total_cost_usd, 'daily_cap', v_cap);
    END;
    $$ LANGUAGE plpgsql;
    ```
  - Create `reconcile_llm_reservation` RPC for post-call reconciliation:
    ```sql
    CREATE FUNCTION reconcile_llm_reservation(p_category TEXT, p_reserved NUMERIC, p_actual NUMERIC)
    RETURNS void AS $$
    BEGIN
      UPDATE daily_cost_rollups
      SET reserved_usd = GREATEST(0, reserved_usd - p_reserved),
          reserved_at = now()
      WHERE date = CURRENT_DATE AND category = p_category;
    END;
    $$ LANGUAGE plpgsql;
    ```
  - Backfill `daily_cost_rollups` from existing `llmCallTracking` data (batched in 10K row chunks, run AFTER trigger creation)
  - **Rollback SQL** (comment at top of migration):
    ```sql
    -- ROLLBACK: DROP TRIGGER IF EXISTS llm_cost_rollup_trigger ON "llmCallTracking";
    -- DROP FUNCTION IF EXISTS update_daily_cost_rollup();
    -- DROP FUNCTION IF EXISTS check_and_reserve_llm_budget(TEXT, NUMERIC, INTEGER);
    -- DROP FUNCTION IF EXISTS reconcile_llm_reservation(TEXT, NUMERIC, NUMERIC);
    -- DROP TABLE IF EXISTS llm_cost_config;
    -- DROP TABLE IF EXISTS daily_cost_rollups;
    ```
- `src/lib/schemas/llmCostSchemas.ts` — New file (separate from main schemas.ts to avoid bloating it further):
  - Zod schemas for `daily_cost_rollups` and `llm_cost_config`

**Validation**: Run migration on dev, insert test rows into `llmCallTracking`, verify `daily_cost_rollups` updates atomically. Verify rollback SQL executes cleanly.

### Phase 2: Global Spending Gate (application-level enforcement)
**Goal**: Add pre-flight spending checks to `callLLMModelRaw()` that block all LLM calls when daily/monthly caps are exceeded or kill switch is on.

**Files to create/modify**:
- `src/lib/services/llmSpendingGate.ts` — New file:
  - `LLMSpendingGate` class with in-memory TTL cache (30s for spending totals, 5s for kill switch)
  - `checkBudget(callSource: string, estimatedCostUsd?: number): Promise<void>`:
    1. Check kill switch (cached, 5s TTL) → throw `LLMKillSwitchError`
    2. Compute category via shared `getCallCategory(callSource)` utility (`evolution_*` → 'evolution', else → 'non_evolution')
    3. Fast-path: if in-memory cached daily total is >10% below cap → allow (skip DB query)
    4. Near-cap path (within 10% of cap OR cache miss): call `check_and_reserve_llm_budget` RPC for DB-atomic reservation
    5. If RPC returns `{allowed: false}` → throw `GlobalBudgetExceededError`
    6. Monthly cap check: query `SUM(total_cost_usd) FROM daily_cost_rollups WHERE date >= date_trunc('month', CURRENT_DATE) AND category = ?` (cached with 60s TTL since monthly totals change slowly). If over monthly cap → throw `GlobalBudgetExceededError`
    7. Update in-memory cache with latest daily total from RPC response
  - `reconcileAfterCall(actualCostUsd: number, reservedCostUsd: number, callSource: string): void`:
    - Call `reconcile_llm_reservation` RPC to release DB reservation
    - The actual cost is already recorded via `saveLlmCallTracking` → trigger → `daily_cost_rollups.total_cost_usd`
    - Update in-memory cache: `cachedTotal += (actualCost - reservedCost)`
  - `getSpendingSummary(): Promise<SpendingSummary>` — for admin UI
  - `invalidateCache(): void` — for kill switch toggle immediate effect
  - `resetForTesting(): void` — reset singleton state (like `resetLLMSemaphore()`)
  - Singleton with lazy init; on DB query failure → **fail closed** (throw error, block call)
- `src/lib/services/llms.ts` — Modify `callLLMModelRaw()`:
  - Before routing: `await spendingGate.checkBudget(call_source, estimatedCost)`
  - Estimated cost computed via `calculateLLMCost()` with conservative token estimate
  - In `saveLlmCallTracking()` (which is called from both `callOpenAIModel` and `callAnthropicModel`): add `spendingGate.reconcileAfterCall(cost, call_source)`
  - **Note**: The post-call hook goes in `saveLlmCallTracking()`, NOT in an `onUsage` callback on `callLLMModelRaw()`, because `saveLlmCallTracking` is the common exit point for both provider functions and already has the actual cost
  - Handle `saveLlmCallTracking` failure: if the tracking INSERT fails (currently swallowed by try/catch), the trigger won't fire, so the gate relies on the optimistic cache update as fallback. Log a warning when tracking INSERT fails so the gap is visible.
- `src/lib/errorHandling.ts` — Add error codes:
  - `GLOBAL_BUDGET_EXCEEDED: 'GLOBAL_BUDGET_EXCEEDED'`
  - `LLM_KILL_SWITCH: 'LLM_KILL_SWITCH'`
- `src/lib/errors/serviceError.ts` — New error subclasses (extend existing `ServiceError`):
  - `GlobalBudgetExceededError extends ServiceError` — uses `ERROR_CODES.GLOBAL_BUDGET_EXCEEDED`
  - `LLMKillSwitchError extends ServiceError` — uses `ERROR_CODES.LLM_KILL_SWITCH`

**Validation**: Unit tests for LLMSpendingGate with mocked DB. Integration test: insert rows into `daily_cost_rollups` to simulate near-cap state, call `checkBudget()`, verify it throws (no real LLM call needed).

### Phase 3: Admin UI + Kill Switch
**Goal**: Add admin controls for viewing/setting spending caps and toggling the kill switch.

**Files to create/modify**:
- `src/app/admin/costs/page.tsx` — Extend existing page:
  - Add daily/monthly cap display with current spend vs cap (progress bars)
  - Add kill switch toggle button (with confirmation dialog)
  - Add cap configuration form (daily cap, monthly cap, evolution daily cap)
  - Show spending gate status (active/disabled, cache age)
- `src/lib/services/llmCostConfigActions.ts` — New server actions file:
  - Must include `'use server'` directive at top of file
  - Must follow codebase pattern: `withLogging` + `requireAdmin` + `serverReadRequestId` wrappers
  - `getLLMCostConfig()` — Read current caps and kill switch state from `llm_cost_config` table
  - `updateLLMCostConfig(key, value)` — Update config value with:
    - `await requireAdmin()` for authentication
    - `logAdminAction()` with audit trail
    - Input validation (reject negative caps, non-boolean kill switch values)
  - `toggleKillSwitch(enabled: boolean)` — Toggle with:
    - `await requireAdmin()` for authentication
    - `logAdminAction()` with audit trail
    - `spendingGate.invalidateCache()` for immediate in-process effect
- `src/lib/services/auditLog.ts` — Extend types:
  - Add `'update_cost_config' | 'toggle_kill_switch'` to `AuditAction` type
  - Add `'llm_cost_config'` to `EntityType` type

**Validation**: Manual verification on dev: toggle kill switch, verify all LLM calls blocked. Set daily cap, verify enforcement. Verify audit log entries are created.

### Phase 4: Per-Run Hardening
**Goal**: Add concurrent run limits and batch budget enforcement to prevent evolution pipeline runaway.

**Files to create/modify**:
- `evolution/src/lib/core/pipeline.ts` — Add global daily cap check before starting run
- `evolution/src/services/evolutionRunnerCore.ts` — Add max concurrent runs enforcement (this is where `claim_evolution_run` RPC is actually called, at line 43). Before the RPC call, add a `SELECT COUNT(*) FROM evolution_invocations WHERE status = 'running' FOR UPDATE` check with configurable max (default: 5). Use `FOR UPDATE` to prevent the same TOCTOU race as the spending gate — multiple batch runners reading count simultaneously.
- `evolution/src/lib/core/llmClient.ts` — Add global gate check alongside per-run CostTracker check

**Validation**: Unit test: mock DB to return N running invocations, verify claim is rejected when N >= max. Integration test: batch with aggregate budget, verify enforcement.

### Phase 5: OpenTelemetry Cost Attributes + Honeycomb Monitoring
**Goal**: Add cost span attributes to LLM traces and configure Honeycomb triggers for alerting.

**Files to create/modify**:
- `src/lib/services/llms.ts` — Add span attributes inside `callOpenAIModel()` and `callAnthropicModel()` (where `span.setAttributes()` is already called), NOT in `saveLlmCallTracking`:
  - `llm.cost_usd`, `llm.prompt_tokens`, `llm.completion_tokens`, `llm.reasoning_tokens`
- `instrumentation.ts` — Verify span attribute propagation to Honeycomb
- Honeycomb configuration (via MCP or manual):
  - Query: SUM(llm.cost_usd) with alerts at 50%/80%/95% of daily cap
  - Query: RATE_SUM(llm.cost_usd) for per-minute anomaly detection
  - Trigger notifications (Honeycomb triggers → email initially)

**Validation**: Unit test: verify `span.setAttributes()` is called with `llm.cost_usd` attribute after a successful call. Manual: make LLM calls, verify cost attributes appear in Honeycomb spans. Verify triggers fire when thresholds exceeded.

### Phase 6: Provider-Level Documentation
**Goal**: Document and verify provider-level spending limits as ultimate backstop.

**Files to create/modify**:
- `docs/docs_overall/llm_provider_limits.md` — New doc:
  - Current limits set on each provider dashboard
  - Recommended monthly limits per provider
  - How to update limits
  - Escalation procedure when limits are hit
- Admin UI: Display provider limit recommendations alongside application caps

**Validation**: Verify each provider dashboard has limits configured. Screenshot documentation.

## Testing

### Unit Tests
All test files use **colocated convention** (same directory as source, `*.test.ts`), matching codebase pattern.

- `src/lib/services/llmSpendingGate.test.ts`:
  - Cache hit returns cached value (use `jest.useFakeTimers()` for TTL testing)
  - Cache miss queries DB (mock `createSupabaseServiceClient`)
  - Over-cap throws `GlobalBudgetExceededError`
  - Kill switch throws `LLMKillSwitchError`
  - Pre-call reservation prevents TOCTOU: `Promise.all([checkBudget(), checkBudget()])` with cap near limit, verify at most one passes
  - `reconcileAfterCall` replaces reservation with actual cost
  - Category separation (evolution vs non-evolution)
  - TTL expiration refreshes cache (use `jest.advanceTimersByTime(31000)`)
  - DB query failure → fail closed (throws, blocks call)
  - `resetForTesting()` clears all state
  - `invalidateCache()` forces next check to query DB

- `src/lib/services/llmCostConfigActions.test.ts`:
  - Get/set config values (mock Supabase)
  - `requireAdmin()` is called before any mutation
  - Kill switch toggle creates audit log entry
  - Invalid cap values rejected (negative, non-numeric)
  - `invalidateCache()` is called after kill switch toggle

- `src/lib/services/llmSpendingGate.test.ts` (additional monthly cap tests):
  - Monthly cap check: mock daily_cost_rollups with 30 days of data, verify SUM enforcement
  - Monthly cap uses 60s TTL cache (verify with `jest.advanceTimersByTime`)
  - Monthly cap exceeded → throws `GlobalBudgetExceededError` with monthly context

- `evolution/src/services/evolutionRunnerCore.test.ts` (extend existing):
  - Max concurrent runs enforcement: mock DB COUNT query returning N, verify claim rejected when N >= max
  - Uses FOR UPDATE to prevent concurrent claim race

- `src/lib/services/llms.test.ts` (extend existing, for Phase 5):
  - Verify `span.setAttributes()` called with `llm.cost_usd` after successful LLM call

- `src/lib/services/llmSpendingGate.test.ts` (additional `getCallCategory` tests):
  - `getCallCategory('evolution_writer')` → 'evolution'
  - `getCallCategory('returnExplanation')` → 'non_evolution'
  - `getCallCategory('evolution_')` → 'evolution' (edge case: empty suffix)

### Migration Validation
The PostgreSQL trigger is validated via **integration tests** that run against the staging Supabase instance (same as existing integration test pattern), NOT as unit tests (no local PostgreSQL infrastructure exists):
- `src/__tests__/integration/llm-spending-gate.integration.test.ts` (kebab-case, matching existing convention in `src/__tests__/integration/`):
  - INSERT into `llmCallTracking` → verify `daily_cost_rollups` row created/incremented
  - Concurrent INSERTs don't lose data (run 10 parallel inserts, verify sum matches)
  - Category derivation: `evolution_*` → 'evolution', other → 'non_evolution'
  - NULL `estimated_cost_usd` → treated as 0 via COALESCE
  - Config table seeding: verify default rows exist after migration
  - Set cap in config → insert tracking rows → call `checkBudget()` → verify enforcement
  - Kill switch: set to true → verify `checkBudget()` throws → set to false → verify passes
  - Monthly cap: insert rollup rows for multiple days in current month, verify SUM-based monthly enforcement
  - DB-atomic reservation: concurrent `check_and_reserve_llm_budget` RPCs with cap near limit, verify only expected number pass
  - Reservation reconciliation: reserve → reconcile → verify `reserved_usd` decremented
  - Stale reservation expiry: set `reserved_at` to 10 minutes ago, verify reservation ignored in cap check
  - **No real LLM calls**: tests insert directly into tracking table and call `checkBudget()` against the DB state

### Manual Verification (on staging)
- Toggle kill switch via admin UI → verify no LLM calls succeed (within 5s)
- Set daily cap to $1 → make calls → verify cap enforced
- Check Honeycomb for cost span attributes (`llm.cost_usd`)
- Verify Honeycomb triggers fire when thresholds exceeded
- Verify audit log entries for all config changes

### Rollback Plan
If the migration causes issues on production:
1. Disable the trigger immediately: `ALTER TABLE "llmCallTracking" DISABLE TRIGGER llm_cost_rollup_trigger;`
2. The spending gate will continue to work with stale data (last cached values) until cache expires
3. Once trigger is disabled, run full rollback SQL (documented in migration file header)
4. Deploy code change removing the spending gate from `callLLMModelRaw()` (gate is additive, removal is safe)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Add global cap and kill switch documentation
- `evolution/docs/evolution/reference.md` - Update config, env vars, and budget enforcement sections
- `evolution/docs/evolution/architecture.md` - Document new global budget check in pipeline flow
- `evolution/docs/evolution/data_model.md` - Document new tables for global spending tracking
- `evolution/docs/evolution/strategy_experiments.md` - Document experiment budget guardrails
- `evolution/docs/evolution/visualization.md` - Document new cost monitoring dashboard elements
- `evolution/docs/evolution/README.md` - Update overview with cost security features
