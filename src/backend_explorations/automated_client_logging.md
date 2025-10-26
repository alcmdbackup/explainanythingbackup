# Client-Side Automatic Logging Implementation Plan

## Goal
Automatically log **USER-WRITTEN client-side** function calls, React events, and async operations to local drive, mirroring the server-side automatic logging approach.

## ⚠️ CRITICAL SAFETY REQUIREMENTS

### 🔄 Infinite Recursion Prevention (MANDATORY)

**Problem:** Client logging systems are extremely prone to infinite recursion because:
1. Logging functions use the same browser APIs we want to wrap (fetch, Promise, setTimeout)
2. Writing logs can trigger events that get logged again
3. Circular object references in sanitization can cause infinite loops

**REQUIRED Safeguards:**

#### 1. Re-entrance Guard System
```typescript
// Global re-entrance prevention
const LOGGING_IN_PROGRESS = new Set<string>();
const MAX_RECURSION_DEPTH = 3;
let currentRecursionDepth = 0;

function withRecursionGuard<T>(fn: () => T, operation: string): T | null {
  if (LOGGING_IN_PROGRESS.has(operation) || currentRecursionDepth >= MAX_RECURSION_DEPTH) {
    return null; // Silent abort - do not log
  }

  LOGGING_IN_PROGRESS.add(operation);
  currentRecursionDepth++;

  try {
    return fn();
  } finally {
    LOGGING_IN_PROGRESS.delete(operation);
    currentRecursionDepth--;
  }
}
```

#### 2. Logging System API Exclusion
```typescript
// NEVER wrap these APIs that logging system uses
const LOGGING_SYSTEM_APIS = [
  'fetch',           // Used for dev server streaming
  'XMLHttpRequest',  // HTTP requests
  'setTimeout',      // Log batching
  'setInterval',     // Periodic operations
  'requestIdleCallback', // Performance optimization
  'addEventListener', // File system events
  'indexedDB',       // Storage operations
  'console',         // Debug output
  'JSON.stringify',  // Log serialization
  'performance.now'  // Timing measurements
];
```

#### 3. Circular Reference Detection
```typescript
function sanitizeWithCircularCheck(data: any, seen = new WeakSet()): any {
  if (data && typeof data === 'object') {
    if (seen.has(data)) {
      return '[Circular Reference]';
    }
    seen.add(data);
  }
  // ... rest of sanitization
}
```

### 🎯 User Code Only - System Code Exclusion (MANDATORY)

**Problem:** Current filtering is insufficient. We must NEVER log:
- Browser APIs (fetch, setTimeout, addEventListener, etc.)
- Framework internals (React, Next.js, webpack)
- Node modules code
- Build system generated code
- Polyfills and shims

**REQUIRED Filtering Strategy:**

#### 1. File Path Whitelist (Build-Time)
```typescript
// ONLY transform files in these directories
const USER_CODE_DIRECTORIES = [
  '/src/',           // User source code
  '/app/',           // Next.js app directory
  '/pages/',         // Next.js pages
  '/components/',    // User components
  '/lib/',           // User utilities
  '/utils/'          // User utilities
];

// NEVER transform these paths
const SYSTEM_CODE_BLOCKLIST = [
  'node_modules/',
  '.next/',
  'dist/',
  'build/',
  '/__tests__/',
  '.turbo/',
  'webpack:',
  'react',
  'next'
];
```

#### 2. Function Origin Detection
```typescript
function isUserWrittenFunction(fn: Function, name: string): boolean {
  const fnString = fn.toString();

  // REJECT: Native browser APIs
  if (fnString.includes('[native code]')) return false;

  // REJECT: System function patterns
  const systemPatterns = [
    /^use[A-Z]/,        // React hooks
    /^__webpack/,       // Webpack internals
    /^__next/,          // Next.js internals
    /^React\./,         // React methods
    /scheduler/,        // React scheduler
    /node_modules/      // Dependencies
  ];

  if (systemPatterns.some(pattern => pattern.test(name) || pattern.test(fnString))) {
    return false;
  }

  // ACCEPT: Only if source location indicates user code
  const stack = new Error().stack;
  if (stack) {
    const userCodeFile = stack.split('\n').find(line =>
      USER_CODE_DIRECTORIES.some(dir => line.includes(dir)) &&
      !SYSTEM_CODE_BLOCKLIST.some(blocked => line.includes(blocked))
    );
    return !!userCodeFile;
  }

  return false;
}
```

#### 3. Conservative Wrapping Strategy
```typescript
// NEVER wrap browser/system APIs - only user exports
export function shouldWrapFunction(fn: Function, name: string, source: string): boolean {
  // Circuit breaker: If any recursion detected, stop all wrapping
  if (currentRecursionDepth > 0) return false;

  // Only wrap functions explicitly exported from user modules
  if (!source.startsWith('/src/') && !source.startsWith('/app/')) return false;

  // Never wrap if function uses logging system APIs
  const fnStr = fn.toString();
  if (LOGGING_SYSTEM_APIS.some(api => fnStr.includes(api))) return false;

  // Never wrap React/system patterns
  if (!isUserWrittenFunction(fn, name)) return false;

  // Additional safety: Function must be substantial user code
  return fnStr.length > 50 && fnStr.includes('return');
}
```

## REVISED: Conservative Three-Phase Implementation Strategy

### Phase 1: Build-Time User Function Wrapping (80% Coverage)
**SAFE: Transform only user-written code at build time**

1. **Conservative Babel/SWC Plugin**
   - `src/lib/logging/clientBuildTransform.js` - Build-time function wrapping
   - **ONLY** wrap functions exported from user modules in `/src/`, `/app/`, `/components/`
   - **NEVER** wrap React hooks, browser APIs, or framework code
   - Apply `shouldWrapFunction()` filters at build time

2. **User Function Pattern Detection**
   ```typescript
   // SAFE: Only wrap user-defined exports
   export function handleSubmit() { ... }        // ✅ WRAP
   export const handleClick = () => { ... }      // ✅ WRAP
   export async function fetchUserData() { ... } // ✅ WRAP

   // NEVER wrap system code
   useState()                                     // ❌ NEVER
   useEffect()                                    // ❌ NEVER
   fetch()                                        // ❌ NEVER
   Promise.then()                                 // ❌ NEVER
   ```

3. **Build-Time Safety Checks**
   - Verify file paths are in user directories
   - Reject functions that call logging system APIs
   - Add recursion guards to all wrapped functions

### Phase 2: Explicit User Event Handler Wrapping (15% Coverage)
**SAFE: Only wrap explicitly user-defined event handlers**

1. **Manual Component Wrapping** (NOT automatic browser API wrapping)
   ```typescript
   // SAFE: User explicitly wraps their own handlers
   const handleSubmit = withClientLogging(
     async (event) => { /* user code */ },
     'handleSubmit',
     { functionType: 'eventHandler' }
   );

   // NEVER: Automatic browser API wrapping
   // ❌ Promise.prototype.then = ...
   // ❌ window.setTimeout = ...
   // ❌ EventTarget.prototype.addEventListener = ...
   ```

2. **Opt-in Component Integration**
   ```typescript
   // User chooses to enable logging per component
   const MyComponent = withComponentLogging(() => {
     // Only user-written handlers get logged
     const handleClick = (e) => { /* user code */ };
     return <button onClick={handleClick}>Click</button>;
   });
   ```

### Phase 3: Development-Only Request Tracing (5% Coverage)
**SAFE: Minimal, development-only enhancements**

1. **Request ID Correlation** (existing functionality)
   - Use existing `RequestIdContext` - no changes needed
   - User actions → server actions already traced

2. **Manual Export Functions**
   ```typescript
   // SAFE: User explicitly calls these when needed
   export function logUserAction(name: string, data: any) { ... }
   export function exportClientLogs() { ... }
   ```

## ⚠️ ELIMINATED DANGEROUS APPROACHES

### ❌ Removed: Runtime Browser API Wrapping
**Reason: High infinite recursion risk**
- ~~`Promise.prototype.then` wrapping~~ → Logging system uses promises
- ~~`setTimeout/setInterval` wrapping~~ → Logging system uses timers
- ~~`addEventListener` wrapping~~ → Logging system uses events
- ~~`Array.prototype.map` wrapping~~ → Logging system uses arrays

### ❌ Removed: React Hook Interception
**Reason: System code, not user code**
- ~~`useState` setter wrapping~~ → React internal, causes infinite loops
- ~~`useEffect` callback wrapping~~ → React internal, not user code
- ~~`useCallback` wrapping~~ → React internal, performance impact

### ❌ Removed: Universal Function Interception
**Reason: Cannot distinguish user vs system code safely**
- ~~Module interception~~ → Too broad, catches system code
- ~~Runtime universal wrapping~~ → Causes infinite recursion

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
async function persistClientLogSafely(entry: ClientLogEntry) {
  // MANDATORY: Prevent infinite recursion in log persistence
  if (LOGGING_IN_PROGRESS.has('persist') || currentRecursionDepth > 0) {
    return; // Silent abort - do not log the logging
  }

  LOGGING_IN_PROGRESS.add('persist');

  try {
    // 1. Always store in IndexedDB (reliable backup)
    await indexedDBStoreSafely(entry);

    // 2. Try development server streaming (CAREFULLY - avoid recursion)
    if (process.env.NODE_ENV === 'development') {
      // Use native fetch directly (bypass any wrapping)
      try {
        await window.fetch('/api/client-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry)
        });
      } catch {
        // Silently fallback to IndexedDB only
        // NEVER log this error - would cause recursion
      }
    }

    // 3. File System API (if user opted in) - with error guards
    if (userFileHandle) {
      try {
        await writeToUserFileSafely(entry);
      } catch {
        // Silent fail - never log persistence errors
      }
    }
  } catch {
    // Silent fail - persistence should never crash the app
  } finally {
    LOGGING_IN_PROGRESS.delete('persist');
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

### SAFE Core withClientLogging Function

**Conservative implementation with mandatory recursion guards:**

```typescript
// src/lib/logging/client/safeClientLoggingBase.ts
import { logger } from '@/lib/client_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';

// Global recursion prevention (MANDATORY)
const LOGGING_IN_PROGRESS = new Set<string>();
const MAX_RECURSION_DEPTH = 3;
let currentRecursionDepth = 0;

export interface ClientLogConfig {
  enabled: boolean;
  logInputs: boolean;
  logOutputs: boolean;
  logErrors: boolean;
  maxInputLength: number;
  maxOutputLength: number;
  sensitiveFields: string[];
  functionType?: 'userFunction' | 'userEventHandler' | 'userAsync';
}

const defaultClientLogConfig: ClientLogConfig = {
  enabled: process.env.NODE_ENV === 'development', // Development only
  logInputs: true,
  logOutputs: false, // Prevent DOM log spam
  logErrors: true,
  maxInputLength: 100, // Shorter for safety
  maxOutputLength: 200,
  sensitiveFields: ['password', 'token', 'apiKey', 'secret', 'key'],
  functionType: 'userFunction'
};

export function withClientLogging<T extends (...args: any[]) => any>(
  fn: T,
  functionName: string,
  config: Partial<ClientLogConfig> = {}
): T {
  const finalConfig = { ...defaultClientLogConfig, ...config };

  // Safety check: Only wrap in development
  if (!finalConfig.enabled || process.env.NODE_ENV !== 'development') {
    return fn;
  }

  // Safety check: Prevent wrapping logging system functions
  const fnString = fn.toString();
  if (fnString.includes('logger.') || fnString.includes('console.') || fnString.includes('fetch(')) {
    return fn; // Silent abort - do not wrap
  }

  const logKey = `${functionName}-${Date.now()}`;

  return ((...args: Parameters<T>): ReturnType<T> => {
    // MANDATORY: Recursion guard
    if (LOGGING_IN_PROGRESS.has(logKey) || currentRecursionDepth >= MAX_RECURSION_DEPTH) {
      return fn(...args); // Execute without logging
    }

    // MANDATORY: Add to in-progress set
    LOGGING_IN_PROGRESS.add(logKey);
    currentRecursionDepth++;

    try {
      const startTime = performance.now();
      let sanitizedArgs: any;

      // Safe sanitization with recursion guard
      try {
        sanitizedArgs = finalConfig.logInputs ?
          sanitizeWithCircularCheck(args, new WeakSet()) :
          undefined;
      } catch {
        sanitizedArgs = '[Sanitization Failed]';
      }

      // Safe logging with try-catch
      try {
        logger.info(`${finalConfig.functionType} ${functionName} called`, {
          inputs: sanitizedArgs,
          timestamp: new Date().toISOString(),
          source: 'client-safe'
        });
      } catch {
        // Silent fail - logging should never break user code
      }

      const result = fn(...args);

      // Handle async results safely
      if (result instanceof Promise) {
        return result
          .then((resolvedResult) => {
            try {
              const duration = performance.now() - startTime;
              logger.info(`${finalConfig.functionType} ${functionName} completed`, {
                duration: `${duration.toFixed(2)}ms`,
                timestamp: new Date().toISOString()
              });
            } catch {
              // Silent fail
            }
            return resolvedResult;
          })
          .catch((error) => {
            try {
              if (finalConfig.logErrors) {
                logger.error(`${finalConfig.functionType} ${functionName} failed`, {
                  error: error instanceof Error ? error.message : String(error),
                  timestamp: new Date().toISOString()
                });
              }
            } catch {
              // Silent fail
            }
            throw error;
          }) as ReturnType<T>;
      } else {
        // Synchronous function
        try {
          const duration = performance.now() - startTime;
          logger.info(`${finalConfig.functionType} ${functionName} completed`, {
            duration: `${duration.toFixed(2)}ms`,
            timestamp: new Date().toISOString()
          });
        } catch {
          // Silent fail
        }
        return result;
      }
    } catch (error) {
      // Log synchronous errors safely
      try {
        if (finalConfig.logErrors) {
          logger.error(`${finalConfig.functionType} ${functionName} failed`, {
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
        }
      } catch {
        // Silent fail
      }
      throw error;
    } finally {
      // MANDATORY: Always clean up recursion guards
      LOGGING_IN_PROGRESS.delete(logKey);
      currentRecursionDepth--;
    }
  }) as T;
}

// SAFE sanitization with circular reference protection
function sanitizeWithCircularCheck(data: any, seen = new WeakSet(), depth = 0): any {
  // Prevent deep recursion
  if (depth > 5) return '[Max Depth Reached]';

  if (!data || typeof data !== 'object') {
    return data;
  }

  // Circular reference protection
  if (seen.has(data)) {
    return '[Circular Reference]';
  }
  seen.add(data);

  // Handle DOM elements safely
  if (data instanceof HTMLElement) {
    return `<${data.tagName.toLowerCase()}${data.id ? ` id="${data.id}"` : ''}>`;
  }

  // Handle Events safely
  if (data instanceof Event) {
    return {
      type: data.type,
      target: 'HTMLElement',
      timestamp: data.timeStamp
    };
  }

  // Handle Functions (log but don't traverse)
  if (typeof data === 'function') {
    return `[Function: ${data.name || 'anonymous'}]`;
  }

  try {
    const sanitized = Array.isArray(data) ? [] : {};

    if (Array.isArray(data)) {
      // Limit array size for safety
      const maxItems = Math.min(data.length, 10);
      for (let i = 0; i < maxItems; i++) {
        sanitized[i] = sanitizeWithCircularCheck(data[i], seen, depth + 1);
      }
      if (data.length > 10) {
        sanitized.push(`[... ${data.length - 10} more items]`);
      }
    } else {
      // Limit object properties for safety
      const entries = Object.entries(data).slice(0, 10);
      for (const [key, value] of entries) {
        // Remove sensitive fields
        if (['password', 'token', 'secret', 'key', 'apiKey'].some(field =>
          key.toLowerCase().includes(field.toLowerCase())
        )) {
          sanitized[key] = '[REDACTED]';
          continue;
        }

        // Truncate long strings
        if (typeof value === 'string' && value.length > 100) {
          sanitized[key] = value.substring(0, 100) + '...';
          continue;
        }

        // Recursively sanitize
        sanitized[key] = sanitizeWithCircularCheck(value, seen, depth + 1);
      }

      if (Object.keys(data).length > 10) {
        sanitized['...'] = `[${Object.keys(data).length - 10} more properties]`;
      }
    }

    return sanitized;
  } catch (error) {
    return '[Sanitization Error]';
  }
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

### ❌ DANGEROUS RUNTIME INTERCEPTION REMOVED

**⚠️ WARNING: The following approach was REMOVED due to infinite recursion risks:**

```typescript
// ❌ NEVER DO THIS - Causes infinite recursion
// Promise.prototype.then = ...
// window.setTimeout = ...
// EventTarget.prototype.addEventListener = ...
```

**Why this is dangerous:**
1. **Infinite Recursion**: Logging system uses promises, timers, and events
2. **System Code Pollution**: Wraps framework and browser internals
3. **Performance Impact**: Every single Promise/timer gets wrapped
4. **Debugging Nightmare**: Stack traces become unreadable

### ✅ SAFE ALTERNATIVE: Manual User Code Wrapping

**Instead of dangerous runtime interception, use explicit user code wrapping:**

```typescript
// src/lib/logging/client/safeUserCodeWrapper.ts

// SAFE: User explicitly chooses what to log
export function createSafeEventHandler<T extends Function>(
  fn: T,
  name: string
): T {
  // Only wrap in development, with full safety guards
  if (process.env.NODE_ENV !== 'development') return fn;

  return withClientLogging(fn, name, {
    functionType: 'userEventHandler',
    enabled: true,
    logInputs: true,
    logOutputs: false
  });
}

// SAFE: User explicitly wraps their async functions
export function createSafeAsyncFunction<T extends Function>(
  fn: T,
  name: string
): T {
  if (process.env.NODE_ENV !== 'development') return fn;

  return withClientLogging(fn, name, {
    functionType: 'userAsync',
    enabled: true,
    logInputs: true,
    logOutputs: false
  });
}

// SAFE: Optional component-level logging
export function withComponentLogging<T extends Function>(
  component: T,
  componentName?: string
): T {
  if (process.env.NODE_ENV !== 'development') return component;

  // Only log the top-level component render, not internals
  return withClientLogging(component, componentName || 'Component', {
    functionType: 'userFunction',
    enabled: true,
    logInputs: false, // Avoid logging props (performance)
    logOutputs: false // Avoid logging JSX (noise)
  });
}
```

### Usage Examples (SAFE)

```typescript
// User manually opts into logging for their code
export const MyComponent = withComponentLogging(() => {
  // User explicitly wraps their event handlers
  const handleSubmit = createSafeEventHandler(
    async (event: FormEvent) => {
      // User code that gets logged safely
      await submitForm(event);
    },
    'handleSubmit'
  );

  // User explicitly wraps their async operations
  const fetchData = createSafeAsyncFunction(
    async () => {
      // User code that gets logged safely
      const data = await fetch('/api/data');
      return data.json();
    },
    'fetchData'
  );

  return <form onSubmit={handleSubmit}>...</form>;
});

// NEVER automatically wrapped:
// - Promise.prototype.then ❌
// - setTimeout/setInterval ❌
// - addEventListener ❌
// - Array.prototype.map ❌
// - React hooks ❌
// - Browser APIs ❌
```
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

## 🔒 FINAL SAFETY SUMMARY

### ✅ MANDATORY Safety Requirements Implemented

1. **Infinite Recursion Prevention**
   - ✅ Re-entrance guards on all logging operations
   - ✅ Maximum recursion depth limits (3 levels)
   - ✅ Never wrap APIs that logging system uses
   - ✅ Silent failure modes for all logging operations
   - ✅ Circular reference detection in sanitization

2. **User Code Only Filtering**
   - ✅ File path whitelist: only `/src/`, `/app/`, `/components/`
   - ✅ System code blocklist: `node_modules/`, React internals, browser APIs
   - ✅ Function origin detection via stack traces
   - ✅ Conservative wrapping strategy with explicit opt-in

3. **Development Only Operation**
   - ✅ Completely disabled in production
   - ✅ No performance impact on production builds
   - ✅ Easy emergency disable via environment variable

### ⚠️ CRITICAL "NEVER DO" List

1. **NEVER wrap these APIs** (infinite recursion risk):
   - ❌ `Promise.prototype.then/catch/finally`
   - ❌ `setTimeout/setInterval/requestAnimationFrame`
   - ❌ `EventTarget.prototype.addEventListener`
   - ❌ `fetch/XMLHttpRequest`
   - ❌ `Array.prototype.map/filter/forEach`
   - ❌ `console.*` methods
   - ❌ `JSON.stringify/parse`
   - ❌ `performance.*` APIs

2. **NEVER log these system components**:
   - ❌ React hooks (`useState`, `useEffect`, etc.)
   - ❌ Next.js internals
   - ❌ Webpack/build system code
   - ❌ Browser polyfills and shims
   - ❌ Node modules dependencies

3. **NEVER assume safety**:
   - ❌ Always use try-catch around logging operations
   - ❌ Never let logging errors crash user code
   - ❌ Never log without recursion guards
   - ❌ Never enable in production without explicit opt-in

### 📋 REQUIRED Testing Checklist

#### Infinite Recursion Testing (CRITICAL)
```typescript
// Test: Logging system doesn't log itself
function testLoggingSystemExclusion() {
  const logger = createTestLogger();
  const wrappedLogger = withClientLogging(logger.info, 'loggerTest');
  wrappedLogger('test message'); // Should NOT create recursive logs

  assert(getLogCount() === 1, 'Logging system logged itself - RECURSION RISK');
}

// Test: Maximum recursion depth respected
function testRecursionDepthLimit() {
  const deepFunction = (depth: number) => {
    if (depth > 0) return deepFunction(depth - 1);
    return 'done';
  };

  const wrapped = withClientLogging(deepFunction, 'deepTest');
  wrapped(10); // Should not exceed MAX_RECURSION_DEPTH

  assert(currentRecursionDepth === 0, 'Recursion depth not properly reset');
}

// Test: Circular reference handling
function testCircularReferences() {
  const obj: any = { name: 'test' };
  obj.self = obj; // Circular reference

  const wrappedFn = withClientLogging(() => obj, 'circularTest');
  const result = wrappedFn(); // Should not cause infinite loop

  assert(result.self === '[Circular Reference]', 'Circular reference not handled');
}
```

#### User Code vs System Code Testing (CRITICAL)
```typescript
// Test: System code rejection
function testSystemCodeRejection() {
  const systemFunction = Promise.prototype.then;
  const shouldWrap = shouldWrapFunction(systemFunction, 'then', 'system');

  assert(!shouldWrap, 'System code was not rejected - POLLUTION RISK');
}

// Test: User code acceptance
function testUserCodeAcceptance() {
  const userFunction = function handleSubmit() { return 'user code'; };
  const shouldWrap = shouldWrapFunction(userFunction, 'handleSubmit', '/src/components/Form.tsx');

  assert(shouldWrap, 'User code was rejected - MISSING LOGS');
}
```

### 🚨 Emergency Disable

```bash
# If infinite recursion occurs, immediately disable:
echo "CLIENT_LOGGING=false" >> .env.local
# Restart development server
npm run dev
```

This **SAFE, CONSERVATIVE** plan provides client-side logging for USER CODE ONLY while preventing infinite recursion and system code pollution. The emphasis is on safety over coverage.