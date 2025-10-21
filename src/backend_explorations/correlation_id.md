# AsyncLocalStorage Solution

## The Magic
AsyncLocalStorage creates an invisible "context bubble" that automatically carries data through your entire async call chain without changing any function signatures.

## Implementation
```typescript
// 1. Create context storage
import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage<{ requestId: string; userId: string }>();

export class CorrelationContext {
  static run(data, callback) {
    return storage.run(data, callback);
  }

  static getRequestId() {
    return storage.getStore()?.requestId || 'unknown';
  }
}

// 2. Update your logger to auto-read context
function writeToFile(level, message, data) {
  const logEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level, message, data,
    correlation: {
      requestId: CorrelationContext.getRequestId() // Automatically gets ID!
    }
  });
  appendFileSync(logFile, logEntry);
}

// 3. Wrap server actions
export function withCorrelation(fn) {
  return async (...args) => {
    const correlationData = args[0]?.__correlation || { requestId: randomUUID() };
    return CorrelationContext.run(correlationData, () => fn(...args));
  };
}

// 4. Your existing functions need ZERO changes
async function saveData(query, data) {
  logger.info("Saving"); // This log now automatically includes requestId!
  await callDatabase();   // This call's logs also auto-include requestId!
}

export const saveDataAction = withCorrelation(saveData); // Only change needed
```

## Client Usage
```typescript
const correlatedCall = (data) => ({ ...data, __correlation: { requestId: 'abc-123' }});
await saveDataAction(correlatedCall({ query, data }));
```

## Result
Every log automatically includes correlation without touching your functions:
```
[CLIENT] req:abc-123 User clicked save
[SERVER] req:abc-123 Saving data
[SERVER] req:abc-123 Database call
[SERVER] req:abc-123 Complete
```

**Zero function signature changes, automatic correlation everywhere.**