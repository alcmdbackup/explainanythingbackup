/**
 * Unit tests for cost analytics server actions.
 * Tests admin cost reporting operations.
 */

import {
  getCostSummaryAction,
  getDailyCostsAction,
  getCostByModelAction,
  getCostByUserAction,
  backfillCostsAction
} from './costAnalytics';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { logger } from '@/lib/server_utilities';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn()
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn()
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn
}));

describe('CostAnalytics Service', () => {
  let mockSupabase: {
    from: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    eq: jest.Mock;
    gte: jest.Mock;
    lte: jest.Mock;
    is: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
  };

  const mockAdminId = 'admin-123';

  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn()
    };

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireAdmin as jest.Mock).mockResolvedValue(mockAdminId);
  });

  describe('getCostSummaryAction', () => {
    it('should return cost summary', async () => {
      const mockData = [
        { estimated_cost_usd: '0.05', total_tokens: 1000 },
        { estimated_cost_usd: '0.10', total_tokens: 2000 }
      ];

      mockSupabase.lte.mockResolvedValue({
        data: mockData,
        error: null,
        count: 2
      });

      const result = await getCostSummaryAction({});

      expect(result.success).toBe(true);
      expect(result.data?.totalCost).toBeCloseTo(0.15, 2);
      expect(result.data?.totalCalls).toBe(2);
      expect(result.data?.totalTokens).toBe(3000);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should handle empty data', async () => {
      mockSupabase.lte.mockResolvedValue({
        data: [],
        error: null,
        count: 0
      });

      const result = await getCostSummaryAction({});

      expect(result.success).toBe(true);
      expect(result.data?.totalCost).toBe(0);
      expect(result.data?.totalCalls).toBe(0);
    });

    it('should return error when not admin', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getCostSummaryAction({});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getDailyCostsAction', () => {
    it('should return daily costs aggregated', async () => {
      const mockData = [
        { date: '2025-01-15', call_count: 10, total_tokens: 5000, total_cost_usd: '0.50' },
        { date: '2025-01-15', call_count: 5, total_tokens: 2500, total_cost_usd: '0.25' },
        { date: '2025-01-14', call_count: 8, total_tokens: 4000, total_cost_usd: '0.40' }
      ];

      mockSupabase.order.mockResolvedValue({
        data: mockData,
        error: null
      });

      const result = await getDailyCostsAction({});

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2); // Aggregated by date

      const jan15 = result.data?.find(d => d.date === '2025-01-15');
      expect(jan15?.callCount).toBe(15); // 10 + 5
      expect(jan15?.totalCost).toBeCloseTo(0.75, 2); // 0.50 + 0.25
    });

    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getDailyCostsAction({});

      expect(result.success).toBe(false);
    });
  });

  describe('getCostByModelAction', () => {
    it('should aggregate costs by model', async () => {
      const mockData = [
        { model: 'gpt-4o', prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 0, total_tokens: 150, estimated_cost_usd: '0.01' },
        { model: 'gpt-4o', prompt_tokens: 200, completion_tokens: 100, reasoning_tokens: 0, total_tokens: 300, estimated_cost_usd: '0.02' },
        { model: 'gpt-4o-mini', prompt_tokens: 500, completion_tokens: 250, reasoning_tokens: 0, total_tokens: 750, estimated_cost_usd: '0.005' }
      ];

      mockSupabase.lte.mockResolvedValue({
        data: mockData,
        error: null
      });

      const result = await getCostByModelAction({});

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);

      const gpt4o = result.data?.find(m => m.model === 'gpt-4o');
      expect(gpt4o?.callCount).toBe(2);
      expect(gpt4o?.totalCost).toBeCloseTo(0.03, 3);
    });

    it('should sort by total cost descending', async () => {
      const mockData = [
        { model: 'cheap', prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 0, total_tokens: 150, estimated_cost_usd: '0.01' },
        { model: 'expensive', prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 0, total_tokens: 150, estimated_cost_usd: '1.00' }
      ];

      mockSupabase.lte.mockResolvedValue({
        data: mockData,
        error: null
      });

      const result = await getCostByModelAction({});

      expect(result.success).toBe(true);
      expect(result.data?.[0].model).toBe('expensive');
    });
  });

  describe('getCostByUserAction', () => {
    it('should aggregate costs by user', async () => {
      const mockData = [
        { userid: 'user-1', total_tokens: 1000, estimated_cost_usd: '0.10' },
        { userid: 'user-1', total_tokens: 500, estimated_cost_usd: '0.05' },
        { userid: 'user-2', total_tokens: 2000, estimated_cost_usd: '0.20' }
      ];

      mockSupabase.lte.mockResolvedValue({
        data: mockData,
        error: null
      });

      const result = await getCostByUserAction({ limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);

      const user1 = result.data?.find(u => u.userId === 'user-1');
      expect(user1?.callCount).toBe(2);
      expect(user1?.totalCost).toBeCloseTo(0.15, 3);
    });

    it('should respect limit parameter', async () => {
      const mockData = Array.from({ length: 50 }, (_, i) => ({
        userid: `user-${i}`,
        total_tokens: 100,
        estimated_cost_usd: '0.01'
      }));

      mockSupabase.lte.mockResolvedValue({
        data: mockData,
        error: null
      });

      const result = await getCostByUserAction({ limit: 5 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(5);
    });
  });

  describe('backfillCostsAction', () => {
    it('should backfill missing costs', async () => {
      const mockRecords = [
        { id: 1, model: 'gpt-4o', prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 0 },
        { id: 2, model: 'gpt-4o-mini', prompt_tokens: 200, completion_tokens: 100, reasoning_tokens: 0 }
      ];

      mockSupabase.limit.mockResolvedValue({
        data: mockRecords,
        error: null
      });

      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      const result = await backfillCostsAction({ batchSize: 100 });

      expect(result.success).toBe(true);
      expect(result.data?.processed).toBe(2);
      expect(logger.info).toHaveBeenCalledWith(
        'Cost backfill completed',
        expect.objectContaining({ processed: 2 })
      );
    });

    it('should handle empty records', async () => {
      mockSupabase.limit.mockResolvedValue({
        data: [],
        error: null
      });

      const result = await backfillCostsAction({});

      expect(result.success).toBe(true);
      expect(result.data?.processed).toBe(0);
      expect(result.data?.updated).toBe(0);
    });

    it('should support dry run mode', async () => {
      const mockRecords = [
        { id: 1, model: 'gpt-4o', prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 0 }
      ];

      mockSupabase.limit.mockResolvedValue({
        data: mockRecords,
        error: null
      });

      const result = await backfillCostsAction({ dryRun: true });

      expect(result.success).toBe(true);
      expect(result.data?.processed).toBe(1);
      expect(result.data?.updated).toBe(0); // Dry run doesn't update
    });

    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await backfillCostsAction({});

      expect(result.success).toBe(false);
    });
  });
});
