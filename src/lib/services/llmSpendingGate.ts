// Global LLM spending gate — enforces daily/monthly caps and kill switch before every LLM call.
// Uses in-memory TTL cache for performance with DB-atomic reservation for correctness near cap.
//
// Originally added in Phase 0 of build_website_for_evolutiOn_20260626:
// - Fail-CLOSED on DB errors — UNCONDITIONAL. Any error path in the gate THROWS
//   GlobalBudgetExceededError. (The Phase-0 LLM_GATE_FAIL_CLOSED_DISABLED rollback
//   kill-switch was removed after staging soak; LLM_GATE_PANIC_BYPASS remains as
//   the only operational escape, and it audit-logs on every call.)
// - LLM_GATE_PANIC_BYPASS env var (operational kill-switch for all gate checks; audit-logged)
// - reserveForUser / recordActualForUser / releaseForUser triple (reserve-before-spend semantics)
//   against the new per_user_daily_reservations table + reserve_per_user_daily_cost RPC
//   (migration 20260627000002).
// - Structured Honeycomb events: gate.fail_closed_rejected (HIGH) vs gate.guest_pool_exhausted (INFO)
// - Configurable per-user cap via llm_cost_config (`guest_user_daily_cap_usd`); the hard-coded `10`
//   at llms.ts:988 is replaced with a config-driven read.

import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';
import type { CheckBudgetResult } from '@/lib/schemas/llmCostSchemas';

/**
 * Operational panic bypass — when 'true', ALL gate checks short-circuit and allow
 * the call. Logs an audit line to stderr per call so the bypass is discoverable.
 * NEVER set in any deployed env by default. Last-resort tool for prolonged outages.
 */
function panicBypassEnabled(): boolean {
  if (process.env.LLM_GATE_PANIC_BYPASS === 'true') {
    // Audit line — written every call so a forgotten flag is visible in container logs.
    logger.error('[LLM_GATE_PANIC_BYPASS] gate disabled; call passing through unchecked');
    return true;
  }
  return false;
}

// B088: Zod-parse the kill-switch config row instead of an unchecked cast.
// The DB stores the value as `{ value: boolean }` JSON; anything else (a stringly-typed
// 'true', a missing inner key, a numeric cast) must default to false/disabled.
const killSwitchConfigSchema = z.object({ value: z.boolean() });

const SPENDING_CACHE_TTL_MS = 30_000;
const KILL_SWITCH_CACHE_TTL_MS = 5_000;
const MONTHLY_CACHE_TTL_MS = 60_000;
const DEFAULT_RESERVATION_USD = 0.05;
const FAST_PATH_HEADROOM = 0.10;
// B013-S5: shared default monthly cap so getSummary and checkMonthlyCap don't drift.
// Previously checkMonthlyCap defaulted to 500 while getSummary returned the raw config
// value (which could be undefined → 0). Surface the same number from both paths.
const DEFAULT_MONTHLY_CAP_USD = 500;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface SpendingCacheData {
  dailyTotal: number;
  dailyCap: number;
  reserved: number;
}

/** Safely extract error message from unknown error values. */
function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Check if an error indicates the cost tables/functions haven't been created yet (migration not applied). */
function isMissingTableError(err: unknown): boolean {
  const msg = errorMsg(err);
  const code = (err as { code?: string })?.code;
  // PostgreSQL: 42P01 = undefined_table, 42883 = undefined_function
  // PostgREST: PGRST205 = table not found, PGRST202 = function not found, PGRST116 = row not found
  const missingCodes = new Set(['42P01', '42883', 'PGRST205', 'PGRST202', 'PGRST116']);
  return (!!code && missingCodes.has(code)) || msg.includes('does not exist') || msg.includes('Could not find');
}

export function getCallCategory(callSource: string): 'evolution' | 'non_evolution' {
  return callSource.startsWith('evolution_') ? 'evolution' : 'non_evolution';
}

function getMonthStartDate(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]!;
}

export interface SpendingSummary {
  daily: { category: string; totalCostUsd: number; reservedUsd: number; callCount: number; cap: number }[];
  monthlyTotal: number;
  monthlyCap: number;
  killSwitchEnabled: boolean;
}

export class LLMSpendingGate {
  private spendingCache = new Map<string, CacheEntry<SpendingCacheData>>();
  private killSwitchCache: CacheEntry<boolean> | null = null;
  private monthlyCache: CacheEntry<{ total: number; cap: number }> | null = null;
  // Per-user spending cache, keyed by `${userid}:${dateISO}`. Separate keyspace
  // from the category-keyed spendingCache to avoid pollution.
  private userSpendingCache = new Map<string, CacheEntry<number>>();
  // Per-user cap cache (Phase 0). Reads llm_cost_config.guest_user_daily_cap_usd.
  private guestCapCache: CacheEntry<number> | null = null;

  /**
   * @deprecated Use `reserveForUser` instead. New callers blocked by ESLint
   * `no-restricted-imports`. To be deleted in a follow-up PR.
   *
   * Per-user daily LLM cap (read-only check). Reads from per_user_daily_cost_rollups
   * (populated by trigger on llmCallTracking insert — see migration 20260524000003).
   *
   * SEED_BYPASS_USER_CAP='true' lets seed scripts (e.g., scripts/seed-guest-library.ts)
   * bypass the cap so they can populate the demo library without consuming the
   * day's budget for the actual demo. Set as env var only when running the script.
   *
   * Fails CLOSED on DB errors — throws GlobalBudgetExceededError. Reads ONLY
   * total_cost_usd; does NOT account for reserved_usd from the new
   * per_user_daily_reservations table — use `reserveForUser` for the airtight path.
   */
  async checkPerUserCap(userid: string, capUsd: number): Promise<void> {
    if (panicBypassEnabled()) return;
    if (process.env.SEED_BYPASS_USER_CAP === 'true') return;
    if (!userid || capUsd <= 0) return;

    const today = new Date().toISOString().split('T')[0]!;
    const cacheKey = `${userid}:${today}`;
    const cached = this.userSpendingCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.value >= capUsd) {
        this.logGuestPoolExhausted(userid, cached.value, capUsd);
        throw new GlobalBudgetExceededError(
          `Daily per-user budget exceeded: $${cached.value.toFixed(2)} spent of $${capUsd.toFixed(2)} cap`,
          { category: 'per_user', dailyTotal: cached.value, dailyCap: capUsd, reserved: 0 },
        );
      }
      return;
    }

    try {
      const supabase = await createSupabaseServiceClient();
      // Cast the .from() result: `per_user_daily_cost_rollups` is added by migration
      // 20260524000003 and database.types.ts will regenerate on next CI types pass.
      // Until then, the table isn't in the generated `Database` type, so we type-assert.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rollupTable = supabase.from('per_user_daily_cost_rollups' as any);
      const { data, error } = await rollupTable
        .select('total_cost_usd')
        .eq('user_id', userid)
        .eq('date', today);

      if (error) {
        if (isMissingTableError(error)) {
          logger.debug('per_user_daily_cost_rollups missing — skipping per-user cap', { userid });
          return;
        }
        return this.failClosedOrAllow('checkPerUserCap.read', userid, error);
      }

      const rows = (data ?? []) as unknown as Array<{ total_cost_usd: number | string | null }>;
      const total = rows.reduce((sum, r) => {
        const v = r.total_cost_usd;
        return sum + (typeof v === 'string' ? parseFloat(v) : v ?? 0);
      }, 0);

      this.userSpendingCache.set(cacheKey, {
        value: total,
        expiresAt: Date.now() + SPENDING_CACHE_TTL_MS,
      });

      if (total >= capUsd) {
        this.logGuestPoolExhausted(userid, total, capUsd);
        throw new GlobalBudgetExceededError(
          `Daily per-user budget exceeded: $${total.toFixed(2)} spent of $${capUsd.toFixed(2)} cap`,
          { category: 'per_user', dailyTotal: total, dailyCap: capUsd, reserved: 0 },
        );
      }
    } catch (err) {
      if (err instanceof GlobalBudgetExceededError) throw err;
      if (isMissingTableError(err)) return;
      this.failClosedOrAllow('checkPerUserCap.throw', userid, err);
    }
  }

  /**
   * Reserve-before-spend per-user gate (Phase 0).
   * Calls the `reserve_per_user_daily_cost` RPC (migration 20260627000002) which
   * atomically SELECT FOR UPDATEs the (date, user_id) row, sums total_cost_usd
   * across all call_sources, and either increments reserved_usd or rejects.
   *
   * On rejection, throws `GlobalBudgetExceededError` and emits a structured
   * `gate.guest_pool_exhausted` event (INFO) — the cap is doing its job.
   * On DB error, throws via `failClosedOrThrow` (HIGH) — system broken.
   *
   * Caller MUST pair every successful reservation with `recordActualForUser`
   * (success path) or `releaseForUser` (failure path) in a try/finally.
   *
   * Returns the reserved USD amount (echoed from the input estimate) so the
   * caller can pass it back unchanged to the reconcile call.
   */
  async reserveForUser(userid: string, estimatedCostUsd: number, capUsd: number): Promise<number> {
    if (panicBypassEnabled()) return estimatedCostUsd;
    if (process.env.SEED_BYPASS_USER_CAP === 'true') return estimatedCostUsd;
    if (!userid || capUsd <= 0 || estimatedCostUsd <= 0) return 0;

    const today = new Date().toISOString().split('T')[0]!;

    try {
      const supabase = await createSupabaseServiceClient();
      // RPC added by migration 20260627000002; database.types.ts will regenerate on next CI types pass.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('reserve_per_user_daily_cost', {
        p_user_id: userid,
        p_date: today,
        p_estimated_usd: estimatedCostUsd,
        p_cap_usd: capUsd,
      });

      if (error) {
        if (isMissingTableError(error)) {
          this.logFailClosedRejected('reserveForUser.missing_rpc', userid, error);
          throw new GlobalBudgetExceededError(
            'reserve_per_user_daily_cost RPC not found (migration not applied)',
            { category: 'per_user', cause: 'gate_check_failed', dailyTotal: 0, dailyCap: capUsd, reserved: 0 },
          );
        }
        this.logFailClosedRejected('reserveForUser.rpc_error', userid, error);
        throw new GlobalBudgetExceededError(
          'Unable to verify per-user budget (DB error) — blocking call for safety',
          { category: 'per_user', cause: 'gate_check_failed', dailyTotal: 0, dailyCap: capUsd, reserved: 0 },
        );
      }

      const result = (data ?? {}) as { ok?: boolean; dailyTotal?: number; dailyCap?: number; reservedUsd?: number };
      if (!result.ok) {
        const dailyTotal = Number(result.dailyTotal ?? 0);
        this.logGuestPoolExhausted(userid, dailyTotal, capUsd);
        throw new GlobalBudgetExceededError(
          `Daily per-user budget exceeded: $${dailyTotal.toFixed(2)} of $${capUsd.toFixed(2)} cap`,
          { category: 'per_user', dailyTotal, dailyCap: capUsd, reserved: 0 },
        );
      }

      // Invalidate the deprecated checkPerUserCap cache so a mixed-callers transition
      // window doesn't serve stale values.
      this.userSpendingCache.delete(`${userid}:${today}`);

      return Number(result.reservedUsd ?? estimatedCostUsd);
    } catch (err) {
      if (err instanceof GlobalBudgetExceededError) throw err;
      if (isMissingTableError(err)) {
        this.logFailClosedRejected('reserveForUser.throw_missing', userid, err);
        throw new GlobalBudgetExceededError(
          'reserve_per_user_daily_cost RPC not found',
          { category: 'per_user', cause: 'gate_check_failed' },
        );
      }
      this.logFailClosedRejected('reserveForUser.throw', userid, err);
      throw new GlobalBudgetExceededError(
        'Unable to verify per-user budget (gate threw) — blocking call for safety',
        { category: 'per_user', cause: 'gate_check_failed' },
      );
    }
  }

  /**
   * Reconcile after a successful LLM call: decrement the per-user reservation by
   * the reserved amount. The llmCallTracking AFTER INSERT trigger writes the
   * ACTUAL cost into per_user_daily_cost_rollups separately — we only release
   * the reservation here, never re-add the actual.
   *
   * Safe to call in a `finally` block — swallows reconcile errors (logs only)
   * so the caller's primary return is never clobbered. Cache invalidated on
   * failure so the next call gets a fresh DB read.
   */
  async recordActualForUser(userid: string, reservedUsd: number): Promise<void> {
    if (panicBypassEnabled()) return;
    if (!userid || reservedUsd <= 0) return;

    const today = new Date().toISOString().split('T')[0]!;
    try {
      const supabase = await createSupabaseServiceClient();
      // RPC added by migration 20260627000002; database.types.ts will regenerate on next CI types pass.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('reconcile_per_user_reservation', {
        p_user_id: userid,
        p_date: today,
        p_reserved_usd: reservedUsd,
      });
      if (error) {
        logger.error('Failed to reconcile per-user reservation', {
          error: error.message,
          userid,
          reservedUsd,
        });
        this.userSpendingCache.delete(`${userid}:${today}`);
      }
    } catch (err) {
      logger.error('Error reconciling per-user reservation', {
        error: errorMsg(err),
        userid,
        reservedUsd,
      });
      this.userSpendingCache.delete(`${userid}:${today}`);
    }
  }

  /**
   * Release a per-user reservation without recording any actual spend (the LLM
   * call failed before reaching the provider). Mechanically identical to
   * `recordActualForUser` — the difference is purely intent / call-site naming.
   */
  async releaseForUser(userid: string, reservedUsd: number): Promise<void> {
    return this.recordActualForUser(userid, reservedUsd);
  }

  /**
   * Read the per-user daily cap from `llm_cost_config` (key `guest_user_daily_cap_usd`).
   * Defaults to $10 when the row is missing — matches the historical hard-coded value
   * at llms.ts:988 that this method replaces. Caches alongside the kill-switch (5s TTL)
   * since both are read from llm_cost_config on every LLM call.
   */
  async getGuestUserCap(): Promise<number> {
    if (this.guestCapCache && Date.now() < this.guestCapCache.expiresAt) {
      return this.guestCapCache.value;
    }
    try {
      const supabase = await createSupabaseServiceClient();
      const { data, error } = await supabase
        .from('llm_cost_config')
        .select('value')
        .eq('key', 'guest_user_daily_cap_usd')
        .single();
      if (error) {
        if (isMissingTableError(error)) {
          this.guestCapCache = { value: 10, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS };
          return 10;
        }
        logger.warn('getGuestUserCap config read failed; using default', { error: error.message });
        return 10;
      }
      const value = (data?.value as { value?: unknown } | null)?.value;
      const cap = typeof value === 'number' ? value : 10;
      this.guestCapCache = { value: cap, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS };
      return cap;
    } catch (err) {
      logger.warn('getGuestUserCap threw; using default', { error: errorMsg(err) });
      return 10;
    }
  }

  /** Honeycomb-shaped log: HIGH priority — system-broken, not user-fault. */
  private logFailClosedRejected(site: string, userid: string, err: unknown): void {
    logger.error('gate.fail_closed_rejected', {
      site,
      userid,
      errorType: (err as { code?: string } | null)?.code ?? 'unknown',
      errorMessage: errorMsg(err),
      cause: 'gate_check_failed',
    });
  }

  /** Honeycomb-shaped log: INFORMATIONAL — the cap is doing its job. Sustained rate alerts only. */
  private logGuestPoolExhausted(userid: string, dailyTotal: number, dailyCap: number): void {
    logger.info('gate.guest_pool_exhausted', {
      userid,
      dailyTotal,
      dailyCap,
      category: 'per_user',
    });
  }

  /**
   * Fail-CLOSED helper: log + throw GlobalBudgetExceededError on any DB error.
   * Used only by the deprecated `checkPerUserCap`; new callers use `reserveForUser`
   * which has its own fail-closed path.
   */
  private failClosedOrAllow(site: string, userid: string, err: unknown): void {
    this.logFailClosedRejected(site, userid, err);
    throw new GlobalBudgetExceededError(
      'Unable to verify per-user budget (gate failed) — blocking call for safety',
      { category: 'per_user', cause: 'gate_check_failed' },
    );
  }

  /** Throws on kill switch, over-cap, or DB errors (fail-closed). Returns reserved cost. */
  async checkBudget(callSource: string, estimatedCostUsd?: number): Promise<number> {
    if (panicBypassEnabled()) return estimatedCostUsd ?? DEFAULT_RESERVATION_USD;
    const killSwitchEnabled = await this.getKillSwitch();
    if (killSwitchEnabled) {
      throw new LLMKillSwitchError();
    }

    const category = getCallCategory(callSource);
    const estimatedCost = estimatedCostUsd ?? DEFAULT_RESERVATION_USD;

    // B019 + B086 (atomic): always run the monthly-cap check before the daily fast-path
    // return. Previously the fast path exited without consulting the monthly cap when the
    // monthly cache was stale, allowing over-spend for a full monthly-TTL window. Now every
    // request — fast-path daily-hit OR slow-path daily-miss — runs a monthly check. The
    // monthly-cap comparison is standardized to `>` at every site (fast + slow) so the two
    // paths never diverge. See `checkMonthlyCap()` for the refresh-on-expiry flow.
    await this.checkMonthlyCap(category, estimatedCost);

    // Fast-path: if cached spending is well below cap, skip DB query for the daily side.
    const cached = this.getCachedSpending(category);
    if (cached) {
      const headroom = cached.dailyCap * FAST_PATH_HEADROOM;
      if (cached.dailyTotal + cached.reserved + estimatedCost < cached.dailyCap - headroom) {
        // Monthly check has already run above. Safe to fast-return.
        return estimatedCost;
      }
    }

    // Near-cap or cache miss: DB-atomic reservation
    const result = await this.reserveViaRpc(category, estimatedCost);
    if (!result.allowed) {
      throw new GlobalBudgetExceededError(
        `Daily ${category} budget exceeded: $${result.daily_total.toFixed(2)} spent + $${result.reserved.toFixed(2)} reserved of $${result.daily_cap.toFixed(2)} cap`,
        { category, dailyTotal: result.daily_total, dailyCap: result.daily_cap, reserved: result.reserved },
      );
    }

    this.spendingCache.set(category, {
      value: { dailyTotal: result.daily_total, dailyCap: result.daily_cap, reserved: result.reserved },
      expiresAt: Date.now() + SPENDING_CACHE_TTL_MS,
    });

    await this.checkMonthlyCap(category);

    return estimatedCost;
  }

  async reconcileAfterCall(reservedCostUsd: number, callSource: string): Promise<void> {
    const category = getCallCategory(callSource);
    try {
      const supabase = await createSupabaseServiceClient();
      const { error } = await supabase.rpc('reconcile_llm_reservation', {
        p_category: category,
        p_reserved: reservedCostUsd,
      });
      if (error) {
        logger.error('Failed to reconcile LLM reservation', { error: error.message, category, reserved: reservedCostUsd });
      }
    } catch (err) {
      logger.error('Error reconciling LLM reservation', { error: errorMsg(err), category, reserved: reservedCostUsd });
    }
    this.spendingCache.delete(category);
  }

  async getSpendingSummary(): Promise<SpendingSummary> {
    const supabase = await createSupabaseServiceClient();
    const today = new Date().toISOString().split('T')[0]!;

    const [rollupsResult, configResult] = await Promise.all([
      supabase.from('daily_cost_rollups').select('*').eq('date', today),
      supabase.from('llm_cost_config').select('*'),
    ]);

    const rollups = rollupsResult.data ?? [];
    const config = configResult.data ?? [];

    const getConfigValue = (key: string): unknown => {
      const row = config.find((c: { key: string; value: unknown }) => c.key === key);
      return (row?.value as { value?: unknown } | null)?.value ?? 0;
    };

    const daily = rollups.map((r: { category: string; total_cost_usd: number; reserved_usd: number; call_count: number }) => ({
      category: r.category,
      totalCostUsd: Number(r.total_cost_usd),
      reservedUsd: Number(r.reserved_usd),
      callCount: r.call_count,
      // B089: documented defaults when the config row is missing — matches the values
      // declared in environments.md (evolution: $25/day, non-evolution: $50/day).
      cap: r.category === 'evolution'
        ? ((getConfigValue('evolution_daily_cap_usd') as number) || 25)
        : ((getConfigValue('daily_cap_usd') as number) || 50),
    }));

    const { data: monthlyData } = await supabase
      .from('daily_cost_rollups')
      .select('total_cost_usd')
      .gte('date', getMonthStartDate());

    const monthlyTotal = (monthlyData ?? []).reduce((sum: number, r: { total_cost_usd: number }) => sum + Number(r.total_cost_usd), 0);

    return {
      daily,
      monthlyTotal,
      monthlyCap: (getConfigValue('monthly_cap_usd') as number | undefined) ?? DEFAULT_MONTHLY_CAP_USD,
      killSwitchEnabled: getConfigValue('kill_switch_enabled') as boolean,
    };
  }

  invalidateCache(): void {
    this.killSwitchCache = null;
    this.spendingCache.clear();
    this.monthlyCache = null;
    this.userSpendingCache.clear();
    this.guestCapCache = null;
  }

  async cleanupOrphanedReservations(): Promise<void> {
    const supabase = await createSupabaseServiceClient();
    const { error } = await supabase.rpc('reset_orphaned_reservations');
    if (error) {
      logger.error('Failed to cleanup orphaned reservations', { error: error.message });
      throw error;
    }
  }

  private async getKillSwitch(): Promise<boolean> {
    if (this.killSwitchCache && Date.now() < this.killSwitchCache.expiresAt) {
      return this.killSwitchCache.value;
    }

    try {
      const supabase = await createSupabaseServiceClient();
      const { data, error } = await supabase
        .from('llm_cost_config')
        .select('value')
        .eq('key', 'kill_switch_enabled')
        .single();

      if (error) throw error;

      // B088: schema-parse instead of unchecked cast; malformed rows default to `false`.
      const parsed = killSwitchConfigSchema.safeParse(data?.value);
      const enabled = parsed.success ? parsed.data.value : false;
      if (!parsed.success) {
        logger.warn('kill_switch_enabled config row failed schema validation', {
          issues: parsed.error.issues,
        });
      }
      this.killSwitchCache = { value: enabled, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS };
      return enabled;
    } catch (err) {
      // If the table doesn't exist yet (migration not applied), allow calls through
      if (isMissingTableError(err)) {
        logger.warn('llm_cost_config table not found — spending gate disabled (migration not applied)');
        this.killSwitchCache = { value: false, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS };
        return false;
      }
      this.logFailClosedRejected('getKillSwitch', '', err);
      // B084: cache the fail-closed state for the TTL so every subsequent call in the
      // window doesn't re-query the failing DB. Without this cache write, a transient
      // DB error produces a flood of identical queries until it recovers.
      this.killSwitchCache = { value: true, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS };
      throw new LLMKillSwitchError();
    }
  }

  private getCachedSpending(category: string): SpendingCacheData | null {
    const entry = this.spendingCache.get(category);
    if (entry && Date.now() < entry.expiresAt) {
      return entry.value;
    }
    return null;
  }

  private async reserveViaRpc(category: string, estimatedCost: number): Promise<CheckBudgetResult> {
    try {
      const supabase = await createSupabaseServiceClient();
      const { data, error } = await supabase.rpc('check_and_reserve_llm_budget', {
        p_category: category,
        p_estimated_cost: estimatedCost,
      });

      if (error) throw error;
      return data as CheckBudgetResult;
    } catch (err) {
      if (isMissingTableError(err)) {
        logger.warn('Budget RPC not found — spending gate disabled (migration not applied)');
        return { allowed: true, daily_total: 0, daily_cap: 999, reserved: 0 };
      }
      this.logFailClosedRejected('reserveViaRpc', '', err);
      throw new GlobalBudgetExceededError(
        'Unable to verify LLM budget (DB error) — blocking call for safety',
        { category, cause: 'gate_check_failed' },
      );
    }
  }

  private async checkMonthlyCap(category: string, estimatedCost = 0): Promise<void> {
    // B086: consistent `>` comparison at BOTH the cached-hit site and the slow-path site;
    //       comparing the post-estimation total against the cap so "equal to cap" is still allowed.
    if (this.monthlyCache && Date.now() < this.monthlyCache.expiresAt) {
      if (this.monthlyCache.value.total + estimatedCost > this.monthlyCache.value.cap) {
        throw new GlobalBudgetExceededError(
          `Monthly budget exceeded: $${this.monthlyCache.value.total.toFixed(2)} of $${this.monthlyCache.value.cap.toFixed(2)} cap`,
          { category, monthlyTotal: this.monthlyCache.value.total, monthlyCap: this.monthlyCache.value.cap },
        );
      }
      return;
    }

    try {
      const supabase = await createSupabaseServiceClient();

      const [totalResult, capResult] = await Promise.all([
        supabase.from('daily_cost_rollups').select('total_cost_usd').gte('date', getMonthStartDate()),
        supabase.from('llm_cost_config').select('value').eq('key', 'monthly_cap_usd').single(),
      ]);

      if (totalResult.error) throw totalResult.error;
      if (capResult.error) throw capResult.error;

      const monthlyTotal = (totalResult.data ?? []).reduce((sum: number, r: { total_cost_usd: number }) => sum + Number(r.total_cost_usd), 0);
      const monthlyCap = ((capResult.data?.value as { value?: unknown } | null)?.value as number) ?? DEFAULT_MONTHLY_CAP_USD;

      this.monthlyCache = { value: { total: monthlyTotal, cap: monthlyCap }, expiresAt: Date.now() + MONTHLY_CACHE_TTL_MS };

      // B086: consistent `>` comparison at this slow-path site too.
      if (monthlyTotal + estimatedCost > monthlyCap) {
        throw new GlobalBudgetExceededError(
          `Monthly budget exceeded: $${monthlyTotal.toFixed(2)} of $${monthlyCap.toFixed(2)} cap`,
          { category, monthlyTotal, monthlyCap },
        );
      }
    } catch (err) {
      if (err instanceof GlobalBudgetExceededError) throw err;
      if (isMissingTableError(err)) {
        logger.warn('Cost tables not found — monthly cap check skipped (migration not applied)');
        return;
      }
      this.logFailClosedRejected('checkMonthlyCap', '', err);
      throw new GlobalBudgetExceededError(
        'Unable to verify monthly budget (DB error) — blocking call for safety',
        { category, cause: 'gate_check_failed' },
      );
    }
  }
}

let singletonGate: LLMSpendingGate | null = null;

export function getSpendingGate(): LLMSpendingGate {
  if (!singletonGate) {
    singletonGate = new LLMSpendingGate();
  }
  return singletonGate;
}

export function resetSpendingGate(): void {
  singletonGate = null;
}
