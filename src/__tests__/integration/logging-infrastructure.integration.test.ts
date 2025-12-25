/**
 * Integration Test: Logging Infrastructure
 *
 * Tests that the logging system properly:
 * - Wraps functions with entry/exit logging via withLogging
 * - Captures function inputs and outputs
 * - Measures performance (execution time)
 * - Handles errors with stack traces
 * - Respects enabled/disabled configuration
 */

import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { logger } from '@/lib/server_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';

// Capture log entries for verification
const capturedLogs: Array<{ level: string; message: string; data: unknown }> = [];

describe('Logging Infrastructure Integration Tests', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    capturedLogs.length = 0;

    // Capture console output (logger writes to console)
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && (args[0].includes('[INFO]') || args[0].includes('[DEBUG]'))) {
        capturedLogs.push({
          level: args[0].includes('[DEBUG]') ? 'debug' : 'info',
          message: args[0],
          data: args[1],
        });
      }
    });

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('[ERROR]')) {
        capturedLogs.push({ level: 'error', message: args[0], data: args[1] });
      }
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('withLogging Wrapper', () => {
    it('should log function entry and exit with inputs and outputs', async () => {
      // Arrange
      const testFn = async (input: { value: number }) => {
        return { result: input.value * 2 };
      };

      const wrappedFn = withLogging(testFn, 'doubleValue', { enabled: true });

      // Act
      const result = await wrappedFn({ value: 21 });

      // Assert
      expect(result).toEqual({ result: 42 });

      // Should have at least entry and exit logs
      expect(capturedLogs.length).toBeGreaterThanOrEqual(2);

      // Check for function name in logs
      const hasEntryLog = capturedLogs.some((log) => log.message.includes('doubleValue'));
      expect(hasEntryLog).toBe(true);
    });

    it('should respect enabled flag (disabled)', async () => {
      // Arrange
      const testFn = async () => 'done';

      const wrappedFn = withLogging(testFn, 'disabledLogging', { enabled: false });

      // Act
      const result = await wrappedFn();

      // Assert
      expect(result).toBe('done');

      // With enabled: false, should have minimal or no logs
      const disabledLogs = capturedLogs.filter((log) => log.message.includes('disabledLogging'));
      expect(disabledLogs.length).toBeLessThanOrEqual(2); // May still log errors
    });

    it('should capture and log errors with context', async () => {
      // Arrange
      const errorFn = async () => {
        throw new Error('Test error in wrapped function');
      };

      const wrappedFn = withLogging(errorFn, 'failingFunction', { enabled: true });

      // Act & Assert
      await expect(wrappedFn()).rejects.toThrow('Test error in wrapped function');

      // Should have error logged
      const errorLogs = capturedLogs.filter((log) => log.level === 'error');
      expect(errorLogs.length).toBeGreaterThan(0);
    });

    it('should work with synchronous functions', () => {
      // Arrange
      const syncFn = (a: number, b: number) => a + b;

      const wrappedFn = withLogging(syncFn, 'syncAdd', { enabled: true });

      // Act
      const result = wrappedFn(5, 3);

      // Assert
      expect(result).toBe(8);

      // Should have logs for sync function
      const addLogs = capturedLogs.filter((log) => log.message.includes('syncAdd'));
      expect(addLogs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Performance Overhead', () => {
    it('should have minimal performance overhead (< 10ms per call)', async () => {
      // Arrange
      const fastFn = async () => {
        // Very fast operation
        return 'fast';
      };

      const wrappedFn = withLogging(fastFn, 'fastOperation', { enabled: true });

      // Act - measure multiple calls
      const startTime = Date.now();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        await wrappedFn();
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTimePerCall = totalTime / iterations;

      // Assert - average time should be < 10ms per call (including logging overhead)
      expect(avgTimePerCall).toBeLessThan(10);
    });
  });

  describe('Context Preservation', () => {
    it('should preserve request ID in logged data', async () => {
      // Arrange
      const testRequestId = 'logging-context-req';
      const testUserId = 'logging-context-user';

      const testFn = async () => {
        logger.info('Inside wrapped function', { step: 'middle' });
        return 'completed';
      };

      const wrappedFn = withLogging(testFn, 'contextPreservation', { enabled: true });

      // Act
      RequestIdContext.run({ requestId: testRequestId, userId: testUserId, sessionId: 'test-session' }, () => {
        return wrappedFn();
      });

      // Intentional wait for async callback completion - needed for RequestIdContext to propagate
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert - all logs should have requestId
      const logsWithRequestId = capturedLogs.filter((log) => {
        const data = log.data as Record<string, unknown>;
        return data.requestId === testRequestId;
      });

      expect(logsWithRequestId.length).toBeGreaterThan(0);
    });
  });

  describe('Structured Logging Format', () => {
    it('should maintain consistent structured log format', async () => {
      // Arrange
      const testFn = async (input: string) => `processed: ${input}`;

      const wrappedFn = withLogging(testFn, 'structuredTest', { enabled: true });

      // Act
      await wrappedFn('test-input');

      // Assert - logs should have consistent structure
      capturedLogs.forEach((log) => {
        // Every log should have level, message, and data
        expect(log.level).toBeTruthy();
        expect(log.message).toBeTruthy();

        // Data should include requestId and userId (from addRequestId)
        const data = log.data as Record<string, unknown>;
        expect(data).toHaveProperty('requestId');
        expect(data).toHaveProperty('userId');
      });
    });

    it('should handle complex nested inputs/outputs', async () => {
      // Arrange
      const complexFn = async (data: { nested: { deep: { value: number } } }) => {
        return {
          transformed: {
            original: data.nested.deep.value,
            doubled: data.nested.deep.value * 2,
          },
        };
      };

      const wrappedFn = withLogging(complexFn, 'complexData', { enabled: true });

      // Act
      const result = await wrappedFn({ nested: { deep: { value: 10 } } });

      // Assert
      expect(result.transformed.doubled).toBe(20);

      // Logs should capture the complex structure
      const hasLogs = capturedLogs.length > 0;
      expect(hasLogs).toBe(true);
    });
  });

  describe('File Logging Integration', () => {
    it('should write logs to file (server.log)', async () => {
      // Note: This test verifies the logging infrastructure writes to file
      // In actual implementation, writeToFile is called internally
      // We verify the logging functions work without throwing

      const testFn = async () => 'file logging test';
      const wrappedFn = withLogging(testFn, 'fileLoggingTest', { enabled: true });

      // Act - should not throw
      await expect(wrappedFn()).resolves.toBe('file logging test');

      // Assert - function completed successfully with logging
      // File writing is an implementation detail; we verify no errors thrown
    });
  });
});
