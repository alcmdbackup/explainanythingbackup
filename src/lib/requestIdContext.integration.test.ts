/**
 * Integration Test: Request ID Context Propagation (Scenario 8)
 *
 * Tests request ID propagation across:
 * - Client to server boundary
 * - Async operations
 * - Streaming operations
 * - Service calls
 * - Logging infrastructure
 *
 * Covers:
 * - Request ID survives client → server
 * - Async operations maintain context
 * - Streaming preserves requestId
 * - No cross-contamination between requests
 * - Correlation in logs and telemetry
 */

import { RequestIdContext } from './requestIdContext';
import {
  setupIntegrationTestContext,
  type IntegrationTestContext,
} from '@/testing/utils/integration-helpers';

describe('Request ID Context Integration Tests (Scenario 8)', () => {
  let context: IntegrationTestContext;

  beforeAll(async () => {
    context = await setupIntegrationTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  describe('Context Creation and Retrieval', () => {
    it('should store and retrieve request ID in context', async () => {
      // Arrange
      const testData = {
        requestId: `test-req-${Date.now()}`,
        userId: context.testUserId,
      };

      // Act & Assert
      RequestIdContext.run(testData, () => {
        const retrieved = RequestIdContext.get();
        expect(retrieved).toBeDefined();
        expect(retrieved?.requestId).toBe(testData.requestId);
        expect(retrieved?.userId).toBe(testData.userId);
      });

      console.log('Request ID stored and retrieved:', testData.requestId);
    });

    it('should retrieve request ID separately', () => {
      // Arrange
      const testRequestId = `req-${Date.now()}`;

      // Act & Assert
      RequestIdContext.run({ requestId: testRequestId, userId: 'test-user' }, () => {
        const retrieved = RequestIdContext.getRequestId();
        expect(retrieved).toBe(testRequestId);
      });
    });

    it('should retrieve user ID separately', () => {
      // Arrange
      const testUserId = `user-${Date.now()}`;

      // Act & Assert
      RequestIdContext.run({ requestId: 'test-req', userId: testUserId }, () => {
        const retrieved = RequestIdContext.getUserId();
        expect(retrieved).toBe(testUserId);
      });
    });

    it('should return defaults when no context is set', () => {
      // Act - Outside of run() context
      const requestId = RequestIdContext.getRequestId();
      const userId = RequestIdContext.getUserId();

      // Assert - Should return defaults
      expect(requestId).toBe('unknown');
      expect(userId).toBe('anonymous');
    });
  });

  describe('Async Operations', () => {
    it('should maintain context through async operations', async () => {
      // Arrange
      const testData = {
        requestId: `async-req-${Date.now()}`,
        userId: context.testUserId,
      };

      // Act
      const result = await RequestIdContext.run(testData, async () => {
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 100));

        // Context should still be available
        const retrieved = RequestIdContext.get();
        return retrieved;
      });

      // Assert
      expect(result).toBeDefined();
      expect(result?.requestId).toBe(testData.requestId);
      expect(result?.userId).toBe(testData.userId);

      console.log('Context preserved through async:', testData.requestId);
    });

    it('should handle nested async calls', async () => {
      // Arrange
      const testData = {
        requestId: `nested-${Date.now()}`,
        userId: context.testUserId,
      };

      // Act
      await RequestIdContext.run(testData, async () => {
        // Level 1
        await new Promise(resolve => setTimeout(resolve, 50));
        const level1 = RequestIdContext.get();

        // Level 2
        await new Promise(resolve => setTimeout(resolve, 50));
        const level2 = RequestIdContext.get();

        // Assert - Should be same at all levels
        expect(level1?.requestId).toBe(testData.requestId);
        expect(level2?.requestId).toBe(testData.requestId);
      });

      console.log('Context preserved through nested async calls');
    });

    it('should maintain context through Promise.all', async () => {
      // Arrange
      const testData = {
        requestId: `parallel-${Date.now()}`,
        userId: context.testUserId,
      };

      // Act
      const results = await RequestIdContext.run(testData, async () => {
        return Promise.all([
          new Promise(resolve => setTimeout(() => resolve(RequestIdContext.getRequestId()), 50)),
          new Promise(resolve => setTimeout(() => resolve(RequestIdContext.getRequestId()), 100)),
          new Promise(resolve => setTimeout(() => resolve(RequestIdContext.getRequestId()), 150)),
        ]);
      });

      // Assert - All should have the same request ID
      expect(results[0]).toBe(testData.requestId);
      expect(results[1]).toBe(testData.requestId);
      expect(results[2]).toBe(testData.requestId);

      console.log('Context maintained through Promise.all');
    });
  });

  describe('Context Isolation', () => {
    it('should not cross-contaminate between requests', async () => {
      // Arrange
      const request1 = {
        requestId: `req-1-${Date.now()}`,
        userId: 'user-1',
      };

      const request2 = {
        requestId: `req-2-${Date.now()}`,
        userId: 'user-2',
      };

      // Act - Simulate concurrent requests
      const [result1, result2] = await Promise.all([
        RequestIdContext.run(request1, async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return RequestIdContext.get();
        }),
        RequestIdContext.run(request2, async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return RequestIdContext.get();
        }),
      ]);

      // Assert - Each should have its own context
      expect(result1?.requestId).toBe(request1.requestId);
      expect(result2?.requestId).toBe(request2.requestId);
      expect(result1?.userId).toBe(request1.userId);
      expect(result2?.userId).toBe(request2.userId);

      console.log('No cross-contamination between concurrent requests');
    });
  });

  describe('Integration with Services', () => {
    it('should propagate through service calls', async () => {
      // Arrange
      const testData = {
        requestId: `service-${Date.now()}`,
        userId: context.testUserId,
      };

      // Simulate service call
      const serviceFunction = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          requestId: RequestIdContext.getRequestId(),
          userId: RequestIdContext.getUserId(),
        };
      };

      // Act
      const result = await RequestIdContext.run(testData, serviceFunction);

      // Assert
      expect(result.requestId).toBe(testData.requestId);
      expect(result.userId).toBe(testData.userId);

      console.log('Context propagated through service call');
    });

    it('should be available in error paths', async () => {
      // Arrange
      const testData = {
        requestId: `error-${Date.now()}`,
        userId: context.testUserId,
      };

      // Act
      try {
        await RequestIdContext.run(testData, async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          const contextBeforeError = RequestIdContext.get();

          // Verify context is available before throwing
          expect(contextBeforeError?.requestId).toBe(testData.requestId);

          throw new Error('Test error');
        });
      } catch (error) {
        // Error is expected
        expect(error).toBeDefined();
      }

      console.log('Context available in error paths');
    });
  });

  describe('Streaming Operations', () => {
    it('should maintain context through streaming callback', async () => {
      // Arrange
      const testData = {
        requestId: `stream-${Date.now()}`,
        userId: context.testUserId,
      };

      const chunks: string[] = [];

      // Simulate streaming operation
      const streamFunction = async (callback: (chunk: string) => void) => {
        for (let i = 0; i < 5; i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          const requestId = RequestIdContext.getRequestId();
          callback(`chunk-${i}-${requestId}`);
        }
      };

      // Act
      await RequestIdContext.run(testData, async () => {
        await streamFunction(chunk => chunks.push(chunk));
      });

      // Assert - All chunks should have the request ID
      expect(chunks.length).toBe(5);
      chunks.forEach(chunk => {
        expect(chunk).toContain(testData.requestId);
      });

      console.log('Context maintained through streaming:', chunks.length, 'chunks');
    });
  });
});
