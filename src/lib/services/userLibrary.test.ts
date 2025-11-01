import {
  saveExplanationToLibrary,
  getExplanationIdsForUser,
  getUserLibraryExplanations,
  isExplanationSavedByUser
} from './userLibrary';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { getExplanationsByIds } from '@/lib/services/explanations';
import { incrementExplanationSaves } from '@/lib/services/metrics';
import { userLibraryType } from '@/lib/schemas/schemas';

// Mock dependencies
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));

jest.mock('@/lib/services/explanations', () => ({
  getExplanationsByIds: jest.fn()
}));

jest.mock('@/lib/services/metrics', () => ({
  incrementExplanationSaves: jest.fn()
}));

describe('UserLibrary Service', () => {
  let mockSupabase: any;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Spy on console.error to verify error logging
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Create mock Supabase client with chainable methods
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockReturnThis(),
    };

    // Setup the mock to return our mockSupabase
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('saveExplanationToLibrary', () => {
    it('should save explanation to library successfully', async () => {
      // Arrange
      const explanationId = 123;
      const userId = 'user-456';
      const expectedData: userLibraryType = {
        id: 1,
        explanationid: explanationId,
        userid: userId,
        created: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: expectedData,
        error: null
      });

      (incrementExplanationSaves as jest.Mock).mockResolvedValue(undefined);

      // Act
      const result = await saveExplanationToLibrary(explanationId, userId);

      // Assert
      expect(result).toEqual(expectedData);
      expect(mockSupabase.from).toHaveBeenCalledWith('userLibrary');
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        explanationid: explanationId,
        userid: userId
      });
      expect(mockSupabase.select).toHaveBeenCalledWith('id, explanationid, userid, created');
      expect(mockSupabase.single).toHaveBeenCalled();

      // Verify metrics are updated (async, not awaited)
      // Wait a bit for the async call to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(incrementExplanationSaves).toHaveBeenCalledWith(explanationId);
    });

    it('should throw error when insertion fails', async () => {
      // Arrange
      const explanationId = 123;
      const userId = 'user-456';
      const mockError = { message: 'Duplicate key violation' };

      mockSupabase.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(saveExplanationToLibrary(explanationId, userId)).rejects.toEqual(mockError);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error saving explanation to user library:', mockError);
      expect(incrementExplanationSaves).not.toHaveBeenCalled();
    });

    it('should handle metrics update failure gracefully', async () => {
      // Arrange
      const explanationId = 123;
      const userId = 'user-456';
      const expectedData: userLibraryType = {
        id: 1,
        explanationid: explanationId,
        userid: userId,
        created: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: expectedData,
        error: null
      });

      const metricsError = new Error('Metrics service unavailable');
      (incrementExplanationSaves as jest.Mock).mockRejectedValue(metricsError);

      // Act
      const result = await saveExplanationToLibrary(explanationId, userId);

      // Assert - Should still return successfully even if metrics fail
      expect(result).toEqual(expectedData);

      // Wait for async metrics call to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to update explanation metrics after save:',
        {
          explanationid: explanationId,
          error: 'Metrics service unavailable'
        }
      );
    });
  });

  describe('getExplanationIdsForUser', () => {
    it('should return explanation IDs without dates', async () => {
      // Arrange
      const userId = 'user-123';
      const mockData = [
        { explanationid: 1 },
        { explanationid: 2 },
        { explanationid: 3 }
      ];

      mockSupabase.eq.mockResolvedValue({
        data: mockData,
        error: null
      });

      // Act
      const result = await getExplanationIdsForUser(userId);

      // Assert
      expect(result).toEqual([1, 2, 3]);
      expect(mockSupabase.from).toHaveBeenCalledWith('userLibrary');
      expect(mockSupabase.select).toHaveBeenCalledWith('explanationid');
      expect(mockSupabase.eq).toHaveBeenCalledWith('userid', userId);
    });

    it('should return explanation IDs with dates when requested', async () => {
      // Arrange
      const userId = 'user-123';
      const mockData = [
        { explanationid: 1, created: '2024-01-01T00:00:00Z' },
        { explanationid: 2, created: '2024-01-02T00:00:00Z' }
      ];

      mockSupabase.eq.mockResolvedValue({
        data: mockData,
        error: null
      });

      // Act
      const result = await getExplanationIdsForUser(userId, true);

      // Assert
      expect(result).toEqual(mockData);
      expect(mockSupabase.select).toHaveBeenCalledWith('explanationid, created');
    });

    it('should return empty array when no explanations found', async () => {
      // Arrange
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getExplanationIdsForUser('user-no-data');

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Database error' };
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getExplanationIdsForUser('user-123')).rejects.toEqual(mockError);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching explanation IDs for user:', mockError);
    });

    it('should handle empty result set gracefully', async () => {
      // Arrange
      mockSupabase.eq.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      const result = await getExplanationIdsForUser('user-empty', false);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('getUserLibraryExplanations', () => {
    it('should return explanations with saved timestamps', async () => {
      // Arrange
      const userId = 'user-123';
      const mockIdCreatedArr = [
        { explanationid: 1, created: '2024-01-01T00:00:00Z' },
        { explanationid: 2, created: '2024-01-02T00:00:00Z' }
      ];

      const mockExplanations = [
        {
          id: 1,
          explanation_title: 'Title 1',
          content: 'Content 1',
          primary_topic_id: 1,
          secondary_topic_id: null,
          timestamp: '2024-01-01T00:00:00Z',
          status: 'active'
        },
        {
          id: 2,
          explanation_title: 'Title 2',
          content: 'Content 2',
          primary_topic_id: 2,
          secondary_topic_id: 3,
          timestamp: '2024-01-02T00:00:00Z',
          status: 'active'
        }
      ];

      // Mock getExplanationIdsForUser
      mockSupabase.eq.mockResolvedValue({
        data: mockIdCreatedArr,
        error: null
      });

      // Mock getExplanationsByIds
      (getExplanationsByIds as jest.Mock).mockResolvedValue(mockExplanations);

      // Act
      const result = await getUserLibraryExplanations(userId);

      // Assert
      expect(result).toEqual([
        {
          id: 1,
          explanation_title: 'Title 1',
          content: 'Content 1',
          primary_topic_id: 1,
          secondary_topic_id: null,
          timestamp: '2024-01-01T00:00:00Z',
          saved_timestamp: '2024-01-01T00:00:00Z',
          status: 'active'
        },
        {
          id: 2,
          explanation_title: 'Title 2',
          content: 'Content 2',
          primary_topic_id: 2,
          secondary_topic_id: 3,
          timestamp: '2024-01-02T00:00:00Z',
          saved_timestamp: '2024-01-02T00:00:00Z',
          status: 'active'
        }
      ]);

      expect(getExplanationsByIds).toHaveBeenCalledWith([1, 2]);
    });

    it('should return empty array when user has no saved explanations', async () => {
      // Arrange
      mockSupabase.eq.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      const result = await getUserLibraryExplanations('user-no-saves');

      // Assert
      expect(result).toEqual([]);
      expect(getExplanationsByIds).not.toHaveBeenCalled();
    });

    it('should handle missing explanations gracefully', async () => {
      // Arrange
      const userId = 'user-123';
      const mockIdCreatedArr = [
        { explanationid: 1, created: '2024-01-01T00:00:00Z' },
        { explanationid: 999, created: '2024-01-02T00:00:00Z' } // Non-existent
      ];

      const mockExplanations = [
        {
          id: 1,
          explanation_title: 'Title 1',
          content: 'Content 1',
          primary_topic_id: 1,
          timestamp: '2024-01-01T00:00:00Z',
          status: 'active'
        }
        // ID 999 not returned by getExplanationsByIds
      ];

      mockSupabase.eq.mockResolvedValue({
        data: mockIdCreatedArr,
        error: null
      });

      (getExplanationsByIds as jest.Mock).mockResolvedValue(mockExplanations);

      // Act
      const result = await getUserLibraryExplanations(userId);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBeUndefined(); // Missing explanation should have empty properties
      expect(result[1].saved_timestamp).toBe('2024-01-02T00:00:00Z');
    });

    it('should propagate errors from getExplanationIdsForUser', async () => {
      // Arrange
      const mockError = { message: 'Database error' };
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getUserLibraryExplanations('user-123')).rejects.toEqual(mockError);
      expect(getExplanationsByIds).not.toHaveBeenCalled();
    });

    it('should propagate errors from getExplanationsByIds', async () => {
      // Arrange
      const mockIdCreatedArr = [
        { explanationid: 1, created: '2024-01-01T00:00:00Z' }
      ];

      mockSupabase.eq.mockResolvedValue({
        data: mockIdCreatedArr,
        error: null
      });

      const mockError = new Error('Failed to fetch explanations');
      (getExplanationsByIds as jest.Mock).mockRejectedValue(mockError);

      // Act & Assert
      await expect(getUserLibraryExplanations('user-123')).rejects.toEqual(mockError);
    });
  });

  describe('isExplanationSavedByUser', () => {
    it('should return true when explanation is saved', async () => {
      // Arrange
      mockSupabase.maybeSingle.mockResolvedValue({
        data: { id: 1 },
        error: null
      });

      // Act
      const result = await isExplanationSavedByUser(123, 'user-456');

      // Assert
      expect(result).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('userLibrary');
      expect(mockSupabase.select).toHaveBeenCalledWith('id');
      expect(mockSupabase.eq).toHaveBeenCalledWith('userid', 'user-456');
      expect(mockSupabase.eq).toHaveBeenCalledWith('explanationid', 123);
      expect(mockSupabase.maybeSingle).toHaveBeenCalled();
    });

    it('should return false when explanation is not saved', async () => {
      // Arrange
      mockSupabase.maybeSingle.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await isExplanationSavedByUser(123, 'user-456');

      // Assert
      expect(result).toBe(false);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.maybeSingle.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(isExplanationSavedByUser(123, 'user-456')).rejects.toEqual(mockError);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error checking if explanation is saved:', mockError);
    });
  });
});