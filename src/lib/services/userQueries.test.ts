/**
 * @jest-environment node
 */

import {
  createUserQuery,
  getRecentUserQueries,
  getUserQueryById
} from './userQueries';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import type { UserQueryInsertType } from '@/lib/schemas/schemas';
import { UserInputType } from '@/lib/schemas/schemas';

// Mock dependencies
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
  order: jest.Mock;
  range: jest.Mock;
};

describe('UserQueries Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock Supabase client
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
    };

    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('createUserQuery userId validation', () => {
    const baseQueryData: UserQueryInsertType = {
      user_query: 'What is React?',
      explanation_id: 123,
      matches: [],
      userid: 'test-user',
      newExplanation: true,
      userInputType: UserInputType.Query,
      allowedQuery: true,
      previousExplanationViewedId: null
    };

    it('should throw error when userid is null', async () => {
      await expect(createUserQuery({ ...baseQueryData, userid: null as any })).rejects.toThrow('userId is required for createUserQuery');
    });

    it('should throw error when userid is undefined', async () => {
      await expect(createUserQuery({ ...baseQueryData, userid: undefined as any })).rejects.toThrow('userId is required for createUserQuery');
    });

    it('should throw error when userid is empty string', async () => {
      await expect(createUserQuery({ ...baseQueryData, userid: '' })).rejects.toThrow('userId is required for createUserQuery');
    });
  });

  describe('createUserQuery', () => {
    it('should create a user query successfully', async () => {
      // Arrange
      const queryData: UserQueryInsertType = {
        user_query: 'What is React?',
        explanation_id: 123,
        matches: [],
        userid: 'test-user',
        newExplanation: true,
        userInputType: UserInputType.Query,
        allowedQuery: true,
        previousExplanationViewedId: null
      };

      const expectedResponse = {
        ...queryData,
        id: 1,
        created_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: expectedResponse,
        error: null
      });

      // Act
      const result = await createUserQuery(queryData);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(mockSupabase.from).toHaveBeenCalledWith('userQueries');
      expect(mockSupabase.insert).toHaveBeenCalledWith(queryData);
      expect(mockSupabase.select).toHaveBeenCalled();
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should throw error when insertion fails', async () => {
      // Arrange
      const queryData: UserQueryInsertType = {
        user_query: 'Test query',
        explanation_id: 123,
        matches: [],
        userid: 'test-user',
        newExplanation: true,
        userInputType: UserInputType.Query,
        allowedQuery: true,
        previousExplanationViewedId: null
      };

      const mockError = { message: 'Database error' };
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(createUserQuery(queryData)).rejects.toEqual(mockError);
    });
  });

  describe('getRecentUserQueries', () => {
    it('should return recent queries with default parameters', async () => {
      // Arrange
      const mockQueries = [
        {
          id: 1,
          user_query: 'Query 1',
          explanation_title: 'Title 1',
          content: 'Content 1',
          created_at: '2024-01-02T00:00:00Z'
        },
        {
          id: 2,
          user_query: 'Query 2',
          explanation_title: 'Title 2',
          content: 'Content 2',
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockQueries,
        error: null
      });

      // Act
      const result = await getRecentUserQueries();

      // Assert
      expect(result).toEqual(mockQueries);
      expect(mockSupabase.from).toHaveBeenCalledWith('userQueries');
      expect(mockSupabase.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9);
    });

    it('should handle custom limit and offset', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentUserQueries(5, 10);

      // Assert
      expect(mockSupabase.range).toHaveBeenCalledWith(10, 14);
    });

    it('should normalize invalid limit to 10', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentUserQueries(-5, 0);

      // Assert
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9);
    });

    it('should normalize negative offset to 0', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentUserQueries(10, -10);

      // Assert
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9);
    });

    it('should return empty array when no data found', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getRecentUserQueries();

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
      await expect(getRecentUserQueries()).rejects.toEqual(mockError);
    });

    it('should handle zero limit', async () => {
      // Arrange
      mockSupabase.range.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await getRecentUserQueries(0);

      // Assert - should be normalized to 10
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 9);
    });
  });

  describe('getUserQueryById', () => {
    it('should return query when found', async () => {
      // Arrange
      const mockQuery = {
        id: 1,
        user_query: 'Test query',
        explanation_title: 'Test Title',
        content: 'Test content',
        created_at: '2024-01-01T00:00:00Z'
      };

      mockSupabase.single.mockResolvedValue({
        data: mockQuery,
        error: null
      });

      // Act
      const result = await getUserQueryById(1);

      // Assert
      expect(result).toEqual(mockQuery);
      expect(mockSupabase.from).toHaveBeenCalledWith('userQueries');
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 1);
      expect(mockSupabase.single).toHaveBeenCalled();
    });

    it('should throw error when query not found', async () => {
      // Arrange
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: null
      });

      // Act & Assert
      await expect(getUserQueryById(999)).rejects.toThrow('User query not found for ID: 999');
    });

    it('should throw error when database query fails', async () => {
      // Arrange
      const mockError = { message: 'Database error' };
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getUserQueryById(1)).rejects.toEqual(mockError);
    });
  });
});
