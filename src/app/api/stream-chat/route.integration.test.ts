/**
 * Integration Test: Stream Chat API Route (Scenario 3)
 *
 * Tests streaming API responses with real:
 * - OpenAI streaming chat completions
 * - Server-Sent Events (SSE) formatting
 * - Request ID context propagation
 * - Error handling during streaming
 *
 * Covers:
 * - Successful streaming response
 * - SSE chunk formatting
 * - Completion signal
 * - Error before streaming starts
 * - Error mid-stream
 * - Request ID propagation through streaming
 */

import { POST } from './route';
import {
  setupIntegrationTestContext,
  type IntegrationTestContext,
} from '@/testing/utils/integration-helpers';
import { NextRequest } from 'next/server';

describe('Stream Chat API Integration Tests (Scenario 3)', () => {
  let context: IntegrationTestContext;
  let testUserId: string;

  beforeAll(async () => {
    context = await setupIntegrationTestContext();
    testUserId = context.testUserId;
  });

  afterAll(async () => {
    await context.cleanup();
  });

  /**
   * Helper to create a mock NextRequest with JSON body
   */
  function createMockRequest(body: any): NextRequest {
    return {
      json: async () => body,
    } as NextRequest;
  }

  /**
   * Helper to consume a streaming response and collect chunks
   */
  async function consumeStream(response: Response): Promise<string[]> {
    const chunks: string[] = [];
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('No reader available');
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }

    return chunks;
  }

  /**
   * Helper to parse SSE chunks into data objects
   */
  function parseSSEChunks(chunks: string[]): any[] {
    const dataObjects: any[] = [];

    chunks.forEach(chunk => {
      // SSE format: "data: {json}\n\n"
      const lines = chunk.split('\n');
      lines.forEach(line => {
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6); // Remove "data: "
          try {
            const data = JSON.parse(jsonStr);
            dataObjects.push(data);
          } catch {
            // Ignore invalid JSON
          }
        }
      });
    });

    return dataObjects;
  }

  describe('Successful Streaming', () => {
    it('should stream chat completion with real OpenAI API', async () => {
      // Arrange
      const request = createMockRequest({
        prompt: 'Write a short poem about testing.',
        userid: testUserId,
        __requestId: {
          requestId: `test-stream-${Date.now()}`,
          userId: testUserId,
        },
      });

      // Act
      const response = await POST(request);

      // Assert - Response headers
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/event-stream');

      // Consume stream
      const chunks = await consumeStream(response);

      // Assert - Received chunks
      expect(chunks.length).toBeGreaterThan(0);

      // Parse SSE data
      const dataObjects = parseSSEChunks(chunks);

      expect(dataObjects.length).toBeGreaterThan(0);

      // Verify at least one chunk with content
      const hasContent = dataObjects.some(data => data.text && data.text.length > 0);
      expect(hasContent).toBe(true);

      // Verify completion signal
      const completionChunk = dataObjects.find(data => data.isComplete === true);
      expect(completionChunk).toBeDefined();

      console.log('Total chunks:', chunks.length);
      console.log('Parsed data objects:', dataObjects.length);
      console.log('Final text length:', completionChunk?.text?.length || 0);
    }, 60000);

    it('should send multiple chunks during streaming', async () => {
      // Arrange
      const request = createMockRequest({
        prompt: 'Explain neural networks in 3 paragraphs.',
        userid: testUserId,
      });

      // Act
      const response = await POST(request);

      // Assert
      expect(response.status).toBe(200);

      const chunks = await consumeStream(response);
      const dataObjects = parseSSEChunks(chunks);

      // Should receive multiple incremental updates
      const incrementalChunks = dataObjects.filter(data => data.isComplete === false);
      expect(incrementalChunks.length).toBeGreaterThan(0);

      // Each chunk should have text
      incrementalChunks.forEach(chunk => {
        expect(chunk).toHaveProperty('text');
      });

      console.log('Incremental chunks:', incrementalChunks.length);
    }, 60000);

    it('should properly format SSE events', async () => {
      // Arrange
      const request = createMockRequest({
        prompt: 'Count from 1 to 5.',
        userid: testUserId,
      });

      // Act
      const response = await POST(request);
      const chunks = await consumeStream(response);

      // Assert - SSE format validation
      chunks.forEach(chunk => {
        // Should contain "data: " prefix
        if (chunk.includes('data: ')) {
          expect(chunk).toMatch(/data: \{.*\}/);
          // Should end with double newline
          expect(chunk).toMatch(/\n\n$/);
        }
      });

      console.log('SSE formatting validated');
    }, 60000);
  });

  describe('Error Handling', () => {
    it('should return 400 for missing prompt', async () => {
      // Arrange
      const request = createMockRequest({
        // Missing prompt
        userid: testUserId,
      });

      // Act
      const response = await POST(request);

      // Assert
      expect(response.status).toBe(400);

      const text = await response.text();
      expect(text).toContain('Missing prompt');
    });

    it('should return 400 for missing userid', async () => {
      // Arrange
      const request = createMockRequest({
        prompt: 'Test prompt',
        // Missing userid
      });

      // Act
      const response = await POST(request);

      // Assert
      expect(response.status).toBe(400);

      const text = await response.text();
      expect(text).toContain('Missing');
    });

    it('should handle errors during streaming gracefully', async () => {
      // Arrange - Use an invalid/problematic prompt
      const request = createMockRequest({
        prompt: '', // Empty prompt may cause error
        userid: testUserId,
      });

      // Act
      const response = await POST(request);

      // Assert - Should still return a valid response
      expect(response).toBeDefined();

      // If it streams, it should send an error in the stream
      if (response.status === 200) {
        const chunks = await consumeStream(response);
        const dataObjects = parseSSEChunks(chunks);

        // Should have completion signal
        const hasCompletion = dataObjects.some(data => data.isComplete === true);
        expect(hasCompletion).toBe(true);
      }
    }, 60000);
  });

  describe('Request ID Context', () => {
    it('should accept and process custom request ID', async () => {
      // Arrange
      const customRequestId = `custom-req-${Date.now()}`;
      const request = createMockRequest({
        prompt: 'Test with custom request ID',
        userid: testUserId,
        __requestId: {
          requestId: customRequestId,
          userId: testUserId,
        },
      });

      // Act
      const response = await POST(request);

      // Assert
      expect(response.status).toBe(200);

      const chunks = await consumeStream(response);
      const dataObjects = parseSSEChunks(chunks);

      expect(dataObjects.length).toBeGreaterThan(0);

      // Request ID should be used internally (would need logging verification)
      console.log('Used custom request ID:', customRequestId);
    }, 60000);

    it('should generate fallback request ID if not provided', async () => {
      // Arrange
      const request = createMockRequest({
        prompt: 'Test without request ID',
        userid: testUserId,
        // No __requestId provided
      });

      // Act
      const response = await POST(request);

      // Assert
      expect(response.status).toBe(200);

      const chunks = await consumeStream(response);
      const dataObjects = parseSSEChunks(chunks);

      expect(dataObjects.length).toBeGreaterThan(0);

      // Should still work with auto-generated request ID
      console.log('Generated fallback request ID');
    }, 60000);
  });

  describe('Concurrent Streaming', () => {
    it('should handle multiple concurrent stream requests', async () => {
      // Arrange
      const requests = [
        createMockRequest({
          prompt: 'Count to 3',
          userid: testUserId,
          __requestId: {
            requestId: `concurrent-1-${Date.now()}`,
            userId: testUserId,
          },
        }),
        createMockRequest({
          prompt: 'List 3 colors',
          userid: testUserId,
          __requestId: {
            requestId: `concurrent-2-${Date.now()}`,
            userId: testUserId,
          },
        }),
        createMockRequest({
          prompt: 'Name 3 animals',
          userid: testUserId,
          __requestId: {
            requestId: `concurrent-3-${Date.now()}`,
            userId: testUserId,
          },
        }),
      ];

      // Act - Send all requests concurrently
      const responses = await Promise.all(
        requests.map(req => POST(req))
      );

      // Assert - All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Consume all streams
      const allChunks = await Promise.all(
        responses.map(response => consumeStream(response))
      );

      // Verify each stream completed
      allChunks.forEach(chunks => {
        expect(chunks.length).toBeGreaterThan(0);
        const dataObjects = parseSSEChunks(chunks);
        const hasCompletion = dataObjects.some(data => data.isComplete === true);
        expect(hasCompletion).toBe(true);
      });

      console.log('All concurrent streams completed successfully');
    }, 120000);
  });
});
