/**
 * Unit tests for adminAuth service.
 * Tests admin authentication and authorization logic.
 */

import { isUserAdmin, requireAdmin, getAdminUser } from './adminAuth';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

describe('AdminAuth Service', () => {
  let mockSupabase: {
    auth: { getUser: jest.Mock };
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
    limit: jest.Mock;
  };
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock Supabase client with chainable methods
    mockSupabase = {
      auth: {
        getUser: jest.fn()
      },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn()
    };

    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('isUserAdmin', () => {
    it('should return true when user is authenticated and has admin record', async () => {
      // Arrange
      const mockUser = { id: 'user-123', email: 'admin@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: [{ id: 1 }],
        error: null
      });

      // Act
      const result = await isUserAdmin();

      // Assert
      expect(result).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('admin_users');
      expect(mockSupabase.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('should return false when user is not authenticated', async () => {
      // Arrange
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      });

      // Act
      const result = await isUserAdmin();

      // Assert
      expect(result).toBe(false);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return false when user has no admin record', async () => {
      // Arrange
      const mockUser = { id: 'user-123', email: 'regular@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      const result = await isUserAdmin();

      // Assert
      expect(result).toBe(false);
    });

    it('should return false and log error when database query fails', async () => {
      // Arrange
      const mockUser = { id: 'user-123', email: 'admin@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      });

      // Act
      const result = await isUserAdmin();

      // Assert
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error checking admin status',
        expect.objectContaining({ userId: 'user-123' })
      );
    });

    it('should return false when exception is thrown', async () => {
      // Arrange
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Network error'));

      // Act
      const result = await isUserAdmin();

      // Assert
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Exception in isUserAdmin',
        expect.any(Object)
      );
    });
  });

  describe('requireAdmin', () => {
    it('should return user ID when user is authenticated admin', async () => {
      // Arrange
      const mockUser = { id: 'admin-user-456', email: 'admin@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: [{ id: 1 }],
        error: null
      });

      // Act
      const result = await requireAdmin();

      // Assert
      expect(result).toBe('admin-user-456');
    });

    it('should throw error when user is not authenticated', async () => {
      // Arrange
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      });

      // Act & Assert
      await expect(requireAdmin()).rejects.toThrow('Unauthorized: Not authenticated');
    });

    it('should throw error when user is not an admin', async () => {
      // Arrange
      const mockUser = { id: 'user-123', email: 'regular@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: [],
        error: null
      });

      // Act & Assert
      await expect(requireAdmin()).rejects.toThrow('Unauthorized: Not an admin');
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      const mockUser = { id: 'user-123', email: 'admin@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      });

      // Act & Assert
      await expect(requireAdmin()).rejects.toThrow('Unauthorized: Failed to verify admin status');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getAdminUser', () => {
    it('should return admin user record when user is admin', async () => {
      // Arrange
      const mockUser = { id: 'admin-user-789', email: 'admin@example.com' };
      const mockAdminRecord = {
        id: 1,
        user_id: 'admin-user-789',
        role: 'admin',
        created_at: '2024-01-01T00:00:00Z',
        created_by: null
      };
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: [mockAdminRecord],
        error: null
      });

      // Act
      const result = await getAdminUser();

      // Assert
      expect(result).toEqual(mockAdminRecord);
    });

    it('should return null when user is not authenticated', async () => {
      // Arrange
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      });

      // Act
      const result = await getAdminUser();

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when user is not an admin', async () => {
      // Arrange
      const mockUser = { id: 'user-123', email: 'regular@example.com' };
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      });
      mockSupabase.limit.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      const result = await getAdminUser();

      // Assert
      expect(result).toBeNull();
    });

    it('should return null and log error when exception occurs', async () => {
      // Arrange
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Network error'));

      // Act
      const result = await getAdminUser();

      // Assert
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Exception in getAdminUser',
        expect.any(Object)
      );
    });
  });
});
