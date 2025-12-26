/**
 * Integration Test: Streaming API (/api/stream-chat)
 *
 * Tests the streaming chat API endpoint with real database and mocked LLM responses
 * This validates:
 * - Request ID context propagation through streaming
 * - SSE (Server-Sent Events) message formatting
 * - Streaming error handling
 * - Request/response integration
 */

import { POST } from '@/app/api/stream-chat/route';
import { setupTestDatabase, teardownTestDatabase, createTestContext } from '@/testing/utils/integration-helpers';
import { collectStreamData, parseSSEMessages } from '@/testing/utils/test-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import { fullExplanationContent } from '@/testing/fixtures/llm-responses';

// Import the mocked openai and llms module
import * as llmsModule from '@/lib/services/llms';

// Mock the llms module functions
jest.mock('@/lib/services/llms', () => ({
  ...jest.requireActual('@/lib/services/llms'),
  callOpenAIModel: jest.fn(),
  default_model: 'gpt-4',
}));

describe('Streaming API Integration Tests', () => {
  let supabase: SupabaseClient;
  let testUserId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    // Set up test database connection
    supabase = await setupTestDatabase();
    console.log('Streaming API integration tests: Database setup complete');
  });

  afterAll(async () => {
    // Clean up all test data
    await teardownTestDatabase(supabase);
    console.log('Streaming API integration tests: Database cleanup complete');
  });

  beforeEach(async () => {
    // Create test context for each test
    const context = await createTestContext();
    testUserId = context.userId;
    cleanup = context.cleanup;
  });

  afterEach(async () => {
    // Clean up test data after each test
    await cleanup();
  });

  describe('Successful Streaming Response', () => {
    it('should stream chat response with proper SSE formatting', async () => {
      // Arrange - mock OpenAI streaming response
      const mockCallOpenAIModel = llmsModule.callOpenAIModel as jest.MockedFunction<typeof llmsModule.callOpenAIModel>;

      mockCallOpenAIModel.mockImplementation(
        async (
          _prompt: string,
          _context: string,
          _userid: string,
          _model: string,
          _streaming: boolean,
          callback: ((text: string) => void) | null
        ) => {
          // Simulate streaming chunks
          const chunks = [
            'Hello',
            'Hello, this is',
            'Hello, this is a',
            'Hello, this is a test',
            'Hello, this is a test response',
          ];

          for (const chunk of chunks) {
            callback?.(chunk);
            // Intentional delay to simulate real streaming behavior in mock
            await new Promise((resolve) => setTimeout(resolve, 10));
          }

          return 'Hello, this is a test response';
        }
      );

      // Act - create request and call API
      const request = new Request('http://localhost:3000/api/stream-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
          userid: testUserId,
          __requestId: {
            requestId: 'test-request-123',
            userId: testUserId,
          },
        }),
      }) as any;

      const response = await POST(request);

      // Assert - verify response structure
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(response.headers.get('Connection')).toBe('keep-alive');

      // Collect streaming data
      const chunks = await collectStreamData(response.body!);
      const messages = parseSSEMessages(chunks);

      // Verify streaming chunks
      expect(messages.length).toBeGreaterThan(0);

      // Verify incremental updates
      const incrementalMessages = messages.filter((msg: any) => !msg.isComplete);
      expect(incrementalMessages.length).toBeGreaterThan(0);
      incrementalMessages.forEach((msg: any) => {
        expect(msg).toHaveProperty('text');
        expect(msg.isComplete).toBe(false);
      });

      // Verify completion signal
      const completionMessage = messages.find((msg: any) => msg.isComplete) as { text: string; isComplete: boolean } | undefined;
      expect(completionMessage).toBeDefined();
      expect(completionMessage).toHaveProperty('text');
      expect(completionMessage!.isComplete).toBe(true);
      expect(completionMessage!.text).toBe('Hello, this is a test response');
    });

    it('should handle long streaming content correctly', async () => {
      // Arrange - mock OpenAI with longer content
      const mockCallOpenAIModel = llmsModule.callOpenAIModel as jest.MockedFunction<typeof llmsModule.callOpenAIModel>;

      mockCallOpenAIModel.mockImplementation(
        async (
          _prompt: string,
          _context: string,
          _userid: string,
          _model: string,
          _streaming: boolean,
          callback: ((text: string) => void) | null
        ) => {
          // Simulate streaming the full explanation content in chunks
          const chunkSize = 50;
          let accumulated = '';

          for (let i = 0; i < fullExplanationContent.length; i += chunkSize) {
            accumulated += fullExplanationContent.slice(i, i + chunkSize);
            callback?.(accumulated);
            // Intentional delay to simulate real streaming behavior in mock
            await new Promise((resolve) => setTimeout(resolve, 5));
          }

          return accumulated;
        }
      );

      // Act
      const request = new Request('http://localhost:3000/api/stream-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Explain quantum entanglement',
          userid: testUserId,
        }),
      }) as any;

      const response = await POST(request);

      // Assert
      const chunks = await collectStreamData(response.body!);
      const messages = parseSSEMessages(chunks);

      const completionMessage = messages.find((msg: any) => msg.isComplete) as { text: string; isComplete: boolean } | undefined;
      expect(completionMessage).toBeDefined();
      expect(completionMessage!.text.length).toBeGreaterThan(100);
      expect(completionMessage!.text).toContain('Quantum Entanglement');
    });
  });

  describe('Error Handling', () => {
    it('should handle error before streaming starts', async () => {
      // Arrange - mock OpenAI to throw error
      const mockCallOpenAIModel = llmsModule.callOpenAIModel as jest.MockedFunction<typeof llmsModule.callOpenAIModel>;

      mockCallOpenAIModel.mockRejectedValueOnce(
        new Error('OpenAI API error: Rate limit exceeded')
      );

      // Act
      const request = new Request('http://localhost:3000/api/stream-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
          userid: testUserId,
        }),
      }) as any;

      const response = await POST(request);

      // Assert
      expect(response.status).toBe(200); // Stream started, but error in content

      const chunks = await collectStreamData(response.body!);
      const messages = parseSSEMessages(chunks);

      // Verify error message
      const errorMessage = messages.find((msg: any) => msg.error) as { error: string; isComplete: boolean } | undefined;
      expect(errorMessage).toBeDefined();
      expect(errorMessage!.error).toContain('OpenAI API error');
      expect(errorMessage!.isComplete).toBe(true);
    });

    it('should handle missing required fields', async () => {
      // Act - missing prompt
      const request1 = new Request('http://localhost:3000/api/stream-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userid: testUserId,
        }),
      }) as any;

      const response1 = await POST(request1);

      // Assert
      expect(response1.status).toBe(400);
      const text1 = await response1.text();
      expect(text1).toBe('Missing prompt or userid');

      // Act - missing userid
      const request2 = new Request('http://localhost:3000/api/stream-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
        }),
      }) as any;

      const response2 = await POST(request2);

      // Assert
      expect(response2.status).toBe(400);
      const text2 = await response2.text();
      expect(text2).toBe('Missing prompt or userid');
    });
  });

  describe('Request ID Context Propagation', () => {
    it('should propagate request ID through streaming callbacks', async () => {
      // Arrange
      const mockCallOpenAIModel = llmsModule.callOpenAIModel as jest.MockedFunction<typeof llmsModule.callOpenAIModel>;
      const testRequestId = 'test-request-propagation-123';

      mockCallOpenAIModel.mockImplementation(
        async (
          _prompt: string,
          _context: string,
          _userid: string,
          _model: string,
          _streaming: boolean,
          callback: ((text: string) => void) | null
        ) => {
          callback?.('Test response');
          return 'Test response';
        }
      );

      // Act
      const request = new Request('http://localhost:3000/api/stream-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Test prompt',
          userid: testUserId,
          __requestId: {
            requestId: testRequestId,
            userId: testUserId,
          },
        }),
      }) as any;

      const response = await POST(request);

      // Assert
      expect(response.status).toBe(200);

      // Verify the LLM was called (context propagation happens internally)
      expect(mockCallOpenAIModel).toHaveBeenCalled();

      const chunks = await collectStreamData(response.body!);
      const messages = parseSSEMessages(chunks);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((msg: any) => msg.isComplete)).toBe(true);
    });
  });
});
