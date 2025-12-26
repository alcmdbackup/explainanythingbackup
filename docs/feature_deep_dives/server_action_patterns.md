# Server Action Patterns

## Overview

All client-server communication flows through Next.js Server Actions. This provides type safety, automatic request tracing, and prevents direct service access from the client.

## Implementation

### Key Files
- `src/actions/actions.ts` - All 50+ server actions
- `src/lib/logging/server/automaticServerLoggingBase.ts` - Action wrappers

### Core Principle

**Never call services directly from client code.** All service access must go through server actions.

```
Client → Server Actions → Services → Database/APIs
         (actions.ts)    (lib/services/)
```

### Action Wrapping Pattern

Every action follows this pattern:

```typescript
'use server';

import { withLogging, serverReadRequestId } from '@/lib/logging/server/automaticServerLoggingBase';

// Internal function with logging
const _functionName = withLogging(
  async function functionName(param: string) {
    // Call services here
    return await someService.doWork(param);
  },
  'functionName',
  { logInputs: true, logOutputs: true }
);

// Exported action with request ID context
export const functionName = serverReadRequestId(_functionName);
```

### Response Pattern

All actions return a consistent structure:

```typescript
{
  success: boolean;
  data: T | null;
  error: ErrorResponse | null;
}
```

### Action Categories

| Category | Examples |
|----------|----------|
| **Explanation** | `saveExplanationAndTopic`, `updateExplanationAndTopic`, `getExplanationByIdAction` |
| **Content & Links** | `resolveLinksForDisplayAction`, `getLinkDataForLexicalOverlayAction` |
| **User Library** | `saveExplanationToLibraryAction`, `getUserLibraryExplanationsAction` |
| **Tags** | `createTagsAction`, `addTagsToExplanationAction`, `getAllTagsAction` |
| **Metrics** | `getExplanationMetricsAction`, `refreshExplanationMetricsAction` |
| **AI/Editing** | `generateAISuggestionsAction`, `applyAISuggestionsAction` |
| **Link Admin** | `createWhitelistTermAction`, `approveCandidateAction` |

## Usage

### Calling Actions from Client

```typescript
import { getExplanationByIdAction } from '@/actions/actions';

const result = await getExplanationByIdAction(explanationId);

if (result.success) {
  const explanation = result.data;
} else {
  handleError(result.error);
}
```

### With Request ID Propagation

```typescript
import { clientPassRequestId } from '@/hooks/clientPassRequestId';
import { saveExplanationToLibraryAction } from '@/actions/actions';

const result = await clientPassRequestId(
  () => saveExplanationToLibraryAction(explanationId),
  requestId
);
```

### Creating New Actions

1. Define internal function with `withLogging`:

```typescript
const _myNewAction = withLogging(
  async function myNewAction(param: string) {
    // Validate input
    const validated = mySchema.parse(param);

    // Call service
    const result = await myService.doSomething(validated);

    // Return response
    return { success: true, data: result, error: null };
  },
  'myNewAction',
  { logInputs: true, logOutputs: true }
);
```

2. Export with request context:

```typescript
export const myNewAction = serverReadRequestId(_myNewAction);
```

3. Add to `actions.ts` exports.

### Error Handling in Actions

```typescript
const _myAction = withLogging(
  async function myAction(param: string) {
    try {
      const result = await riskyOperation(param);
      return { success: true, data: result, error: null };
    } catch (error) {
      const errorResponse = handleError(error, 'myAction', { param });
      return { success: false, data: null, error: errorResponse };
    }
  },
  'myAction'
);
```

### Best Practices

1. **One responsibility**: Each action does one thing
2. **Validate early**: Use Zod schemas for input validation
3. **Handle errors**: Catch and categorize all errors
4. **Log appropriately**: Use withLogging for automatic tracing
5. **Return consistently**: Always use the `{ success, data, error }` pattern
6. **Never expose internals**: Services stay server-side only
