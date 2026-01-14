/* eslint-disable @typescript-eslint/no-require-imports */
// Import OpenAI shims first
import 'openai/shims/node';

describe('returnExplanation', () => {
  // Mock all dependencies before importing the module
  beforeAll(() => {
    // Mock llms module
    jest.mock('@/lib/services/llms', () => ({
      default_model: 'gpt-4',
      callOpenAIModel: jest.fn()
    }));

    // Mock prompts module
    jest.mock('@/lib/prompts', () => ({
      createExplanationPrompt: jest.fn(),
      createTitlePrompt: jest.fn(),
      editExplanationPrompt: jest.fn(),
      createLinkCandidatesPrompt: jest.fn().mockReturnValue('extract link candidates prompt'),
      createExplanationWithSourcesPrompt: jest.fn()
    }));

    // Mock schemas
    jest.mock('@/lib/schemas/schemas', () => ({
      MatchMode: {
        Normal: 'normal',
        ForceMatch: 'forceMatch',
        ForceNew: 'forceNew'
      },
      UserInputType: {
        Query: 'query',
        TitleFromLink: 'titleFromLink',
        EditWithTags: 'editWithTags',
        RewriteWithTags: 'rewriteWithTags',
        TitleFromRegenerate: 'titleFromRegenerate'
      },
      AnchorSet: {
        Main: 'main'
      },
      explanationBaseSchema: {
        safeParse: jest.fn().mockReturnValue({ success: true, data: {} })
      },
      titleQuerySchema: {
        safeParse: jest.fn().mockReturnValue({
          success: true,
          data: { title1: 'Test Title', title2: 'Alt Title', title3: 'Another Title' }
        })
      },
      linkCandidatesExtractionSchema: {},
      // Required for sentrySanitization.ts
      defaultLogConfig: {
        sensitiveFields: ['password', 'apiKey', 'token', 'secret', 'pass']
      }
    }));

    // Mock vectorsim
    jest.mock('@/lib/services/vectorsim', () => ({
      findMatchesInVectorDb: jest.fn().mockResolvedValue([]),
      maxNumberAnchors: 5,
      calculateAllowedScores: jest.fn().mockResolvedValue({ allowedTitle: true }),
      searchForSimilarVectors: jest.fn().mockResolvedValue([])
    }));

    // Mock findMatches
    jest.mock('@/lib/services/findMatches', () => ({
      findBestMatchFromList: jest.fn().mockResolvedValue({
        selectedIndex: 0,
        explanationId: null,
        topicId: null
      }),
      enhanceMatchesWithCurrentContentAndDiversity: jest.fn().mockResolvedValue([]),
      // filterTestContent is a pure function that filters test content from matches
      filterTestContent: jest.fn().mockImplementation((matches) => matches)
    }));

    // Mock error handling
    jest.mock('@/lib/errorHandling', () => ({
      ERROR_CODES: {
        NO_TITLE_FOR_VECTOR_SEARCH: 'NO_TITLE_FOR_VECTOR_SEARCH',
        QUERY_NOT_ALLOWED: 'QUERY_NOT_ALLOWED',
        SAVE_FAILED: 'SAVE_FAILED',
        INTERNAL_ERROR: 'INTERNAL_ERROR'
      },
      handleError: jest.fn((error, context) => ({
        code: 'INTERNAL_ERROR',
        message: error.message || 'Unknown error',
        context
      })),
      createError: jest.fn((code, message) => ({ code, message })),
      createInputError: jest.fn(message => ({ code: 'INPUT_ERROR', message })),
      createValidationError: jest.fn((message, error) => ({
        code: 'VALIDATION_ERROR',
        message,
        details: error
      }))
    }));

    // Mock logging
    jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
      withLogging: jest.fn(fn => fn),
      withLoggingAndTracing: jest.fn(fn => fn)
    }));

    jest.mock('@/lib/client_utilities', () => ({
      logger: {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn()
      }
    }));

    // Mock links
    jest.mock('@/lib/services/links', () => ({
      cleanupAfterEnhancements: jest.fn(content => content)
    }));

    // Mock linkWhitelist
    jest.mock('@/lib/services/linkWhitelist', () => ({
      generateHeadingStandaloneTitles: jest.fn().mockResolvedValue({}),
      saveHeadingLinks: jest.fn().mockResolvedValue(undefined)
    }));

    // Mock tag evaluation
    jest.mock('@/lib/services/tagEvaluation', () => ({
      evaluateTags: jest.fn().mockResolvedValue({ difficultyLevel: 3, length: 2, simpleTags: [5] })
    }));

    // Mock actions
    jest.mock('@/actions/actions', () => ({
      saveExplanationAndTopic: jest.fn().mockResolvedValue({ error: null, id: 456 }),
      saveUserQuery: jest.fn().mockResolvedValue({ error: null, id: 789 }),
      addTagsToExplanationAction: jest.fn().mockResolvedValue({ error: null })
    }));
  });

  describe('Basic functionality tests', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully run basic test', () => {
      expect(true).toBe(true);
    });

    it('should test generateTitleFromUserQuery', async () => {
      // Import mocked modules
      const { callOpenAIModel } = require('@/lib/services/llms');
      const { createTitlePrompt } = require('@/lib/prompts');
      const { titleQuerySchema } = require('@/lib/schemas/schemas');

      // Setup mocks
      createTitlePrompt.mockReturnValue('Generate titles for: test query');
      callOpenAIModel.mockResolvedValue(JSON.stringify({
        title1: 'Test Title',
        title2: 'Alternative Title',
        title3: 'Another Title'
      }));

      // Import the function dynamically to use mocked dependencies
      const { generateTitleFromUserQuery } = require('./returnExplanation');

      // Test the function
      const result = await generateTitleFromUserQuery('test query', 'user123');

      // Assertions
      expect(result.success).toBe(true);
      expect(result.title).toBe('Test Title');
      expect(result.error).toBeNull();
    });

    it('should test postprocessNewExplanationContent', async () => {
      // Import mocked modules
      const { cleanupAfterEnhancements } = require('@/lib/services/links');
      const { generateHeadingStandaloneTitles } = require('@/lib/services/linkWhitelist');
      const { evaluateTags } = require('@/lib/services/tagEvaluation');
      const { callOpenAIModel } = require('@/lib/services/llms');

      // Setup mocks
      // Headings are no longer embedded - titles are returned separately
      // Key terms are now resolved at render time via linkResolver (not embedded)
      generateHeadingStandaloneTitles.mockResolvedValue({ 'Test': 'Standalone Test Title' });
      evaluateTags.mockResolvedValue({ difficultyLevel: 3 });
      cleanupAfterEnhancements.mockImplementation((c: string) => c);
      // Mock extractLinkCandidates' call to callOpenAIModel
      callOpenAIModel.mockResolvedValue(JSON.stringify({ candidates: ['keyword'] }));

      // Import the function
      const { postprocessNewExplanationContent } = require('./returnExplanation');

      // Test the function
      const result = await postprocessNewExplanationContent(
        '## Test\n\nContent with keyword',
        'Test Title',
        'user123'
      );

      // Assertions
      // Links are now resolved at render time via linkResolver
      // Content should be preserved as-is (only cleaned up with cleanupAfterEnhancements)
      expect(result.enhancedContent).toContain('## Test'); // heading preserved as-is
      expect(result.enhancedContent).not.toContain('[[Test]]'); // no embedded link
      expect(result.enhancedContent).toContain('keyword'); // key term preserved as plain text
      expect(result.headingTitles).toEqual({ 'Test': 'Standalone Test Title' });
      expect(result.tagEvaluation).toEqual({ difficultyLevel: 3 });
      expect(result.error).toBeNull();
    });

    it('should test generateNewExplanation', async () => {
      // Import mocked modules
      const { callOpenAIModel } = require('@/lib/services/llms');
      const { createExplanationPrompt } = require('@/lib/prompts');
      const { cleanupAfterEnhancements } = require('@/lib/services/links');
      const { generateHeadingStandaloneTitles } = require('@/lib/services/linkWhitelist');
      const { evaluateTags } = require('@/lib/services/tagEvaluation');
      const { UserInputType } = require('@/lib/schemas/schemas');

      // Setup mocks
      createExplanationPrompt.mockReturnValue('explanation prompt');
      // First call: generate explanation content, Second call: extractLinkCandidates
      callOpenAIModel
        .mockResolvedValueOnce('Generated content')
        .mockResolvedValueOnce(JSON.stringify({ candidates: [] }));
      generateHeadingStandaloneTitles.mockResolvedValue({ 'Heading': 'Standalone Heading Title' });
      // Key terms are now resolved at render time via linkResolver
      evaluateTags.mockResolvedValue({ difficultyLevel: 3 });
      cleanupAfterEnhancements.mockImplementation((c: string) => c);

      // Import the function
      const { generateNewExplanation } = require('./returnExplanation');

      // Test the function
      const result = await generateNewExplanation(
        'Test Title',
        ['rule1', 'rule2'],
        UserInputType.Query,
        'user123'
      );

      // Assertions
      expect(result.explanationData).toBeDefined();
      expect(result.explanationData.explanation_title).toBe('Test Title');
      expect(result.error).toBeNull();
      expect(result.tagEvaluation).toEqual({ difficultyLevel: 3 });
      expect(result.headingTitles).toEqual({ 'Heading': 'Standalone Heading Title' });
    });

    it('should test applyTagsToExplanation', async () => {
      // Import mocked module
      const { addTagsToExplanationAction } = require('@/actions/actions');

      // Setup mock
      addTagsToExplanationAction.mockResolvedValue({ error: null });

      // Import the function
      const { applyTagsToExplanation } = require('./returnExplanation');

      // Test the function with valid tag evaluation
      await applyTagsToExplanation(
        123,
        { difficultyLevel: 3, length: 2, simpleTags: [5, 8] },
        'user123'
      );

      // Assertions
      expect(addTagsToExplanationAction).toHaveBeenCalledWith(123, [3, 2, 5, 8]);
    });

    it('should handle empty user input in returnExplanationLogic', async () => {
      // Import required modules
      const { MatchMode, UserInputType } = require('@/lib/schemas/schemas');

      // Import the function
      const { returnExplanationLogic } = require('./returnExplanation');

      // Test with empty input
      const result = await returnExplanationLogic(
        '',
        null,
        MatchMode.Normal,
        'user123',
        UserInputType.Query,
        []
      );

      // Assertions
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('INPUT_ERROR');
      expect(result.match_found).toBeNull();
      expect(result.explanationId).toBeNull();
    });

    it('should generate new explanation when no match found', async () => {
      // Import mocked modules
      const { callOpenAIModel } = require('@/lib/services/llms');
      const { createTitlePrompt, createExplanationPrompt } = require('@/lib/prompts');
      const { findMatchesInVectorDb, calculateAllowedScores } = require('@/lib/services/vectorsim');
      const { findBestMatchFromList } = require('@/lib/services/findMatches');
      const { saveExplanationAndTopic, saveUserQuery } = require('@/actions/actions');
      const { MatchMode, UserInputType } = require('@/lib/schemas/schemas');

      // Setup mocks for full flow
      createTitlePrompt.mockReturnValue('title prompt');
      // First call: title generation, Second call: explanation content, Third call: extractLinkCandidates
      callOpenAIModel
        .mockResolvedValueOnce(JSON.stringify({ title1: 'Generated Title' }))
        .mockResolvedValueOnce('Generated content')
        .mockResolvedValueOnce(JSON.stringify({ candidates: [] }));
      findMatchesInVectorDb.mockResolvedValue([]);
      calculateAllowedScores.mockResolvedValue({ allowedTitle: true });
      findBestMatchFromList.mockResolvedValue({
        selectedIndex: 0,
        explanationId: null,
        topicId: null
      });
      saveExplanationAndTopic.mockResolvedValue({ error: null, id: 456 });
      saveUserQuery.mockResolvedValue({ error: null, id: 789 });

      // Import the function
      const { returnExplanationLogic } = require('./returnExplanation');

      // Test the function
      const result = await returnExplanationLogic(
        'What is machine learning?',
        null,
        MatchMode.Normal,
        'user123',
        UserInputType.Query,
        []
      );

      // Assertions
      expect(result.match_found).toBe(false);
      expect(result.error).toBeNull();
      expect(result.explanationId).toBe(456);
      expect(result.userQueryId).toBe(789);
    });
  });
});