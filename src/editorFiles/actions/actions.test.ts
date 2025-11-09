/**
 * Tests for actions.ts (Phase 7E)
 * Tests server actions for AI suggestions pipeline and testing pipeline management
 */

import {
  generateAISuggestionsAction,
  applyAISuggestionsAction,
  saveTestingPipelineStepAction,
  getTestingPipelineRecordsByStepAction,
  updateTestingPipelineRecordSetNameAction,
  runAISuggestionsPipelineAction,
  mergeAISuggestionOutputAction,
  validateAISuggestionOutputAction,
  getAndApplyAISuggestionsAction,
} from './actions';

// Mock dependencies
jest.mock('@/lib/services/llms');
jest.mock('@/lib/errorHandling');
jest.mock('@/lib/logging/server/automaticServerLoggingBase');
jest.mock('@/lib/client_utilities');
jest.mock('../../lib/services/testingPipeline');
jest.mock('../../lib/supabase');

// Mock the aiSuggestion module including functions used by dynamic imports
jest.mock('../../editorFiles/aiSuggestion', () => ({
  aiSuggestionSchema: {},
  createAISuggestionPrompt: jest.fn(),
  createApplyEditsPrompt: jest.fn(),
  mergeAISuggestionOutput: jest.fn(),
  validateAISuggestionOutput: jest.fn(),
  getAndApplyAISuggestions: jest.fn(),
}));

// Import mocked modules
import { callOpenAIModel } from '@/lib/services/llms';
import { handleError } from '@/lib/errorHandling';
import { logger } from '@/lib/client_utilities';
import {
  createAISuggestionPrompt,
  createApplyEditsPrompt,
  aiSuggestionSchema,
  mergeAISuggestionOutput,
  validateAISuggestionOutput,
  getAndApplyAISuggestions,
} from '../../editorFiles/aiSuggestion';
import {
  checkAndSaveTestingPipelineRecord,
  updateTestingPipelineRecordSetName,
} from '../../lib/services/testingPipeline';
import { supabase } from '../../lib/supabase';

// Mock withLogging to return the original function
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

// ============= generateAISuggestionsAction Tests =============

describe('generateAISuggestionsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully generate AI suggestions with valid text', async () => {
    const mockPrompt = 'Test prompt for improvement';
    const mockResponse = JSON.stringify({ edits: ['Improved text', '... existing text ...'] });

    (createAISuggestionPrompt as jest.Mock).mockReturnValue(mockPrompt);
    (callOpenAIModel as jest.Mock).mockResolvedValue(mockResponse);

    const result = await generateAISuggestionsAction('Original text', 'user-123');

    expect(createAISuggestionPrompt).toHaveBeenCalledWith('Original text');
    expect(callOpenAIModel).toHaveBeenCalledWith(
      mockPrompt,
      'editor_ai_suggestions',
      'user-123',
      expect.anything(), // default_model
      false,
      null,
      aiSuggestionSchema,
      'aiSuggestion'
    );
    expect(result).toEqual({
      success: true,
      data: mockResponse,
      error: null,
    });
  });

  it('should handle OpenAI API errors gracefully', async () => {
    const mockError = new Error('OpenAI API rate limit exceeded');
    const mockErrorResponse = { message: 'API Error', code: 'RATE_LIMIT' };

    (createAISuggestionPrompt as jest.Mock).mockReturnValue('Test prompt');
    (callOpenAIModel as jest.Mock).mockRejectedValue(mockError);
    (handleError as jest.Mock).mockReturnValue(mockErrorResponse);

    const result = await generateAISuggestionsAction('Test text', 'user-123');

    expect(result).toEqual({
      success: false,
      data: null,
      error: mockErrorResponse,
    });
    expect(handleError).toHaveBeenCalledWith(
      mockError,
      'generateAISuggestionsAction',
      { textLength: 9 }
    );
  });

  it('should return proper error structure on failure', async () => {
    const mockError = new Error('Network error');
    const mockErrorResponse = { message: 'Network error', code: 'NETWORK_ERROR' };

    (createAISuggestionPrompt as jest.Mock).mockReturnValue('Test prompt');
    (callOpenAIModel as jest.Mock).mockRejectedValue(mockError);
    (handleError as jest.Mock).mockReturnValue(mockErrorResponse);

    const result = await generateAISuggestionsAction('Test', 'user-123');

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toEqual(mockErrorResponse);
  });

  it('should log debug information during execution', async () => {
    const mockPrompt = 'Test prompt';
    const mockResponse = '{"edits": ["test"]}';

    (createAISuggestionPrompt as jest.Mock).mockReturnValue(mockPrompt);
    (callOpenAIModel as jest.Mock).mockResolvedValue(mockResponse);

    await generateAISuggestionsAction('Test text', 'user-123');

    expect(logger.debug).toHaveBeenCalledWith(
      'AI Suggestion Request',
      expect.objectContaining({
        textLength: 9,
        promptLength: expect.any(Number),
        userid: 'user-123',
      }),
      true
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'AI Suggestion Response',
      expect.objectContaining({
        responseLength: expect.any(Number),
        response: mockResponse,
      }),
      true
    );
  });
});

// ============= applyAISuggestionsAction Tests =============

describe('applyAISuggestionsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully apply suggestions to content', async () => {
    const mockPrompt = 'Apply these edits prompt';
    const mockResponse = 'Final edited text with all changes applied';

    (createApplyEditsPrompt as jest.Mock).mockReturnValue(mockPrompt);
    (callOpenAIModel as jest.Mock).mockResolvedValue(mockResponse);

    const result = await applyAISuggestionsAction(
      '{"edits": ["Edit 1"]}',
      'Original content',
      'user-123'
    );

    expect(createApplyEditsPrompt).toHaveBeenCalledWith(
      '{"edits": ["Edit 1"]}',
      'Original content'
    );
    expect(callOpenAIModel).toHaveBeenCalledWith(
      mockPrompt,
      'editor_apply_suggestions',
      'user-123',
      expect.anything(), // lighter_model
      false,
      null
    );
    expect(result).toEqual({
      success: true,
      data: mockResponse,
      error: null,
    });
  });

  it('should handle empty suggestions array', async () => {
    const mockPrompt = 'Apply prompt';
    const mockResponse = 'Original content unchanged';

    (createApplyEditsPrompt as jest.Mock).mockReturnValue(mockPrompt);
    (callOpenAIModel as jest.Mock).mockResolvedValue(mockResponse);

    const result = await applyAISuggestionsAction('{}', 'Original content', 'user-123');

    expect(result.success).toBe(true);
    expect(result.data).toBe(mockResponse);
  });

  it('should return proper error structure on API failure', async () => {
    const mockError = new Error('API timeout');
    const mockErrorResponse = { message: 'Timeout error', code: 'TIMEOUT' };

    (createApplyEditsPrompt as jest.Mock).mockReturnValue('Test prompt');
    (callOpenAIModel as jest.Mock).mockRejectedValue(mockError);
    (handleError as jest.Mock).mockReturnValue(mockErrorResponse);

    const result = await applyAISuggestionsAction('suggestions', 'content', 'user-123');

    expect(result).toEqual({
      success: false,
      data: null,
      error: mockErrorResponse,
    });
    expect(handleError).toHaveBeenCalledWith(
      mockError,
      'applyAISuggestionsAction',
      {
        suggestionsLength: 11,
        originalContentLength: 7,
      }
    );
  });

  it('should log error on failure', async () => {
    const mockError = new Error('Test error');

    (createApplyEditsPrompt as jest.Mock).mockReturnValue('Test prompt');
    (callOpenAIModel as jest.Mock).mockRejectedValue(mockError);
    (handleError as jest.Mock).mockReturnValue({});

    await applyAISuggestionsAction('suggestions', 'content', 'user-123');

    expect(logger.error).toHaveBeenCalledWith(
      'Apply AI Suggestions Error',
      expect.objectContaining({
        error: 'Test error',
      })
    );
  });
});

// ============= saveTestingPipelineStepAction Tests =============

describe('saveTestingPipelineStepAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should save new record when no duplicate exists', async () => {
    const mockResult = {
      saved: true,
      record: { id: 123, name: 'test-set', step: 'step1', content: 'content', created_at: '2024-01-01' },
    };

    (checkAndSaveTestingPipelineRecord as jest.Mock).mockResolvedValue(mockResult);

    const result = await saveTestingPipelineStepAction('test-set', 'step1', 'content');

    expect(checkAndSaveTestingPipelineRecord).toHaveBeenCalledWith('test-set', 'step1', 'content');
    expect(result).toEqual({
      success: true,
      data: {
        saved: true,
        recordId: 123,
      },
      error: null,
    });
  });

  it('should skip save when exact duplicate exists', async () => {
    const mockResult = {
      saved: false,
      record: null,
    };

    (checkAndSaveTestingPipelineRecord as jest.Mock).mockResolvedValue(mockResult);

    const result = await saveTestingPipelineStepAction('test-set', 'step1', 'duplicate content');

    expect(result).toEqual({
      success: true,
      data: {
        saved: false,
        recordId: undefined,
      },
      error: null,
    });
  });

  it('should handle database errors gracefully', async () => {
    const mockError = new Error('Database connection failed');
    const mockErrorResponse = { message: 'DB Error', code: 'DB_ERROR' };

    (checkAndSaveTestingPipelineRecord as jest.Mock).mockRejectedValue(mockError);
    (handleError as jest.Mock).mockReturnValue(mockErrorResponse);

    const result = await saveTestingPipelineStepAction('test-set', 'step1', 'content');

    expect(result).toEqual({
      success: false,
      data: null,
      error: mockErrorResponse,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Save Testing Pipeline Step Error',
      expect.objectContaining({
        error: 'Database connection failed',
        setName: 'test-set',
        step: 'step1',
        contentLength: 7,
      })
    );
  });
});

// ============= getTestingPipelineRecordsByStepAction Tests =============

describe('getTestingPipelineRecordsByStepAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return records ordered by created_at DESC', async () => {
    const mockData = [
      { id: 2, name: 'set-2', content: 'content-2', created_at: '2024-01-02' },
      { id: 1, name: 'set-1', content: 'content-1', created_at: '2024-01-01' },
    ];

    const mockSupabaseChain = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: mockData, error: null }),
    };

    (supabase as unknown as jest.Mock) = mockSupabaseChain as never;

    const result = await getTestingPipelineRecordsByStepAction('step1');

    expect(result).toEqual({
      success: true,
      data: mockData,
      error: null,
    });
  });

  it('should return empty array when no records exist', async () => {
    const mockSupabaseChain = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    (supabase as unknown as jest.Mock) = mockSupabaseChain as never;

    const result = await getTestingPipelineRecordsByStepAction('nonexistent-step');

    expect(result).toEqual({
      success: true,
      data: [],
      error: null,
    });
  });

  it('should handle database errors gracefully', async () => {
    const mockError = { message: 'Query failed', code: 'QUERY_ERROR' };
    const mockErrorResponse = { message: 'DB Error', code: 'DB_ERROR' };

    const mockSupabaseChain = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: null, error: mockError }),
    };

    (supabase as unknown as jest.Mock) = mockSupabaseChain as never;
    (handleError as jest.Mock).mockReturnValue(mockErrorResponse);

    const result = await getTestingPipelineRecordsByStepAction('step1');

    expect(result).toEqual({
      success: false,
      data: null,
      error: mockErrorResponse,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Supabase error fetching testing pipeline records by step:',
      expect.objectContaining({
        error: 'Query failed',
        errorCode: 'QUERY_ERROR',
        step: 'step1',
      })
    );
  });
});

// ============= updateTestingPipelineRecordSetNameAction Tests =============

describe('updateTestingPipelineRecordSetNameAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should update record name successfully', async () => {
    const mockUpdatedRecord = {
      id: 123,
      name: 'new-name',
      step: 'step1',
      content: 'content',
      created_at: '2024-01-01',
    };

    (updateTestingPipelineRecordSetName as jest.Mock).mockResolvedValue(mockUpdatedRecord);

    const result = await updateTestingPipelineRecordSetNameAction(123, 'new-name');

    expect(updateTestingPipelineRecordSetName).toHaveBeenCalledWith(123, 'new-name');
    expect(result).toEqual({
      success: true,
      data: mockUpdatedRecord,
      error: null,
    });
  });

  it('should handle non-existent record ID error', async () => {
    const mockError = new Error('Record not found');
    const mockErrorResponse = { message: 'Not found', code: 'NOT_FOUND' };

    (updateTestingPipelineRecordSetName as jest.Mock).mockRejectedValue(mockError);
    (handleError as jest.Mock).mockReturnValue(mockErrorResponse);

    const result = await updateTestingPipelineRecordSetNameAction(999, 'new-name');

    expect(result).toEqual({
      success: false,
      data: null,
      error: mockErrorResponse,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Update Testing Pipeline Record Set Name Error',
      expect.objectContaining({
        error: 'Record not found',
        recordId: 999,
        newSetName: 'new-name',
      })
    );
  });
});

// ============= runAISuggestionsPipelineAction Tests =============

describe('runAISuggestionsPipelineAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should run complete pipeline with session data', async () => {
    const mockResult = {
      success: true,
      content: 'Edited content',
      session_id: 'session-123',
    };
    (getAndApplyAISuggestions as jest.Mock).mockResolvedValue(mockResult);

    const sessionData = {
      explanation_id: 456,
      explanation_title: 'Test Explanation',
    };

    const result = await runAISuggestionsPipelineAction(
      'Original content',
      'Make it better',
      sessionData
    );

    expect(getAndApplyAISuggestions).toHaveBeenCalledWith(
      'Original content',
      null,
      undefined,
      {
        explanation_id: 456,
        explanation_title: 'Test Explanation',
        user_prompt: 'Make it better',
      }
    );
    expect(result).toEqual(mockResult);
  });

  it('should handle missing session data', async () => {
    const mockResult = {
      success: true,
      content: 'Edited content',
    };
    (getAndApplyAISuggestions as jest.Mock).mockResolvedValue(mockResult);

    const result = await runAISuggestionsPipelineAction('Content', 'Prompt');

    expect(getAndApplyAISuggestions).toHaveBeenCalledWith(
      'Content',
      null,
      undefined,
      undefined
    );
    expect(result).toEqual(mockResult);
  });

  it('should return original content on failure', async () => {
    const mockError = new Error('Pipeline failed');
    (getAndApplyAISuggestions as jest.Mock).mockRejectedValue(mockError);

    const result = await runAISuggestionsPipelineAction(
      'Original content',
      'Test prompt'
    );

    expect(result).toEqual({
      success: false,
      error: 'Pipeline failed',
      content: 'Original content',
    });
  });

  it('should trim user prompt before processing', async () => {
    (getAndApplyAISuggestions as jest.Mock).mockResolvedValue({ success: true, content: '' });

    await runAISuggestionsPipelineAction(
      'Content',
      '  Prompt with spaces  '
    );

    expect(getAndApplyAISuggestions).toHaveBeenCalledWith(
      'Content',
      null,
      undefined,
      undefined
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('runAISuggestionsPipelineAction'),
      expect.objectContaining({
        userPrompt: 'Prompt with spaces',
      }),
      true
    );
  });
});

// ============= mergeAISuggestionOutputAction Tests =============

describe('mergeAISuggestionOutputAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should merge edits array into string', async () => {
    const mockOutput = 'Edit 1... existing text ...Edit 2';
    (mergeAISuggestionOutput as jest.Mock).mockReturnValue(mockOutput);

    const result = await mergeAISuggestionOutputAction(['Edit 1', '... existing text ...', 'Edit 2']);

    expect(mergeAISuggestionOutput).toHaveBeenCalledWith({ edits: ['Edit 1', '... existing text ...', 'Edit 2'] });
    expect(result).toEqual({
      success: true,
      data: mockOutput,
      error: null,
    });
  });

  it('should handle empty edits array', async () => {
    (mergeAISuggestionOutput as jest.Mock).mockReturnValue('');

    const result = await mergeAISuggestionOutputAction([]);

    expect(result).toEqual({
      success: true,
      data: '',
      error: null,
    });
  });

  it('should handle errors with proper error response', async () => {
    const mockError = new Error('Merge failed');
    const mockErrorResponse = { message: 'Merge error', code: 'MERGE_ERROR' };

    (mergeAISuggestionOutput as jest.Mock).mockImplementation(() => {
      throw mockError;
    });
    (handleError as jest.Mock).mockReturnValue(mockErrorResponse);

    const result = await mergeAISuggestionOutputAction(['Edit']);

    expect(result).toEqual({
      success: false,
      data: null,
      error: mockErrorResponse,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'mergeAISuggestionOutputAction Error',
      expect.objectContaining({
        error: 'Merge failed',
        editsCount: 1,
      })
    );
  });
});

// ============= validateAISuggestionOutputAction Tests =============

describe('validateAISuggestionOutputAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should validate correct schema format', async () => {
    const mockResult = {
      success: true,
      data: { edits: ['Content'] },
    };
    (validateAISuggestionOutput as jest.Mock).mockReturnValue(mockResult);

    const result = await validateAISuggestionOutputAction('{"edits": ["Content"]}');

    expect(validateAISuggestionOutput).toHaveBeenCalledWith('{"edits": ["Content"]}');
    expect(result).toEqual({
      success: true,
      data: mockResult,
      error: null,
    });
  });

  it('should return error for invalid JSON/schema', async () => {
    const mockResult = {
      success: false,
      error: { issues: ['Invalid schema'] },
    };
    (validateAISuggestionOutput as jest.Mock).mockReturnValue(mockResult);

    const result = await validateAISuggestionOutputAction('invalid json');

    expect(result).toEqual({
      success: true,
      data: mockResult,
      error: null,
    });
  });

  it('should handle validation errors with proper error response', async () => {
    const mockError = new Error('Validation crashed');
    const mockErrorResponse = { message: 'Validation error', code: 'VALIDATION_ERROR' };

    (validateAISuggestionOutput as jest.Mock).mockImplementation(() => {
      throw mockError;
    });
    (handleError as jest.Mock).mockReturnValue(mockErrorResponse);

    const result = await validateAISuggestionOutputAction('test');

    expect(result).toEqual({
      success: false,
      data: null,
      error: mockErrorResponse,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'validateAISuggestionOutputAction Error',
      expect.objectContaining({
        error: 'Validation crashed',
        rawOutputLength: 4,
      })
    );
  });
});

// ============= getAndApplyAISuggestionsAction Tests =============

describe('getAndApplyAISuggestionsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should run pipeline with progress callback', async () => {
    const mockResult = {
      success: true,
      content: 'Final content',
      session_id: 'sess-456',
    };
    (getAndApplyAISuggestions as jest.Mock).mockResolvedValue(mockResult);

    const result = await getAndApplyAISuggestionsAction(
      'Original content',
      true,
      {
        explanation_id: 1,
        explanation_title: 'Test',
        user_prompt: 'Improve this',
      }
    );

    expect(getAndApplyAISuggestions).toHaveBeenCalledWith(
      'Original content',
      null,
      expect.any(Function),
      {
        explanation_id: 1,
        explanation_title: 'Test',
        user_prompt: 'Improve this',
      }
    );
    expect(result).toEqual(mockResult);
  });

  it('should handle missing session data', async () => {
    const mockResult = {
      success: true,
      content: 'Content',
    };
    (getAndApplyAISuggestions as jest.Mock).mockResolvedValue(mockResult);

    const result = await getAndApplyAISuggestionsAction('Content', false);

    expect(getAndApplyAISuggestions).toHaveBeenCalledWith(
      'Content',
      null,
      undefined,
      undefined
    );
    expect(result).toEqual(mockResult);
  });

  it('should return original content on error', async () => {
    const mockError = new Error('Pipeline error');
    (getAndApplyAISuggestions as jest.Mock).mockRejectedValue(mockError);

    const result = await getAndApplyAISuggestionsAction('Original', false);

    expect(result).toEqual({
      success: false,
      error: 'Pipeline error',
      content: 'Original',
    });
  });

  it('should log progress when callback enabled', async () => {
    (getAndApplyAISuggestions as jest.Mock).mockImplementation(async (content, ref, onProgress) => {
      if (onProgress) {
        onProgress('step1', 50);
      }
      return { success: true, content };
    });

    await getAndApplyAISuggestionsAction('Content', true);

    expect(logger.debug).toHaveBeenCalledWith(
      'Pipeline progress: step1 (50%)',
      {},
      true
    );
  });
});
