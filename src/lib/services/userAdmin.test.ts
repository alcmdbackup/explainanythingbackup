/**
 * Unit tests for user admin server actions.
 * Tests user management operations.
 */

import {
  getAdminUsersAction,
  getAdminUserByIdAction,
  disableUserAction,
  enableUserAction,
  updateUserNotesAction,
  isUserDisabledAction
} from './userAdmin';
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

describe('UserAdmin Service', () => {
  let mockSupabase: {
    auth: {
      admin: {
        listUsers: jest.Mock;
        getUserById: jest.Mock;
      };
    };
    from: jest.Mock;
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    eq: jest.Mock;
    in: jest.Mock;
    single: jest.Mock;
  };

  const mockAdminId = 'admin-123';
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabase = {
      auth: {
        admin: {
          listUsers: jest.fn(),
          getUserById: jest.fn()
        }
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      single: jest.fn()
    };

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireAdmin as jest.Mock).mockResolvedValue(mockAdminId);
  });

  describe('getAdminUsersAction', () => {
    it('should return users with profiles and stats', async () => {
      const mockUsers = [
        { id: 'user-1', email: 'test@example.com', created_at: '2025-01-01T00:00:00Z', last_sign_in_at: null }
      ];

      mockSupabase.auth.admin.listUsers.mockResolvedValue({
        data: { users: mockUsers },
        error: null
      });

      mockSupabase.in.mockResolvedValue({
        data: [],
        error: null
      });

      // Mock explanation count
      mockSupabase.eq.mockResolvedValue({
        count: 5,
        error: null
      });

      // Mock LLM stats
      mockSupabase.eq.mockResolvedValue({
        data: [{ estimated_cost_usd: '0.10' }],
        error: null
      });

      const result = await getAdminUsersAction({});

      expect(result.success).toBe(true);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should return error when not admin', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getAdminUsersAction({});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getAdminUserByIdAction', () => {
    it('should return user by id when found', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: '2025-01-01T00:00:00Z',
        last_sign_in_at: null
      };

      mockSupabase.auth.admin.getUserById.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });

      // Mock all chained calls to return expected data
      const mockChain = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null })
      };
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue({
        ...mockSupabase,
        from: jest.fn().mockReturnValue(mockChain)
      });

      const result = await getAdminUserByIdAction('user-1');

      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should return not found for missing user', async () => {
      mockSupabase.auth.admin.getUserById.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not found' }
      });

      const result = await getAdminUserByIdAction('missing-user');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('disableUserAction', () => {
    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await disableUserAction({ userId: 'user-1' });

      expect(result.success).toBe(false);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should call database with correct parameters', async () => {
      const mockChain = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { user_id: 'user-1' }, error: null })
      };
      mockChain.eq.mockResolvedValue({ data: null, error: null });

      (createSupabaseServiceClient as jest.Mock).mockResolvedValue({
        from: jest.fn().mockReturnValue(mockChain)
      });

      await disableUserAction({ userId: 'user-1', reason: 'Test' });

      expect(requireAdmin).toHaveBeenCalled();
    });
  });

  describe('enableUserAction', () => {
    it('should enable disabled user', async () => {
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      const result = await enableUserAction('user-1');

      expect(result.success).toBe(true);
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          is_disabled: false,
          disabled_at: null,
          disabled_by: null,
          disabled_reason: null
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User enabled',
        expect.objectContaining({ userId: 'user-1' })
      );
    });

    it('should return error on database failure', async () => {
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      });

      const result = await enableUserAction('user-1');

      expect(result.success).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('updateUserNotesAction', () => {
    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await updateUserNotesAction({
        userId: 'user-1',
        notes: 'VIP customer'
      });

      expect(result.success).toBe(false);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should call database when updating notes', async () => {
      const mockChain = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { user_id: 'user-1' }, error: null })
      };
      mockChain.eq.mockResolvedValue({ data: null, error: null });

      (createSupabaseServiceClient as jest.Mock).mockResolvedValue({
        from: jest.fn().mockReturnValue(mockChain)
      });

      await updateUserNotesAction({ userId: 'user-1', notes: 'Test notes' });

      expect(requireAdmin).toHaveBeenCalled();
    });
  });

  describe('isUserDisabledAction', () => {
    it('should return disabled status', async () => {
      mockSupabase.single.mockResolvedValue({
        data: { is_disabled: true, disabled_reason: 'Spam' },
        error: null
      });

      const result = await isUserDisabledAction('user-1');

      expect(result.success).toBe(true);
      expect(result.data?.isDisabled).toBe(true);
      expect(result.data?.reason).toBe('Spam');
    });

    it('should return not disabled when no profile exists', async () => {
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' }
      });

      const result = await isUserDisabledAction('user-1');

      expect(result.success).toBe(true);
      expect(result.data?.isDisabled).toBe(false);
    });
  });
});
