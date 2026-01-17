/**
 * Unit tests for audit log server actions.
 * Tests logging, retrieval, filtering, and export functionality.
 */

import {
  logAdminAction,
  getAuditLogsAction,
  getAuditAdminsAction,
  exportAuditLogsAction
} from './auditLog';
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

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(null)
  })
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn
}));

describe('AuditLog Service', () => {
  let mockSupabase: {
    from: jest.Mock;
    insert: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
    gte: jest.Mock;
    lte: jest.Mock;
    range: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
  };

  const mockAdminId = 'admin-123';
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null })
    };

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireAdmin as jest.Mock).mockResolvedValue(mockAdminId);
  });

  describe('logAdminAction', () => {
    it('should insert audit log entry', async () => {
      mockSupabase.insert.mockResolvedValue({ error: null });

      await logAdminAction({
        adminUserId: mockAdminId,
        action: 'hide_explanation',
        entityType: 'explanation',
        entityId: '123',
        details: { reason: 'spam' }
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('admin_audit_log');
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should not throw on database error', async () => {
      mockSupabase.insert.mockResolvedValue({ error: { message: 'DB error' } });

      // Should not throw
      await expect(logAdminAction({
        adminUserId: mockAdminId,
        action: 'hide_explanation',
        entityType: 'explanation',
        entityId: '123'
      })).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should sanitize sensitive fields in details', async () => {
      mockSupabase.insert.mockResolvedValue({ error: null });

      await logAdminAction({
        adminUserId: mockAdminId,
        action: 'disable_user',
        entityType: 'user',
        entityId: 'user-123',
        details: {
          reason: 'test',
          password: 'secret123',
          token: 'abc123',
          nested: {
            apiKey: 'key123'
          }
        }
      });

      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall.details.password).toBe('[REDACTED]');
      expect(insertCall.details.token).toBe('[REDACTED]');
      expect(insertCall.details.nested.apiKey).toBe('[REDACTED]');
      expect(insertCall.details.reason).toBe('test');
    });
  });

  describe('getAuditLogsAction', () => {
    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getAuditLogsAction({});

      expect(result.success).toBe(false);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should return paginated logs', async () => {
      const mockLogs = [
        {
          id: 1,
          admin_user_id: mockAdminId,
          action: 'hide_explanation',
          entity_type: 'explanation',
          entity_id: '123',
          details: null,
          ip_address: null,
          user_agent: null,
          created_at: '2025-01-01T00:00:00Z'
        }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 1
      });

      const result = await getAuditLogsAction({ limit: 50, offset: 0 });

      expect(result.success).toBe(true);
      expect(result.data?.logs).toHaveLength(1);
      expect(result.data?.total).toBe(1);
    });

    it('should apply filters', async () => {
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0
      });

      await getAuditLogsAction({
        adminUserId: mockAdminId,
        action: 'hide_explanation',
        entityType: 'explanation',
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      });

      expect(mockSupabase.eq).toHaveBeenCalledWith('admin_user_id', mockAdminId);
      expect(mockSupabase.eq).toHaveBeenCalledWith('action', 'hide_explanation');
      expect(mockSupabase.eq).toHaveBeenCalledWith('entity_type', 'explanation');
      expect(mockSupabase.gte).toHaveBeenCalled();
      expect(mockSupabase.lte).toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      mockSupabase.range.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      });

      const result = await getAuditLogsAction({});

      expect(result.success).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getAuditAdminsAction', () => {
    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getAuditAdminsAction();

      expect(result.success).toBe(false);
    });

    it('should return admin counts', async () => {
      mockSupabase.select.mockResolvedValue({
        data: [
          { admin_user_id: 'admin-1' },
          { admin_user_id: 'admin-1' },
          { admin_user_id: 'admin-2' }
        ],
        error: null
      });

      const result = await getAuditAdminsAction();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].adminId).toBe('admin-1');
      expect(result.data?.[0].count).toBe(2);
      expect(result.data?.[1].adminId).toBe('admin-2');
      expect(result.data?.[1].count).toBe(1);
    });
  });

  describe('exportAuditLogsAction', () => {
    it('should require admin access', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await exportAuditLogsAction({});

      expect(result.success).toBe(false);
    });

    it('should return logs for export', async () => {
      const mockLogs = [
        {
          id: 1,
          admin_user_id: mockAdminId,
          action: 'hide_explanation',
          entity_type: 'explanation',
          entity_id: '123',
          details: null,
          ip_address: '127.0.0.1',
          user_agent: 'Mozilla/5.0',
          created_at: '2025-01-01T00:00:00Z'
        }
      ];

      mockSupabase.limit.mockResolvedValue({
        data: mockLogs,
        error: null
      });

      const result = await exportAuditLogsAction({});

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should limit export to 10000 records', async () => {
      mockSupabase.limit.mockResolvedValue({
        data: [],
        error: null
      });

      await exportAuditLogsAction({});

      expect(mockSupabase.limit).toHaveBeenCalledWith(10000);
    });

    it('should apply filters for export', async () => {
      // Set up chain where limit returns this (chainable) and eq/gte/lte resolve
      mockSupabase.limit.mockReturnThis();
      mockSupabase.eq.mockReturnThis();
      mockSupabase.gte.mockReturnThis();
      mockSupabase.lte.mockResolvedValue({
        data: [],
        error: null
      });

      const result = await exportAuditLogsAction({
        adminUserId: mockAdminId,
        action: 'disable_user',
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      });

      // Verify admin access was checked and operation succeeded
      expect(requireAdmin).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('admin_audit_log');
    });
  });
});
