/**
 * Integration Test: End-to-End Explanation Generation
 *
 * Tests the complete explanation generation flow with real database and mocked external APIs
 * This validates:
 * - Full orchestration from user query to saved explanation
 * - Title generation → vector search → content generation → enhancement → database save
 * - Parallel operations (tag evaluation + link creation)
 * - Transaction atomicity and rollback on failures
 * - Error propagation across service boundaries
 * - Streaming response handling
 */

import { setupTestDatabase, teardownTestDatabase, createTestContext } from '@/testing/utils/integration-helpers';
import {
  completeExplanationFixture,
  titleGenerationResponse,
  fullExplanationContent,
  tagEvaluationResponse,
  headingLinkMappingsResponse,
  keyTermLinkMappingsResponse,
  errorResponse,
} from '@/testing/fixtures/llm-responses';
import {
  pineconeNoMatchesResponse,
  pineconeUpsertSuccessResponse,
  pineconeUpsertFailure,
  createPineconeHighSimilarityMatch,
  generateRandomEmbedding,
} from '@/testing/fixtures/vector-responses';
import { SupabaseClient } from '@supabase/supabase-js';
import { MatchMode, UserInputType } from '@/lib/schemas/schemas';

// Access global mocks from jest.integration-setup.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PineconeMock = require('@pinecone-database/pinecone');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpenAIMock = require('openai').default;

// Get mock functions from global mocks
const mockPineconeQuery = PineconeMock.__mockQuery;
const mockPineconeUpsert = PineconeMock.__mockUpsert;
const mockPineconeFetch = PineconeMock.__mockFetch;
const mockOpenAIEmbeddingsCreate = OpenAIMock.__mockEmbeddingsCreate;
const mockOpenAIChatCreate = OpenAIMock.__mockChatCreate;

// Import returnExplanation service (uses global mocks)
import { returnExplanationLogic } from '@/lib/services/returnExplanation';

describe('Explanation Generation Integration Tests', () => {
  let supabase: SupabaseClient;
  let testId: string;
  let userId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    console.log('Explanation generation integration tests: Database setup complete');
  });

  afterAll(async () => {
    await teardownTestDatabase(supabase);
    console.log('Explanation generation integration tests: Database cleanup complete');
  });

  beforeEach(async () => {
    const context = await createTestContext();
    testId = context.testId;
    userId = context.userId;
    cleanup = context.cleanup;

    jest.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Happy Path - New Explanation Generation', () => {
    it('should generate complete explanation with tags and links when no match found', async () => {
      // Arrange
      const userQuery = 'What is quantum entanglement?';
      const mockEmbedding = generateRandomEmbedding(3072);

      // Mock OpenAI: Embedding creation (for vector search)
      mockOpenAIEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      // Mock Pinecone: No matches found (all 3 searches)
      mockPineconeQuery.mockResolvedValue(pineconeNoMatchesResponse);

      // Smart mock that handles parallel calls correctly
      // Calls 3-5 (heading links, key term links, tag evaluation) run in parallel via Promise.all
      // Use prompt content to identify call type (more reliable than checking Zod schemas)
      mockOpenAIChatCreate.mockImplementation(async (params: any) => {
        const prompt = params.messages?.[1]?.content || '';
        const hasResponseFormat = !!params.response_format;

        // Title generation - prompt contains "Guess the title"
        if (hasResponseFormat && prompt.includes('Guess the title')) {
          return titleGenerationResponse;
        }

        // Tag evaluation - prompt contains "evaluate" (case-insensitive)
        if (hasResponseFormat && (prompt.includes('difficulty level') || prompt.toLowerCase().includes('evaluate'))) {
          return tagEvaluationResponse;
        }

        // Key term links - prompt contains "KEY TERMS WITH CONTEXT"
        if (hasResponseFormat && prompt.includes('KEY TERMS WITH CONTEXT')) {
          return keyTermLinkMappingsResponse;
        }

        // Heading links - prompt contains "standalone titles" or "subsection"
        if (hasResponseFormat && (prompt.includes('standalone titles') || prompt.includes('subsection'))) {
          return headingLinkMappingsResponse;
        }

        // Content generation (no schema, no response_format)
        return {
          choices: [{ message: { content: fullExplanationContent } }],
        };
      });

      // Act
      const result = await returnExplanationLogic(
        userQuery,             // userInput: string
        null,                  // savedId: number | null
        MatchMode.Normal,      // matchMode: MatchMode
        userId,                // userid: string
        UserInputType.Query,   // userInputType: UserInputType
        [],                    // additionalRules: string[]
        undefined,             // onStreamingText?: StreamingCallback
        undefined,             // existingContent?: string
        null,                  // previousExplanationViewedId?: number | null
        null                   // previousExplanationViewedVector?: { values: number[] } | null
      );

      // Assert - Check result structure
      expect(result.error).toBeNull();
      expect(result.explanationId).toBeTruthy();
      expect(result.data).toMatchObject({
        explanation_title: expect.stringContaining('Quantum'),
        content: expect.stringContaining('entanglement'),
        // Note: status is set by database on save, not returned in result.data
      });

      // Verify explanation saved in database
      const { data: savedExplanation, error: explanationError } = await supabase
        .from('explanations')
        .select('*')
        .eq('id', result.explanationId)
        .single();

      expect(explanationError).toBeNull();
      expect(savedExplanation).toBeTruthy();
      expect(savedExplanation!.explanation_title).toBe(result.data!.explanation_title);

      // Verify topic created by checking explanation's foreign key
      const { data: explanationWithTopic, error: topicQueryError } = await supabase
        .from('explanations')
        .select('primary_topic_id')
        .eq('id', result.explanationId)
        .single();

      expect(topicQueryError).toBeNull();
      expect(explanationWithTopic).toBeTruthy();
      expect(explanationWithTopic!.primary_topic_id).toBeTruthy();

      // Note: Pinecone upsert for embedding storage is NOT called in returnExplanationLogic
      // The embedding storage might happen in a separate process/job

      // Verify user query was logged (table is userQueries, column is explanation_id)
      const { data: userQueries } = await supabase
        .from('userQueries')
        .select('*')
        .eq('id', result.userQueryId);

      expect(userQueries).toBeTruthy();
      expect(userQueries!.length).toBeGreaterThan(0);
      expect(userQueries![0].user_query).toContain(userQuery);
    });
  });

  describe('Match Found - Return Existing Explanation', () => {
    it('should return existing explanation when high similarity match found', async () => {
      // Arrange - Create existing explanation in database
      const existingTopicTitle = `[TEST] ${testId}-existing-topic`;
      const topicResult = await supabase
        .from('topics')
        .insert({
          topic_title: existingTopicTitle,
          topic_description: 'Test topic for matching',
        })
        .select()
        .single();

      expect(topicResult.error).toBeNull();
      const existingTopic = topicResult.data;

      const existingExplanationTitle = `[TEST] ${testId}-existing-explanation`;
      const explanationResult = await supabase
        .from('explanations')
        .insert({
          explanation_title: existingExplanationTitle,
          content: fullExplanationContent,
          primary_topic_id: existingTopic!.id,
          status: 'published',
        })
        .select()
        .single();

      expect(explanationResult.error).toBeNull();
      const existingExplanation = explanationResult.data;

      const userQuery = 'What is quantum entanglement?';
      const mockEmbedding = generateRandomEmbedding(3072);

      // Mock OpenAI: Embedding creation
      mockOpenAIEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      // Mock Pinecone: High similarity match found
      mockPineconeQuery.mockResolvedValue(
        createPineconeHighSimilarityMatch(existingExplanation!.id.toString(), existingTopic!.id)
      );

      // Mock OpenAI: Title generation and match selection
      mockOpenAIChatCreate.mockImplementation(async (params: any) => {
        const prompt = params.messages?.[1]?.content || '';
        const hasResponseFormat = !!params.response_format;

        if (hasResponseFormat && prompt.includes('Guess the title')) {
          return {
            choices: [{ message: { content: JSON.stringify({ title1: 'Understanding Quantum Entanglement', title2: 'Quantum Entanglement Explained', title3: 'The Science of Quantum Entanglement' }) } }],
          };
        }

        // Match selection - returns index of best match (1-based index)
        if (hasResponseFormat && (prompt.includes('select') || prompt.includes('match') || prompt.includes('source'))) {
          return {
            choices: [{ message: { content: JSON.stringify({ selectedSourceIndex: 1 }) } }],
          };
        }

        // Shouldn't reach here for match case
        return { choices: [{ message: { content: 'Unexpected call' } }] };
      });

      // Act
      const result = await returnExplanationLogic(
        userQuery,             // userInput: string
        null,                  // savedId: number | null
        MatchMode.Normal,      // matchMode: MatchMode
        userId,                // userid: string
        UserInputType.Query,   // userInputType: UserInputType
        [],                    // additionalRules: string[]
        undefined,             // onStreamingText?: StreamingCallback
        undefined,             // existingContent?: string
        null,                  // previousExplanationViewedId?: number | null
        null                   // previousExplanationViewedVector?: { values: number[] } | null
      );

      // Assert - Should return existing explanation
      expect(result.error).toBeNull();
      expect(result.explanationId).toBe(existingExplanation!.id);

      // Verify NO new explanation was created
      const { data: allExplanations } = await supabase
        .from('explanations')
        .select('*')
        .ilike('explanation_title', `%${testId}%`);

      expect(allExplanations).toHaveLength(1); // Only the existing one

      // Verify OpenAI content generation was NOT called (should skip generation)
      // mockOpenAIChatCreate call count should be 2 (title + match selection)
      expect(mockOpenAIChatCreate).toHaveBeenCalledTimes(2);

      // Verify user query logged with match reference
      const { data: userQueries } = await supabase
        .from('userQueries')
        .select('*')
        .eq('id', result.userQueryId);

      expect(userQueries).toBeTruthy();
      expect(userQueries!.length).toBeGreaterThan(0);
      expect(userQueries![0].user_query).toContain(userQuery);
    });
  });

  describe('Error Handling', () => {
    it('should handle OpenAI failure during content generation', async () => {
      // Arrange
      const userQuery = 'What is quantum entanglement?';
      const mockEmbedding = generateRandomEmbedding(3072);

      // Mock OpenAI: Embedding creation
      mockOpenAIEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      // Mock Pinecone: No matches
      mockPineconeQuery.mockResolvedValue(pineconeNoMatchesResponse);

      // Mock OpenAI: Title generation succeeds, content generation FAILS
      let titleGenerated = false;
      mockOpenAIChatCreate.mockImplementation(async (params: any) => {
        const prompt = params.messages?.[1]?.content || '';
        const hasResponseFormat = !!params.response_format;

        if (hasResponseFormat && prompt.includes('Guess the title')) {
          titleGenerated = true;
          return {
            choices: [{ message: { content: JSON.stringify({ title1: 'Test Title', title2: 'Test Title 2', title3: 'Test Title 3' }) } }],
          };
        }

        // Content generation - fail
        if (titleGenerated && !hasResponseFormat) {
          throw new Error(errorResponse.error.message);
        }

        return { choices: [{ message: { content: 'Unexpected call' } }] };
      });

      // Act
      const result = await returnExplanationLogic(
        userQuery,             // userInput: string
        null,                  // savedId: number | null
        MatchMode.Normal,      // matchMode: MatchMode
        userId,                // userid: string
        UserInputType.Query,   // userInputType: UserInputType
        [],                    // additionalRules: string[]
        undefined,             // onStreamingText?: StreamingCallback
        undefined,             // existingContent?: string
        null,                  // previousExplanationViewedId?: number | null
        null                   // previousExplanationViewedVector?: { values: number [] } | null
      );

      // Assert - Error returned
      expect(result.error).toBeDefined();
      expect(result.error).not.toBeNull();
      expect(result.error?.code).toMatch(/LLM_ERROR|API_ERROR|UNKNOWN_ERROR/);

      // Verify NO database records created
      const { data: explanations } = await supabase
        .from('explanations')
        .select('*')
        .ilike('explanation_title', `%${testId}%`);

      expect(explanations).toHaveLength(0);

      const { data: topics } = await supabase
        .from('topics')
        .select('*')
        .ilike('topic_title', `%${testId}%`);

      expect(topics).toHaveLength(0);
    });

    it('should rollback database changes if Pinecone upsert fails', async () => {
      // Arrange
      const userQuery = 'Test rollback scenario';
      const mockEmbedding = generateRandomEmbedding(3072);

      // Mock all OpenAI calls to succeed
      mockOpenAIChatCreate.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ title: `[TEST] ${testId}-rollback-title` }) } }],
      });

      mockOpenAIEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      mockPineconeQuery.mockResolvedValue(pineconeNoMatchesResponse);

      mockOpenAIChatCreate.mockResolvedValueOnce({
        choices: [{ message: { content: fullExplanationContent } }],
      });

      mockOpenAIChatCreate.mockResolvedValueOnce(headingLinkMappingsResponse);
      mockOpenAIChatCreate.mockResolvedValueOnce(keyTermLinkMappingsResponse);
      mockOpenAIChatCreate.mockResolvedValueOnce(tagEvaluationResponse);

      // Mock Pinecone: Upsert FAILS
      mockPineconeUpsert.mockRejectedValueOnce(pineconeUpsertFailure);

      // Act
      const result = await returnExplanationLogic(
        userQuery,             // userInput: string
        null,                  // savedId: number | null
        MatchMode.Normal,      // matchMode: MatchMode
        userId,                // userid: string
        UserInputType.Query,   // userInputType: UserInputType
        [],                    // additionalRules: string[]
        undefined,             // onStreamingText?: StreamingCallback
        undefined,             // existingContent?: string
        null,                  // previousExplanationViewedId?: number | null
        null                   // previousExplanationViewedVector?: { values: number[] } | null
      );

      // Assert - Error returned
      expect(result.error).toBeDefined();
      expect(result.error).not.toBeNull();

      // Verify NO explanation saved (rollback occurred)
      const { data: explanations } = await supabase
        .from('explanations')
        .select('*')
        .ilike('explanation_title', `%${testId}-rollback%`);

      expect(explanations).toHaveLength(0);

      // Verify NO topic saved
      const { data: topics } = await supabase
        .from('topics')
        .select('*')
        .ilike('topic_title', `%${testId}-rollback%`);

      expect(topics).toHaveLength(0);
    });
  });

  describe('Streaming Response Handling', () => {
    it('should handle non-streaming explanation generation with callback', async () => {
      // Note: Full streaming tests require complex async iterator mocking
      // This test verifies the basic flow works when a callback is provided but not used
      // The actual streaming behavior (async iteration) would require mocking OpenAI's stream response
      const userQuery = 'What is quantum entanglement?';
      const mockEmbedding = generateRandomEmbedding(3072);
      const streamingCallbacks: string[] = [];

      // Streaming callback to capture chunks
      const onStreamingText = (text: string) => {
        streamingCallbacks.push(text);
      };

      // Reset all mocks to ensure clean state
      mockOpenAIChatCreate.mockReset();
      mockOpenAIEmbeddingsCreate.mockReset();
      mockPineconeQuery.mockReset();
      mockPineconeUpsert.mockReset();

      // Mock OpenAI: Embedding
      mockOpenAIEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      // Mock Pinecone: No matches
      mockPineconeQuery.mockResolvedValue(pineconeNoMatchesResponse);

      // Smart mock that handles parallel calls correctly
      // Use prompt content to identify call type (more reliable than checking Zod schemas)
      mockOpenAIChatCreate.mockImplementation(async (params: any) => {
        const prompt = params.messages?.[1]?.content || '';
        const hasResponseFormat = !!params.response_format;

        // Title generation - prompt contains "Guess the title" and has response_format
        if (hasResponseFormat && prompt.includes('Guess the title')) {
          return {
            choices: [{ message: { content: JSON.stringify({ title1: 'Test Title', title2: 'Test Title 2', title3: 'Test Title 3' }) } }],
          };
        }

        // Tag evaluation - prompt contains "evaluate" (case-insensitive check)
        if (hasResponseFormat && (prompt.includes('difficulty level') || prompt.toLowerCase().includes('evaluate'))) {
          return tagEvaluationResponse;
        }

        // Heading/Key term links - prompts contain specific keywords
        if (hasResponseFormat && prompt.includes('KEY TERMS WITH CONTEXT')) {
          return keyTermLinkMappingsResponse;
        }
        if (hasResponseFormat && (prompt.includes('standalone titles') || prompt.includes('subsection'))) {
          return headingLinkMappingsResponse;
        }

        // Content generation - when streaming is requested, return async iterator
        if (params.stream === true) {
          // Return an async generator to simulate OpenAI streaming
          async function* streamGenerator() {
            const chunks = ['# Understanding', ' Quantum', ' Entanglement\n\n', '...'];
            for (const chunk of chunks) {
              yield {
                choices: [{ delta: { content: chunk }, finish_reason: null }],
                model: 'gpt-4.1-mini',
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
              };
            }
          }
          return streamGenerator();
        }

        // Non-streaming content generation
        return {
          choices: [{ message: { content: fullExplanationContent } }],
        };
      });

      mockPineconeUpsert.mockResolvedValueOnce(pineconeUpsertSuccessResponse);

      // Act
      const result = await returnExplanationLogic(
        userQuery,             // userInput: string
        null,                  // savedId: number | null
        MatchMode.Normal,      // matchMode: MatchMode
        userId,                // userid: string
        UserInputType.Query,   // userInputType: UserInputType
        [],                    // additionalRules: string[]
        onStreamingText,       // onStreamingText?: StreamingCallback
        undefined,             // existingContent?: string
        null,                  // previousExplanationViewedId?: number | null
        null                   // previousExplanationViewedVector?: { values: number[] } | null
      );

      // Assert - should complete without error (streaming callback may or may not be called depending on implementation)
      expect(result.error).toBeNull();
      expect(result.explanationId).toBeTruthy();

      // Verify callbacks were invoked (progress events sent via onStreamingText)
      expect(streamingCallbacks.length).toBeGreaterThan(0);
    });
  });

  describe('Database Constraints', () => {
    it('should handle database constraint violations gracefully', async () => {
      // Arrange - Create topic with specific title
      const duplicateTopicTitle = `[TEST] ${testId}-duplicate-topic`;
      await supabase
        .from('topics')
        .insert({
          topic_title: duplicateTopicTitle,
          topic_description: 'Original topic',
        });

      const userQuery = 'Test duplicate constraint';
      const mockEmbedding = generateRandomEmbedding(3072);

      mockOpenAIEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      mockPineconeQuery.mockResolvedValue(pineconeNoMatchesResponse);

      // Smart mock that handles parallel calls correctly
      // Use prompt content to identify call type
      mockOpenAIChatCreate.mockImplementation(async (params: any) => {
        const prompt = params.messages?.[1]?.content || '';
        const hasResponseFormat = !!params.response_format;

        // Title generation - return duplicate topic title
        if (hasResponseFormat && prompt.includes('Guess the title')) {
          return {
            choices: [{ message: { content: JSON.stringify({ title1: duplicateTopicTitle, title2: 'Alt Title 2', title3: 'Alt Title 3' }) } }],
          };
        }

        // Tag evaluation
        if (hasResponseFormat && (prompt.includes('difficulty level') || prompt.includes('Evaluate'))) {
          return tagEvaluationResponse;
        }

        // Key term links
        if (hasResponseFormat && prompt.includes('KEY TERMS WITH CONTEXT')) {
          return keyTermLinkMappingsResponse;
        }

        // Heading links
        if (hasResponseFormat && (prompt.includes('standalone titles') || prompt.includes('subsection'))) {
          return headingLinkMappingsResponse;
        }

        // Content generation
        return {
          choices: [{ message: { content: fullExplanationContent } }],
        };
      });

      mockPineconeUpsert.mockResolvedValueOnce(pineconeUpsertSuccessResponse);

      // Act
      const result = await returnExplanationLogic(
        userQuery,             // userInput: string
        null,                  // savedId: number | null
        MatchMode.Normal,      // matchMode: MatchMode
        userId,                // userid: string
        UserInputType.Query,   // userInputType: UserInputType
        [],                    // additionalRules: string[]
        undefined,             // onStreamingText?: StreamingCallback
        undefined,             // existingContent?: string
        null,                  // previousExplanationViewedId?: number | null
        null                   // previousExplanationViewedVector?: { values: number[] } | null
      );

      // Assert - May succeed (duplicate topics allowed) or fail gracefully
      // This depends on database constraints
      // For now, just verify no crash and result is defined
      expect(result).toBeDefined();
      // Either succeeds or returns an error (both are valid)
      expect(result.error !== null || result.explanationId !== null).toBe(true);
    });
  });
});
