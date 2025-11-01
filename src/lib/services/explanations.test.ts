import {
  createExplanation,
  getExplanationById,
  getRecentExplanations,
  updateExplanation,
  deleteExplanation,
  getExplanationsByIds,
  getExplanationsByTopicId
} from './explanations';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { ExplanationInsertType, ExplanationFullDbType } from '@/lib/schemas/schemas';

// Mock Supabase server client
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));

describe('Explanations Service', () => {
  let mockSupabase: any;

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
    };

    // Setup the mock to return our mockSupabase
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('createExplanation', () => {
    it('should create a new explanation successfully', async () => {
      // Arrange
      const newExplanation: ExplanationInsertType = {
        explanation_title: 'Test Explanation',
        content: 'Test content',
        primary_topic_id: 1,
        secondary_topic_id: 2,
        status: 'active'
      };

      const expectedResponse: ExplanationFullDbType = {
        id: 1,
        explanation_title: 'Test Explanation',
        content: 'Test content',
        primary_topic_id: 1,
        secondary_topic_id: 2,
        status: 'active',
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
        content: 'Test content'
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
        status: 'active',
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
          timestamp: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          explanation_title: 'Explanation 2',
          content: 'Content 2',
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

    it('should handle custom parameters correctly', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentExplanations(5, 10, 'id', 'asc');

      // Assert
      expect(mockSupabase.order).toHaveBeenCalledWith('id', { ascending: true });
      expect(mockSupabase.range).toHaveBeenCalledWith(10, 14);
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
        { id: 1, explanation_title: 'Title 1', content: 'Content 1' },
        { id: 2, explanation_title: 'Title 2', content: 'Content 2' }
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
          primary_topic_id: 5
        },
        {
          id: 2,
          explanation_title: 'Title 2',
          content: 'Content 2',
          secondary_topic_id: 5
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