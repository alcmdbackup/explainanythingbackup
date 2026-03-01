// Centralized error handling: categorizes errors, reports to Sentry, and provides typed error constructors.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from '@/lib/server_utilities';
import * as Sentry from '@sentry/nextjs';
import { RequestIdContext } from './requestIdContext';

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
  SOURCE_FETCH_TIMEOUT: 'SOURCE_FETCH_TIMEOUT',
  SOURCE_FETCH_FAILED: 'SOURCE_FETCH_FAILED',
  SOURCE_CONTENT_EMPTY: 'SOURCE_CONTENT_EMPTY',
  SOURCE_PAYWALL_DETECTED: 'SOURCE_PAYWALL_DETECTED',
  GLOBAL_BUDGET_EXCEEDED: 'GLOBAL_BUDGET_EXCEEDED',
  LLM_KILL_SWITCH: 'LLM_KILL_SWITCH',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export type ErrorResponse = {
  code: ErrorCode;
  message: string;
  details?: any;
};

/**
 * Type guard for Supabase/Postgres error objects.
 * Supabase errors are plain objects (NOT instanceof Error) with { code, message, details?, hint? }
 */
function isSupabaseError(error: unknown): error is { code: string; message: string; details?: string; hint?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as any).code === 'string' &&
    typeof (error as any).message === 'string'
  );
}

function categorizeError(error: unknown): ErrorResponse {
  if (!(error instanceof Error)) {
    if (isSupabaseError(error)) {
      return {
        code: ERROR_CODES.DATABASE_ERROR,
        message: error.message || 'Database operation failed',
        details: { supabaseCode: error.code, hint: error.hint, rawDetails: error.details }
      };
    }
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

const CRITICAL_ERRORS: ReadonlySet<ErrorCode> = new Set([
  ERROR_CODES.DATABASE_ERROR,
  ERROR_CODES.LLM_API_ERROR,
  ERROR_CODES.EMBEDDING_ERROR,
  ERROR_CODES.UNKNOWN_ERROR,
]);

const WARNING_ERRORS: ReadonlySet<ErrorCode> = new Set([
  ERROR_CODES.TIMEOUT_ERROR,
  ERROR_CODES.VALIDATION_ERROR,
  ERROR_CODES.INVALID_INPUT,
  ERROR_CODES.SOURCE_FETCH_TIMEOUT,
]);

function getSentryLevel(code: ErrorCode): Sentry.SeverityLevel {
  if (CRITICAL_ERRORS.has(code)) return 'error';
  if (WARNING_ERRORS.has(code)) return 'warning';
  return 'info';
}

export function handleError(
  error: unknown,
  context: string,
  additionalData?: Record<string, any>
): ErrorResponse {
  const errorResponse = categorizeError(error);

  Sentry.withScope((scope) => {
    const requestContext = RequestIdContext.get();
    if (requestContext) {
      scope.setTag('requestId', requestContext.requestId);
      scope.setTag('sessionId', requestContext.sessionId);
      scope.setUser({ id: requestContext.userId });
    }

    scope.setTag('errorCode', errorResponse.code);
    scope.setLevel(getSentryLevel(errorResponse.code));
    scope.setContext('errorContext', {
      context,
      errorCode: errorResponse.code,
      errorMessage: errorResponse.message,
      ...additionalData,
    });

    Sentry.captureException(error);
  });

  logger.error(`Error in ${context}`, {
    error: errorResponse,
    ...additionalData
  });

  return errorResponse;
}

export function createError(
  code: ErrorCode, 
  message: string, 
  details?: any
): ErrorResponse {
  return { code, message, details };
}

export function createValidationError(
  message: string,
  details?: any
): ErrorResponse {
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

export function createInputError(
  message: string
): ErrorResponse {
  return createError(ERROR_CODES.INVALID_INPUT, message);
} 