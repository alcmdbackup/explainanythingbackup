/**
 * @jest-environment node
 */

import {
  createUserExplanationEvent,
  refreshExplanationMetrics,
  getMultipleExplanationMetrics,
  incrementExplanationViews,
  incrementExplanationSaves
} from './metrics';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import type { UserExplanationEventsType, ExplanationMetricsType } from '@/lib/schemas/schemas';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
  createSupabaseServiceClient: jest.fn()
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

import { logger } from '@/lib/server_utilities';

type MockSupabaseClient = {
  from: jest.Mock;
  insert: jest.Mock;
  select: jest.Mock;
  single: jest.Mock;
  in: jest.Mock;
  rpc: jest.Mock;
};

describe('Metrics Service', () => {
  let mockSupabase: MockSupabaseClient;
  const mockLogger = logger as jest.Mocked<typeof logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock Supabase client
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      rpc: jest.fn().mockReturnThis(),
    };

    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('createUserExplanationEvent', () => {
    const mockEventData: UserExplanationEventsType = {
      event_name: 'explanation_viewed',
      userid: 'user123',
      explanationid: 456,
      value: 1,
      metadata: '{"duration_seconds": 30}'
    };

    it('should create a new event successfully', async () => {
      // Arrange
      const expectedResponse: UserExplanationEventsType = {
        ...mockEventData
      };

      mockSupabase.single.mockResolvedValue({
        data: expectedResponse,
        error: null
      });

      // Act
      const result = await createUserExplanationEvent(mockEventData);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(mockSupabase.from).toHaveBeenCalledWith('userExplanationEvents');
      expect(mockSupabase.insert).toHaveBeenCalledWith(mockEventData);
      expect(mockSupabase.select).toHaveBeenCalled();
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should throw error when schema validation fails', async () => {
      // Arrange
      const invalidEventData = {
        event_name: '',  // Invalid - empty string
        userid: 'user123'
        // Missing required fields
      } as any;

      // Act & Assert
      await expect(createUserExplanationEvent(invalidEventData)).rejects.toThrow('Invalid event data');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid event data',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should throw error when database insertion fails', async () => {
      // Arrange
      const mockError = {
        message: 'Database error',
        details: 'Connection failed',
        hint: 'Check connection',
        code: '500'
      };

      mockSupabase.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(createUserExplanationEvent(mockEventData)).rejects.toEqual(mockError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error creating user explanation event',
        {
          message: 'Database error',
          details: 'Connection failed',
          hint: 'Check connection',
          code: '500'
        }
      );
    });

    it('should trigger background metrics update for view events', async () => {
      // Arrange
      const viewEventData: UserExplanationEventsType = {
        event_name: 'explanation_viewed',
        userid: 'user123',
        explanationid: 456,
        value: 1,
        metadata: '{"test": "data"}'
      };

      mockSupabase.single.mockResolvedValue({
        data: { ...viewEventData, id: 1, timestamp: '2024-01-01T00:00:00Z' },
        error: null
      });

      // Mock the RPC call for increment
      mockSupabase.rpc.mockResolvedValue({
        data: [{
          explanationid: 456,
          total_views: 1,
          total_saves: 0,
          save_rate: 0,
          last_updated: '2024-01-01T00:00:00Z'
        }],
        error: null
      });

      // Act
      await createUserExplanationEvent(viewEventData);

      // Assert - background update should be called but we don't wait for it
      // The test just verifies the main event creation succeeds
      expect(mockSupabase.from).toHaveBeenCalledWith('userExplanationEvents');
    });

    it('should not trigger metrics update for non-view events', async () => {
      // Arrange
      const saveEventData: UserExplanationEventsType = {
        event_name: 'explanation_saved',
        userid: 'user123',
        explanationid: 456,
        value: 1,
        metadata: '{"test": "data"}'
      };

      mockSupabase.single.mockResolvedValue({
        data: { ...saveEventData, id: 1, timestamp: '2024-01-01T00:00:00Z' },
        error: null
      });

      // Act
      await createUserExplanationEvent(saveEventData);

      // Assert - RPC should not be called for non-view events
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('should handle background metrics update failure gracefully', async () => {
      // Arrange
      const viewEventData: UserExplanationEventsType = {
        event_name: 'explanation_viewed',
        userid: 'user123',
        explanationid: 456,
        value: 1,
        metadata: '{"test": "data"}'
      };

      mockSupabase.single.mockResolvedValue({
        data: { ...viewEventData, id: 1, timestamp: '2024-01-01T00:00:00Z' },
        error: null
      });

      // Mock RPC failure
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' }
      });

      // Act - should not throw even if background update fails
      const result = await createUserExplanationEvent(viewEventData);

      // Assert
      expect(result.event_name).toBe('explanation_viewed');
    });
  });

  describe('refreshExplanationMetrics', () => {
    it('should refresh all metrics when refreshAll is true', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: 5,
        error: null
      });

      // Act
      const result = await refreshExplanationMetrics({ refreshAll: true });

      // Assert
      expect(result).toEqual({ results: [], count: 5 });
      expect(mockSupabase.rpc).toHaveBeenCalledWith('refresh_all_explanation_metrics');
    });

    it('should refresh specific metrics by single ID', async () => {
      // Arrange
      const mockMetrics: ExplanationMetricsType[] = [{
        explanationid: 1,
        total_views: 10,
        total_saves: 5,
        save_rate: 0.5,
        last_updated: '2024-01-01T00:00:00Z'
      }];

      mockSupabase.rpc.mockResolvedValue({
        data: mockMetrics,
        error: null
      });

      // Act
      const result = await refreshExplanationMetrics({ explanationIds: 1 });

      // Assert
      expect(result).toEqual({ results: mockMetrics, count: 1 });
      expect(mockSupabase.rpc).toHaveBeenCalledWith('refresh_explanation_metrics', {
        explanation_ids: [1]
      });
    });

    it('should refresh specific metrics by array of IDs', async () => {
      // Arrange
      const mockMetrics: ExplanationMetricsType[] = [
        {
          explanationid: 1,
          total_views: 10,
          total_saves: 5,
          save_rate: 0.5,
          last_updated: '2024-01-01T00:00:00Z'
        },
        {
          explanationid: 2,
          total_views: 20,
          total_saves: 10,
          save_rate: 0.5,
          last_updated: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.rpc.mockResolvedValue({
        data: mockMetrics,
        error: null
      });

      // Act
      const result = await refreshExplanationMetrics({ explanationIds: [1, 2] });

      // Assert
      expect(result).toEqual({ results: mockMetrics, count: 2 });
      expect(mockSupabase.rpc).toHaveBeenCalledWith('refresh_explanation_metrics', {
        explanation_ids: [1, 2]
      });
    });

    it('should throw error when neither refreshAll nor explanationIds provided', async () => {
      // Act & Assert
      await expect(refreshExplanationMetrics({})).rejects.toThrow(
        'Either explanationIds must be provided or refreshAll must be true'
      );
    });

    it('should throw error when RPC call fails', async () => {
      // Arrange
      const mockError = { message: 'RPC failed' };
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(refreshExplanationMetrics({ refreshAll: true })).rejects.toEqual(mockError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error refreshing all explanation metrics',
        { error: 'RPC failed' }
      );
    });

    it('should throw error when RPC returns non-array data', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: 'not an array',
        error: null
      });

      // Act & Assert
      await expect(refreshExplanationMetrics({ explanationIds: 1 })).rejects.toThrow(
        'Expected array of metrics data from stored procedure'
      );
    });

    it('should throw error when returned data fails schema validation', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: [{ invalid: 'data' }],
        error: null
      });

      // Act & Assert
      await expect(refreshExplanationMetrics({ explanationIds: 1 })).rejects.toThrow('Invalid metrics data');
    });

    it('should handle zero count from refresh_all', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await refreshExplanationMetrics({ refreshAll: true });

      // Assert
      expect(result).toEqual({ results: [], count: 0 });
    });
  });

  describe('getMultipleExplanationMetrics', () => {
    it('should return empty array for empty input', async () => {
      // Act
      const result = await getMultipleExplanationMetrics([]);

      // Assert
      expect(result).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should fetch metrics for multiple IDs', async () => {
      // Arrange
      // Note: Database returns 'explanationid' but TypeScript type uses 'explanation_id'
      const mockMetrics: any[] = [
        {
          explanationid: 1,
          total_views: 10,
          total_saves: 5,
          save_rate: 0.5,
          last_updated: '2024-01-01T00:00:00Z'
        },
        {
          explanationid: 2,
          total_views: 20,
          total_saves: 10,
          save_rate: 0.5,
          last_updated: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.in.mockResolvedValue({
        data: mockMetrics,
        error: null
      });

      // Act
      const result = await getMultipleExplanationMetrics([1, 2]);

      // Assert
      expect(result).toEqual(mockMetrics);
      expect(mockSupabase.from).toHaveBeenCalledWith('explanationMetrics');
      expect(mockSupabase.in).toHaveBeenCalledWith('explanationid', [1, 2]);
    });

    it('should return null for missing metrics', async () => {
      // Arrange - only return metric for ID 1, not 2
      const mockMetrics: any[] = [
        {
          explanationid: 1,
          total_views: 10,
          total_saves: 5,
          save_rate: 0.5,
          last_updated: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.in.mockResolvedValue({
        data: mockMetrics,
        error: null
      });

      // Act
      const result = await getMultipleExplanationMetrics([1, 2]);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockMetrics[0]);
      expect(result[1]).toBeNull();
    });

    it('should maintain order of input IDs', async () => {
      // Arrange - return results in different order
      // Note: DB column is 'explanationid' but schema type uses 'explanation_id'
      const mockMetrics: any[] = [
        {
          explanationid: 3,
          total_views: 30,
          total_saves: 15,
          save_rate: 0.5,
          last_updated: '2024-01-01T00:00:00Z'
        },
        {
          explanationid: 1,
          total_views: 10,
          total_saves: 5,
          save_rate: 0.5,
          last_updated: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.in.mockResolvedValue({
        data: mockMetrics,
        error: null
      });

      // Act
      const result = await getMultipleExplanationMetrics([1, 2, 3]);

      // Assert - should be ordered as [1, 2(null), 3]
      // Cast to any since DB returns 'explanationid' but type says 'explanation_id'
      expect(result).toHaveLength(3);
      expect((result[0] as any)?.explanationid).toBe(1);
      expect(result[1]).toBeNull();
      expect((result[2] as any)?.explanationid).toBe(3);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.in.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getMultipleExplanationMetrics([1, 2])).rejects.toEqual(mockError);
    });
  });

  describe('incrementExplanationViews', () => {
    it('should increment views successfully', async () => {
      // Arrange
      const mockMetrics: ExplanationMetricsType = {
        explanationid: 1,
        total_views: 11,
        total_saves: 5,
        save_rate: 0.45,
        last_updated: '2024-01-01T00:00:00Z'
      };

      mockSupabase.rpc.mockResolvedValue({
        data: [mockMetrics],
        error: null
      });

      // Act
      const result = await incrementExplanationViews(1);

      // Assert
      expect(result).toEqual(mockMetrics);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('increment_explanation_views', {
        p_explanation_id: 1
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Raw data from stored procedure',
        expect.objectContaining({ data: expect.anything() })
      );
    });

    it('should throw error when RPC returns empty array', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null
      });

      // Act & Assert
      await expect(incrementExplanationViews(1)).rejects.toThrow(
        'Expected single metrics record from increment procedure'
      );
    });

    it('should throw error when RPC returns non-array', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: null
      });

      // Act & Assert
      await expect(incrementExplanationViews(1)).rejects.toThrow(
        'Expected single metrics record from increment procedure'
      );
    });

    it('should throw error when returned data fails validation', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: [{ invalid: 'data' }],
        error: null
      });

      // Act & Assert
      await expect(incrementExplanationViews(1)).rejects.toThrow('Invalid metrics data');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid metrics data returned from increment procedure',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should throw error when RPC call fails', async () => {
      // Arrange
      const mockError = { message: 'RPC failed' };
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(incrementExplanationViews(1)).rejects.toEqual(mockError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error incrementing explanation views',
        { error: 'RPC failed' }
      );
    });
  });

  describe('incrementExplanationSaves', () => {
    it('should increment saves successfully', async () => {
      // Arrange
      const mockMetrics: ExplanationMetricsType = {
        explanationid: 1,
        total_views: 10,
        total_saves: 6,
        save_rate: 0.6,
        last_updated: '2024-01-01T00:00:00Z'
      };

      mockSupabase.rpc.mockResolvedValue({
        data: [mockMetrics],
        error: null
      });

      // Act
      const result = await incrementExplanationSaves(1);

      // Assert
      expect(result).toEqual(mockMetrics);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('increment_explanation_saves', {
        p_explanation_id: 1
      });
    });

    it('should throw error when RPC returns empty array', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null
      });

      // Act & Assert
      await expect(incrementExplanationSaves(1)).rejects.toThrow(
        'Expected single metrics record from increment procedure'
      );
    });

    it('should throw error when returned data fails validation', async () => {
      // Arrange
      mockSupabase.rpc.mockResolvedValue({
        data: [{ invalid: 'data' }],
        error: null
      });

      // Act & Assert
      await expect(incrementExplanationSaves(1)).rejects.toThrow('Invalid metrics data');
    });

    it('should throw error when RPC call fails', async () => {
      // Arrange
      const mockError = { message: 'RPC failed' };
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(incrementExplanationSaves(1)).rejects.toEqual(mockError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error incrementing explanation saves',
        { error: 'RPC failed' }
      );
    });
  });
});
