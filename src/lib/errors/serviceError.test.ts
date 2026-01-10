/**
 * Tests for ServiceError class - structured error propagation.
 */
import { ServiceError } from './serviceError';
import { ERROR_CODES } from '@/lib/errorHandling';

describe('ServiceError', () => {
    describe('constructor', () => {
        it('should create error with required fields', () => {
            const error = new ServiceError(
                ERROR_CODES.DATABASE_ERROR,
                'Database connection failed',
                'createUser'
            );

            expect(error.name).toBe('ServiceError');
            expect(error.code).toBe(ERROR_CODES.DATABASE_ERROR);
            expect(error.message).toBe('Database connection failed');
            expect(error.context).toBe('createUser');
            expect(error.details).toBeUndefined();
            expect(error.cause).toBeUndefined();
        });

        it('should create error with details', () => {
            const error = new ServiceError(
                ERROR_CODES.VALIDATION_ERROR,
                'Invalid input',
                'validateUser',
                { details: { field: 'email', reason: 'invalid format' } }
            );

            expect(error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
            expect(error.details).toEqual({ field: 'email', reason: 'invalid format' });
        });

        it('should create error with cause', () => {
            const originalError = new Error('Original failure');
            const error = new ServiceError(
                ERROR_CODES.LLM_API_ERROR,
                'OpenAI request failed',
                'callOpenAI',
                { cause: originalError }
            );

            expect(error.cause).toBe(originalError);
        });

        it('should create error with both details and cause', () => {
            const originalError = new Error('Network timeout');
            const error = new ServiceError(
                ERROR_CODES.TIMEOUT_ERROR,
                'Request timed out',
                'fetchData',
                {
                    details: { url: 'https://api.example.com', timeout: 5000 },
                    cause: originalError
                }
            );

            expect(error.code).toBe(ERROR_CODES.TIMEOUT_ERROR);
            expect(error.context).toBe('fetchData');
            expect(error.details).toEqual({ url: 'https://api.example.com', timeout: 5000 });
            expect(error.cause).toBe(originalError);
        });
    });

    describe('instanceof checks', () => {
        it('should be instance of Error', () => {
            const error = new ServiceError(
                ERROR_CODES.UNKNOWN_ERROR,
                'Something went wrong',
                'unknownFunction'
            );

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(ServiceError);
        });
    });

    describe('error codes', () => {
        it.each([
            ERROR_CODES.INVALID_INPUT,
            ERROR_CODES.DATABASE_ERROR,
            ERROR_CODES.LLM_API_ERROR,
            ERROR_CODES.TIMEOUT_ERROR,
            ERROR_CODES.EMBEDDING_ERROR,
            ERROR_CODES.VALIDATION_ERROR,
            ERROR_CODES.SAVE_FAILED,
            ERROR_CODES.NOT_FOUND,
        ])('should accept error code %s', (code) => {
            const error = new ServiceError(code, 'Test message', 'testContext');
            expect(error.code).toBe(code);
        });
    });

    describe('stack trace', () => {
        it('should have a stack trace', () => {
            const error = new ServiceError(
                ERROR_CODES.DATABASE_ERROR,
                'DB error',
                'dbOperation'
            );

            expect(error.stack).toBeDefined();
            expect(error.stack).toContain('ServiceError');
        });
    });
});
