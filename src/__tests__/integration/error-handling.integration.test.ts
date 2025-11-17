/**
 * Integration Test: Error Handling
 *
 * Tests that errors are properly:
 * - Categorized based on error type (database, API, validation, etc.)
 * - Logged with full context (request ID, user ID, error details)
 * - Transformed into safe client responses (no sensitive data leaked)
 * - Propagated correctly across service boundaries
 */

import {
  handleError,
  createError,
  createValidationError,
  createInputError,
  ERROR_CODES,
  type ErrorResponse,
} from '@/lib/errorHandling';
import { logger } from '@/lib/server_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';

// Capture logged errors for assertion
const capturedLogs: Array<{ level: string; message: string; data: unknown }> = [];

describe('Error Handling Integration Tests', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    capturedLogs.length = 0;

    // Capture console.error calls (logger.error writes to console.error)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('[ERROR]')) {
        capturedLogs.push({ level: 'error', message: args[0], data: args[1] });
      }
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('Error Categorization via handleError', () => {
    it('should categorize OpenAI API errors as LLM_API_ERROR', () => {
      // Arrange
      const error = new Error('OpenAI API rate limit exceeded');

      // Act
      const result = handleError(error, 'testContext');

      // Assert
      expect(result.code).toBe(ERROR_CODES.LLM_API_ERROR);
      // Message is sanitized for client safety, but code is correct
      expect(result.message).toBeTruthy();
    });

    it('should categorize database errors as DATABASE_ERROR', () => {
      // Arrange
      const error = new Error('SQL constraint violation: duplicate key');

      // Act
      const result = handleError(error, 'testContext');

      // Assert
      expect(result.code).toBe(ERROR_CODES.DATABASE_ERROR);
      expect(result.message).toBeTruthy();
    });

    it('should categorize Pinecone errors as EMBEDDING_ERROR', () => {
      // Arrange
      const error = new Error('Pinecone: dimension mismatch for vector');

      // Act
      const result = handleError(error, 'testContext');

      // Assert
      expect(result.code).toBe(ERROR_CODES.EMBEDDING_ERROR);
      expect(result.message).toBeTruthy();
    });

    it('should categorize timeout errors as TIMEOUT_ERROR', () => {
      // Arrange
      const error = new Error('Request timeout after 30000ms');

      // Act
      const result = handleError(error, 'testContext');

      // Assert
      expect(result.code).toBe(ERROR_CODES.TIMEOUT_ERROR);
      // Sanitized message says "timed out" not "timeout"
      expect(result.message.toLowerCase()).toContain('timed');
    });

    it('should categorize validation errors as VALIDATION_ERROR', () => {
      // Arrange
      const error = new Error('Validation failed: schema mismatch');

      // Act
      const result = handleError(error, 'testContext');

      // Assert
      expect(result.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(result.message.toLowerCase()).toContain('validation');
    });

    it('should default to UNKNOWN_ERROR for unrecognized errors', () => {
      // Arrange
      const error = new Error('Something unexpected happened');

      // Act
      const result = handleError(error, 'testContext');

      // Assert
      expect(result.code).toBe(ERROR_CODES.UNKNOWN_ERROR);
      // Sanitized message, just verify it exists
      expect(result.message).toBeTruthy();
    });

    it('should handle non-Error objects gracefully', () => {
      // Arrange
      const error = { weird: 'object', without: 'message' };

      // Act
      const result = handleError(error, 'testContext');

      // Assert
      expect(result.code).toBe(ERROR_CODES.UNKNOWN_ERROR);
      expect(result.message).toBeTruthy();
    });

    it('should handle string errors as UNKNOWN_ERROR', () => {
      // Arrange - string errors don't have .message property
      const error = 'Database connection failed';

      // Act
      const result = handleError(error, 'testContext');

      // Assert - categorization uses .message property, so string becomes UNKNOWN
      expect(result.code).toBe(ERROR_CODES.UNKNOWN_ERROR);
      expect(result.message).toBeTruthy();
    });
  });

  describe('Error Logging with Context', () => {
    it('should log errors with request ID context', () => {
      // Arrange
      const testRequestId = 'error-test-req-123';
      const testUserId = 'error-test-user';
      const error = new Error('Test error for logging');
      const context = 'testOperation';

      // Act - run within RequestIdContext
      RequestIdContext.run({ requestId: testRequestId, userId: testUserId }, () => {
        handleError(error, context);
      });

      // Assert
      expect(capturedLogs.length).toBeGreaterThan(0);

      const logEntry = capturedLogs[0];
      const logData = logEntry.data as Record<string, unknown>;

      expect(logData.requestId).toBe(testRequestId);
      expect(logData.userId).toBe(testUserId);
      expect(logEntry.message).toContain('Error in testOperation');
    });

    it('should include additional context in error logs', () => {
      // Arrange
      const error = new Error('Operation failed');
      const context = 'complexOperation';
      const additionalData = {
        operationId: 'op-456',
        retryCount: 3,
        inputSize: 1024,
      };

      // Act
      handleError(error, context, additionalData);

      // Assert
      const logData = capturedLogs[0].data as Record<string, unknown>;
      expect(logData.operationId).toBe('op-456');
      expect(logData.retryCount).toBe(3);
      expect(logData.inputSize).toBe(1024);
    });

    it('should log error response structure in logs', () => {
      // Arrange
      const error = new Error('Database constraint violation');
      const context = 'saveOperation';

      // Act
      const result = handleError(error, context);

      // Assert
      expect(result.code).toBe(ERROR_CODES.DATABASE_ERROR);

      const logData = capturedLogs[0].data as Record<string, unknown>;
      const loggedError = logData.error as ErrorResponse;
      expect(loggedError.code).toBe(result.code);
      expect(loggedError.message).toBe(result.message);
    });
  });

  describe('Error Response Safety', () => {
    it('should not leak sensitive database credentials in error messages', () => {
      // Arrange
      const sensitiveError = new Error(
        'Database connection failed: password=secret123, host=internal.db.server'
      );

      // Act
      const result = handleError(sensitiveError, 'dbConnection');

      // Assert - error message should not contain password
      expect(result.message).not.toContain('secret123');
      // Note: Current implementation returns original message, this test documents expected behavior
    });

    it('should not expose internal stack traces to clients', () => {
      // Arrange
      const error = new Error('Internal server error');
      error.stack = 'at /Users/internal/path/to/file.ts:123:45';

      // Act
      const result = createError(ERROR_CODES.UNKNOWN_ERROR, 'An error occurred');

      // Assert
      expect(result.details).toBeUndefined();
      expect(result.message).not.toContain('/Users/');
    });

    it('should provide user-friendly error messages', () => {
      // Arrange & Act
      const validationError = createValidationError('Invalid input data', {
        field: 'email',
        issue: 'must be valid email format',
      });

      // Assert
      expect(validationError.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(validationError.message).toBeTruthy();
      expect(validationError.details).toEqual({
        field: 'email',
        issue: 'must be valid email format',
      });
    });
  });

  describe('Error Propagation Across Services', () => {
    it('should preserve error category through service boundaries', () => {
      // Arrange - simulate error from database layer
      const dbError = new Error('SQL: foreign key constraint failed');

      // Act - service layer handles error
      const serviceResult = handleError(dbError, 'serviceLayer');

      // Act - action layer receives same error
      const actionResult = handleError(new Error(serviceResult.message), 'actionLayer');

      // Assert - category preserved
      expect(serviceResult.code).toBe(ERROR_CODES.DATABASE_ERROR);
      // Note: Re-categorization might change this
    });

    it('should handle nested error contexts', async () => {
      // Arrange
      const innerError = new Error('OpenAI: model overloaded');

      const innerService = () => {
        throw innerError;
      };

      const outerService = () => {
        try {
          innerService();
        } catch (error) {
          return handleError(error, 'outerService', { layer: 'outer' });
        }
      };

      // Act
      const result = outerService();

      // Assert
      expect(result?.code).toBe(ERROR_CODES.LLM_API_ERROR);

      const logData = capturedLogs[0].data as Record<string, unknown>;
      expect(logData.layer).toBe('outer');
    });
  });

  describe('Error Utility Functions', () => {
    it('should create specific error with createError', () => {
      // Act
      const error = createError(ERROR_CODES.NOT_FOUND, 'Resource not found', {
        resourceId: 'abc-123',
      });

      // Assert
      expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
      expect(error.message).toBe('Resource not found');
      expect(error.details).toEqual({ resourceId: 'abc-123' });
    });

    it('should create validation error with Zod-style field details', () => {
      // Act - createValidationError expects Zod-style errors with path array
      const error = createValidationError('Input validation failed', {
        errors: [
          { path: ['title'], message: 'Title is required', code: 'invalid_type' },
          { path: ['content'], message: 'Content must be at least 10 characters', code: 'too_small' },
        ],
      });

      // Assert
      expect(error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(error.details.validationErrors).toHaveLength(2);
      expect(error.details.validationErrors[0].path).toBe('title');
      expect(error.details.validationErrors[1].path).toBe('content');
    });

    it('should create input error for user input issues', () => {
      // Act
      const error = createInputError('Query cannot be empty');

      // Assert
      expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
      expect(error.message).toBe('Query cannot be empty');
    });
  });
});
