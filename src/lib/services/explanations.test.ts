import {
  createExplanation,
  getExplanationById,
  getRecentExplanations,
  updateExplanation,
  deleteExplanation,
  getExplanationsByIds,
  getExplanationsByTopicId
} from './explanations';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { ExplanationInsertType, ExplanationFullDbType, ExplanationStatus } from '@/lib/schemas/schemas';

// Mock Supabase server client
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
  createSupabaseServiceClient: jest.fn()
}));

type MockSupabaseClient = {
  from: jest.Mock;
  insert: jest.Mock;
  select: jest.Mock;
  single: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  or: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  order: jest.Mock;
  range: jest.Mock;
  gte: jest.Mock;
};

describe('Explanations Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create mock Supabase client with chainable methods
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
    };

    // Setup the mock to return our mockSupabase
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('createExplanation', () => {
    it('should create a new explanation successfully', async () => {
      // Arrange
      const newExplanation: ExplanationInsertType = {
        explanation_title: 'Test Explanation',
        content: 'Test content',
        primary_topic_id: 1,
        secondary_topic_id: 2,
        status: ExplanationStatus.Published
      };

      const expectedResponse: ExplanationFullDbType = {
        id: 1,
        explanation_title: 'Test Explanation',
        content: 'Test content',
        primary_topic_id: 1,
        secondary_topic_id: 2,
        status: ExplanationStatus.Published,
        timestamp: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: expectedResponse,
        error: null
      });

      // Act
      const result = await createExplanation(newExplanation);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
      expect(mockSupabase.insert).toHaveBeenCalledWith(newExplanation);
      expect(mockSupabase.select).toHaveBeenCalledWith('id, explanation_title, content, timestamp, primary_topic_id, secondary_topic_id, status');
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should throw error when insertion fails', async () => {
      // Arrange
      const newExplanation: ExplanationInsertType = {
        explanation_title: 'Test Explanation',
        content: 'Test content',
        primary_topic_id: 1,
        status: ExplanationStatus.Published
      };

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
      await expect(createExplanation(newExplanation)).rejects.toEqual(mockError);
    });
  });

  describe('getExplanationById', () => {
    it('should return explanation when found', async () => {
      // Arrange
      const expectedExplanation: ExplanationFullDbType = {
        id: 1,
        explanation_title: 'Test Explanation',
        content: 'Test content',
        primary_topic_id: 1,
        secondary_topic_id: 2,
        status: ExplanationStatus.Published,
        timestamp: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: expectedExplanation,
        error: null
      });

      // Act
      const result = await getExplanationById(1);

      // Assert
      expect(result).toEqual(expectedExplanation);
      expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 1);
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should throw error when explanation not found', async () => {
      // Arrange
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: null
      });

      // Act & Assert
      await expect(getExplanationById(999)).rejects.toThrow('Explanation not found for ID: 999');
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      const mockError = { message: 'Database error' };
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getExplanationById(1)).rejects.toEqual(mockError);
    });
  });

  describe('getRecentExplanations', () => {
    it('should return recent explanations with default parameters', async () => {
      // Arrange
      const mockExplanations: ExplanationFullDbType[] = [
        {
          id: 1,
          explanation_title: 'Explanation 1',
          content: 'Content 1',
          primary_topic_id: 1,
          status: ExplanationStatus.Published,
          timestamp: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          explanation_title: 'Explanation 2',
          content: 'Content 2',
          primary_topic_id: 2,
          status: ExplanationStatus.Published,
          timestamp: '2024-01-02T00:00:00Z'
        }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockExplanations,
        error: null
      });

      // Act
      const result = await getRecentExplanations();

      // Assert
      expect(result).toEqual(mockExplanations);
      expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
      expect(mockSupabase.order).toHaveBeenCalledWith('timestamp', { ascending: false });
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9);
    });

    it('should handle custom limit and offset parameters', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentExplanations(5, 10);

      // Assert
      expect(mockSupabase.order).toHaveBeenCalledWith('timestamp', { ascending: false });
      expect(mockSupabase.range).toHaveBeenCalledWith(10, 14);
    });

    it('should use new mode with options object', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentExplanations(10, 0, { sort: 'new' });

      // Assert
      expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
      expect(mockSupabase.order).toHaveBeenCalledWith('timestamp', { ascending: false });
    });

    it('should validate and correct invalid parameters', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentExplanations(-5, -10);

      // Assert
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9); // Should use defaults for invalid values
    });

    it('should return empty array when no data found', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getRecentExplanations();

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.range.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getRecentExplanations()).rejects.toEqual(mockError);
    });

    it('should sort by view count in top mode', async () => {
      // Arrange - mock explanations
      const mockExplanations: ExplanationFullDbType[] = [
        {
          id: 1,
          explanation_title: 'Less Popular',
          content: 'Content 1',
          primary_topic_id: 1,
          status: ExplanationStatus.Published,
          timestamp: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          explanation_title: 'Most Popular',
          content: 'Content 2',
          primary_topic_id: 2,
          status: ExplanationStatus.Published,
          timestamp: '2024-01-02T00:00:00Z'
        }
      ];

      // Mock view events (explanation 2 has more views)
      const mockViewEvents = [
        { explanationid: 2 },
        { explanationid: 2 },
        { explanationid: 2 },
        { explanationid: 1 }
      ];

      // Setup mock chain for view events query
      let queryState = 'initial';
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'userExplanationEvents') {
          queryState = 'events';
        } else if (table === 'explanations') {
          queryState = 'explanations';
        }
        return mockSupabase;
      });

      mockSupabase.gte.mockResolvedValue({
        data: mockViewEvents,
        error: null
      });

      mockSupabase.eq.mockImplementation(() => {
        if (queryState === 'explanations') {
          return {
            data: mockExplanations,
            error: null
          };
        }
        return mockSupabase;
      });

      // Act
      const result = await getRecentExplanations(10, 0, { sort: 'top', period: 'week' });

      // Assert - explanation 2 should come first (more views)
      expect(result[0].id).toBe(2);
      expect(result[1].id).toBe(1);
    });

    it('should filter views by time period in top mode', async () => {
      // Arrange - need to maintain chain for gte call
      mockSupabase.eq.mockReturnThis(); // Keep chain going
      mockSupabase.gte.mockResolvedValue({
        data: [],
        error: null
      });
      // Mock the explanations query
      let callCount = 0;
      mockSupabase.eq.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First eq call is for event_name filter - return chain
          return mockSupabase;
        }
        // Second eq call is for explanations status filter
        return {
          data: [],
          error: null
        };
      });

      // Act
      await getRecentExplanations(10, 0, { sort: 'top', period: 'today' });

      // Assert - should call gte with a date filter
      expect(mockSupabase.gte).toHaveBeenCalledWith('created_at', expect.any(String));
    });

    it('should not apply time filter for all period in top mode', async () => {
      // Arrange
      // For 'all' period, gte should not be called
      mockSupabase.eq.mockImplementation(() => {
        return {
          data: [],
          error: null
        };
      });

      // Act
      await getRecentExplanations(10, 0, { sort: 'top', period: 'all' });

      // Assert - gte should not be called for 'all' period
      expect(mockSupabase.gte).not.toHaveBeenCalled();
    });
  });

  describe('updateExplanation', () => {
    it('should update explanation successfully', async () => {
      // Arrange
      const updates: Partial<ExplanationInsertType> = {
        explanation_title: 'Updated Title',
        content: 'Updated content'
      };

      const updatedExplanation: ExplanationFullDbType = {
        id: 1,
        explanation_title: 'Updated Title',
        content: 'Updated content',
        primary_topic_id: 1,
        status: ExplanationStatus.Published,
        timestamp: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: updatedExplanation,
        error: null
      });

      // Act
      const result = await updateExplanation(1, updates);

      // Assert
      expect(result).toEqual(updatedExplanation);
      expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
      expect(mockSupabase.update).toHaveBeenCalledWith(updates);
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 1);
      expect(mockSupabase.select).toHaveBeenCalled();
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should throw error when update fails', async () => {
      // Arrange
      const mockError = { message: 'Update failed' };
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(updateExplanation(1, {})).rejects.toEqual(mockError);
    });
  });

  describe('deleteExplanation', () => {
    it('should delete explanation successfully', async () => {
      // Arrange
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      await deleteExplanation(1);

      // Assert
      expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
      expect(mockSupabase.delete).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw error when deletion fails', async () => {
      // Arrange
      const mockError = { message: 'Deletion failed' };
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(deleteExplanation(1)).rejects.toEqual(mockError);
    });
  });

  describe('getExplanationsByIds', () => {
    it('should return explanations for given IDs', async () => {
      // Arrange
      const ids = [1, 2, 3];
      const mockExplanations: ExplanationFullDbType[] = [
        { 
          id: 1, 
          explanation_title: 'Title 1', 
          content: 'Content 1',
          primary_topic_id: 1,
          status: ExplanationStatus.Published,
          timestamp: '2024-01-01T00:00:00Z'
        },
        { 
          id: 2, 
          explanation_title: 'Title 2', 
          content: 'Content 2',
          primary_topic_id: 2,
          status: ExplanationStatus.Published,
          timestamp: '2024-01-02T00:00:00Z'
        }
      ];

      mockSupabase.in.mockResolvedValue({
        data: mockExplanations,
        error: null
      });

      // Act
      const result = await getExplanationsByIds(ids);

      // Assert
      expect(result).toEqual(mockExplanations);
      expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
      expect(mockSupabase.in).toHaveBeenCalledWith('id', ids);
    });

    it('should return empty array when no explanations found', async () => {
      // Arrange
      mockSupabase.in.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getExplanationsByIds([999]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.in.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getExplanationsByIds([1])).rejects.toEqual(mockError);
    });
  });

  describe('getExplanationsByTopicId', () => {
    it('should return explanations matching topic ID', async () => {
      // Arrange
      const topicId = 5;
      const mockExplanations: ExplanationFullDbType[] = [
        {
          id: 1,
          explanation_title: 'Title 1',
          content: 'Content 1',
          primary_topic_id: 5,
          status: ExplanationStatus.Published,
          timestamp: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          explanation_title: 'Title 2',
          content: 'Content 2',
          primary_topic_id: 1,
          secondary_topic_id: 5,
          status: ExplanationStatus.Published,
          timestamp: '2024-01-02T00:00:00Z'
        }
      ];

      mockSupabase.order.mockResolvedValue({
        data: mockExplanations,
        error: null
      });

      // Act
      const result = await getExplanationsByTopicId(topicId);

      // Assert
      expect(result).toEqual(mockExplanations);
      expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
      expect(mockSupabase.or).toHaveBeenCalledWith(`primary_topic_id.eq.${topicId},secondary_topic_id.eq.${topicId}`);
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9);
      expect(mockSupabase.order).toHaveBeenCalledWith('timestamp', { ascending: false });
    });

    it('should handle custom pagination parameters', async () => {
      // Arrange
      mockSupabase.order.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getExplanationsByTopicId(1, 5, 10);

      // Assert
      expect(mockSupabase.range).toHaveBeenCalledWith(10, 14);
    });

    it('should return empty array when no matches found', async () => {
      // Arrange
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getExplanationsByTopicId(999);

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getExplanationsByTopicId(1)).rejects.toEqual(mockError);
    });
  });
});