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

## Phased Execution Plan

### Phase 1: Database Foundation (migration + rollup table)
**Goal**: Create the `daily_cost_rollups` table and PostgreSQL trigger so all LLM spending is atomically tracked in a queryable format.

**Files to create/modify**:
- `supabase/migrations/YYYYMMDD_add_daily_cost_rollups.sql` — New migration:
  - Create `daily_cost_rollups` table: `(date DATE, category TEXT, total_cost_usd NUMERIC, call_count INTEGER, PRIMARY KEY (date, category))`
  - Create `llm_cost_config` table: `(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ, updated_by TEXT)`
  - Seed config rows: `daily_cap_usd`, `monthly_cap_usd`, `evolution_daily_cap_usd`, `kill_switch_enabled`
  - Create AFTER INSERT trigger on `llmCallTracking` → upsert into `daily_cost_rollups`
  - Backfill `daily_cost_rollups` from existing `llmCallTracking` data
- `src/lib/schemas/schemas.ts` — Add Zod schemas for `daily_cost_rollups` and `llm_cost_config`

**Validation**: Run migration on dev, insert test rows into `llmCallTracking`, verify `daily_cost_rollups` updates atomically.

### Phase 2: Global Spending Gate (application-level enforcement)
**Goal**: Add pre-flight spending checks to `callLLMModelRaw()` that block all LLM calls when daily/monthly caps are exceeded or kill switch is on.

**Files to create/modify**:
- `src/lib/services/llmSpendingGate.ts` — New file:
  - `LLMSpendingGate` class with in-memory TTL cache (30s default)
  - `checkBudget(callSource: string): Promise<void>` — throws `GlobalBudgetExceededError` or `LLMKillSwitchError`
  - `updateAfterCall(costUsd: number, callSource: string): void` — optimistic cache update
  - `getSpendingSummary(): Promise<SpendingSummary>` — for admin UI
  - Singleton instance with lazy initialization
- `src/lib/services/llms.ts` — Modify `callLLMModelRaw()`:
  - Add `await spendingGate.checkBudget(call_source)` before routing
  - Add `spendingGate.updateAfterCall(cost, call_source)` in the `onUsage` callback
- `src/lib/services/llmErrors.ts` — New file:
  - `GlobalBudgetExceededError` class
  - `LLMKillSwitchError` class

**Validation**: Unit tests for LLMSpendingGate. Integration test: set cap to $0.001, make an LLM call, verify it throws.

### Phase 3: Admin UI + Kill Switch
**Goal**: Add admin controls for viewing/setting spending caps and toggling the kill switch.

**Files to create/modify**:
- `src/app/admin/costs/page.tsx` — Extend existing page:
  - Add daily/monthly cap display with current spend vs cap
  - Add kill switch toggle button (with confirmation dialog)
  - Add cap configuration form (daily cap, monthly cap, evolution daily cap)
  - Show spending gate status (active/disabled, cache age)
- `src/lib/services/llmCostConfigActions.ts` — New server actions:
  - `getLLMCostConfig()` — Read current caps and kill switch state
  - `updateLLMCostConfig(key, value)` — Update a config value with audit logging
  - `toggleKillSwitch(enabled)` — Toggle with `logAdminAction()`

**Validation**: Manual verification on dev: toggle kill switch, verify all LLM calls blocked. Set daily cap, verify enforcement.

### Phase 4: Per-Run Hardening
**Goal**: Add concurrent run limits and batch budget enforcement to prevent evolution pipeline runaway.

**Files to create/modify**:
- `evolution/src/lib/core/pipeline.ts` — Add global daily cap check before starting run
- `evolution/src/services/experimentActions.ts` — Add max concurrent runs enforcement
- `evolution/src/lib/core/llmClient.ts` — Add global gate check alongside per-run CostTracker check

**Validation**: Unit test: start 2 runs with max_concurrent=1, verify second is queued/rejected. Test: batch with $10 budget, runs with $5 each, verify only 2 runs execute.

### Phase 5: OpenTelemetry Cost Attributes + Honeycomb Monitoring
**Goal**: Add cost span attributes to LLM traces and configure Honeycomb triggers for alerting.

**Files to create/modify**:
- `src/lib/services/llms.ts` — Add span attributes in `saveLlmCallTracking`:
  - `llm.cost_usd`, `llm.prompt_tokens`, `llm.completion_tokens`, `llm.reasoning_tokens`
- `instrumentation.ts` — Verify span attribute propagation
- Honeycomb configuration (via MCP or manual):
  - Query: SUM(llm.cost_usd) with alerts at 50%/80%/95% of daily cap
  - Query: RATE_SUM(llm.cost_usd) for per-minute anomaly detection
  - Trigger notifications (Honeycomb triggers → email initially)

**Validation**: Make LLM calls, verify cost attributes appear in Honeycomb spans. Verify triggers fire when thresholds exceeded.

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
- `src/lib/services/__tests__/llmSpendingGate.test.ts`:
  - Cache hit returns cached value
  - Cache miss queries DB
  - Over-cap throws GlobalBudgetExceededError
  - Kill switch throws LLMKillSwitchError
  - Optimistic update increments cache
  - Category separation (evolution vs non-evolution)
  - TTL expiration refreshes cache
  - Concurrent access is safe

- `supabase/migrations/__tests__/daily_cost_rollups_trigger.test.ts`:
  - INSERT into llmCallTracking creates/updates rollup row
  - Concurrent INSERTs don't lose data (atomic upsert)
  - Category derivation from call_source is correct
  - Date rollover creates new row

- `src/lib/services/__tests__/llmCostConfigActions.test.ts`:
  - Get/set config values
  - Kill switch toggle with audit logging
  - Invalid cap values rejected

### Integration Tests
- `src/lib/services/__tests__/llmSpendingGate.integration.test.ts`:
  - End-to-end: set cap → make LLM call → verify enforcement
  - Kill switch: enable → verify all calls blocked → disable → verify calls resume
  - Daily cap reset at midnight UTC

### Manual Verification (on staging)
- Toggle kill switch via admin UI → verify no LLM calls succeed
- Set daily cap to $1 → make calls → verify cap enforced
- Check Honeycomb for cost span attributes
- Verify Honeycomb triggers fire at configured thresholds

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Add global cap and kill switch documentation
- `evolution/docs/evolution/reference.md` - Update config, env vars, and budget enforcement sections
- `evolution/docs/evolution/architecture.md` - Document new global budget check in pipeline flow
- `evolution/docs/evolution/data_model.md` - Document new tables for global spending tracking
- `evolution/docs/evolution/strategy_experiments.md` - Document experiment budget guardrails
- `evolution/docs/evolution/visualization.md` - Document new cost monitoring dashboard elements
- `evolution/docs/evolution/README.md` - Update overview with cost security features
