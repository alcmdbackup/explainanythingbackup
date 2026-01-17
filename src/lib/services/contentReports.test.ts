/**
 * Unit tests for contentReports service.
 * Tests content report creation and admin review operations.
 */

import {
  createContentReportAction,
  getContentReportsAction,
  resolveContentReportAction,
  getReportCountsAction
} from './contentReports';
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

// Mock serverReadRequestId to pass through
jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn
}));

// Mock withLogging to pass through
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn
}));

describe('ContentReports Service', () => {
  let mockServerSupabase: {
    auth: { getUser: jest.Mock };
    from: jest.Mock;
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    eq: jest.Mock;
    limit: jest.Mock;
    single: jest.Mock;
  };

  let mockServiceSupabase: {
    from: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    eq: jest.Mock;
    order: jest.Mock;
    range: jest.Mock;
    single: jest.Mock;
  };

  const mockLogger = logger as jest.Mocked<typeof logger>;
  const mockUserId = 'user-123';
  const mockAdminId = 'admin-456';

  beforeEach(() => {
    jest.clearAllMocks();

    // Server client mock (for user actions)
    mockServerSupabase = {
      auth: { getUser: jest.fn() },
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn()
    };

    // Service client mock (for admin actions)
    mockServiceSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      single: jest.fn()
    };

    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockServerSupabase);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockServiceSupabase);
    (requireAdmin as jest.Mock).mockResolvedValue(mockAdminId);
  });

  describe('createContentReportAction', () => {
    beforeEach(() => {
      mockServerSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: mockUserId } }
      });
    });

    it('should create a report successfully', async () => {
      const mockReport = {
        id: 1,
        explanation_id: 100,
        reporter_id: mockUserId,
        reason: 'spam',
        status: 'pending'
      };

      // Mock no existing report
      mockServerSupabase.limit.mockResolvedValueOnce({
        data: [],
        error: null
      });

      // Mock successful insert
      mockServerSupabase.single.mockResolvedValue({
        data: mockReport,
        error: null
      });

      const result = await createContentReportAction({
        explanation_id: 100,
        reason: 'spam',
        details: 'This is spam content'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockReport);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Content report created',
        expect.objectContaining({ reportId: 1, reason: 'spam' })
      );
    });

    it('should reject if user not logged in', async () => {
      mockServerSupabase.auth.getUser.mockResolvedValue({
        data: { user: null }
      });

      const result = await createContentReportAction({
        explanation_id: 100,
        reason: 'spam'
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('logged in');
    });

    it('should reject if user already reported', async () => {
      mockServerSupabase.limit.mockResolvedValue({
        data: [{ id: 1 }],
        error: null
      });

      const result = await createContentReportAction({
        explanation_id: 100,
        reason: 'spam'
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('already reported');
    });

    it('should reject missing required fields', async () => {
      const result = await createContentReportAction({
        explanation_id: 0,
        reason: '' as any
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');
    });
  });

  describe('getContentReportsAction', () => {
    it('should return reports with pagination', async () => {
      const mockReports = [
        {
          id: 1,
          explanation_id: 100,
          reason: 'spam',
          status: 'pending',
          explanations: { explanation_title: 'Test Title' }
        }
      ];

      mockServiceSupabase.range.mockResolvedValue({
        data: mockReports,
        error: null,
        count: 50
      });

      const result = await getContentReportsAction({ status: 'pending' });

      expect(result.success).toBe(true);
      expect(result.data?.reports).toHaveLength(1);
      expect(result.data?.reports[0].explanation_title).toBe('Test Title');
      expect(result.data?.total).toBe(50);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should return error when not admin', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getContentReportsAction({});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('resolveContentReportAction', () => {
    it('should resolve report with dismissed status', async () => {
      mockServiceSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      const result = await resolveContentReportAction({
        report_id: 1,
        status: 'dismissed'
      });

      expect(result.success).toBe(true);
      expect(mockServiceSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'dismissed',
          reviewed_by: mockAdminId
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Content report resolved',
        expect.objectContaining({ reportId: 1, status: 'dismissed' })
      );
    });

    it('should call update with actioned status when hide_explanation requested', async () => {
      // This test validates that the correct parameters are passed
      // The actual hiding logic uses the same Supabase client
      mockServiceSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });
      mockServiceSupabase.single.mockResolvedValue({
        data: { explanation_id: 100 },
        error: null
      });

      await resolveContentReportAction({
        report_id: 1,
        status: 'actioned',
        hide_explanation: true
      });

      expect(mockServiceSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'actioned',
          reviewed_by: mockAdminId
        })
      );
    });

    it('should return error on database failure', async () => {
      mockServiceSupabase.eq.mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      });

      const result = await resolveContentReportAction({
        report_id: 1,
        status: 'reviewed'
      });

      expect(result.success).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getReportCountsAction', () => {
    it('should require admin access', async () => {
      // Test that requireAdmin is called
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getReportCountsAction();

      expect(result.success).toBe(false);
      expect(requireAdmin).toHaveBeenCalled();
    });

    it('should call database for counts', async () => {
      // Create a simple mock that returns count values
      const mockClient = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ count: 5, error: null })
      };
      (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockClient);

      await getReportCountsAction();

      expect(requireAdmin).toHaveBeenCalled();
      expect(mockClient.from).toHaveBeenCalledWith('content_reports');
    });

    it('should return error when not admin', async () => {
      (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

      const result = await getReportCountsAction();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
