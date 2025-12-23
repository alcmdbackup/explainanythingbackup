/**
 * @jest-environment node
 */

import {
  checkTestingPipelineExists,
  saveTestingPipelineRecord,
  checkAndSaveTestingPipelineRecord,
  updateTestingPipelineRecordSetName,
  getTestingPipelineRecords,
  type TestingPipelineInsert,
  type TestingPipelineRecord,
  type SessionData
} from './testingPipeline';
import { createSupabaseServerClient } from '../utils/supabase/server';
import { logger } from '../client_utilities';

// Mock dependencies
jest.mock('../utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
}));
jest.mock('../client_utilities', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  }
}));

type MockSupabaseChain = {
  select: jest.Mock;
  eq: jest.Mock;
  limit: jest.Mock;
  insert: jest.Mock;
  single: jest.Mock;
  update: jest.Mock;
  order: jest.Mock;
};

type MockSupabaseClient = {
  from: jest.Mock;
};

describe('TestingPipeline Service', () => {
  let mockChain: MockSupabaseChain;
  let mockSupabaseClient: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console.log to avoid clutter
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Create mock Supabase chain (for chained methods like .select().eq())
    mockChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };

    // Create mock Supabase client with from() method
    mockSupabaseClient = {
      from: jest.fn().mockReturnValue(mockChain)
    };

    // Mock createSupabaseServerClient to return our mock client
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabaseClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkTestingPipelineExists', () => {
    it('should return true when record exists', async () => {
      // Arrange
      mockChain.limit.mockResolvedValue({
        data: [{ id: 1 }],
        error: null
      });

      // Act
      const result = await checkTestingPipelineExists('test-set', 'step1', 'content');

      // Assert
      expect(result).toBe(true);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('testing_edits_pipeline');
      expect(mockChain.eq).toHaveBeenCalledWith('set_name', 'test-set');
      expect(mockChain.eq).toHaveBeenCalledWith('step', 'step1');
      expect(mockChain.eq).toHaveBeenCalledWith('content', 'content');
      expect(mockChain.limit).toHaveBeenCalledWith(1);
    });

    it('should return false when record does not exist', async () => {
      // Arrange
      mockChain.limit.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      const result = await checkTestingPipelineExists('test-set', 'step1', 'content');

      // Assert
      expect(result).toBe(false);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed', code: '500' };
      mockChain.limit.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(checkTestingPipelineExists('test-set', 'step1', 'content')).rejects.toEqual(mockError);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log debug information', async () => {
      // Arrange
      mockChain.limit.mockResolvedValue({
        data: [],
        error: null
      });

      // Act
      await checkTestingPipelineExists('test-set', 'step1', 'content');

      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        'Checking if testing pipeline record exists:',
        expect.objectContaining({
          setName: 'test-set',
          step: 'step1'
        })
      );
    });
  });

  describe('saveTestingPipelineRecord', () => {
    it('should save record successfully', async () => {
      // Arrange
      const recordData: TestingPipelineInsert = {
        set_name: 'test-set',
        step: 'step1',
        content: 'test content'
      };

      const savedRecord: TestingPipelineRecord = {
        id: 1,
        ...recordData,
        created_at: '2024-01-01T00:00:00Z'
      };

      mockChain.single.mockResolvedValue({
        data: savedRecord,
        error: null
      });

      // Act
      const result = await saveTestingPipelineRecord(recordData);

      // Assert
      expect(result).toEqual(savedRecord);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('testing_edits_pipeline');
      expect(mockChain.insert).toHaveBeenCalledWith({
        set_name: 'test-set',
        step: 'step1',
        content: 'test content'
      });
    });

    it('should include session data when provided', async () => {
      // Arrange
      const recordData: TestingPipelineInsert = {
        set_name: 'test-set',
        step: 'step1',
        content: 'test content',
        session_id: 'session123',
        explanation_id: 1,
        explanation_title: 'Title',
        user_prompt: 'Prompt',
        source_content: 'Source',
        session_metadata: { test: 'data' }
      };

      mockChain.single.mockResolvedValue({
        data: { id: 1, ...recordData },
        error: null
      });

      // Act
      await saveTestingPipelineRecord(recordData);

      // Assert
      expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'session123',
        explanation_id: 1
      }));
    });

    it('should throw error when save fails', async () => {
      // Arrange
      const recordData: TestingPipelineInsert = {
        set_name: 'test-set',
        step: 'step1',
        content: 'test content'
      };

      const mockError = { message: 'Save failed', code: '500' };
      mockChain.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(saveTestingPipelineRecord(recordData)).rejects.toEqual(mockError);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('checkAndSaveTestingPipelineRecord', () => {
    it('should return saved: false when record already exists', async () => {
      // Arrange
      mockChain.limit.mockResolvedValue({
        data: [{ id: 1 }],
        error: null
      });

      // Act
      const result = await checkAndSaveTestingPipelineRecord('test-set', 'step1', 'content');

      // Assert
      expect(result).toEqual({ saved: false });
      expect(mockChain.insert).not.toHaveBeenCalled();
    });

    it('should save and return record when it does not exist', async () => {
      // Arrange
      mockChain.limit.mockResolvedValue({
        data: [],
        error: null
      });

      const savedRecord: TestingPipelineRecord = {
        id: 1,
        set_name: 'test-set',
        step: 'step1',
        content: 'content',
        created_at: '2024-01-01T00:00:00Z'
      };

      mockChain.single.mockResolvedValue({
        data: savedRecord,
        error: null
      });

      // Act
      const result = await checkAndSaveTestingPipelineRecord('test-set', 'step1', 'content');

      // Assert
      expect(result).toEqual({ saved: true, record: savedRecord });
      expect(mockChain.insert).toHaveBeenCalled();
    });

    it('should include session data when provided', async () => {
      // Arrange
      mockChain.limit.mockResolvedValue({
        data: [],
        error: null
      });

      const savedRecord: TestingPipelineRecord = {
        id: 1,
        set_name: 'test-set',
        step: 'step1',
        content: 'content',
        session_id: 'session123',
        explanation_id: 1,
        explanation_title: 'Title',
        user_prompt: 'Prompt',
        source_content: 'Source',
        created_at: '2024-01-01T00:00:00Z'
      };

      mockChain.single.mockResolvedValue({
        data: savedRecord,
        error: null
      });

      const sessionData: SessionData = {
        session_id: 'session123',
        explanation_id: 1,
        explanation_title: 'Title',
        user_prompt: 'Prompt',
        source_content: 'Source'
      };

      // Act
      await checkAndSaveTestingPipelineRecord('test-set', 'step1', 'content', sessionData);

      // Assert
      expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'session123'
      }));
    });

    it('should throw error when check or save fails', async () => {
      // Arrange
      const mockError = { message: 'Error' };
      mockChain.limit.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(
        checkAndSaveTestingPipelineRecord('test-set', 'step1', 'content')
      ).rejects.toEqual(mockError);
    });
  });

  describe('updateTestingPipelineRecordSetName', () => {
    it('should update set name successfully', async () => {
      // Arrange
      const updatedRecord: TestingPipelineRecord = {
        id: 1,
        set_name: 'new-name',
        step: 'step1',
        content: 'content',
        created_at: '2024-01-01T00:00:00Z'
      };

      mockChain.single.mockResolvedValue({
        data: updatedRecord,
        error: null
      });

      // Act
      const result = await updateTestingPipelineRecordSetName(1, 'new-name');

      // Assert
      expect(result).toEqual(updatedRecord);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('testing_edits_pipeline');
      expect(mockChain.update).toHaveBeenCalledWith({ set_name: 'new-name' });
      expect(mockChain.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw error when update fails', async () => {
      // Arrange
      const mockError = { message: 'Update failed', code: '500' };
      mockChain.single.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(updateTestingPipelineRecordSetName(1, 'new-name')).rejects.toEqual(mockError);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getTestingPipelineRecords', () => {
    it('should return records for a set name', async () => {
      // Arrange
      const mockRecords: TestingPipelineRecord[] = [
        {
          id: 1,
          set_name: 'test-set',
          step: 'step1',
          content: 'content1',
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          set_name: 'test-set',
          step: 'step2',
          content: 'content2',
          created_at: '2024-01-02T00:00:00Z'
        }
      ];

      mockChain.order.mockResolvedValue({
        data: mockRecords,
        error: null
      });

      // Act
      const result = await getTestingPipelineRecords('test-set');

      // Assert
      expect(result).toEqual(mockRecords);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('testing_edits_pipeline');
      expect(mockChain.eq).toHaveBeenCalledWith('set_name', 'test-set');
      expect(mockChain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    it('should return empty array when no records found', async () => {
      // Arrange
      mockChain.order.mockResolvedValue({
        data: null,
        error: null
      });

      // Act
      const result = await getTestingPipelineRecords('test-set');

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockError = { message: 'Query failed' };
      mockChain.order.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getTestingPipelineRecords('test-set')).rejects.toEqual(mockError);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
