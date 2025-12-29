/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from '@/lib/server_utilities';
import * as Sentry from '@sentry/nextjs';
import { RequestIdContext } from './requestIdContext';

// Error codes as constants for consistency
export const ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  NO_TITLE_FOR_VECTOR_SEARCH: 'NO_TITLE_FOR_VECTOR_SEARCH',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  INVALID_USER_QUERY: 'INVALID_USER_QUERY',
  LLM_API_ERROR: 'LLM_API_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EMBEDDING_ERROR: 'EMBEDDING_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SAVE_FAILED: 'SAVE_FAILED',
  QUERY_NOT_ALLOWED: 'QUERY_NOT_ALLOWED',
  NOT_FOUND: 'NOT_FOUND',
  // Source fetching error codes
  SOURCE_FETCH_TIMEOUT: 'SOURCE_FETCH_TIMEOUT',
  SOURCE_FETCH_FAILED: 'SOURCE_FETCH_FAILED',
  SOURCE_CONTENT_EMPTY: 'SOURCE_CONTENT_EMPTY',
  SOURCE_PAYWALL_DETECTED: 'SOURCE_PAYWALL_DETECTED'
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

// Standard error response type
export type ErrorResponse = {
  code: ErrorCode;
  message: string;
  details?: any;
};

// Error categorization logic
function categorizeError(error: unknown): ErrorResponse {
  if (!(error instanceof Error)) {
    return {
      code: ERROR_CODES.UNKNOWN_ERROR,
      message: 'An unexpected error occurred'
    };
  }

  const message = error.message.toLowerCase();
  
  if (message.includes('api') || message.includes('openai')) {
    return {
      code: ERROR_CODES.LLM_API_ERROR,
      message: 'Error communicating with AI service',
      details: error.message
    };
  }
  
  if (message.includes('timeout')) {
    return {
      code: ERROR_CODES.TIMEOUT_ERROR,
      message: 'Request timed out!',
      details: error.message
    };
  }
  
  if (message.includes('database') || message.includes('sql')) {
    return {
      code: ERROR_CODES.DATABASE_ERROR,
      message: 'Database operation failed',
      details: error.message
    };
  }
  
  if (message.includes('embedding') || message.includes('pinecone')) {
    return {
      code: ERROR_CODES.EMBEDDING_ERROR,
      message: 'Failed to process embeddings',
      details: error.message
    };
  }
  
  if (message.includes('validation') || message.includes('schema')) {
    return {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Data validation failed',
      details: error.message
    };
  }
  
  return {
    code: ERROR_CODES.UNKNOWN_ERROR,
    message: error.message
  };
}

/**
 * Map error codes to Sentry severity levels.
 * Critical errors get 'error' level, recoverable ones get 'warning'.
 */
function getSentryLevel(code: ErrorCode): Sentry.SeverityLevel {
  const critical: readonly ErrorCode[] = [
    ERROR_CODES.DATABASE_ERROR,
    ERROR_CODES.LLM_API_ERROR,
    ERROR_CODES.EMBEDDING_ERROR,
    ERROR_CODES.UNKNOWN_ERROR,
  ];
  const warning: readonly ErrorCode[] = [
    ERROR_CODES.TIMEOUT_ERROR,
    ERROR_CODES.VALIDATION_ERROR,
    ERROR_CODES.INVALID_INPUT,
    ERROR_CODES.SOURCE_FETCH_TIMEOUT,
  ];

  if (critical.includes(code)) return 'error';
  if (warning.includes(code)) return 'warning';
  return 'info';
}

// Main error handler function
export function handleError(
  error: unknown,
  context: string,
  additionalData?: Record<string, any>
): ErrorResponse {
  const errorResponse = categorizeError(error);

  // Report to Sentry with full context
  Sentry.withScope((scope) => {
    // Get request context if available
    const requestContext = RequestIdContext.get();
    if (requestContext) {
      scope.setTag('requestId', requestContext.requestId);
      scope.setTag('sessionId', requestContext.sessionId);
      scope.setUser({ id: requestContext.userId });
    }

    // Set error code as a filterable tag
    scope.setTag('errorCode', errorResponse.code);

    // Set severity based on error type
    scope.setLevel(getSentryLevel(errorResponse.code));

    // Add structured context for debugging
    scope.setContext('errorContext', {
      context,
      errorCode: errorResponse.code,
      errorMessage: errorResponse.message,
      ...additionalData,
    });

    // Capture the exception
    Sentry.captureException(error);
  });

  // Log error with context (will also create breadcrumb via sendToSentry)
  logger.error(`Error in ${context}`, {
    error: errorResponse,
    ...additionalData
  });

  return errorResponse;
}

// Utility function for creating specific error responses
export function createError(
  code: ErrorCode, 
  message: string, 
  details?: any
): ErrorResponse {
  return { code, message, details };
}

// Utility function for validation errors
export function createValidationError(
  message: string, 
  details?: any
): ErrorResponse {
  // Format Zod validation errors for better readability
  let formattedDetails = details;
  if (details && typeof details === 'object' && 'errors' in details) {
    formattedDetails = {
      validationErrors: details.errors.map((err: any) => ({
        path: err.path.join('.'),
        message: err.message,
        code: err.code
      }))
    };
  }
  
  return createError(ERROR_CODES.VALIDATION_ERROR, message, formattedDetails);
}

// Utility function for input validation errors
export function createInputError(
  message: string
): ErrorResponse {
  return createError(ERROR_CODES.INVALID_INPUT, message);
} 