'use server';
// Server actions for managing LLM cost configuration (caps, kill switch).
// All mutations require admin auth and create audit log entries.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { logAdminAction } from '@/lib/services/auditLog';
import { getSpendingGate } from '@/lib/services/llmSpendingGate';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import type { SpendingSummary } from '@/lib/services/llmSpendingGate';

interface ActionResult<T> {
  success: boolean;
  data: T | null;
  error: ErrorResponse | null;
}

function success<T>(data: T): ActionResult<T> {
  return { success: true, data, error: null };
}

function failure(error: ErrorResponse): ActionResult<never> {
  return { success: false, data: null, error };
}

export interface CostConfigData {
  dailyCapUsd: number;
  monthlyCapUsd: number;
  evolutionDailyCapUsd: number;
  killSwitchEnabled: boolean;
}

const _getLLMCostConfigAction = withLogging(async (): Promise<ActionResult<CostConfigData>> => {
  await requireAdmin();
  const supabase = await createSupabaseServiceClient();

  const { data, error } = await supabase
    .from('llm_cost_config')
    .select('key, value');

  if (error) {
    return failure(handleError(error, 'getLLMCostConfig'));
  }

  const config: Record<string, unknown> = {};
  for (const row of data ?? []) {
    config[row.key] = (row.value as { value: unknown })?.value;
  }

  return success({
    dailyCapUsd: (config.daily_cap_usd as number) ?? 50,
    monthlyCapUsd: (config.monthly_cap_usd as number) ?? 500,
    evolutionDailyCapUsd: (config.evolution_daily_cap_usd as number) ?? 25,
    killSwitchEnabled: (config.kill_switch_enabled as boolean) ?? false,
  });
}, 'getLLMCostConfig');

export const getLLMCostConfigAction = serverReadRequestId(_getLLMCostConfigAction);

const _updateLLMCostConfigAction = withLogging(async (
  key: string,
  value: number,
): Promise<ActionResult<null>> => {
  const admin = await requireAdmin();

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return failure({ code: 'INVALID_INPUT', message: 'Cap value must be a non-negative number' });
  }

  const validKeys = ['daily_cap_usd', 'monthly_cap_usd', 'evolution_daily_cap_usd'];
  if (!validKeys.includes(key)) {
    return failure({ code: 'INVALID_INPUT', message: `Invalid config key: ${key}` });
  }

  const supabase = await createSupabaseServiceClient();
  const { error } = await supabase
    .from('llm_cost_config')
    .update({ value: { value }, updated_at: new Date().toISOString(), updated_by: admin })
    .eq('key', key);

  if (error) {
    return failure(handleError(error, 'updateLLMCostConfig'));
  }

  await logAdminAction({
    adminUserId: admin,
    action: 'update_cost_config',
    entityType: 'llm_cost_config',
    entityId: key,
    details: { key, newValue: value },
  });

  getSpendingGate().invalidateCache();
  return success(null);
}, 'updateLLMCostConfig');

export const updateLLMCostConfigAction = serverReadRequestId(_updateLLMCostConfigAction);

const _toggleKillSwitchAction = withLogging(async (
  enabled: boolean,
): Promise<ActionResult<null>> => {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServiceClient();

  const { error } = await supabase
    .from('llm_cost_config')
    .update({ value: { value: enabled }, updated_at: new Date().toISOString(), updated_by: admin })
    .eq('key', 'kill_switch_enabled');

  if (error) {
    return failure(handleError(error, 'toggleKillSwitch'));
  }

  await logAdminAction({
    adminUserId: admin,
    action: 'toggle_kill_switch',
    entityType: 'llm_cost_config',
    entityId: 'kill_switch_enabled',
    details: { enabled },
  });

  getSpendingGate().invalidateCache();
  return success(null);
}, 'toggleKillSwitch');

export const toggleKillSwitchAction = serverReadRequestId(_toggleKillSwitchAction);

const _getSpendingSummaryAction = withLogging(async (): Promise<ActionResult<SpendingSummary>> => {
  await requireAdmin();
  const summary = await getSpendingGate().getSpendingSummary();
  return success(summary);
}, 'getSpendingSummary');

export const getSpendingSummaryAction = serverReadRequestId(_getSpendingSummaryAction);
