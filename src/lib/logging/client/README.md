# Client-Side Automatic Logging Implementation

This implementation provides **SAFE, EXPLICIT** client-side logging for user-written code only.

## 🔒 Safety Features Implemented

### ✅ Infinite Recursion Prevention
- Re-entrance guards on all logging operations
- Maximum recursion depth limits (3 levels)
- Never wraps APIs that logging system uses
- Silent failure modes for all logging operations
- Circular reference detection in sanitization

### ✅ User Code Only Filtering
- File path whitelist: only `/src/`, `/app/`, `/components/`
- System code blocklist: `node_modules/`, React internals, browser APIs
- Function origin detection via stack traces
- Conservative wrapping strategy with explicit opt-in

### ✅ Development Only Operation
- Completely disabled in production
- No performance impact on production builds
- Easy emergency disable via environment variable

## 📁 File Structure

```
src/lib/logging/client/
├── safeClientLoggingBase.ts       # Core withClientLogging function with recursion guards
├── safeUserCodeWrapper.ts         # Explicit opt-in wrapper functions
├── logPersistence.ts              # Safe log storage (IndexedDB + dev server)
├── initClientAutoLogging.ts       # Client initialization
├── appIntegration.tsx             # App layout integration
├── examples/usage.tsx             # Usage examples
├── __tests__/clientLoggingSafety.test.ts  # Safety tests
└── README.md                      # This file

src/app/api/client-logs/route.ts   # Development server endpoint
```

## 🚀 Usage

### 1. Basic Event Handler Logging

```typescript
import { createSafeEventHandler } from '@/lib/logging/client/safeUserCodeWrapper';

const handleSubmit = createSafeEventHandler(
  async (event: FormEvent) => {
    // Your business logic here
    await submitForm(event);
  },
  'handleSubmit'
);
```

### 2. Async Function Logging

```typescript
import { createSafeAsyncFunction } from '@/lib/logging/client/safeUserCodeWrapper';

const fetchUserData = createSafeAsyncFunction(
  async (userId: string) => {
    const response = await fetch(`/api/users/${userId}`);
    return response.json();
  },
  'fetchUserData'
);
```

### 3. Manual Action Logging

```typescript
import { logUserAction } from '@/lib/logging/client/safeUserCodeWrapper';

// Log important user actions
logUserAction('form_submitted', {
  formType: 'contact',
  userId: '123'
});
```

### 4. Component-Level Logging (Optional)

```typescript
import { withComponentLogging } from '@/lib/logging/client/safeUserCodeWrapper';

export const MyComponent = withComponentLogging(() => {
  // Component implementation
  return <div>My Component</div>;
}, 'MyComponent');
```

## 🔧 Development Workflow

### Start Development Server
```bash
npm run dev

# Logs appear in:
# - Browser console (immediate feedback)
# - client.log file (persistent logging)
# - IndexedDB (browser storage backup)
```

### View Client Logs
```bash
# Terminal 1: Server logs
tail -f server.log

# Terminal 2: Client logs
tail -f client.log

# Search across both logs by request ID
grep "client-1761405857368-fwmg2w" *.log
```

### Export Client Logs
```typescript
import { exportClientLogs } from '@/lib/logging/client/safeUserCodeWrapper';

// Export logs from browser storage
await exportClientLogs();
```

## 🚨 Emergency Disable

If any issues occur:

```bash
# Immediately disable client logging
echo "CLIENT_LOGGING=false" >> .env.local

# Restart development server
npm run dev
```

## ⚠️ What Gets Logged vs What Doesn't

### ✅ LOGGED (User Business Logic)
- Event handlers you explicitly wrap
- Async functions you explicitly wrap
- Manual user actions you log
- Business logic functions

### ❌ NOT LOGGED (System Code)
- React hooks (`useState`, `useEffect`)
- Browser APIs (`fetch`, `setTimeout`, `addEventListener`)
- Next.js internals
- Node modules dependencies
- Framework code

## 🧪 Testing

Run safety tests:
```bash
npm test src/lib/logging/client/__tests__/clientLoggingSafety.test.ts
```

Tests verify:
- Infinite recursion prevention
- System code vs user code detection
- Error handling
- Development vs production behavior
- Performance and memory safety

## 📊 Expected Log Output

### Browser Console
```
[INFO] userEventHandler handleSubmit called {
  inputs: [{ type: "submit", target: "<form>" }],
  timestamp: "2024-10-25T15:30:00Z"
}
```

### client.log File
```json
{"timestamp":"2024-10-25T15:30:00Z","level":"INFO","message":"userEventHandler handleSubmit called","data":{"inputs":[{"type":"submit"}]},"requestId":"client-1761405857368-fwmg2w","source":"client"}
```

## 🎯 Key Benefits

- ✅ **Zero recursion risk** - comprehensive guards prevent infinite loops
- ✅ **User code only** - never pollutes system/framework code
- ✅ **Explicit control** - you choose exactly what gets logged
- ✅ **Development focused** - zero production impact
- ✅ **Request correlation** - logs connect to server-side logs
- ✅ **Local persistence** - logs saved to files for debugging
- ✅ **Easy debugging** - clear, readable log format

## 💡 Best Practices

1. **Only log business logic** - not UI components or framework integration
2. **Use descriptive names** - `'handleUserRegistration'` not `'onClick'`
3. **Avoid logging sensitive data** - passwords, tokens automatically redacted
4. **Test recursion safety** - run provided tests before deployment
5. **Monitor log file sizes** - export/clear logs periodically in long sessions

This implementation prioritizes **safety over automation** - you control exactly what gets logged while maintaining comprehensive protection against infinite recursion and system code pollution.