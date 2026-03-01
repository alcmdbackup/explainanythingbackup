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

### Deployment model
The app runs on **Vercel serverless**. Module-level singletons reset per cold start, so the TTL cache will miss on first invocation of each function instance. This is acceptable because: (a) cache miss triggers a fast O(1) DB query (~2-5ms), (b) warm function instances (majority of traffic) get cache hits, (c) the cache is a performance optimization, not a correctness requirement — enforcement always works, just with varying latency.

### Pre-call cost reservation in the global gate
Unlike the evolution CostTracker which has precise pre-call cost estimation, the global gate uses a **simpler approach**: `checkBudget()` performs an atomic `reservedTotal += estimatedCost` on the in-memory cache before the call executes, then `reconcileAfterCall()` replaces the reservation with actual cost. Estimated cost is derived from `calculateLLMCost()` using a conservative token estimate (max_tokens from the model config). This prevents the TOCTOU race where N concurrent requests all read the same cached total and all pass. If estimation is unavailable, a fixed reservation of $0.05 is used (covers 99%+ of gpt-4.1-mini calls).

## Phased Execution Plan

### Phase 1: Database Foundation (migration + rollup table)
**Goal**: Create the `daily_cost_rollups` table and PostgreSQL trigger so all LLM spending is atomically tracked in a queryable format.

**Files to create/modify**:
- `supabase/migrations/YYYYMMDD_add_daily_cost_rollups.sql` — New migration:
  - Create `daily_cost_rollups` table: `(date DATE, category TEXT, total_cost_usd NUMERIC(12,6), call_count INTEGER, PRIMARY KEY (date, category))`
  - Create `llm_cost_config` table: `(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT)`
  - Add RLS policies: `daily_cost_rollups` read-only for authenticated, write via service_role only; `llm_cost_config` read for authenticated, write restricted to service_role
  - Seed config rows: `daily_cap_usd` (default: 50), `monthly_cap_usd` (default: 500), `evolution_daily_cap_usd` (default: 25), `kill_switch_enabled` (default: false)
  - Create AFTER INSERT trigger on `llmCallTracking`:
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
  - Backfill `daily_cost_rollups` from existing `llmCallTracking` data (batched in 10K row chunks to avoid lock contention)
  - **Rollback SQL** (comment at top of migration):
    ```sql
    -- ROLLBACK: DROP TRIGGER IF EXISTS llm_cost_rollup_trigger ON "llmCallTracking";
    -- DROP FUNCTION IF EXISTS update_daily_cost_rollup();
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
    2. Compute category from `callSource.startsWith('evolution_')` — extract to shared `getCallCategory()` utility
    3. Atomic pre-call reservation: `cachedTotal += (estimatedCostUsd ?? 0.05)` to prevent TOCTOU race
    4. If `cachedTotal > dailyCap` → release reservation, throw `GlobalBudgetExceededError`
    5. If cache miss → query `daily_cost_rollups` (O(1) lookup), cache result
  - `reconcileAfterCall(actualCostUsd: number, callSource: string): void` — replace reservation with actual cost
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
- `evolution/src/services/evolutionActions.ts` — Add max concurrent runs enforcement (not experimentActions.ts — evolutionActions already handles run claiming via `claim_evolution_run` RPC with `FOR UPDATE SKIP LOCKED`). Add `SELECT COUNT(*) FROM evolution_invocations WHERE status = 'running'` check with configurable max (default: 5) before claiming.
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

- `evolution/src/services/evolutionActions.test.ts` (extend existing):
  - Max concurrent runs enforcement: mock N running invocations, verify claim rejected

### Migration Validation
The PostgreSQL trigger is validated via **integration tests** that run against the staging Supabase instance (same as existing integration test pattern), NOT as unit tests (no local PostgreSQL infrastructure exists):
- `src/lib/services/llmSpendingGate.integration.test.ts`:
  - INSERT into `llmCallTracking` → verify `daily_cost_rollups` row created/incremented
  - Concurrent INSERTs don't lose data (run 10 parallel inserts, verify sum matches)
  - Category derivation: `evolution_*` → 'evolution', other → 'non_evolution'
  - NULL `estimated_cost_usd` → treated as 0 via COALESCE
  - Config table seeding: verify default rows exist after migration
  - Set cap in config → insert tracking rows → call `checkBudget()` → verify enforcement
  - Kill switch: set to true → verify `checkBudget()` throws → set to false → verify passes
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
