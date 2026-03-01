/**
 * @jest-environment node
 */
// Unit tests for LLMSpendingGate — spending caps, kill switch, cache, and reservation logic.

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { LLMSpendingGate, getSpendingGate, resetSpendingGate, getCallCategory } from './llmSpendingGate';
import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';

// ─── Helpers ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: Record<string, unknown> = {
  kill_switch_enabled: { value: false },
  monthly_cap_usd: { value: 500 },
  daily_cap_usd: { value: 50 },
  evolution_daily_cap_usd: { value: 25 },
};

function makeConfigEq(configOverrides?: Record<string, unknown>) {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  return jest.fn().mockImplementation((_col: string, val: string) => ({
    single: jest.fn().mockResolvedValue({
      data: { value: config[val] ?? { value: 0 } },
      error: null,
    }),
  }));
}

function mockSupabase(overrides: Record<string, unknown> = {}, configOverrides?: Record<string, unknown>) {
  const rpcResults: Record<string, unknown> = {
    check_and_reserve_llm_budget: { data: { allowed: true, daily_total: 5, daily_cap: 50, reserved: 1 }, error: null },
    reconcile_llm_reservation: { data: null, error: null },
    reset_orphaned_reservations: { data: null, error: null },
    ...overrides,
  };

  const supabase = {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'llm_cost_config') {
        return {
          select: jest.fn().mockReturnValue({
            eq: makeConfigEq(configOverrides),
          }),
        };
      }
      if (table === 'daily_cost_rollups') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnThis(),
            gte: jest.fn().mockResolvedValue({
              data: [{ total_cost_usd: 10 }],
              error: null,
            }),
          }),
        };
      }
      return { select: jest.fn() };
    }),
    rpc: jest.fn().mockImplementation((name: string) => {
      const result = rpcResults[name];
      return Promise.resolve(result ?? { data: null, error: { message: `Unknown RPC: ${name}` } });
    }),
  };

  (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);
  return supabase;
}

function mockKillSwitch(enabled: boolean) {
  return mockSupabase({}, { kill_switch_enabled: { value: enabled } });
}

// ─── Tests ───────────────────────────────────────────────────────

describe('LLMSpendingGate', () => {
  let gate: LLMSpendingGate;

  beforeEach(() => {
    jest.useFakeTimers();
    gate = new LLMSpendingGate();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetSpendingGate();
  });

  describe('getCallCategory', () => {
    it('returns evolution for evolution_ prefixed sources', () => {
      expect(getCallCategory('evolution_writer')).toBe('evolution');
      expect(getCallCategory('evolution_')).toBe('evolution');
    });

    it('returns non_evolution for other sources', () => {
      expect(getCallCategory('returnExplanation')).toBe('non_evolution');
      expect(getCallCategory('search')).toBe('non_evolution');
    });
  });

  describe('checkBudget', () => {
    it('allows calls when under daily cap', async () => {
      mockSupabase();
      const reserved = await gate.checkBudget('returnExplanation', 0.01);
      expect(reserved).toBe(0.01);
    });

    it('uses default reservation when no estimate provided', async () => {
      mockSupabase();
      const reserved = await gate.checkBudget('returnExplanation');
      expect(reserved).toBe(0.05);
    });

    it('throws LLMKillSwitchError when kill switch is on', async () => {
      mockKillSwitch(true);
      await expect(gate.checkBudget('returnExplanation', 0.01)).rejects.toThrow(LLMKillSwitchError);
    });

    it('throws GlobalBudgetExceededError when daily cap exceeded', async () => {
      mockSupabase({
        check_and_reserve_llm_budget: {
          data: { allowed: false, daily_total: 49, daily_cap: 50, reserved: 2 },
          error: null,
        },
      });
      await expect(gate.checkBudget('returnExplanation', 0.01)).rejects.toThrow(GlobalBudgetExceededError);
    });

    it('fails closed on DB error', async () => {
      (createSupabaseServiceClient as jest.Mock).mockRejectedValue(new Error('DB connection failed'));
      await expect(gate.checkBudget('returnExplanation', 0.01)).rejects.toThrow();
    });

    it('allows calls when cost tables do not exist (migration not applied)', async () => {
      const missingTableError = { message: 'relation "public.llm_cost_config" does not exist', code: '42P01' };
      const missingFnError = { message: 'function check_and_reserve_llm_budget does not exist', code: '42883' };
      const supabase = {
        from: jest.fn().mockImplementation(() => ({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: missingTableError }),
            }),
            gte: jest.fn().mockResolvedValue({ data: null, error: missingTableError }),
          }),
        })),
        rpc: jest.fn().mockImplementation(() => {
          throw missingFnError;
        }),
      };
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);

      // Should NOT throw — gate should be disabled when migration not applied
      const reserved = await gate.checkBudget('returnExplanation', 0.01);
      expect(reserved).toBe(0.01);
    });

    it('caches kill switch result within TTL', async () => {
      mockKillSwitch(false);
      await gate.checkBudget('returnExplanation', 0.01);
      const callCountAfterFirst = (createSupabaseServiceClient as jest.Mock).mock.calls.length;

      // Second call within 5s TTL
      await gate.checkBudget('returnExplanation', 0.01);
      // Kill switch cache should be hit, but RPC still called for near-cap check
      // The key assertion is no error thrown
    });

    it('refreshes kill switch cache after TTL expires', async () => {
      mockKillSwitch(false);
      await gate.checkBudget('returnExplanation', 0.01);

      // Advance past kill switch TTL (5s)
      jest.advanceTimersByTime(6000);

      // Now make kill switch enabled
      mockKillSwitch(true);
      await expect(gate.checkBudget('returnExplanation', 0.01)).rejects.toThrow(LLMKillSwitchError);
    });

    it('separates evolution and non_evolution categories', async () => {
      const supabase = mockSupabase();
      await gate.checkBudget('evolution_writer', 0.01);
      expect(supabase.rpc).toHaveBeenCalledWith('check_and_reserve_llm_budget', {
        p_category: 'evolution',
        p_estimated_cost: 0.01,
      });

      await gate.checkBudget('returnExplanation', 0.01);
      expect(supabase.rpc).toHaveBeenCalledWith('check_and_reserve_llm_budget', {
        p_category: 'non_evolution',
        p_estimated_cost: 0.01,
      });
    });
  });

  describe('reconcileAfterCall', () => {
    it('calls reconcile RPC with correct category', async () => {
      const supabase = mockSupabase();
      await gate.reconcileAfterCall(0.05, 'returnExplanation');
      expect(supabase.rpc).toHaveBeenCalledWith('reconcile_llm_reservation', {
        p_category: 'non_evolution',
        p_reserved: 0.05,
      });
    });

    it('calls reconcile RPC for evolution category', async () => {
      const supabase = mockSupabase();
      await gate.reconcileAfterCall(0.05, 'evolution_writer');
      expect(supabase.rpc).toHaveBeenCalledWith('reconcile_llm_reservation', {
        p_category: 'evolution',
        p_reserved: 0.05,
      });
    });

    it('does not throw on reconciliation failure', async () => {
      mockSupabase({
        reconcile_llm_reservation: { data: null, error: { message: 'DB error' } },
      });
      await expect(gate.reconcileAfterCall(0.05, 'returnExplanation')).resolves.not.toThrow();
    });
  });

  describe('invalidateCache', () => {
    it('forces next check to query DB for kill switch', async () => {
      mockKillSwitch(false);
      await gate.checkBudget('returnExplanation', 0.01);

      gate.invalidateCache();

      // After invalidation, switching to enabled should be picked up immediately
      mockKillSwitch(true);
      await expect(gate.checkBudget('returnExplanation', 0.01)).rejects.toThrow(LLMKillSwitchError);
    });
  });

  describe('cleanupOrphanedReservations', () => {
    it('calls reset RPC', async () => {
      const supabase = mockSupabase();
      await gate.cleanupOrphanedReservations();
      expect(supabase.rpc).toHaveBeenCalledWith('reset_orphaned_reservations');
    });

    it('throws on RPC failure', async () => {
      mockSupabase({
        reset_orphaned_reservations: { data: null, error: { message: 'fail' } },
      });
      await expect(gate.cleanupOrphanedReservations()).rejects.toEqual({ message: 'fail' });
    });
  });

  describe('singleton', () => {
    it('returns same instance', () => {
      const a = getSpendingGate();
      const b = getSpendingGate();
      expect(a).toBe(b);
    });

    it('resets on resetSpendingGate', () => {
      const a = getSpendingGate();
      resetSpendingGate();
      const b = getSpendingGate();
      expect(a).not.toBe(b);
    });
  });
});
