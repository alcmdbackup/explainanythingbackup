# LLM Spending Gate

Hardened in Phase 0 of `build_website_for_evolutiOn_20260626`. Defends every LLM call across the system against runaway spend through a layered cap stack.

## Layered cap stack

For a public `/edit` submission, every LLM call passes through (in order):

| Layer | Mechanism | Where | Default cap |
|---|---|---|---|
| Per-run | `evolution_runs.budget_cap_usd` checked inside `claimAndExecuteRun` | DB column | `$0.10` for `/edit`; admin caller controls otherwise |
| Per-IP | `perIpSpendingGate.reserveForIp(ip, country, est)` (Upstash) | `src/lib/services/perIpSpendingGate.ts` | `$0.50/day` (`PUBLIC_EDIT_PER_IP_DAILY_USD_CAP`) |
| Per-region | `perIpSpendingGate.reserveForIp` (region bucket) | same | `$5/day` (`PUBLIC_EDIT_PER_REGION_DAILY_USD_CAP`) per country |
| Per-user (reserve-before-spend) | `LLMSpendingGate.reserveForUser(userid, est, cap)` | `src/lib/services/llmSpendingGate.ts` | `$10/day` (config `guest_user_daily_cap_usd`) for `GUEST_USER_ID` only |
| Global evolution daily | `LLMSpendingGate.checkBudget('evolution_…', est)` → `check_and_reserve_llm_budget` RPC | DB | `$25/day` (config `evolution_daily_cap_usd`) |
| Global non-evolution daily | same | DB | `$50/day` (config `daily_cap_usd`) |
| Monthly | `checkMonthlyCap` | DB | `$500/month` (config `monthly_cap_usd`) |
| Kill switch | `getKillSwitch()` | DB | `kill_switch_enabled=false` |

Any layer can throw. `try/finally` reconciles reservations on success or failure.

## Reserve-before-spend (per-user, Phase 0)

Earlier `checkPerUserCap` was a read-only check that raced under load. Phase 0 replaces it (at the `llms.ts:988` call site) with:

```ts
const cap = await spendingGate.getGuestUserCap();           // reads llm_cost_config
const reserved = await spendingGate.reserveForUser(userid, estCost, cap);
try {
  // …LLM call…
} finally {
  spendingGate.recordActualForUser(userid, reserved);       // releases reservation
}
```

The reservation goes into a dedicated table — `per_user_daily_reservations` (PK `(date, user_id)`) — independent of the per-call_source `per_user_daily_cost_rollups` table the existing trigger writes to. Cap-check sums BOTH tables.

The reservation RPC (`reserve_per_user_daily_cost`) uses `SELECT … FOR UPDATE` to atomically check-then-increment — UPSERT-with-RETURNING was insufficient because it can't reject after-the-fact.

Orphan cleanup runs from the minicomputer's `processRunQueue.ts` BEFORE the claim loop (so it fires once per systemd-timer wake even when the queue is empty): `cleanup_orphaned_per_user_reservations(15)` releases reservations older than 15 minutes whose corresponding `llmCallTracking` row never landed.

## Fail-CLOSED contract

**Unconditional.** Any error path in the gate THROWS (`GlobalBudgetExceededError` with `cause: 'gate_check_failed'`). There is no env-var escape for the fail-CLOSED behavior — if the gate's DB reads break, every LLM call refuses until the underlying error is resolved. Cost-tracking integrity is treated as a load-bearing system invariant ([feedback_cost_tracking_fail_closed](../../memory/feedback_cost_tracking_fail_closed.md)).

The original Phase-0 `LLM_GATE_FAIL_CLOSED_DISABLED` rollback kill switch was retired in `fix/remove-llm-gate-failclosed-killswitch` after the staging soak proved the gate's DB reads were stable. `LLM_GATE_PANIC_BYPASS` remains as the only operational escape — but it kills the ENTIRE gate (not just the fail-closed path) and audit-logs on every call, so it can't be silently left on.

Honeycomb-shaped events distinguish system-fault vs user-fault rejections:

| Event | Priority | Trigger | Alert action |
|---|---|---|---|
| `gate.fail_closed_rejected` | HIGH | DB error, missing RPC, RLS misconfig | Page ops — system broken, not user-fault |
| `gate.guest_pool_exhausted` | INFO | Real over-cap rejection for `GUEST_USER_ID` | Alert only on sustained rate (>5/hr); the cap is doing its job |

## Operational kill switches

| Env var | Default | Effect when `'true'` |
|---|---|---|
| `LLM_GATE_PANIC_BYPASS` | unset | ALL gate checks short-circuit + audit-log to stderr per call. Last-resort tool for prolonged outages — turns the entire gate off. |
| `PUBLIC_EDIT_RATE_LIMIT_DISABLED` | unset | Per-IP/per-region gate is no-op (E2E + CI bypass) |
| `BOT_PROTECTION_DISABLED` | unset | BotID check skipped (E2E + local dev bypass) |
| `PUBLIC_EDIT_DISABLED` | unset | `/edit` POST returns 503; page renders "temporarily unavailable" |

## Config keys (llm_cost_config)

| Key | Default | Purpose |
|---|---|---|
| `daily_cap_usd` | `50` | Non-evolution daily cap |
| `evolution_daily_cap_usd` | `25` | Evolution daily cap (admin + /edit + minicomputer) |
| `monthly_cap_usd` | `500` | System-wide monthly cap |
| `kill_switch_enabled` | `false` | Global emergency off-switch |
| `guest_user_daily_cap_usd` | `10` | Per-`GUEST_USER_ID` daily pool (Phase 0 replaces hard-coded `10`) |
| `public_edit_per_ip_daily_usd` | `0.50` | Reserved for follow-up; current code reads from env |
| `public_edit_per_region_daily_usd` | `5` | Reserved for follow-up |
| `public_edit_daily_cap_usd` | `15` | Reserved for follow-up split of evolution_daily_cap_usd |

## Key Files

| File | Purpose |
|---|---|
| `src/lib/services/llmSpendingGate.ts` | The gate class + reserve/reconcile/release for per-user + per-category + monthly. |
| `src/lib/services/perIpSpendingGate.ts` | Upstash-backed per-IP + per-region $-spending gate with KvAdapter interface for testability. |
| `src/lib/services/llms.ts` | `callLLM` call site — wires the per-user reserve at lines 982-989 and reconciles in the `finally` at line 1023. |
| `supabase/migrations/20260524000003_add_per_user_daily_cost_rollups.sql` | Original per-user-rollup table + trigger. |
| `supabase/migrations/20260627000001_llm_cost_config_public_edit_keys.sql` | The 4 new `llm_cost_config` keys. |
| `supabase/migrations/20260627000002_per_user_daily_reservations.sql` | The new dedicated reservations table + 3 RPCs (reserve / reconcile / cleanup). |
| `supabase/migrations/20260228000001_add_llm_cost_security.sql` | Reference impl for `check_and_reserve_llm_budget` (the pattern the new reserve RPC mirrors). |
| `evolution/scripts/processRunQueue.ts` | Inline cleanup call at top-of-main (before the while-loop) for orphan release. |
