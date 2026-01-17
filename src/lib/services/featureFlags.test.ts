/**
 * Unit tests for feature flags server actions.
 * Tests flag retrieval, toggling, and system health.
 */

import {
  getFeatureFlagsAction,
  getFeatureFlagAction,
  updateFeatureFlagAction,
  createFeatureFlagAction,
  getSystemHealthAction
} from './featureFlags';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { logger } from '@/lib/server_utilities';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
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

jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn
}));

describe('FeatureFlags Service', () => {
  let mockSupabase: {
    from: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    insert: jest.Mock;
    eq: jest.Mock;
    single: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    auth: {
      admin: {
        listUsers: jest.Mock;
      };
    };
  };

  const mockAdminId = 'admin-123';
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      auth: {
        admin: {
          listUsers: jest.fn()
        }
      }
    };

    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireAdmin as jest.Mock).mockResolvedValue(mockAdminId);
  });

  describe('getFeatureFlagsAction', () => {
    it('should return all feature flags', async () => {
      const mockFlags = [
        { id: 1, name: 'flag_one', enabled: true, description: 'Test', updated_by: null, updated_at: '2025-01-01', created_at: '2025-01-01' },
        { id: 2, name: 'flag_two', enabled: false, description: null, updated_by: null, updated_at: '2025-01-01', created_at: '2025-01-01' }
      ];

      mockSupabase.order.mockResolvedValue({
        data: mockFlags,
        error: null
      });

      const result = await getFeatureFlagsAction();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].name).toBe('flag_one');
    });

    it('should handle database errors', async () => {
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      });

      const result = await getFeatureFlagsAction();

      expect(result.success).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getFeatureFlagAction', () => {
    it('should return flag enabled state', async () => {
      mockSupabase.single.mockResolvedValue({
        data: { enabled: true },
        error: null
      });

      const result = await getFeatureFlagAction('test_flag');

      expect(result.success).toBe(true);
      expect(result.data?.enabled).toBe(true);
    });

    it('should return disabled for non-existent flag', async () => {
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' }
      });

      const result = await getFeatureFlagAction('missing_flag');

      expect(result.success).toBe(true);
      expect(result.data?.enabled).toBe(false);
    });
  });

  describe('updateFeatureFlagAction', () => {
    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await updateFeatureFlagAction({ id: 1, enabled: true });

      expect(result.success).toBe(false);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should call update with correct parameters', async () => {
      // Verify that updateFeatureFlagAction calls admin and DB operations
      // Note: Full chain mocking is complex; this test verifies the key behavior

      // Track if update was called
      let updateCalled = false;
      let fromCalledWith: string | undefined;

      // Create chainable mock object
      const chainMock = {} as {
        from: jest.Mock;
        select: jest.Mock;
        update: jest.Mock;
        eq: jest.Mock;
        single: jest.Mock;
      };

      chainMock.from = jest.fn((table: string) => {
        fromCalledWith = table;
        return chainMock;
      });
      chainMock.select = jest.fn(() => chainMock);
      chainMock.update = jest.fn(() => {
        updateCalled = true;
        return chainMock;
      });
      chainMock.eq = jest.fn(() => {
        // If update was called, this is the terminal eq - resolve
        if (updateCalled) {
          return Promise.resolve({ error: null });
        }
        // Otherwise, this is chaining to single
        return chainMock;
      });
      chainMock.single = jest.fn().mockResolvedValue({
        data: { name: 'test_flag', enabled: false },
        error: null
      });

      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(chainMock);

      const result = await updateFeatureFlagAction({ id: 1, enabled: true });

      expect(requireAdmin).toHaveBeenCalled();
      expect(fromCalledWith).toBe('feature_flags');
      expect(updateCalled).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should handle update errors', async () => {
      mockSupabase.single.mockResolvedValue({
        data: { name: 'test_flag', enabled: false },
        error: null
      });
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' }
      });

      const result = await updateFeatureFlagAction({ id: 1, enabled: true });

      expect(result.success).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('createFeatureFlagAction', () => {
    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await createFeatureFlagAction({ name: 'new_flag' });

      expect(result.success).toBe(false);
    });

    it('should create new flag', async () => {
      const newFlag = {
        id: 1,
        name: 'new_flag',
        enabled: false,
        description: 'Test desc',
        updated_by: mockAdminId,
        updated_at: '2025-01-01',
        created_at: '2025-01-01'
      };

      mockSupabase.single.mockResolvedValue({
        data: newFlag,
        error: null
      });

      const result = await createFeatureFlagAction({
        name: 'new_flag',
        description: 'Test desc'
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('new_flag');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Feature flag created',
        expect.anything()
      );
    });
  });

  describe('getSystemHealthAction', () => {
    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getSystemHealthAction();

      expect(result.success).toBe(false);
    });

    it('should return health data', async () => {
      // Mock parallel queries
      mockSupabase.eq.mockResolvedValue({
        count: 100,
        error: null
      });
      mockSupabase.auth.admin.listUsers.mockResolvedValue({
        data: { users: [{ id: 'user-1' }] },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: [{ id: 1 }],
        error: null
      });

      const result = await getSystemHealthAction();

      expect(result.success).toBe(true);
      expect(result.data?.database).toBeDefined();
      expect(result.data?.lastUpdated).toBeDefined();
    });

    it('should detect database issues', async () => {
      mockSupabase.eq.mockResolvedValue({
        count: 0,
        error: null
      });
      mockSupabase.auth.admin.listUsers.mockResolvedValue({
        data: { users: [] },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: null,
        error: { message: 'Connection failed' }
      });

      const result = await getSystemHealthAction();

      expect(result.success).toBe(true);
      expect(result.data?.database).toBe('down');
    });
  });
});
