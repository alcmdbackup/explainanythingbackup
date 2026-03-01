// Global LLM spending gate — enforces daily/monthly caps and kill switch before every LLM call.
// Uses in-memory TTL cache for performance with DB-atomic reservation for correctness near cap.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';
import type { CheckBudgetResult } from '@/lib/schemas/llmCostSchemas';

// ─── Cache TTLs ──────────────────────────────────────────────────
const SPENDING_CACHE_TTL_MS = 30_000; // 30s for spending totals
const KILL_SWITCH_CACHE_TTL_MS = 5_000; // 5s for kill switch
const MONTHLY_CACHE_TTL_MS = 60_000; // 60s for monthly totals

// ─── Default reservation when cost estimate unavailable ──────────
const DEFAULT_RESERVATION_USD = 0.05;

// ─── Headroom threshold for fast-path cache hit ──────────────────
const FAST_PATH_HEADROOM = 0.10; // 10% headroom

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface SpendingCacheData {
  dailyTotal: number;
  dailyCap: number;
  reserved: number;
}

/** Derive cost category from call_source. */
export function getCallCategory(callSource: string): 'evolution' | 'non_evolution' {
  return callSource.startsWith('evolution_') ? 'evolution' : 'non_evolution';
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

  /** Check budget before an LLM call. Throws on kill switch, over-cap, or DB errors (fail-closed). */
  async checkBudget(callSource: string, estimatedCostUsd?: number): Promise<number> {
    // 1. Kill switch check (cached, 5s TTL)
    const killSwitchEnabled = await this.getKillSwitch();
    if (killSwitchEnabled) {
      throw new LLMKillSwitchError();
    }

    const category = getCallCategory(callSource);
    const estimatedCost = estimatedCostUsd ?? DEFAULT_RESERVATION_USD;

    // 2. Fast-path: if cached daily total is well below cap, allow without DB query
    const cached = this.getCachedSpending(category);
    if (cached) {
      const headroom = cached.dailyCap * FAST_PATH_HEADROOM;
      if (cached.dailyTotal + cached.reserved + estimatedCost < cached.dailyCap - headroom) {
        // Well under cap — skip DB query
        return estimatedCost;
      }
    }

    // 3. Near-cap or cache miss: DB-atomic reservation
    const result = await this.reserveViaRpc(category, estimatedCost);
    if (!result.allowed) {
      throw new GlobalBudgetExceededError(
        `Daily ${category} budget exceeded: $${result.daily_total.toFixed(2)} spent + $${result.reserved.toFixed(2)} reserved of $${result.daily_cap.toFixed(2)} cap`,
        { category, dailyTotal: result.daily_total, dailyCap: result.daily_cap, reserved: result.reserved },
      );
    }

    // Update cache with latest DB values
    this.spendingCache.set(category, {
      value: { dailyTotal: result.daily_total, dailyCap: result.daily_cap, reserved: result.reserved },
      expiresAt: Date.now() + SPENDING_CACHE_TTL_MS,
    });

    // 4. Monthly cap check (cached, 60s TTL)
    await this.checkMonthlyCap(category);

    return estimatedCost;
  }

  /** Release a reservation after LLM call completes. The actual cost is tracked by the DB trigger. */
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
      logger.error('Error reconciling LLM reservation', {
        error: err instanceof Error ? err.message : String(err),
        category,
        reserved: reservedCostUsd,
      });
    }
    // Invalidate spending cache so next check gets fresh data
    this.spendingCache.delete(category);
  }

  /** Get spending summary for admin UI. */
  async getSpendingSummary(): Promise<SpendingSummary> {
    const supabase = await createSupabaseServiceClient();

    const [rollupsResult, configResult] = await Promise.all([
      supabase.from('daily_cost_rollups').select('*').eq('date', new Date().toISOString().split('T')[0]),
      supabase.from('llm_cost_config').select('*'),
    ]);

    const rollups = rollupsResult.data ?? [];
    const config = configResult.data ?? [];

    const getCap = (key: string): number => {
      const row = config.find((c: { key: string; value: { value: number } }) => c.key === key);
      return row?.value?.value ?? 0;
    };

    const daily = rollups.map((r: { category: string; total_cost_usd: number; reserved_usd: number; call_count: number }) => ({
      category: r.category,
      totalCostUsd: Number(r.total_cost_usd),
      reservedUsd: Number(r.reserved_usd),
      callCount: r.call_count,
      cap: r.category === 'evolution' ? getCap('evolution_daily_cap_usd') : getCap('daily_cap_usd'),
    }));

    // Monthly total
    const { data: monthlyData } = await supabase
      .from('daily_cost_rollups')
      .select('total_cost_usd')
      .gte('date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);

    const monthlyTotal = (monthlyData ?? []).reduce((sum: number, r: { total_cost_usd: number }) => sum + Number(r.total_cost_usd), 0);
    const killSwitchEnabled = getCap('kill_switch_enabled') as unknown as boolean;

    return { daily, monthlyTotal, monthlyCap: getCap('monthly_cap_usd'), killSwitchEnabled };
  }

  /** Force cache invalidation — used when kill switch is toggled for immediate effect. */
  invalidateCache(): void {
    this.killSwitchCache = null;
    this.spendingCache.clear();
    this.monthlyCache = null;
  }

  /** Reset singleton state for testing. */
  resetForTesting(): void {
    this.invalidateCache();
  }

  /** Clean up orphaned reservations — called by cron route. */
  async cleanupOrphanedReservations(): Promise<void> {
    const supabase = await createSupabaseServiceClient();
    const { error } = await supabase.rpc('reset_orphaned_reservations');
    if (error) {
      logger.error('Failed to cleanup orphaned reservations', { error: error.message });
      throw error;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────

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

      const enabled = data?.value?.value === true;
      this.killSwitchCache = { value: enabled, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS };
      return enabled;
    } catch (err) {
      // Fail closed: if we can't check, assume blocked
      logger.error('Kill switch check failed — failing closed', {
        error: err instanceof Error ? err.message : String(err),
      });
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
      // Fail closed
      logger.error('Budget reservation RPC failed — failing closed', {
        error: err instanceof Error ? err.message : String(err),
        category,
      });
      throw new GlobalBudgetExceededError(
        'Unable to verify LLM budget (DB error) — blocking call for safety',
        { category, cause: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  private async checkMonthlyCap(category: string): Promise<void> {
    if (this.monthlyCache && Date.now() < this.monthlyCache.expiresAt) {
      if (this.monthlyCache.value.total >= this.monthlyCache.value.cap) {
        throw new GlobalBudgetExceededError(
          `Monthly budget exceeded: $${this.monthlyCache.value.total.toFixed(2)} of $${this.monthlyCache.value.cap.toFixed(2)} cap`,
          { category, monthlyTotal: this.monthlyCache.value.total, monthlyCap: this.monthlyCache.value.cap },
        );
      }
      return;
    }

    try {
      const supabase = await createSupabaseServiceClient();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

      const [totalResult, capResult] = await Promise.all([
        supabase.from('daily_cost_rollups').select('total_cost_usd').gte('date', monthStart),
        supabase.from('llm_cost_config').select('value').eq('key', 'monthly_cap_usd').single(),
      ]);

      if (totalResult.error) throw totalResult.error;
      if (capResult.error) throw capResult.error;

      const monthlyTotal = (totalResult.data ?? []).reduce((sum: number, r: { total_cost_usd: number }) => sum + Number(r.total_cost_usd), 0);
      const monthlyCap = (capResult.data?.value?.value as number) ?? 500;

      this.monthlyCache = { value: { total: monthlyTotal, cap: monthlyCap }, expiresAt: Date.now() + MONTHLY_CACHE_TTL_MS };

      if (monthlyTotal >= monthlyCap) {
        throw new GlobalBudgetExceededError(
          `Monthly budget exceeded: $${monthlyTotal.toFixed(2)} of $${monthlyCap.toFixed(2)} cap`,
          { category, monthlyTotal, monthlyCap },
        );
      }
    } catch (err) {
      if (err instanceof GlobalBudgetExceededError) throw err;
      // Fail closed
      logger.error('Monthly cap check failed — failing closed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new GlobalBudgetExceededError(
        'Unable to verify monthly budget (DB error) — blocking call for safety',
        { category, cause: err instanceof Error ? err.message : String(err) },
      );
    }
  }
}

// ─── Module-level singleton ──────────────────────────────────────

let singletonGate: LLMSpendingGate | null = null;

/** Get the module-level LLM spending gate singleton. */
export function getSpendingGate(): LLMSpendingGate {
  if (!singletonGate) {
    singletonGate = new LLMSpendingGate();
  }
  return singletonGate;
}

/** Reset the singleton (for testing). */
export function resetSpendingGate(): void {
  singletonGate = null;
}
