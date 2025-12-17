/**
 * Integration Test: Request ID Propagation
 *
 * Tests that request IDs properly flow through the entire stack:
 * - Client generates unique requestId
 * - Server actions extract __requestId from payload
 * - RequestIdContext maintains context across async boundaries
 * - Logger automatically includes requestId in all logs
 * - No cross-contamination between concurrent requests
 */

import { RequestIdContext } from '@/lib/requestIdContext';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { logger } from '@/lib/server_utilities';

// Mock console to capture log entries (logger internally calls console.log/error with addRequestId)
const mockLogEntries: Array<{ level: string; message: string; data: unknown }> = [];

describe('Request ID Propagation Integration Tests', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear mock log entries
    mockLogEntries.length = 0;

    // Intercept console calls (logger calls console.log/error internally with addRequestId)
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('[INFO]')) {
        mockLogEntries.push({ level: 'info', message: args[0], data: args[1] });
      } else if (typeof args[0] === 'string' && args[0].includes('[DEBUG]')) {
        mockLogEntries.push({ level: 'debug', message: args[0], data: args[1] });
      }
    });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('[ERROR]')) {
        mockLogEntries.push({ level: 'error', message: args[0], data: args[1] });
      }
    });
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('[WARN]')) {
        mockLogEntries.push({ level: 'warn', message: args[0], data: args[1] });
      }
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('Server Action Request ID Flow', () => {
    it('should extract __requestId from payload and set context', async () => {
      // Arrange
      const testRequestId = 'test-request-123';
      const testUserId = 'user-456';
      const payload = {
        someData: 'test',
        __requestId: { requestId: testRequestId, userId: testUserId },
      };

      let capturedRequestId: string | undefined;
      let capturedUserId: string | undefined;

      // Create a test function that captures context
      const testFn = async (data: { someData: string }) => {
        capturedRequestId = RequestIdContext.getRequestId();
        capturedUserId = RequestIdContext.getUserId();
        return { processed: data.someData };
      };

      // Wrap with serverReadRequestId
      const wrappedFn = serverReadRequestId(testFn);

      // Act
      const result = await wrappedFn(payload);

      // Assert
      expect(result).toEqual({ processed: 'test' });
      expect(capturedRequestId).toBe(testRequestId);
      expect(capturedUserId).toBe(testUserId);
    });

    it('should remove __requestId from payload after extraction', async () => {
      // Arrange
      const payload = {
        data: 'important',
        __requestId: { requestId: 'req-123', userId: 'user-789' },
      };

      let receivedPayload: unknown;

      const testFn = async (data: unknown) => {
        receivedPayload = data;
        return 'done';
      };

      const wrappedFn = serverReadRequestId(testFn);

      // Act
      await wrappedFn(payload);

      // Assert - __requestId should be removed from the payload
      expect(receivedPayload).toEqual({ data: 'important' });
      expect((receivedPayload as Record<string, unknown>).__requestId).toBeUndefined();
    });

    it('should generate default requestId when __requestId not provided', async () => {
      // Arrange
      const payload = { data: 'no request id' };

      let capturedRequestId: string | undefined;
      let capturedUserId: string | undefined;

      const testFn = async (_payload?: unknown) => {
        capturedRequestId = RequestIdContext.getRequestId();
        capturedUserId = RequestIdContext.getUserId();
        return 'ok';
      };

      const wrappedFn = serverReadRequestId(testFn);

      // Act
      await wrappedFn(payload);

      // Assert - should generate a UUID
      expect(capturedRequestId).toBeTruthy();
      expect(capturedRequestId).not.toBe('unknown');
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(capturedRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(capturedUserId).toBe('anonymous');
    });

    it('should maintain context through nested async operations', async () => {
      // Arrange
      const testRequestId = 'nested-async-test';
      const testUserId = 'nested-user';
      const payload = {
        __requestId: { requestId: testRequestId, userId: testUserId },
      };

      const capturedIds: string[] = [];

      const nestedAsyncFn = async () => {
        capturedIds.push(`level3-${RequestIdContext.getRequestId()}`);
        await Promise.resolve();
        capturedIds.push(`level3-after-${RequestIdContext.getRequestId()}`);
      };

      const middleFn = async () => {
        capturedIds.push(`level2-${RequestIdContext.getRequestId()}`);
        await nestedAsyncFn();
        capturedIds.push(`level2-after-${RequestIdContext.getRequestId()}`);
      };

      const testFn = async (_payload?: unknown) => {
        capturedIds.push(`level1-${RequestIdContext.getRequestId()}`);
        await middleFn();
        capturedIds.push(`level1-after-${RequestIdContext.getRequestId()}`);
        return 'done';
      };

      const wrappedFn = serverReadRequestId(testFn);

      // Act
      await wrappedFn(payload);

      // Assert - all levels should have same requestId
      expect(capturedIds).toEqual([
        `level1-${testRequestId}`,
        `level2-${testRequestId}`,
        `level3-${testRequestId}`,
        `level3-after-${testRequestId}`,
        `level2-after-${testRequestId}`,
        `level1-after-${testRequestId}`,
      ]);
    });
  });

  describe('Logger Request ID Integration', () => {
    it('should include requestId in all logger calls within context', async () => {
      // Arrange
      const testRequestId = 'logger-test-req';
      const testUserId = 'logger-test-user';
      const payload = {
        __requestId: { requestId: testRequestId, userId: testUserId },
      };

      const testFn = async (_payload?: unknown) => {
        logger.info('Starting operation', { step: 1 });
        logger.debug('Processing data', { step: 2 }, true); // debug=true to enable debug logging
        logger.info('Operation complete', { step: 3 });
        return 'done';
      };

      const wrappedFn = serverReadRequestId(testFn);

      // Act
      await wrappedFn(payload);

      // Assert - all log entries should include requestId
      expect(mockLogEntries.length).toBe(3); // info + debug + info

      mockLogEntries.forEach((entry) => {
        const data = entry.data as Record<string, unknown>;
        expect(data.requestId).toBe(testRequestId);
        expect(data.userId).toBe(testUserId);
      });
    });

    it('should return unknown/anonymous when no context set', () => {
      // Act - call outside of RequestIdContext.run()
      const requestId = RequestIdContext.getRequestId();
      const userId = RequestIdContext.getUserId();

      // Assert
      expect(requestId).toBe('unknown');
      expect(userId).toBe('anonymous');
    });
  });

  describe('withLogging + serverReadRequestId Integration', () => {
    it('should log function entry and exit with correct requestId', async () => {
      // Arrange
      const testRequestId = 'combined-test';
      const testUserId = 'combined-user';
      const payload = {
        input: 'test data',
        __requestId: { requestId: testRequestId, userId: testUserId },
      };

      const businessLogic = async (data: { input: string }) => {
        logger.info('Business logic executing', { data: data.input });
        return { output: data.input.toUpperCase() };
      };

      // Order matters: withLogging first (inner), then serverReadRequestId (outer)
      const withLog = withLogging(businessLogic, 'testBusinessLogic', { enabled: true });
      const fullyWrapped = serverReadRequestId(withLog);

      // Act
      const result = await fullyWrapped(payload);

      // Assert
      expect(result).toEqual({ output: 'TEST DATA' });

      // Check log entries include requestId
      const requestIdInLogs = mockLogEntries.every((entry) => {
        const data = entry.data as Record<string, unknown>;
        return data.requestId === testRequestId && data.userId === testUserId;
      });
      expect(requestIdInLogs).toBe(true);

      // Should have: entry log + business log + exit log (at least 3)
      expect(mockLogEntries.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Concurrent Requests Isolation', () => {
    it('should not cross-contaminate request IDs between concurrent operations', async () => {
      // Arrange
      const results: Array<{ requestId: string; userId: string; order: number }> = [];

      const testFn = async (order: number) => {
        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        const requestId = RequestIdContext.getRequestId();
        const userId = RequestIdContext.getUserId();
        results.push({ requestId, userId, order });
        return { order, requestId };
      };

      const wrappedFn = serverReadRequestId(
        async (data: { order: number; __requestId?: { requestId: string; userId: string } }) => {
          return testFn(data.order);
        }
      );

      // Act - launch multiple concurrent requests
      const promises = [
        wrappedFn({ order: 1, __requestId: { requestId: 'req-1', userId: 'user-1' } }),
        wrappedFn({ order: 2, __requestId: { requestId: 'req-2', userId: 'user-2' } }),
        wrappedFn({ order: 3, __requestId: { requestId: 'req-3', userId: 'user-3' } }),
      ];

      const responses = await Promise.all(promises);

      // Assert - each request should have its own context
      responses.forEach((response, index) => {
        expect(response.requestId).toBe(`req-${index + 1}`);
      });

      // Verify no cross-contamination in captured results
      const req1Results = results.filter((r) => r.order === 1);
      const req2Results = results.filter((r) => r.order === 2);
      const req3Results = results.filter((r) => r.order === 3);

      expect(req1Results.every((r) => r.requestId === 'req-1')).toBe(true);
      expect(req2Results.every((r) => r.requestId === 'req-2')).toBe(true);
      expect(req3Results.every((r) => r.requestId === 'req-3')).toBe(true);
    });
  });
});
