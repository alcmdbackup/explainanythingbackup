# Error Handling

## Overview

Error handling uses a categorization system with 13 error codes. Errors are automatically classified based on message patterns and logged with context for debugging.

## Implementation

### Key Files
- `src/lib/errorHandling.ts` - Error utilities

### Error Codes

| Code | Category |
|------|----------|
| `INVALID_INPUT` | Input validation failures |
| `INVALID_RESPONSE` | Malformed response data |
| `INVALID_USER_QUERY` | Bad user query |
| `NO_TITLE_FOR_VECTOR_SEARCH` | Missing title for search |
| `LLM_API_ERROR` | OpenAI/AI service errors |
| `TIMEOUT_ERROR` | Request timeouts |
| `DATABASE_ERROR` | Supabase/PostgreSQL errors |
| `EMBEDDING_ERROR` | Pinecone/vector errors |
| `VALIDATION_ERROR` | Schema validation failures |
| `SAVE_FAILED` | Save operation failures |
| `QUERY_NOT_ALLOWED` | Unauthorized query |
| `NOT_FOUND` | Resource not found |
| `UNKNOWN_ERROR` | Unclassified errors |

### Automatic Categorization

```
Error message contains 'api', 'openai' → LLM_API_ERROR
Error message contains 'timeout' → TIMEOUT_ERROR
Error message contains 'database', 'sql' → DATABASE_ERROR
Error message contains 'embedding', 'pinecone' → EMBEDDING_ERROR
Error message contains 'validation', 'schema' → VALIDATION_ERROR
Otherwise → UNKNOWN_ERROR
```

### Error Response Type

```typescript
interface ErrorResponse {
  code: ErrorCode;
  message: string;
  details?: any;
}
```

## Usage

### Handling Errors

```typescript
import { handleError } from '@/lib/errorHandling';

try {
  await riskyOperation();
} catch (error) {
  const errorResponse = handleError(
    error,
    'functionName',           // Context
    { param1: 'value' }       // Additional data
  );
  return { success: false, data: null, error: errorResponse };
}
```

### Creating Errors Manually

```typescript
import { createError, ErrorCode } from '@/lib/errorHandling';

const error = createError(
  ErrorCode.NOT_FOUND,
  'Explanation not found',
  { explanationId }
);
```

### Validation Errors

```typescript
import { createValidationError } from '@/lib/errorHandling';

const result = mySchema.safeParse(input);
if (!result.success) {
  const error = createValidationError(
    'Invalid input data',
    result.error.issues  // Zod issues with field paths
  );
  return { success: false, data: null, error };
}
```

### Input Errors

```typescript
import { createInputError } from '@/lib/errorHandling';

if (!userId) {
  return {
    success: false,
    data: null,
    error: createInputError('User ID is required')
  };
}
```

### In Server Actions

```typescript
const _myAction = withLogging(
  async function myAction(param: string) {
    try {
      // Validate
      const validated = mySchema.parse(param);

      // Execute
      const result = await myService.doWork(validated);

      return { success: true, data: result, error: null };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          data: null,
          error: createValidationError('Validation failed', error.issues)
        };
      }

      const errorResponse = handleError(error, 'myAction', { param });
      return { success: false, data: null, error: errorResponse };
    }
  },
  'myAction'
);
```

### Client-Side Handling

```typescript
const result = await myAction(params);

if (!result.success) {
  switch (result.error.code) {
    case 'NOT_FOUND':
      showNotFoundMessage();
      break;
    case 'VALIDATION_ERROR':
      showValidationErrors(result.error.details);
      break;
    default:
      showGenericError(result.error.message);
  }
}
```

### Logging

`handleError` automatically logs:
- Error code
- Error message
- Context (function name)
- Additional data
- Stack trace (in development)

```typescript
// Logged output
{
  level: 'error',
  code: 'DATABASE_ERROR',
  message: 'Connection failed',
  context: 'saveExplanation',
  additionalData: { explanationId: 'abc' },
  requestId: 'req-123'
}
```

### Best Practices

1. **Categorize early**: Use specific error codes for known failure modes
2. **Include context**: Pass function name and relevant data to `handleError`
3. **Validate input**: Use Zod schemas and `createValidationError`
4. **Mask details**: User-facing messages should be generic
5. **Log everything**: All errors should be logged with context
6. **Consistent response**: Always return `{ success, data, error }` structure

## Evolution Pipeline — Transient Error Classification

The evolution pipeline has its own error classification system in `src/lib/evolution/core/errorClassification.ts`, separate from the global `errorHandling.ts` above. This is intentional: the evolution pipeline needs to decide whether to **retry** (transient) or **fail** (fatal), while the global system categorizes errors for user-facing display.

### `isTransientError(error: unknown): boolean`

Returns `true` for errors that are likely to succeed on retry:

1. **OpenAI SDK classes** (via `instanceof`): `APIConnectionError`, `RateLimitError`, `InternalServerError`
2. **Message patterns**: socket timeout, ECONNRESET, ECONNREFUSED, ETIMEDOUT, fetch failed, HTTP 429/408/500/502/503/504, rate limit, bad gateway, service unavailable, gateway timeout
3. **Cause chain walking**: If `error.cause` is an `Error`, recursively checks the wrapped error

### Defense-in-Depth Strategy

Transient errors are handled at two layers:

- **Agent-level**: IterativeEditingAgent and CalibrationRanker catch transient errors internally, treating them as soft rejections within their loops.
- **Pipeline-level**: `runAgent()` in `pipeline.ts` retries the entire agent once with exponential backoff for transient errors that escape agent-level handling.

`BudgetExceededError` is never retried — it checkpoints state and pauses the run.

### Retry Amplification

The OpenAI SDK retries 3× internally (`maxRetries: 3` in `llms.ts`), then the pipeline retries the entire agent once (`maxRetries: 1` default in `runAgent`). For a persistent transient error, this means up to 8 total LLM call attempts. This is intentional but documented to prevent future maintainers from adding another retry layer.

### Scope

- `executeMinimalPipeline` (single-article mode) does NOT have pipeline-level retry — it uses a simpler agent loop.
- This classification is evolution-specific. Global error categorization remains in `src/lib/errorHandling.ts`.
