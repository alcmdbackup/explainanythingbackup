/**
 * @jest-environment jsdom
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
import { supabase } from '../supabase';
import { logger } from '../client_utilities';

// Mock dependencies
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn()
  }
}));
jest.mock('../client_utilities', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  }
}));

type MockSupabaseClient = {
  select: jest.Mock;
  eq: jest.Mock;
  limit: jest.Mock;
  insert: jest.Mock;
  single: jest.Mock;
  update: jest.Mock;
  order: jest.Mock;
};

describe('TestingPipeline Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console.log to avoid clutter
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Create mock Supabase client
    mockSupabase = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
    };

    (supabase.from as jest.Mock).mockReturnValue(mockSupabase);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkTestingPipelineExists', () => {
    it('should return true when record exists', async () => {
      // Arrange
      mockSupabase.limit.mockResolvedValue({
        data: [{ id: 1 }],
        error: null
      });

      // Act
      const result = await checkTestingPipelineExists('test-set', 'step1', 'content');

      // Assert
      expect(result).toBe(true);
      expect(supabase.from).toHaveBeenCalledWith('testing_edits_pipeline');
      expect(mockSupabase.eq).toHaveBeenCalledWith('set_name', 'test-set');
      expect(mockSupabase.eq).toHaveBeenCalledWith('step', 'step1');
      expect(mockSupabase.eq).toHaveBeenCalledWith('content', 'content');
      expect(mockSupabase.limit).toHaveBeenCalledWith(1);
    });

    it('should return false when record does not exist', async () => {
      // Arrange
      mockSupabase.limit.mockResolvedValue({
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
      mockSupabase.limit.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(checkTestingPipelineExists('test-set', 'step1', 'content')).rejects.toEqual(mockError);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log debug information', async () => {
      // Arrange
      mockSupabase.limit.mockResolvedValue({
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

      mockSupabase.single.mockResolvedValue({
        data: savedRecord,
        error: null
      });

      // Act
      const result = await saveTestingPipelineRecord(recordData);

      // Assert
      expect(result).toEqual(savedRecord);
      expect(supabase.from).toHaveBeenCalledWith('testing_edits_pipeline');
      expect(mockSupabase.insert).toHaveBeenCalledWith({
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

      mockSupabase.single.mockResolvedValue({
        data: { id: 1, ...recordData },
        error: null
      });

      // Act
      await saveTestingPipelineRecord(recordData);

      // Assert
      expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
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
      mockSupabase.single.mockResolvedValue({
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
      mockSupabase.limit.mockResolvedValue({
        data: [{ id: 1 }],
        error: null
      });

      // Act
      const result = await checkAndSaveTestingPipelineRecord('test-set', 'step1', 'content');

      // Assert
      expect(result).toEqual({ saved: false });
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });

    it('should save and return record when it does not exist', async () => {
      // Arrange
      mockSupabase.limit.mockResolvedValue({
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

      mockSupabase.single.mockResolvedValue({
        data: savedRecord,
        error: null
      });

      // Act
      const result = await checkAndSaveTestingPipelineRecord('test-set', 'step1', 'content');

      // Assert
      expect(result).toEqual({ saved: true, record: savedRecord });
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should include session data when provided', async () => {
      // Arrange
      mockSupabase.limit.mockResolvedValue({
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

      mockSupabase.single.mockResolvedValue({
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
      expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'session123'
      }));
    });

    it('should throw error when check or save fails', async () => {
      // Arrange
      const mockError = { message: 'Error' };
      mockSupabase.limit.mockResolvedValue({
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

      mockSupabase.single.mockResolvedValue({
        data: updatedRecord,
        error: null
      });

      // Act
      const result = await updateTestingPipelineRecordSetName(1, 'new-name');

      // Assert
      expect(result).toEqual(updatedRecord);
      expect(supabase.from).toHaveBeenCalledWith('testing_edits_pipeline');
      expect(mockSupabase.update).toHaveBeenCalledWith({ set_name: 'new-name' });
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw error when update fails', async () => {
      // Arrange
      const mockError = { message: 'Update failed', code: '500' };
      mockSupabase.single.mockResolvedValue({
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

      mockSupabase.order.mockResolvedValue({
        data: mockRecords,
        error: null
      });

      // Act
      const result = await getTestingPipelineRecords('test-set');

      // Assert
      expect(result).toEqual(mockRecords);
      expect(supabase.from).toHaveBeenCalledWith('testing_edits_pipeline');
      expect(mockSupabase.eq).toHaveBeenCalledWith('set_name', 'test-set');
      expect(mockSupabase.order).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    it('should return empty array when no records found', async () => {
      // Arrange
      mockSupabase.order.mockResolvedValue({
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
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: mockError
      });

      // Act & Assert
      await expect(getTestingPipelineRecords('test-set')).rejects.toEqual(mockError);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
