// Global LLM spending gate — enforces daily/monthly caps and kill switch before every LLM call.
// Uses in-memory TTL cache for performance with DB-atomic reservation for correctness near cap.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';
import type { CheckBudgetResult } from '@/lib/schemas/llmCostSchemas';

const SPENDING_CACHE_TTL_MS = 30_000;
const KILL_SWITCH_CACHE_TTL_MS = 5_000;
const MONTHLY_CACHE_TTL_MS = 60_000;
const DEFAULT_RESERVATION_USD = 0.05;
const FAST_PATH_HEADROOM = 0.10;

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

  /** Throws on kill switch, over-cap, or DB errors (fail-closed). Returns reserved cost. */
  async checkBudget(callSource: string, estimatedCostUsd?: number): Promise<number> {
    const killSwitchEnabled = await this.getKillSwitch();
    if (killSwitchEnabled) {
      throw new LLMKillSwitchError();
    }

    const category = getCallCategory(callSource);
    const estimatedCost = estimatedCostUsd ?? DEFAULT_RESERVATION_USD;

    // Fast-path: if cached spending is well below cap, skip DB query
    const cached = this.getCachedSpending(category);
    if (cached) {
      const headroom = cached.dailyCap * FAST_PATH_HEADROOM;
      if (cached.dailyTotal + cached.reserved + estimatedCost < cached.dailyCap - headroom) {
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
    const today = new Date().toISOString().split('T')[0];

    const [rollupsResult, configResult] = await Promise.all([
      supabase.from('daily_cost_rollups').select('*').eq('date', today),
      supabase.from('llm_cost_config').select('*'),
    ]);

    const rollups = rollupsResult.data ?? [];
    const config = configResult.data ?? [];

    const getConfigValue = (key: string): unknown => {
      const row = config.find((c: { key: string; value: { value: unknown } }) => c.key === key);
      return row?.value?.value ?? 0;
    };

    const daily = rollups.map((r: { category: string; total_cost_usd: number; reserved_usd: number; call_count: number }) => ({
      category: r.category,
      totalCostUsd: Number(r.total_cost_usd),
      reservedUsd: Number(r.reserved_usd),
      callCount: r.call_count,
      cap: r.category === 'evolution' ? getConfigValue('evolution_daily_cap_usd') as number : getConfigValue('daily_cap_usd') as number,
    }));

    const { data: monthlyData } = await supabase
      .from('daily_cost_rollups')
      .select('total_cost_usd')
      .gte('date', getMonthStartDate());

    const monthlyTotal = (monthlyData ?? []).reduce((sum: number, r: { total_cost_usd: number }) => sum + Number(r.total_cost_usd), 0);

    return {
      daily,
      monthlyTotal,
      monthlyCap: getConfigValue('monthly_cap_usd') as number,
      killSwitchEnabled: getConfigValue('kill_switch_enabled') as boolean,
    };
  }

  invalidateCache(): void {
    this.killSwitchCache = null;
    this.spendingCache.clear();
    this.monthlyCache = null;
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

      const enabled = data?.value?.value === true;
      this.killSwitchCache = { value: enabled, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS };
      return enabled;
    } catch (err) {
      // If the table doesn't exist yet (migration not applied), allow calls through
      if (isMissingTableError(err)) {
        logger.warn('llm_cost_config table not found — spending gate disabled (migration not applied)');
        this.killSwitchCache = { value: false, expiresAt: Date.now() + KILL_SWITCH_CACHE_TTL_MS };
        return false;
      }
      logger.error('Kill switch check failed — failing closed', { error: errorMsg(err) });
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
      logger.error('Budget reservation RPC failed — failing closed', { error: errorMsg(err), category });
      throw new GlobalBudgetExceededError(
        'Unable to verify LLM budget (DB error) — blocking call for safety',
        { category, cause: errorMsg(err) },
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

      const [totalResult, capResult] = await Promise.all([
        supabase.from('daily_cost_rollups').select('total_cost_usd').gte('date', getMonthStartDate()),
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
      if (isMissingTableError(err)) {
        logger.warn('Cost tables not found — monthly cap check skipped (migration not applied)');
        return;
      }
      logger.error('Monthly cap check failed — failing closed', { error: errorMsg(err) });
      throw new GlobalBudgetExceededError(
        'Unable to verify monthly budget (DB error) — blocking call for safety',
        { category, cause: errorMsg(err) },
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
