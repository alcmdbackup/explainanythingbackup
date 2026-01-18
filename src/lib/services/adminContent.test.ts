/**
 * Unit tests for adminContent service.
 * Tests admin content management operations.
 */

import {
  getAdminExplanationsAction,
  hideExplanationAction,
  restoreExplanationAction,
  bulkHideExplanationsAction,
  getAdminExplanationByIdAction
} from './adminContent';
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

// Mock serverReadRequestId to pass through
jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn
}));

// Mock withLogging to pass through
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn
}));

// Mock vectorsim operations
jest.mock('@/lib/services/vectorsim', () => ({
  deleteVectorsByExplanationId: jest.fn().mockResolvedValue(1),
  processContentToStoreEmbedding: jest.fn().mockResolvedValue(undefined)
}));

// Mock auditLog
jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined)
}));

describe('AdminContent Service', () => {
  let mockSupabase: {
    from: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    eq: jest.Mock;
    or: jest.Mock;
    in: jest.Mock;
    order: jest.Mock;
    range: jest.Mock;
    limit: jest.Mock;
  };
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create chainable mock
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      limit: jest.fn()
    };

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireAdmin as jest.Mock).mockResolvedValue('admin-user-123');
  });

  describe('getAdminExplanationsAction', () => {
    it('should return explanations with pagination info', async () => {
      const mockExplanations = [
        { id: 1, explanation_title: 'Test 1', delete_status: 'visible' },
        { id: 2, explanation_title: 'Test 2', delete_status: 'hidden' }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockExplanations,
        error: null,
        count: 100
      });

      const result = await getAdminExplanationsAction({});

      expect(result.success).toBe(true);
      expect(result.data?.explanations).toEqual(mockExplanations);
      expect(result.data?.total).toBe(100);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should apply search filter', async () => {
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0
      });

      await getAdminExplanationsAction({ search: 'test query' });

      expect(mockSupabase.or).toHaveBeenCalledWith(
        expect.stringContaining('test query')
      );
    });

    it('should return error when not admin', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getAdminExplanationsAction({});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('hideExplanationAction', () => {
    it('should hide explanation successfully', async () => {
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      const result = await hideExplanationAction(123);

      expect(result.success).toBe(true);
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          delete_status: 'hidden',
          delete_source: 'manual'
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Explanation hidden',
        expect.objectContaining({ explanationId: 123 })
      );
    });

    it('should return error when database update fails', async () => {
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      });

      const result = await hideExplanationAction(123);

      expect(result.success).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('restoreExplanationAction', () => {
    it('should restore explanation successfully', async () => {
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      const result = await restoreExplanationAction(123);

      expect(result.success).toBe(true);
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          delete_status: 'visible',
          delete_status_changed_at: null,
          delete_reason: null
        })
      );
    });
  });

  describe('bulkHideExplanationsAction', () => {
    it('should hide multiple explanations', async () => {
      mockSupabase.in.mockResolvedValue({
        data: null,
        error: null,
        count: 3
      });

      const result = await bulkHideExplanationsAction([1, 2, 3]);

      expect(result.success).toBe(true);
      expect(result.data?.hiddenCount).toBe(3);
      expect(mockSupabase.in).toHaveBeenCalledWith('id', [1, 2, 3]);
    });

    it('should reject empty array', async () => {
      const result = await bulkHideExplanationsAction([]);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');
    });

    it('should reject more than 100 items', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => i + 1);
      const result = await bulkHideExplanationsAction(ids);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('100');
    });
  });

  describe('getAdminExplanationByIdAction', () => {
    it('should return explanation by ID', async () => {
      const mockExplanation = { id: 123, explanation_title: 'Test' };
      mockSupabase.limit.mockResolvedValue({
        data: [mockExplanation],
        error: null
      });

      const result = await getAdminExplanationByIdAction(123);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockExplanation);
    });

    it('should return not found for missing explanation', async () => {
      mockSupabase.limit.mockResolvedValue({
        data: [],
        error: null
      });

      const result = await getAdminExplanationByIdAction(999);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });
});
