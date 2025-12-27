import {
  createTopic,
  getTopicById,
  getRecentTopics,
  updateTopic,
  deleteTopic,
  searchTopicsByTitle
} from './topics';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { TopicInsertType, TopicFullDbType } from '@/lib/schemas/schemas';

// Mock Supabase server client
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));

describe('Topics Service', () => {
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
      ilike: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };

    // Setup the mock to return our mockSupabase
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('createTopic', () => {
    it('should return existing topic if title already exists', async () => {
      // Arrange
      const newTopic: TopicInsertType = {
        topic_title: 'Physics',
        topic_description: 'Study of matter and energy'
      };

      const existingTopic: TopicFullDbType = {
        id: 1,
        topic_title: 'Physics',
        topic_description: 'Study of matter and energy',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      // Mock the select query to find existing topic
      mockSupabase.single.mockResolvedValue({
        data: existingTopic,
        error: null
      });

      // Act
      const result = await createTopic(newTopic);

      // Assert
      expect(result).toEqual(existingTopic);
      expect(mockSupabase.from).toHaveBeenCalledWith('topics');
      expect(mockSupabase.select).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('topic_title', 'Physics');
      expect(mockSupabase.insert).not.toHaveBeenCalled(); // Should not insert if exists
    });

    it('should create new topic if title does not exist', async () => {
      // Arrange
      const newTopic: TopicInsertType = {
        topic_title: 'Chemistry',
        topic_description: 'Study of substances'
      };

      const createdTopic: TopicFullDbType = {
        id: 2,
        topic_title: 'Chemistry',
        topic_description: 'Study of substances',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      // Mock select to not find existing topic (PGRST116 = No rows found)
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' }
      });

      // Mock insert success
      mockSupabase.single.mockResolvedValueOnce({
        data: createdTopic,
        error: null
      });

      // Act
      const result = await createTopic(newTopic);

      // Assert
      expect(result).toEqual(createdTopic);
      expect(mockSupabase.from).toHaveBeenCalledTimes(2); // Once for select, once for insert
      expect(mockSupabase.insert).toHaveBeenCalledWith(newTopic);
    });

    it('should throw error for database failures (non-PGRST116)', async () => {
      // Arrange
      const newTopic: TopicInsertType = {
        topic_title: 'Biology',
        topic_description: 'Study of life'
      };

      const dbError = {
        code: 'PGRST500',
        message: 'Database connection error'
      };

      mockSupabase.single.mockResolvedValue({
        data: null,
        error: dbError
      });

      // Act & Assert
      await expect(createTopic(newTopic)).rejects.toEqual(dbError);
    });

    it('should throw error when insert fails', async () => {
      // Arrange
      const newTopic: TopicInsertType = {
        topic_title: 'Geology',
        topic_description: 'Study of Earth'
      };

      // Mock select to not find existing
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' }
      });

      // Mock insert failure
      const insertError = { message: 'Insert failed' };
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: insertError
      });

      // Act & Assert
      await expect(createTopic(newTopic)).rejects.toEqual(insertError);
    });
  });

  describe('getTopicById', () => {
    it('should return topic when found', async () => {
      // Arrange
      const expectedTopic: TopicFullDbType = {
        id: 1,
        topic_title: 'Mathematics',
        topic_description: 'Study of numbers',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: expectedTopic,
        error: null
      });

      // Act
      const result = await getTopicById(1);

      // Assert
      expect(result).toEqual(expectedTopic);
      expect(mockSupabase.from).toHaveBeenCalledWith('topics');
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 1);
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should return null when topic not found', async () => {
      // Arrange
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getTopicById(999);

      // Assert
      expect(result).toBeNull();
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      const mockError = { message: 'Database error' };
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getTopicById(1)).rejects.toEqual(mockError);
    });
  });

  describe('getRecentTopics', () => {
    it('should return recent topics with default parameters', async () => {
      // Arrange
      const mockTopics: TopicFullDbType[] = [
        {
          id: 1,
          topic_title: 'Topic 1',
          topic_description: 'Description 1',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          topic_title: 'Topic 2',
          topic_description: 'Description 2',
          created_at: '2024-01-02T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z'
        }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockTopics,
        error: null
      });

      // Act
      const result = await getRecentTopics();

      // Assert
      expect(result).toEqual(mockTopics);
      expect(mockSupabase.from).toHaveBeenCalledWith('topics');
      expect(mockSupabase.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9);
    });

    it('should handle custom parameters correctly', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentTopics(5, 10, 'topic_title', 'asc');

      // Assert
      expect(mockSupabase.order).toHaveBeenCalledWith('topic_title', { ascending: true });
      expect(mockSupabase.range).toHaveBeenCalledWith(10, 14);
    });

    it('should validate and correct invalid parameters', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentTopics(0, -5); // Invalid limit and offset

      // Assert
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9); // Should use defaults
    });

    it('should return empty array when no data found', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getRecentTopics();

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
      await expect(getRecentTopics()).rejects.toEqual(mockError);
    });
  });

  describe('updateTopic', () => {
    it('should update topic successfully', async () => {
      // Arrange
      const updates: Partial<TopicInsertType> = {
        topic_description: 'Updated description'
      };

      const updatedTopic: TopicFullDbType = {
        id: 1,
        topic_title: 'Physics',
        topic_description: 'Updated description',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: updatedTopic,
        error: null
      });

      // Act
      const result = await updateTopic(1, updates);

      // Assert
      expect(result).toEqual(updatedTopic);
      expect(mockSupabase.from).toHaveBeenCalledWith('topics');
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
      await expect(updateTopic(1, {})).rejects.toEqual(mockError);
    });
  });

  describe('deleteTopic', () => {
    it('should delete topic successfully', async () => {
      // Arrange
      mockSupabase.eq.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      await deleteTopic(1);

      // Assert
      expect(mockSupabase.from).toHaveBeenCalledWith('topics');
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
      await expect(deleteTopic(1)).rejects.toEqual(mockError);
    });
  });

  describe('searchTopicsByTitle', () => {
    it('should return topics matching search term', async () => {
      // Arrange
      const searchTerm = 'phy';
      const mockTopics: TopicFullDbType[] = [
        {
          id: 1,
          topic_title: 'Physics',
          topic_description: 'Study of matter',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          topic_title: 'Astrophysics',
          topic_description: 'Study of space',
          created_at: '2024-01-02T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z'
        }
      ];

      mockSupabase.limit.mockResolvedValue({
        data: mockTopics,
        error: null
      });

      // Act
      const result = await searchTopicsByTitle(searchTerm);

      // Assert
      expect(result).toEqual(mockTopics);
      expect(mockSupabase.from).toHaveBeenCalledWith('topics');
      expect(mockSupabase.ilike).toHaveBeenCalledWith('topic_title', '%phy%');
      expect(mockSupabase.limit).toHaveBeenCalledWith(10);
    });

    it('should use custom limit parameter', async () => {
      // Arrange
      mockSupabase.limit.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await searchTopicsByTitle('test', 5);

      // Assert
      expect(mockSupabase.limit).toHaveBeenCalledWith(5);
    });

    it('should return empty array when no matches found', async () => {
      // Arrange
      mockSupabase.limit.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await searchTopicsByTitle('nonexistent');

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when search fails', async () => {
      // Arrange
      const mockError = { message: 'Search failed' };
      mockSupabase.limit.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(searchTopicsByTitle('test')).rejects.toEqual(mockError);
    });
  });
});