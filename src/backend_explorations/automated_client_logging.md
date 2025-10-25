# Client-Side Automatic Logging Implementation Plan

## Goal
Automatically log all **client-side** function calls, React events, and async operations to local drive, mirroring the server-side automatic logging approach.

## Three-Phase Implementation Strategy

### Phase 1: Build-Time Component Interception (60% Coverage)
**Leverage Next.js/Turbopack for build-time transforms:**

1. **Create Babel/SWC Plugin**
   - `src/lib/logging/clientBuildTransform.js` - Build-time function wrapping
   - Auto-wrap exported React components
   - Auto-wrap async functions and event handlers
   - Inject `withClientLogging` wrapper at build time

2. **Component Pattern Detection**
   - Wrap component functions (`useState`, `useEffect`, `useCallback`)
   - Wrap event handlers (`onClick`, `onSubmit`, `onChange`)
   - Wrap async operations (`fetch`, server actions)

### Phase 2: Runtime Browser Interception (30% Coverage)
**Target browser-specific async patterns:**

1. **Promise Chain Interception**
   - `Promise.prototype.then/catch/finally`
   - `fetch()` API calls
   - Server action calls

2. **Event Handler Wrapping**
   - DOM event listeners (`addEventListener`)
   - React synthetic events
   - Timer functions (`setTimeout`, `setInterval`)

3. **Array Processing Callbacks**
   - `.map()`, `.filter()`, `.forEach()`, `.reduce()`
   - State update batching

### Phase 3: React Lifecycle Interception (10% Coverage)
**Target React-specific patterns:**

1. **Hook Interception**
   - `useState` setter functions
   - `useEffect` callbacks
   - `useCallback` wrapped functions

2. **Error Boundary Integration**
   - Component error logging
   - Async error tracking

## Client Log Persistence Strategy: RECOMMENDED HYBRID APPROACH

### 🎯 Primary Strategy: Development Server Streaming + IndexedDB Fallback

**Rationale:** Optimize for development workflow while ensuring reliability in all environments.

#### **Tier 1: Development Server Streaming (Primary)**
```typescript
// Real-time streaming to client.log during development
// Advantages: Zero setup, immediate visibility, works like server.log
POST http://localhost:3000/api/client-logs
{ timestamp, level, message, data, requestId, source: 'client' }

// Result: client.log file appears alongside server.log
// Usage: tail -f client.log (same as server.log workflow)
```

#### **Tier 2: IndexedDB Buffer (Always Active)**
```typescript
// Reliable fallback storage in browser
// Advantages: Works offline, never loses logs, production-ready
const db = await openDB('ClientLogs', 1);
await db.add('logs', logEntry);

// Provides: Manual export, log persistence, offline capability
```

#### **Tier 3: File System Access API (Optional)**
```typescript
// Advanced: Direct file writing for power users
// Advantages: User control, no server dependency
// Disadvantages: Requires user permission, limited browser support
const logFileHandle = await window.showSaveFilePicker({
  suggestedName: `client-logs-${Date.now()}.log`
});
```

### 🔄 Implementation Flow
```typescript
async function persistClientLog(entry: ClientLogEntry) {
  // 1. Always store in IndexedDB (reliable backup)
  await indexedDBStore(entry);

  // 2. Try development server streaming (best UX)
  if (process.env.NODE_ENV === 'development') {
    try {
      await fetch('/api/client-logs', {
        method: 'POST',
        body: JSON.stringify(entry)
      });
    } catch {
      // Silently fallback to IndexedDB only
    }
  }

  // 3. File System API (if user opted in)
  if (userFileHandle) {
    await writeToUserFile(entry);
  }
}
```

### 📊 Expected Developer Experience
```bash
# Development workflow (same as server logging)
npm run dev

# Terminal 1: Server logs
tail -f server.log

# Terminal 2: Client logs (NEW)
tail -f client.log

# Search across both logs by request ID
grep "client-1761405857368-fwmg2w" *.log
```

## Integration with Server-Side Logging

### Strategic Approach: LEVERAGE SHARED PATTERNS, SEPARATE IMPLEMENTATION

The client-side automatic logging system should work as a **companion** to the existing server-side system (`src/lib/logging/automaticServerLoggingBase.ts`), sharing patterns and configurations while maintaining environment-specific optimizations.

### ✅ What Should Be Shared

#### 1. Configuration & Schema Patterns
```typescript
// SHARED: Use existing LogConfig from schemas as base
import { LogConfig, defaultLogConfig } from '@/lib/schemas/schemas';

// Client version extends with browser-specific options
interface ClientLogConfig extends LogConfig {
  functionType?: 'component' | 'eventHandler' | 'hook' | 'async';
  persistToFile?: boolean;
  exportFormat?: 'json' | 'csv';
}
```

#### 2. Core Wrapper Signature & Structure
```typescript
// SHARED: Same function signature pattern for consistency
export function withClientLogging<T extends (...args: any[]) => any>(
  fn: T,
  functionName: string,
  config: Partial<ClientLogConfig> = {}
): T {
  // Same control flow pattern as server
  if (!finalConfig.enabled) return fn;
  // Same async/sync handling pattern
  // Same error catching structure
}
```

#### 3. Filtering & Sanitization Logic Patterns
```typescript
// SHARED: Adapt existing filtering patterns for browser
export function shouldSkipClientLogging(fn: Function, name: string): boolean {
  // Reuse server filtering patterns but add browser-specific excludes:
  // React internals, DOM manipulation, browser APIs
}

function sanitizeClientData(data: any, config: ClientLogConfig): any {
  // Extend server sanitization patterns for DOM elements, Events, React objects
}
```

#### 4. Request ID Integration
```typescript
// SHARED: Use existing RequestIdContext - no changes needed
import { RequestIdContext } from '@/lib/requestIdContext';
// Same request ID flows: client → server → automatic logging
```

### ❌ What Should NOT Be Shared

#### 1. Interceptor Implementation Files
**Reason:** Completely different APIs
- **Server:** `Module._load`, Node.js internals, CommonJS/ESM modules
- **Client:** DOM APIs, React patterns, browser globals, Web APIs

#### 2. Logger Implementation
**Reason:** Different capabilities and targets
- **Server:** File writing via `fs.appendFileSync` to `server.log`
- **Client:** File System Access API, IndexedDB, or HTTP streaming to `client.log`

#### 3. withLogging Function Implementation
**Reason:** Environment-specific optimizations needed

| Aspect | Server `withLogging` | Client `withClientLogging` |
|--------|---------------------|---------------------------|
| **Logger Import** | `@/lib/server_utilities` | `@/lib/client_utilities` |
| **Timing API** | `Date.now()` (adequate for server) | `performance.now()` (precise for UI) |
| **Sanitization** | `sanitizeData()` (Node.js objects) | `sanitizeClientData()` (DOM/React objects) |
| **Message Format** | `"Function ${name} called"` | `"${type} ${name} called"` |
| **Context Data** | Request metadata, trace spans | Component name, user agent, DOM state |
| **Config Type** | `LogConfig` | `ClientLogConfig extends LogConfig` |

#### 4. Initialization Strategy
**Reason:** Different execution contexts
- **Server:** `instrumentation.ts` Node.js hook, module loading time
- **Client:** React component lifecycle, browser load events, user interaction

### 🏗️ Recommended Architecture

```
src/lib/logging/
├── shared/                     # NEW: Shared utilities and patterns
│   ├── baseConfig.ts          # Shared LogConfig extensions and utilities
│   ├── sanitization.ts        # Shared sanitization patterns (adapted per env)
│   ├── filtering.ts           # Shared filtering patterns and utilities
│   └── requestFlow.ts         # Request ID flow documentation and utilities
├── server/                    # EXISTING: Renamed files for clarity and consistency
│   ├── automaticServerLoggingBase.ts         # Current server implementation (unchanged)
│   ├── autoServerLoggingModuleInterceptor.ts # Server-specific module interception
│   ├── autoServerLoggingRuntimeWrapper.ts    # Server-specific runtime wrapping
│   └── autoServerLoggingUniversalInterceptor.ts # Server-specific universal interception
└── client/                    # NEW: Client-specific implementation
    ├── automaticClientLoggingBase.ts  # Browser-optimized withClientLogging
    ├── browserInterceptor.ts          # Browser runtime API wrapping
    ├── reactInterceptor.ts            # React-specific pattern detection
    ├── persistenceManager.ts          # Local drive/browser persistence
    └── initClientAutoLogging.ts       # Client initialization and setup
```

### 🔄 Integration Strategy

#### 1. Unified Request Tracing
```typescript
// Complete request flow with shared request IDs:
// 1. Client: Button click → withRequestId() generates "client-1761405857368-fwmg2w"
// 2. Client: withClientLogging() captures event with same request ID
// 3. Server: Server Action receives request ID via RequestIdContext
// 4. Server: withLogging() captures function calls with same request ID
// 5. Result: Both client.log and server.log contain same request ID for traceability
```

#### 2. Development Integration Bridge
```typescript
// instrumentation.ts - Extended for client logging support
export async function register() {
  // Existing server logging initialization...

  // Add client logging bridge endpoint for development
  if (process.env.NODE_ENV === 'development') {
    const { startClientLogServer } = await import('@/lib/logging/client/logServer');
    startClientLogServer(); // HTTP endpoint to receive client logs → client.log
  }
}
```

#### 3. Shared Configuration Management
```typescript
// src/lib/logging/shared/baseConfig.ts
export const createLoggingConfig = (type: 'server' | 'client') => ({
  ...defaultLogConfig,
  // Environment-specific defaults
  logOutputs: type === 'server',           // Server logs outputs, client doesn't (noise)
  maxInputLength: type === 'client' ? 100 : 1000,  // Shorter client logs for performance
  functionType: type === 'client' ? 'component' : undefined, // Client-specific field
});
```

### 🎯 Benefits of This Approach

#### ✅ Advantages
1. **Consistent Developer Experience** - Same `withLogging` signature and behavior patterns
2. **Shared Infrastructure** - Request IDs, configuration patterns, sanitization logic
3. **Unified Debugging** - Search across `client.log` + `server.log` by request ID
4. **Maintainable Architecture** - Changes to shared logic benefit both environments
5. **Incremental Implementation** - Can implement client logging without touching server code
6. **Environment Optimization** - Each system optimized for its specific constraints

#### 📊 Expected Unified Debugging Experience
```bash
# Search for a specific request across both logs
grep "client-1761405857368-fwmg2w" server.log client.log

# server.log
{"message":"Function getTagsForExplanationAction called","requestId":"client-1761405857368-fwmg2w","source":"server"}

# client.log
{"message":"eventHandler onClick(handleSubmit) called","requestId":"client-1761405857368-fwmg2w","source":"client"}
```

#### ⚠️ Implementation Guidelines
- **Minimal Shared Code**: Configuration utilities (~200 LOC), filtering patterns (~100 LOC)
- **Maximum Reuse**: Patterns and concepts, not actual implementation code
- **Independent Optimization**: Each environment can optimize without affecting the other
- **Consistent Interface**: Developers use the same patterns across client and server

## Naming Consistency & File Organization Strategy

### 🔍 Current State Analysis & Required Improvements

**Current Inconsistencies Found:**
- ❌ Generic file names: `moduleInterceptor.ts`, `runtimeWrapper.ts`, `universalInterceptor.ts`
- ❌ Inconsistent function naming: `setupAdvancedModuleInterception()` vs `setupRuntimeWrapping()`
- ❌ Documentation mismatches between files and proposed architecture

**Impact Assessment:** ✅ **SAFE TO RENAME**
- Only `automaticServerLoggingBase.ts` is imported externally (3 files: actions.ts, returnExplanation.ts, editorFiles/actions.ts)
- Other logging files only have internal dynamic imports within `automaticServerLoggingBase.ts`
- No breaking changes to existing automatic logging functionality

### 🎯 RECOMMENDED NAMING STRATEGY

#### **Phase 1: Server File Renaming (Immediate)**
```diff
Current Structure:
src/lib/logging/
├── automaticServerLoggingBase.ts      # ✅ Keep (already descriptive)
├── moduleInterceptor.ts               # 🔄 RENAME for clarity
├── runtimeWrapper.ts                  # 🔄 RENAME for clarity
└── universalInterceptor.ts            # 🔄 RENAME for clarity

Recommended Structure:
src/lib/logging/
├── automaticServerLoggingBase.ts                    # ✅ Keep unchanged
├── autoServerLoggingModuleInterceptor.ts           # 🆕 Clear purpose & scope
├── autoServerLoggingRuntimeWrapper.ts              # 🆕 Clear purpose & scope
└── autoServerLoggingUniversalInterceptor.ts        # 🆕 Clear purpose & scope
```

#### **Function Naming Standardization**
```diff
Current Functions:
- setupAdvancedModuleInterception()     # Too verbose, inconsistent
- setupRuntimeWrapping()               # Different tense (-ing vs -tion)
- setupUniversalInterception()         # Mixed terminology

Recommended Functions:
+ setupServerModuleInterception()      # Consistent pattern & scope
+ setupServerRuntimeInterception()     # Consistent pattern & scope
+ setupServerUniversalInterception()   # Consistent pattern & scope
```

#### **Required Code Changes (Minimal Impact)**
```typescript
// automaticServerLoggingBase.ts - Update dynamic imports (3 lines)
Promise.all([
- import('./moduleInterceptor').then(m => m.setupAdvancedModuleInterception),
- import('./runtimeWrapper').then(m => m.setupRuntimeWrapping),
- import('./universalInterceptor').then(m => m.setupUniversalInterception)
+ import('./autoServerLoggingModuleInterceptor').then(m => m.setupServerModuleInterception),
+ import('./autoServerLoggingRuntimeWrapper').then(m => m.setupServerRuntimeInterception),
+ import('./autoServerLoggingUniversalInterceptor').then(m => m.setupServerUniversalInterception)
])
```

### 🔧 Final Consistent Architecture

```
📁 src/lib/logging/
├── 📁 shared/                                       # NEW: Shared utilities
│   ├── autoLoggingBaseConfig.ts                   # Shared configuration patterns
│   ├── autoLoggingSanitization.ts                 # Shared sanitization utilities
│   ├── autoLoggingFiltering.ts                    # Shared filtering utilities
│   └── autoLoggingRequestFlow.ts                  # Request ID flow utilities
├── 📁 server/                                       # EXISTING: Server implementation
│   ├── automaticServerLoggingBase.ts              # ✅ Keep unchanged (external imports)
│   ├── autoServerLoggingModuleInterceptor.ts      # 🔄 Renamed for clarity
│   ├── autoServerLoggingRuntimeWrapper.ts         # 🔄 Renamed for clarity
│   └── autoServerLoggingUniversalInterceptor.ts   # 🔄 Renamed for clarity
└── 📁 client/                                       # NEW: Client implementation
    ├── automaticClientLoggingBase.ts              # Client withLogging equivalent
    ├── autoClientLoggingBrowserInterceptor.ts     # Browser API interception
    ├── autoClientLoggingReactInterceptor.ts       # React-specific patterns
    ├── autoClientLoggingPersistenceManager.ts     # Local storage/file handling
    └── initClientAutoLogging.ts                   # Client initialization
```

### 📋 Implementation Priority

#### **Phase 1: Server Renaming (Recommended First)**
**Benefits:**
- ✅ **Zero Breaking Changes** - Only internal references affected
- ✅ **Establishes Pattern** - Sets naming convention for client implementation
- ✅ **Immediate Clarity** - File purpose obvious from name
- ✅ **Future-Proof** - Pattern scales for additional logging types

**Required Changes:**
1. Rename 3 server files with `autoServerLogging` prefix
2. Update 3 dynamic import paths in `automaticServerLoggingBase.ts`
3. Rename 3 function names for consistency
4. Update documentation references

**Risk:** ⭐ **LOW** - No external import changes needed

#### **Phase 2: Client Implementation (Use New Naming)**
**Benefits:**
- ✅ **Start Fresh** - No legacy naming issues
- ✅ **Consistent Pattern** - Follows established server naming
- ✅ **Clear Distinction** - Easy to identify client vs server files
- ✅ **IDE Benefits** - Autocomplete groups related files together

#### **Phase 3: Shared Utilities (Follow Pattern)**
**Benefits:**
- ✅ **Proven Pattern** - Uses naming established in phases 1 & 2
- ✅ **Logical Grouping** - `autoLogging` prefix for all shared utilities
- ✅ **Maintainable** - Clear separation of concerns

### 🎯 Critical Benefits of This Approach

1. **🔍 Self-Documenting Structure** - File purpose clear from name
2. **🚀 Developer Onboarding** - New team members understand structure immediately
3. **🔧 Easy Maintenance** - Related files grouped by naming convention
4. **📊 IDE Navigation** - Autocomplete shows related files together
5. **🎯 Future Scaling** - Pattern works for additional logging types (mobile, worker, etc.)

**Recommendation:** Implement Phase 1 server renaming immediately to establish the pattern, then proceed with client implementation using consistent naming. This maximizes clarity while minimizing risk! 🎯

## Integration Points
1. **Build Config**: Add transform plugin to `next.config.js`
2. **App Component**: Initialize client logging in `_app.tsx`
3. **Development**: Add local log server endpoint
4. **Components**: Zero changes needed (automatic at build time)

## Expected Log Output
```json
{
  "timestamp": "2024-10-25T15:30:00Z",
  "level": "INFO",
  "message": "React Event onClick(handleSubmit) called",
  "data": { "component": "SearchBar", "event": "submit" },
  "requestId": "client-1761405857368-fwmg2w",
  "functionType": "eventHandler",
  "duration": "2ms"
}
```

## Benefits
- ✅ **Zero manual changes** to existing React components
- ✅ **Request ID correlation** with server-side logs
- ✅ **Local development** log files for debugging
- ✅ **Build-time optimization** with minimal runtime overhead
- ✅ **React-aware logging** of hooks and lifecycle events
- ✅ **Async operation tracking** for complete request flows

## Current State Analysis

**✅ Strong Foundation Already Exists:**
- Server-side automatic logging with 3-phase approach (module interception, runtime wrapping, universal interception)
- Client-side logger with request ID integration in `client_utilities.ts`
- Next.js 15.2.3 with Turbopack build system
- React components with async operations, event handlers, and state management

**🎯 Key Client-Side Function Patterns Identified:**
- React event handlers (`handleSubmit`, `handleProgressUpdate`)
- Async server action calls (`runAISuggestionsPipelineAction`)
- State updates (`useState`, `useCallback`, `useEffect`)
- Promise chains and error handling
- Timer-based operations

## Architecture: Three-Phase Approach (Adapted for Browser)

#### **Phase 1: Build-Time Module Interception (60% Coverage)**
**Challenge:** No access to Node.js `Module._load` in browsers
**Solution:** Leverage Next.js/Turbopack build-time transforms

#### **Phase 2: Runtime Wrapper Interception (30% Coverage)**
**Target:** Browser-specific async patterns
- Promise chains (fetch, server actions)
- Event handlers (onClick, onSubmit, onChange)
- Timer functions (setTimeout, setInterval)
- Array processing callbacks

#### **Phase 3: React Lifecycle Interception (10% Coverage)**
**Target:** React-specific patterns
- Component lifecycle hooks (useEffect, useCallback)
- State updates (useState setters)
- Event handlers in JSX

## Detailed Implementation Strategy

### Core withClientLogging Function

Following the server-side pattern, create a client-side wrapper:

```typescript
// src/lib/logging/client/clientLoggingBase.ts
import { logger } from '@/lib/client_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';

export interface ClientLogConfig {
  enabled: boolean;
  logInputs: boolean;
  logOutputs: boolean;
  logErrors: boolean;
  maxInputLength: number;
  maxOutputLength: number;
  sensitiveFields: string[];
  functionType?: 'component' | 'eventHandler' | 'hook' | 'async';
}

const defaultClientLogConfig: ClientLogConfig = {
  enabled: true,
  logInputs: true,
  logOutputs: false, // Prevent DOM log spam
  logErrors: true,
  maxInputLength: 200,
  maxOutputLength: 500,
  sensitiveFields: ['password', 'token', 'apiKey', 'secret'],
  functionType: 'component'
};

export function withClientLogging<T extends (...args: any[]) => any>(
  fn: T,
  functionName: string,
  config: Partial<ClientLogConfig> = {}
): T {
  const finalConfig = { ...defaultClientLogConfig, ...config };

  if (!finalConfig.enabled) {
    return fn;
  }

  return ((...args: Parameters<T>): ReturnType<T> => {
    const startTime = performance.now();
    const sanitizedArgs = finalConfig.logInputs ? sanitizeClientData(args, finalConfig) : undefined;

    // Log function entry
    logger.info(`${finalConfig.functionType} ${functionName} called`, {
      inputs: sanitizedArgs,
      timestamp: new Date().toISOString(),
      component: getComponentName(),
      userAgent: navigator.userAgent.substring(0, 50)
    });

    try {
      const result = fn(...args);

      // Handle both synchronous and asynchronous functions
      if (result instanceof Promise) {
        return result
          .then((resolvedResult) => {
            const duration = performance.now() - startTime;
            const sanitizedResult = finalConfig.logOutputs ? sanitizeClientData(resolvedResult, finalConfig) : undefined;

            logger.info(`${finalConfig.functionType} ${functionName} completed successfully`, {
              outputs: sanitizedResult,
              duration: `${duration.toFixed(2)}ms`,
              timestamp: new Date().toISOString()
            });

            return resolvedResult;
          })
          .catch((error) => {
            const duration = performance.now() - startTime;

            if (finalConfig.logErrors) {
              logger.error(`${finalConfig.functionType} ${functionName} failed`, {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                duration: `${duration.toFixed(2)}ms`,
                timestamp: new Date().toISOString()
              });
            }

            throw error;
          }) as ReturnType<T>;
      } else {
        // Synchronous function
        const duration = performance.now() - startTime;
        const sanitizedResult = finalConfig.logOutputs ? sanitizeClientData(result, finalConfig) : undefined;

        logger.info(`${finalConfig.functionType} ${functionName} completed successfully`, {
          outputs: sanitizedResult,
          duration: `${duration.toFixed(2)}ms`,
          timestamp: new Date().toISOString()
        });

        return result;
      }
    } catch (error) {
      // Synchronous error
      const duration = performance.now() - startTime;

      if (finalConfig.logErrors) {
        logger.error(`${finalConfig.functionType} ${functionName} failed`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          duration: `${duration.toFixed(2)}ms`,
          timestamp: new Date().toISOString()
        });
      }

      throw error;
    }
  }) as T;
}

function sanitizeClientData(data: any, config: ClientLogConfig): any {
  // Similar to server-side sanitization but adapted for browser objects
  if (!data || typeof data !== 'object') {
    return data;
  }

  // Handle DOM elements
  if (data instanceof HTMLElement) {
    return `<${data.tagName.toLowerCase()}${data.id ? ` id="${data.id}"` : ''}${data.className ? ` class="${data.className}"` : ''}>`;
  }

  // Handle Events
  if (data instanceof Event) {
    return {
      type: data.type,
      target: data.target instanceof HTMLElement ? `<${data.target.tagName.toLowerCase()}>` : 'unknown',
      timestamp: data.timeStamp
    };
  }

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizeClientData(item, config));
  }

  for (const [key, value] of Object.entries(sanitized)) {
    // Remove sensitive fields
    if (config.sensitiveFields?.some(field =>
      key.toLowerCase().includes(field.toLowerCase())
    )) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Truncate long string values
    if (typeof value === 'string') {
      const maxLength = key.includes('input') ? config.maxInputLength : config.maxOutputLength;
      if (maxLength && value.length > maxLength) {
        sanitized[key] = value.substring(0, maxLength) + '...';
      }
    }

    // Recursively sanitize nested objects
    if (value && typeof value === 'object') {
      sanitized[key] = sanitizeClientData(value, config);
    }
  }

  return sanitized;
}

function getComponentName(): string {
  // Try to extract component name from call stack
  const stack = new Error().stack;
  if (stack) {
    const lines = stack.split('\n');
    for (const line of lines) {
      if (line.includes('.tsx') || line.includes('.jsx')) {
        const match = line.match(/([A-Z][a-zA-Z]+)/);
        if (match) {
          return match[1];
        }
      }
    }
  }
  return 'UnknownComponent';
}
```

### Runtime Browser Interception

```typescript
// src/lib/logging/client/runtimeInterceptor.ts
import { withClientLogging } from './clientLoggingBase';

export function setupClientRuntimeInterception() {
  if (typeof window === 'undefined') return; // Client-side only

  const wrappedFunctions = new WeakSet();

  function shouldSkipClientFunction(fn: Function, name: string): boolean {
    // Skip React internals and framework code
    const skipPatterns = [
      'React',
      '__webpack',
      '__next',
      'node_modules',
      'react-dom',
      'scheduler',
      'useState',
      'useEffect',
      'useCallback'
    ];

    const fnString = fn.toString();
    return skipPatterns.some(pattern =>
      fnString.includes(pattern) ||
      name.includes(pattern)
    ) || fnString.length < 20;
  }

  function wrapClientCallback(fn: Function, name: string, type: string): Function {
    if (wrappedFunctions.has(fn) || shouldSkipClientFunction(fn, name)) return fn;

    const wrapped = withClientLogging(fn as any, name, {
      enabled: true,
      logInputs: true,
      logOutputs: false,
      logErrors: true,
      maxInputLength: 100,
      functionType: type as any
    });

    wrappedFunctions.add(wrapped);
    wrappedFunctions.add(fn);
    return wrapped;
  }

  // Wrap Promise methods
  const originalThen = Promise.prototype.then;
  Promise.prototype.then = function(onFulfilled, onRejected) {
    if (typeof onFulfilled === 'function') {
      const fnName = onFulfilled.name || 'anonymous';
      onFulfilled = wrapClientCallback(onFulfilled, `promise.then(${fnName})`, 'async');
    }
    if (typeof onRejected === 'function') {
      const fnName = onRejected.name || 'anonymous';
      onRejected = wrapClientCallback(onRejected, `promise.catch(${fnName})`, 'async');
    }
    return originalThen.call(this, onFulfilled, onRejected);
  };

  // Wrap setTimeout/setInterval
  const originalSetTimeout = window.setTimeout;
  window.setTimeout = function(callback: Function, delay: number, ...args: any[]) {
    if (typeof callback === 'function') {
      const fnName = callback.name || 'anonymous';
      callback = wrapClientCallback(callback, `setTimeout(${fnName})`, 'async');
    }
    return originalSetTimeout.call(this, callback, delay, ...args);
  };

  const originalSetInterval = window.setInterval;
  window.setInterval = function(callback: Function, delay: number, ...args: any[]) {
    if (typeof callback === 'function') {
      const fnName = callback.name || 'anonymous';
      callback = wrapClientCallback(callback, `setInterval(${fnName})`, 'async');
    }
    return originalSetInterval.call(this, callback, delay, ...args);
  };

  // Wrap addEventListener
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type: string, listener: any, options?: any) {
    if (typeof listener === 'function') {
      const fnName = listener.name || 'anonymous';
      listener = wrapClientCallback(listener, `addEventListener.${type}(${fnName})`, 'eventHandler');
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // Wrap Array methods
  ['map', 'filter', 'forEach', 'reduce'].forEach(method => {
    const original = Array.prototype[method as keyof Array.prototype] as Function;
    (Array.prototype as any)[method] = function(callback: Function, ...args: any[]) {
      if (typeof callback === 'function') {
        const fnName = callback.name || 'anonymous';
        callback = wrapClientCallback(callback, `Array.${method}(${fnName})`, 'async');
      }
      return original.call(this, callback, ...args);
    };
  });
}
```

### Local Drive Persistence

```typescript
// src/lib/logging/client/logPersistence.ts

interface ClientLogEntry {
  timestamp: string;
  level: string;
  message: string;
  data: any;
  requestId: string;
}

class ClientLogPersistence {
  private logBuffer: ClientLogEntry[] = [];
  private fileHandle: FileSystemFileHandle | null = null;
  private dbName = 'ClientLogs';
  private storeName = 'logs';

  async initialize() {
    // Try File System Access API first
    if ('showSaveFilePicker' in window) {
      await this.initFileSystemAPI();
    } else {
      // Fallback to IndexedDB
      await this.initIndexedDB();
    }
  }

  private async initFileSystemAPI() {
    try {
      // Only request file handle in development
      if (process.env.NODE_ENV === 'development') {
        this.fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: `client-logs-${Date.now()}.log`,
          types: [{
            description: 'Log files',
            accept: { 'text/plain': ['.log'] }
          }]
        });
      }
    } catch (error) {
      console.warn('File System Access API not available, falling back to IndexedDB');
      await this.initIndexedDB();
    }
  }

  private async initIndexedDB() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('requestId', 'requestId', { unique: false });
        }
      };
    });
  }

  async writeLog(entry: ClientLogEntry) {
    this.logBuffer.push(entry);

    // Write to file if available
    if (this.fileHandle) {
      await this.writeToFile(entry);
    } else {
      await this.writeToIndexedDB(entry);
    }

    // Also send to local development server if available
    if (process.env.NODE_ENV === 'development') {
      await this.sendToLocalServer(entry);
    }
  }

  private async writeToFile(entry: ClientLogEntry) {
    try {
      const writable = await this.fileHandle!.createWritable({ keepExistingData: true });
      await writable.seek(await this.getFileSize());
      await writable.write(JSON.stringify(entry) + '\n');
      await writable.close();
    } catch (error) {
      console.warn('Failed to write to file:', error);
    }
  }

  private async writeToIndexedDB(entry: ClientLogEntry) {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);

        store.add({
          ...entry,
          id: Date.now() + Math.random() // Simple ID generation
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };

      request.onerror = () => reject(request.error);
    });
  }

  private async sendToLocalServer(entry: ClientLogEntry) {
    try {
      await fetch('http://localhost:3001/api/client-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
    } catch (error) {
      // Silently fail if local server not available
    }
  }

  private async getFileSize(): Promise<number> {
    try {
      const file = await this.fileHandle!.getFile();
      return file.size;
    } catch {
      return 0;
    }
  }

  async exportLogs(): Promise<void> {
    // Export logs from IndexedDB as downloadable file
    const logs = await this.getAllLogsFromIndexedDB();
    const content = logs.map(log => JSON.stringify(log)).join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `client-logs-export-${Date.now()}.log`;
    a.click();

    URL.revokeObjectURL(url);
  }

  private async getAllLogsFromIndexedDB(): Promise<ClientLogEntry[]> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => resolve(getAllRequest.result);
        getAllRequest.onerror = () => reject(getAllRequest.error);
      };

      request.onerror = () => reject(request.error);
    });
  }
}

export const clientLogPersistence = new ClientLogPersistence();
```

### Integration and Initialization

```typescript
// src/lib/logging/client/initClientAutoLogging.ts
import { setupClientRuntimeInterception } from './runtimeInterceptor';
import { clientLogPersistence } from './logPersistence';

export async function initializeClientAutoLogging() {
  if (typeof window === 'undefined') return; // Client-side only

  try {
    // Initialize log persistence
    await clientLogPersistence.initialize();

    // Setup runtime interception
    setupClientRuntimeInterception();

    console.log('🔧 Client-side automatic logging initialized');
  } catch (error) {
    console.warn('⚠️ Failed to initialize client-side automatic logging:', error);
  }
}

// Export function to manually export logs
export async function exportClientLogs() {
  await clientLogPersistence.exportLogs();
}
```

### Integration in App Component

```typescript
// src/app/layout.tsx or _app.tsx
'use client';

import { useEffect } from 'react';
import { initializeClientAutoLogging } from '@/lib/logging/client/initClientAutoLogging';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize client-side automatic logging
    initializeClientAutoLogging();
  }, []);

  return (
    <html>
      <body>
        {children}
      </body>
    </html>
  );
}
```

## Development Server Endpoint

```typescript
// pages/api/client-logs.ts or app/api/client-logs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import { join } from 'path';

const clientLogFile = join(process.cwd(), 'client.log');

export async function POST(request: NextRequest) {
  try {
    const logEntry = await request.json();

    // Append to client.log file
    const logLine = JSON.stringify({
      ...logEntry,
      source: 'client'
    }) + '\n';

    appendFileSync(clientLogFile, logLine);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to write client log:', error);
    return NextResponse.json({ error: 'Failed to write log' }, { status: 500 });
  }
}
```

## Expected Results

### Console Output
```
[INFO] eventHandler onClick(handleSubmit) called {
  inputs: [{ type: "submit", target: "<form>" }],
  component: "SearchBar",
  requestId: "client-1761405857368-fwmg2w"
}
```

### File Output (client.log)
```json
{"timestamp":"2024-10-25T15:30:00Z","level":"INFO","message":"eventHandler onClick(handleSubmit) called","data":{"inputs":[{"type":"submit","target":"<form>"}],"component":"SearchBar"},"requestId":"client-1761405857368-fwmg2w","source":"client"}
{"timestamp":"2024-10-25T15:30:02Z","level":"INFO","message":"async runAISuggestionsPipelineAction completed successfully","data":{"duration":"1250.50ms"},"requestId":"client-1761405857368-fwmg2w","source":"client"}
```

## Testing & Validation Strategy

### 🧪 Critical Testing Requirements

#### **1. Regression Testing: Ensure Zero Server-Side Impact**

**Goal:** Verify existing server logging continues to work exactly as before.

```bash
# BEFORE implementing client logging
# Baseline test: Generate sample server logs
npm run dev
# Trigger some server actions via UI
# Capture baseline server.log output

# AFTER implementing client logging
# Regression test: Ensure server logs unchanged
npm run dev
# Trigger same server actions via UI
# Compare server.log output (should be identical)
```

**Validation Checklist:**
- ✅ `server.log` format unchanged
- ✅ Server function call logging frequency unchanged
- ✅ Request ID correlation still works
- ✅ Server performance impact negligible (<5ms overhead)
- ✅ Automatic server logging interceptors still active

#### **2. Integration Testing: Verify Client-Server Correlation**

**Goal:** Ensure client and server logs correlate correctly via request IDs.

```typescript
// Test scenario: Complete user flow
// 1. Client button click → generates request ID
// 2. Server action call → receives same request ID
// 3. Both logs should contain same request ID

// Validation script:
async function testRequestCorrelation() {
  // Generate test request
  const testRequestId = `test-${Date.now()}`;

  // Trigger client action
  await triggerClientAction(testRequestId);

  // Wait for server processing
  await delay(2000);

  // Verify logs contain same request ID
  const serverLogs = await readServerLog();
  const clientLogs = await readClientLog();

  const serverEntry = serverLogs.find(log => log.requestId === testRequestId);
  const clientEntry = clientLogs.find(log => log.requestId === testRequestId);

  assert(serverEntry && clientEntry, 'Request ID correlation failed');
}
```

#### **3. Development Workflow Testing**

**Goal:** Ensure new logging enhances rather than disrupts development.

```bash
# Test: Development server integration
npm run dev

# Verify client.log appears automatically
ls -la | grep "client.log"  # Should exist
tail -f client.log           # Should show real-time logs

# Test: Log correlation search
grep "client-123" *.log      # Should find entries in both files

# Test: Performance impact
# Measure page load time with/without client logging
# Should be <10ms difference
```

#### **4. Browser Compatibility Testing**

**Goal:** Ensure client logging works across target browsers.

```typescript
// Test matrix:
// - Chrome/Edge (File System Access API supported)
// - Firefox/Safari (IndexedDB fallback)
// - Mobile browsers (IndexedDB only)

const testBrowserCompat = {
  chrome: () => testFileSystemAPI() && testIndexedDB(),
  firefox: () => testIndexedDB() && testDevServer(),
  safari: () => testIndexedDB() && testDevServer(),
  mobile: () => testIndexedDB()
};
```

#### **5. Error Handling & Resilience Testing**

**Goal:** Ensure logging failures don't break application functionality.

```typescript
// Test scenarios:
// 1. Development server unavailable
// 2. IndexedDB storage quota exceeded
// 3. Network failure during log streaming
// 4. Malformed log data
// 5. Client logging initialization failure

// Expected behavior: Graceful degradation
// - App continues to function normally
// - Fallback storage mechanisms activate
// - No unhandled errors in console
```

### 📋 Pre-Implementation Testing Checklist

```bash
# STEP 1: Capture current baseline
npm run dev
tail -f server.log > baseline_server.log &
# Use app for 5 minutes, trigger various actions
kill %1  # Stop tail

# STEP 2: Document current behavior
wc -l baseline_server.log                    # Count log entries
grep "Function.*called" baseline_server.log  # Count function calls
grep "requestId" baseline_server.log         # Verify request tracking

# STEP 3: Performance baseline
time npm run build  # Build time baseline
# Measure app load time in browser dev tools
```

### 📋 Post-Implementation Validation Checklist

```bash
# STEP 1: Regression verification
npm run dev
tail -f server.log > post_impl_server.log &
# Repeat same 5-minute app usage
kill %1

# Compare logs
diff baseline_server.log post_impl_server.log  # Should be minimal/no diff

# STEP 2: New functionality verification
tail -f client.log                     # Should show client events
grep "eventHandler" client.log         # Should find UI interactions
grep "client-.*-.*" *.log              # Should find correlated request IDs

# STEP 3: Performance validation
time npm run build                      # Should be within 10% of baseline
# Measure app load time (should be <10ms difference)
```

### 🔍 Continuous Monitoring

```typescript
// Add to development environment
if (process.env.NODE_ENV === 'development') {
  // Log health check every 30 seconds
  setInterval(() => {
    const serverLogSize = getFileSize('server.log');
    const clientLogSize = getFileSize('client.log');

    console.log(`📊 Log status - Server: ${serverLogSize}KB, Client: ${clientLogSize}KB`);

    // Alert if logs stop growing (indicates logging failure)
    if (timeSinceLastLog() > 60000) {
      console.warn('⚠️ Logging appears to have stopped');
    }
  }, 30000);
}
```

### 🚨 Rollback Plan

```typescript
// Quick disable mechanism
export const CLIENT_LOGGING_ENABLED = process.env.CLIENT_LOGGING !== 'false';

// Emergency disable:
// 1. Set CLIENT_LOGGING=false in .env.local
// 2. Restart dev server
// 3. Client logging completely disabled, server logging unaffected
```

This comprehensive plan provides automatic client-side logging that mirrors your server-side approach while handling browser-specific challenges, providing multiple persistence options, and ensuring zero regression risk.