import {
  ERROR_CODES,
  handleError,
  createError,
  createValidationError,
  createInputError,
  type ErrorCode,
  type ErrorResponse
} from './errorHandling';
import { logger } from '@/lib/server_utilities';

// Mock logger
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('errorHandling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ERROR_CODES', () => {
    it('should have all expected error codes', () => {
      expect(ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
      expect(ERROR_CODES.NO_TITLE_FOR_VECTOR_SEARCH).toBe('NO_TITLE_FOR_VECTOR_SEARCH');
      expect(ERROR_CODES.INVALID_RESPONSE).toBe('INVALID_RESPONSE');
      expect(ERROR_CODES.INVALID_USER_QUERY).toBe('INVALID_USER_QUERY');
      expect(ERROR_CODES.LLM_API_ERROR).toBe('LLM_API_ERROR');
      expect(ERROR_CODES.TIMEOUT_ERROR).toBe('TIMEOUT_ERROR');
      expect(ERROR_CODES.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
      expect(ERROR_CODES.DATABASE_ERROR).toBe('DATABASE_ERROR');
      expect(ERROR_CODES.EMBEDDING_ERROR).toBe('EMBEDDING_ERROR');
      expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ERROR_CODES.SAVE_FAILED).toBe('SAVE_FAILED');
      expect(ERROR_CODES.QUERY_NOT_ALLOWED).toBe('QUERY_NOT_ALLOWED');
    });

    it('should be immutable', () => {
      expect(() => {
        (ERROR_CODES as any).NEW_CODE = 'NEW_CODE';
      }).toThrow();
    });
  });

  describe('handleError', () => {
    it('should handle API errors', () => {
      const error = new Error('OpenAI API rate limit exceeded');
      const context = 'llm_call';
      const additionalData = { userId: 'user123' };

      const result = handleError(error, context, additionalData);

      expect(result).toEqual({
        code: ERROR_CODES.LLM_API_ERROR,
        message: 'Error communicating with AI service',
        details: 'OpenAI API rate limit exceeded'
      });
      expect(logger.error).toHaveBeenCalledWith(`Error in ${context}`, {
        error: result,
        ...additionalData
      });
    });

    it('should handle timeout errors', () => {
      const error = new Error('Request timeout after 30 seconds');
      const context = 'api_request';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.TIMEOUT_ERROR,
        message: 'Request timed out!',
        details: 'Request timeout after 30 seconds'
      });
    });

    it('should handle database errors', () => {
      const error = new Error('Database connection failed');
      const context = 'db_query';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.DATABASE_ERROR,
        message: 'Database operation failed',
        details: 'Database connection failed'
      });
    });

    it('should handle SQL errors', () => {
      const error = new Error('SQL syntax error near SELECT');
      const context = 'db_query';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.DATABASE_ERROR,
        message: 'Database operation failed',
        details: 'SQL syntax error near SELECT'
      });
    });

    it('should handle embedding errors', () => {
      const error = new Error('Failed to connect to Pinecone');
      const context = 'embedding_creation';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.EMBEDDING_ERROR,
        message: 'Failed to process embeddings',
        details: 'Failed to connect to Pinecone'
      });
    });

    it('should handle validation errors', () => {
      const error = new Error('Schema validation failed');
      const context = 'input_validation';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Data validation failed',
        details: 'Schema validation failed'
      });
    });

    it('should handle unknown errors', () => {
      const error = new Error('Something unexpected happened');
      const context = 'unknown_operation';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.UNKNOWN_ERROR,
        message: 'Something unexpected happened'
      });
    });

    it('should handle non-Error objects', () => {
      const error = 'String error';
      const context = 'string_error_context';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.UNKNOWN_ERROR,
        message: 'An unexpected error occurred'
      });
    });

    it('should handle null errors', () => {
      const error = null;
      const context = 'null_error_context';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.UNKNOWN_ERROR,
        message: 'An unexpected error occurred'
      });
    });

    it('should handle undefined errors', () => {
      const error = undefined;
      const context = 'undefined_error_context';

      const result = handleError(error, context);

      expect(result).toEqual({
        code: ERROR_CODES.UNKNOWN_ERROR,
        message: 'An unexpected error occurred'
      });
    });

    it('should log with additional data', () => {
      const error = new Error('Test error');
      const context = 'test_context';
      const additionalData = {
        userId: 'user123',
        requestId: 'req456',
        timestamp: Date.now()
      };

      handleError(error, context, additionalData);

      expect(logger.error).toHaveBeenCalledWith(`Error in ${context}`, {
        error: expect.any(Object),
        ...additionalData
      });
    });

    it('should handle case-insensitive matching', () => {
      const error1 = new Error('OPENAI rate limit');
      const error2 = new Error('OpenAI rate limit');
      const error3 = new Error('openai rate limit');

      const result1 = handleError(error1, 'test');
      const result2 = handleError(error2, 'test');
      const result3 = handleError(error3, 'test');

      expect(result1.code).toBe(ERROR_CODES.LLM_API_ERROR);
      expect(result2.code).toBe(ERROR_CODES.LLM_API_ERROR);
      expect(result3.code).toBe(ERROR_CODES.LLM_API_ERROR);
    });
  });

  describe('createError', () => {
    it('should create error with code and message', () => {
      const result = createError(ERROR_CODES.INVALID_INPUT, 'Invalid email format');

      expect(result).toEqual({
        code: ERROR_CODES.INVALID_INPUT,
        message: 'Invalid email format'
      });
    });

    it('should create error with details', () => {
      const details = { field: 'email', value: 'invalid' };
      const result = createError(
        ERROR_CODES.INVALID_INPUT,
        'Invalid email format',
        details
      );

      expect(result).toEqual({
        code: ERROR_CODES.INVALID_INPUT,
        message: 'Invalid email format',
        details
      });
    });

    it('should work with any error code', () => {
      Object.values(ERROR_CODES).forEach(code => {
        const result = createError(code as ErrorCode, 'Test message');
        expect(result.code).toBe(code);
        expect(result.message).toBe('Test message');
      });
    });
  });

  describe('createValidationError', () => {
    it('should create validation error with message', () => {
      const result = createValidationError('Required field missing');

      expect(result).toEqual({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Required field missing'
      });
    });

    it('should format Zod errors', () => {
      const zodErrors = {
        errors: [
          {
            path: ['user', 'email'],
            message: 'Invalid email',
            code: 'invalid_string'
          },
          {
            path: ['user', 'age'],
            message: 'Must be positive',
            code: 'too_small'
          }
        ]
      };

      const result = createValidationError('Validation failed', zodErrors);

      expect(result).toEqual({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details: {
          validationErrors: [
            {
              path: 'user.email',
              message: 'Invalid email',
              code: 'invalid_string'
            },
            {
              path: 'user.age',
              message: 'Must be positive',
              code: 'too_small'
            }
          ]
        }
      });
    });

    it('should handle non-Zod error details', () => {
      const details = { field: 'username', issue: 'too short' };
      const result = createValidationError('Username invalid', details);

      expect(result).toEqual({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Username invalid',
        details
      });
    });

    it('should handle empty path in Zod errors', () => {
      const zodErrors = {
        errors: [
          {
            path: [],
            message: 'General validation error',
            code: 'custom'
          }
        ]
      };

      const result = createValidationError('Validation failed', zodErrors);

      expect(result.details.validationErrors[0].path).toBe('');
    });

    it('should handle undefined details', () => {
      const result = createValidationError('Validation failed');

      expect(result).toEqual({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed'
      });
    });
  });

  describe('createInputError', () => {
    it('should create input error with message', () => {
      const result = createInputError('Email is required');

      expect(result).toEqual({
        code: ERROR_CODES.INVALID_INPUT,
        message: 'Email is required'
      });
    });

    it('should create multiple input errors with different messages', () => {
      const result1 = createInputError('Email is required');
      const result2 = createInputError('Password must be at least 8 characters');
      const result3 = createInputError('Invalid date format');

      expect(result1.message).toBe('Email is required');
      expect(result2.message).toBe('Password must be at least 8 characters');
      expect(result3.message).toBe('Invalid date format');

      // All should have the same error code
      expect(result1.code).toBe(ERROR_CODES.INVALID_INPUT);
      expect(result2.code).toBe(ERROR_CODES.INVALID_INPUT);
      expect(result3.code).toBe(ERROR_CODES.INVALID_INPUT);
    });
  });

  describe('integration tests', () => {
    it('should handle complex error categorization', () => {
      const errors = [
        { error: new Error('Connection to database timed out'), expectedCode: ERROR_CODES.TIMEOUT_ERROR },
        { error: new Error('Pinecone API key invalid'), expectedCode: ERROR_CODES.EMBEDDING_ERROR },
        { error: new Error('OpenAI embedding failed'), expectedCode: ERROR_CODES.LLM_API_ERROR },
        { error: new Error('Schema validation error: invalid field'), expectedCode: ERROR_CODES.VALIDATION_ERROR },
        { error: new Error('SQL query failed'), expectedCode: ERROR_CODES.DATABASE_ERROR }
      ];

      errors.forEach(({ error, expectedCode }) => {
        const result = handleError(error, 'test');
        expect(result.code).toBe(expectedCode);
      });
    });

    it('should chain error creation and handling', () => {
      const inputError = createInputError('Invalid user input');
      const validationError = createValidationError('Schema validation failed', {
        errors: [
          { path: ['field'], message: 'Required', code: 'required' }
        ]
      });

      expect(inputError.code).toBe(ERROR_CODES.INVALID_INPUT);
      expect(validationError.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(validationError.details.validationErrors).toHaveLength(1);
    });

    it('should handle edge cases in error messages', () => {
      const testCases = [
        { message: 'api', expectedCode: ERROR_CODES.LLM_API_ERROR },
        { message: 'API', expectedCode: ERROR_CODES.LLM_API_ERROR },
        { message: 'timeout!', expectedCode: ERROR_CODES.TIMEOUT_ERROR },
        { message: 'TIMEOUT', expectedCode: ERROR_CODES.TIMEOUT_ERROR },
        { message: 'database', expectedCode: ERROR_CODES.DATABASE_ERROR },
        { message: 'sql', expectedCode: ERROR_CODES.DATABASE_ERROR },
        { message: 'embedding', expectedCode: ERROR_CODES.EMBEDDING_ERROR },
        { message: 'pinecone', expectedCode: ERROR_CODES.EMBEDDING_ERROR },
        { message: 'validation', expectedCode: ERROR_CODES.VALIDATION_ERROR },
        { message: 'schema', expectedCode: ERROR_CODES.VALIDATION_ERROR },
        { message: 'random error', expectedCode: ERROR_CODES.UNKNOWN_ERROR }
      ];

      testCases.forEach(({ message, expectedCode }) => {
        const result = handleError(new Error(message), 'test');
        expect(result.code).toBe(expectedCode);
      });
    });
  });
});