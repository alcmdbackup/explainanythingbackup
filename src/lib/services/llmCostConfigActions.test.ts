/**
 * @jest-environment node
 */
// Unit tests for LLM cost config server actions — caps, kill switch, admin auth.

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('admin-user-id'),
}));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));
const mockGateInstance = {
  invalidateCache: jest.fn(),
  getSpendingSummary: jest.fn().mockResolvedValue({
    daily: [],
    monthlyTotal: 0,
    monthlyCap: 500,
    killSwitchEnabled: false,
  }),
};
jest.mock('@/lib/services/llmSpendingGate', () => ({
  getSpendingGate: jest.fn(() => mockGateInstance),
}));
jest.mock('next/headers', () => ({
  headers: jest.fn().mockReturnValue(new Map()),
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { logAdminAction } from '@/lib/services/auditLog';
import { getSpendingGate } from '@/lib/services/llmSpendingGate';
import {
  getLLMCostConfigAction,
  updateLLMCostConfigAction,
  toggleKillSwitchAction,
  getSpendingSummaryAction,
} from './llmCostConfigActions';

function mockSupabase() {
  const supabase = {
    from: jest.fn().mockImplementation(() => ({
      select: jest.fn().mockResolvedValue({
        data: [
          { key: 'daily_cap_usd', value: { value: 50 } },
          { key: 'monthly_cap_usd', value: { value: 500 } },
          { key: 'evolution_daily_cap_usd', value: { value: 25 } },
          { key: 'kill_switch_enabled', value: { value: false } },
        ],
        error: null,
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    })),
  };
  (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);
  return supabase;
}

describe('llmCostConfigActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase();
  });

  describe('getLLMCostConfigAction', () => {
    it('requires admin auth', async () => {
      await getLLMCostConfigAction();
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('returns config values', async () => {
      const result = await getLLMCostConfigAction();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        dailyCapUsd: 50,
        monthlyCapUsd: 500,
        evolutionDailyCapUsd: 25,
        killSwitchEnabled: false,
      });
    });
  });

  describe('updateLLMCostConfigAction', () => {
    it('requires admin auth', async () => {
      await updateLLMCostConfigAction('daily_cap_usd', 100);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('rejects negative values', async () => {
      const result = await updateLLMCostConfigAction('daily_cap_usd', -10);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('non-negative');
    });

    it('rejects invalid keys', async () => {
      const result = await updateLLMCostConfigAction('invalid_key', 10);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid config key');
    });

    it('creates audit log entry', async () => {
      await updateLLMCostConfigAction('daily_cap_usd', 100);
      expect(logAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update_cost_config',
          entityType: 'llm_cost_config',
          entityId: 'daily_cap_usd',
        }),
      );
    });

    it('invalidates spending gate cache', async () => {
      await updateLLMCostConfigAction('daily_cap_usd', 100);
      expect(mockGateInstance.invalidateCache).toHaveBeenCalled();
    });
  });

  describe('toggleKillSwitchAction', () => {
    it('requires admin auth', async () => {
      await toggleKillSwitchAction(true);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('creates audit log entry', async () => {
      await toggleKillSwitchAction(true);
      expect(logAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'toggle_kill_switch',
          entityType: 'llm_cost_config',
          details: { enabled: true },
        }),
      );
    });

    it('invalidates spending gate cache', async () => {
      await toggleKillSwitchAction(true);
      expect(mockGateInstance.invalidateCache).toHaveBeenCalled();
    });
  });

  describe('getSpendingSummaryAction', () => {
    it('requires admin auth', async () => {
      await getSpendingSummaryAction();
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('returns spending summary', async () => {
      const result = await getSpendingSummaryAction();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('monthlyCap');
    });
  });
});
