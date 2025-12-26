# Request Tracing & Observability

## Overview

Request tracing propagates unique IDs through the entire request lifecycle, enabling distributed tracing across client and server. All logs and traces are automatically tagged with request context.

## Implementation

### Key Files
- `src/lib/requestIdContext.ts` - Async context manager
- `src/lib/logging/server/automaticServerLoggingBase.ts` - Logging wrappers
- `src/hooks/clientPassRequestId.ts` - Client-to-server propagation

### Architecture

| Environment | Storage | Mechanism |
|-------------|---------|-----------|
| Server | `AsyncLocalStorage` | Async context propagation |
| Client | Module variable | Simple variable swapping |

### RequestIdContext API

```typescript
// Run callback within request context
RequestIdContext.run<T>(
  data: { requestId: string; userId: string },
  callback: () => T
): T

// Get current context
RequestIdContext.get(): { requestId: string; userId: string } | undefined

// Get individual values (with fallbacks)
RequestIdContext.getRequestId(): string    // default: 'unknown'
RequestIdContext.getUserId(): string       // default: 'anonymous'

// Set client context directly
RequestIdContext.setClient(data): void
```

### Logging Wrappers

| Wrapper | Purpose |
|---------|---------|
| `withLogging()` | Auto-log inputs, outputs, duration, errors |
| `withTracing()` | Create OpenTelemetry span |
| `withLoggingAndTracing()` | Both logging and tracing |

### Log Configuration

```typescript
{
  enabled: boolean,
  logInputs: boolean,
  logOutputs: boolean,
  logErrors: boolean,
  sensitiveFields: ['password', 'token', 'secret'],
  maxInputLength: 1000,
  maxOutputLength: 5000
}
```

### Tracing Configuration

```typescript
{
  enabled: boolean,
  customAttributes: Record<string, string | number>,
  includeInputs: boolean,
  includeOutputs: boolean
}
```

## Usage

### Wrapping Server Actions

```typescript
import { withLogging, serverReadRequestId } from '@/lib/logging/server/automaticServerLoggingBase';

// Internal function with logging
const _myAction = withLogging(
  async function myAction(param: string) {
    // Implementation
  },
  'myAction',
  { logInputs: true, logOutputs: true }
);

// Exported with request ID context
export const myAction = serverReadRequestId(_myAction);
```

### API Routes

```typescript
import { RequestIdContext } from '@/lib/requestIdContext';

export async function POST(request: NextRequest) {
  const body = await request.json();

  return RequestIdContext.run(
    { requestId: body.__requestId, userId: body.userid },
    async () => {
      // All operations inherit this context
      logger.info('Processing request');  // Auto-tagged with requestId
      return new Response(...);
    }
  );
}
```

### Client-Side Propagation

```typescript
import { clientPassRequestId } from '@/hooks/clientPassRequestId';

// Wrap action call to pass request ID
const result = await clientPassRequestId(
  () => myServerAction(params),
  currentRequestId
);
```

### OpenTelemetry Spans

```typescript
const tracedFn = withTracing(fn, 'operationName', {
  enabled: true,
  customAttributes: { 'custom.key': 'value' },
  includeInputs: true
});
```

Span attributes:
- `operation.name`: Operation identifier
- `function.args.count`: Number of arguments
- `function.success`: 'true' | 'false'
- `function.output.type`: Return type
- `function.error.type`: Error name (if failed)
- `function.error.message`: Error message (if failed)

### Data Sanitization

The logging system automatically:
- Redacts sensitive fields (password, token, secret, api_key)
- Truncates long values
- Handles BigInt serialization
- Recursively sanitizes nested objects

### Request Flow

```
Client Request
    ↓
API Route / Server Action
    ↓
RequestIdContext.run() wraps entire operation
    ↓
withLoggingAndTracing() decorates functions
    ↓
logger.info/error() auto-attaches requestId
    ↓
AsyncLocalStorage preserves context across await
```
