# Simple Build-Time Auto-Logging Approach

## Core Intuition
Wrap functions **at build time** (AST transform) to log **args + return/throw** on every call. Don't monkey-patch at runtime; don't change function identity. Ship logs via a tiny batched sink.

## Architecture Overview

**Tooling:** SWC/Babel (or TS transformer) that instruments your own code (skip `node_modules`)
**Heuristics:** Include everything under `src/**`, but **skip React components** (PascalCase returning JSX) and **hooks** (`use*`) to avoid noise—toggleable if needed

### What the Transform Does

For each function (declaration, arrow fn, class method), rewrite the body to call a helper that logs:
- Function name (`modulePath#fnName`)
- Arguments (redacted/trimmed)
- Duration
- Return value (or error)
- For `async`, logs **after resolution/rejection**

**Key:** Identity is preserved (no wrapper reassignments), so React dependency arrays keep working.

## Production-Safe Runtime Implementation

```typescript
// telemetry/logger.ts
type Log = {
  fn: string;
  phase: "ok" | "err";
  dur: number;
  args: unknown[];
  ret?: unknown;
  err?: string;
  ts: number;
};

// CRITICAL: Multi-layered recursion protection
const LOGGING_IN_PROGRESS = new Set<string>();
const MAX_RECURSION_DEPTH = 3;
const MAX_QUEUE_SIZE = 1000;
let currentRecursionDepth = 0;
let isSystemInCriticalState = false;

const queue: Log[] = [];
let flushTimer: number | null = null;

// CRITICAL: APIs that telemetry systems use - NEVER instrument these
const TELEMETRY_SYSTEM_APIS = [
  'fetch',              // HTTP requests for log streaming
  'XMLHttpRequest',     // HTTP requests
  'setTimeout',         // Log batching delays
  'setInterval',        // Periodic operations
  'clearTimeout',       // Timer cleanup
  'clearInterval',      // Timer cleanup
  'requestIdleCallback', // Performance optimization
  'cancelIdleCallback', // Performance cleanup
  'addEventListener',   // Event monitoring
  'removeEventListener', // Event cleanup
  'indexedDB',          // Storage operations
  'localStorage',       // Storage operations
  'sessionStorage',     // Storage operations
  'console',            // Debug output
  'JSON.stringify',     // Log serialization
  'JSON.parse',         // Data parsing
  'performance.now',    // Timing measurements
  'performance.mark',   // Performance markers
  'performance.measure', // Performance measurement
  'Date.now',           // Timestamps
  'Math.random',        // ID generation
  'Math.floor',         // Number operations
  'crypto.randomUUID',  // ID generation
  'crypto.getRandomValues', // Random generation
  'WeakMap',            // Internal tracking
  'WeakSet',            // Internal tracking
  'Map',                // Internal state
  'Set',                // Internal state
  'Array.from',         // Data conversion
  'Object.keys',        // Object inspection
  'Object.entries',     // Object inspection
  'String.prototype.slice', // String operations
  'String.prototype.substring', // String operations
  'navigator.sendBeacon', // Network requests
  'Blob',               // Data packaging
  'Promise.resolve',    // Async operations
  'Promise.reject',     // Async operations
  'window.postMessage', // Communication
  'Error.captureStackTrace', // Error handling
  'Error.prepareStackTrace'  // Error handling
];

// Emergency management system
class EmergencyManager {
  private errorCount = 0;
  private maxErrors = 10;
  private errorWindow = 60000; // 1 minute
  private lastErrorTime = 0;
  private isEmergencyShutdown = false;

  checkEmergencyConditions(): boolean {
    if (this.isEmergencyShutdown || isSystemInCriticalState) {
      return false;
    }

    const now = Date.now();

    // Reset error window if enough time has passed
    if (now - this.lastErrorTime > this.errorWindow) {
      this.errorCount = 0;
    }

    // If too many errors in time window, trigger emergency shutdown
    if (this.errorCount >= this.maxErrors) {
      this.triggerEmergencyShutdown('Too many logging errors');
      return false;
    }

    return true;
  }

  recordError(error: Error, context: string) {
    this.errorCount++;
    this.lastErrorTime = Date.now();

    // Critical errors trigger immediate shutdown
    const criticalErrors = [
      'Maximum call stack size exceeded',
      'out of memory',
      'script error',
      'recursion',
      'stack overflow',
      'call stack',
      'too much recursion'
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    if (criticalErrors.some(critical => errorMessage.includes(critical))) {
      this.triggerEmergencyShutdown(`Critical error: ${error.message}`);
    }
  }

  private triggerEmergencyShutdown(reason: string) {
    this.isEmergencyShutdown = true;
    isSystemInCriticalState = true;

    // Attempt to log shutdown (if possible)
    try {
      console.error(`🚨 TELEMETRY EMERGENCY SHUTDOWN: ${reason}`);
    } catch {
      // Silent fail - don't make things worse
    }

    // Clear all active operations
    LOGGING_IN_PROGRESS.clear();
    currentRecursionDepth = 0;

    // Clear queue to free memory
    queue.length = 0;

    if (flushTimer) {
      try {
        clearTimeout(flushTimer);
        flushTimer = null;
      } catch {}
    }
  }

  reset() {
    if (Date.now() - this.lastErrorTime > this.errorWindow * 2) {
      this.isEmergencyShutdown = false;
      isSystemInCriticalState = false;
      this.errorCount = 0;
    }
  }
}

const emergencyManager = new EmergencyManager();

// Enhanced recursion guard with operation tracking
function withRecursionGuard<T>(fn: () => T, operation: string): T | null {
  // Circuit breaker: If system is in critical state, abort everything
  if (isSystemInCriticalState || !emergencyManager.checkEmergencyConditions()) {
    return null;
  }

  // Prevent re-entrance for same operation
  if (LOGGING_IN_PROGRESS.has(operation)) {
    return null; // Silent abort - do not log
  }

  // Prevent deep recursion
  if (currentRecursionDepth >= MAX_RECURSION_DEPTH) {
    isSystemInCriticalState = true; // Emergency shutdown
    emergencyManager.recordError(new Error('Max recursion depth exceeded'), operation);
    return null;
  }

  LOGGING_IN_PROGRESS.add(operation);
  currentRecursionDepth++;

  try {
    return fn();
  } catch (error) {
    emergencyManager.recordError(error as Error, operation);
    return null; // Never let logging errors propagate
  } finally {
    LOGGING_IN_PROGRESS.delete(operation);
    currentRecursionDepth--;
  }
}

// Function to check if a function uses telemetry system APIs
function usesLoggingSystemAPI(fn: Function): boolean {
  if (!fn || typeof fn !== 'function') return false;

  const fnString = fn.toString();
  return TELEMETRY_SYSTEM_APIS.some(api =>
    fnString.includes(api) ||
    fnString.includes(`window.${api}`) ||
    fnString.includes(`globalThis.${api}`) ||
    fnString.includes(`self.${api}`)
  );
}

// Enhanced data sanitization with comprehensive protection
function sanitizeData(data: any, maxDepth = 3, visited = new WeakSet()): any {
  return withRecursionGuard(() => {
    // Prevent infinite recursion from circular references
    if (visited.has(data)) {
      return '[Circular Reference]';
    }

    // Depth limit to prevent deep recursion
    if (maxDepth <= 0) {
      return '[Max Depth Reached]';
    }

    // Null/undefined
    if (data == null) return data;

    // Primitives with size limits
    if (typeof data !== 'object') {
      if (typeof data === 'string') {
        return data.length > 500 ? data.substring(0, 500) + '...[truncated]' : data;
      }
      if (typeof data === 'number') {
        return isFinite(data) ? data : '[Invalid Number]';
      }
      return data;
    }

    // Track this object to prevent circular references
    visited.add(data);

    try {
      // Arrays with strict limits
      if (Array.isArray(data)) {
        const safeArray = data.slice(0, 10).map(item =>
          sanitizeData(item, maxDepth - 1, visited)
        );

        if (data.length > 10) {
          safeArray.push(`...[${data.length - 10} more items]`);
        }

        return {
          type: "Array",
          length: data.length,
          items: safeArray
        };
      }

      // Special object types
      if (data instanceof Date) {
        return { type: "Date", value: data.toISOString() };
      }

      if (data instanceof Error) {
        return {
          type: "Error",
          name: data.name,
          message: data.message?.substring(0, 200) || '',
          stack: data.stack?.substring(0, 500) || ''
        };
      }

      if (data instanceof RegExp) {
        return { type: "RegExp", pattern: data.toString() };
      }

      // Handle functions (should rarely happen but be safe)
      if (typeof data === 'function') {
        return {
          type: "Function",
          name: data.name || 'anonymous',
          length: data.length,
          hasToString: data.toString().length < 1000
        };
      }

      // Objects with enhanced security
      const sanitized: any = { type: "Object" };
      const entries = Object.entries(data).slice(0, 20); // Strict limit

      for (const [key, value] of entries) {
        // Enhanced sensitive key detection
        const sensitivePatterns = [
          /password/i, /pwd/i, /pass/i,
          /token/i, /auth/i, /secret/i, /key/i,
          /email/i, /mail/i, /address/i,
          /ssn/i, /social/i, /credit/i, /card/i,
          /phone/i, /mobile/i, /api_key/i,
          /access_token/i, /refresh_token/i,
          /session/i, /cookie/i, /csrf/i
        ];

        // Skip dangerous properties entirely
        if (key.startsWith('__') ||
            key === 'constructor' ||
            key === 'prototype' ||
            key === '__proto__') {
          continue;
        }

        if (sensitivePatterns.some(pattern => pattern.test(key))) {
          sanitized[key] = '[REDACTED]';
          continue;
        }

        // Recursively sanitize non-sensitive values
        try {
          sanitized[key] = sanitizeData(value, maxDepth - 1, visited);
        } catch {
          sanitized[key] = '[Serialization Error]';
        }
      }

      // Indicate if there are more properties
      const totalKeys = Object.keys(data).length;
      if (totalKeys > 20) {
        sanitized["..."] = `[${totalKeys - 20} more properties]`;
      }

      return sanitized;

    } finally {
      visited.delete(data);
    }
  }, 'data-sanitization') || '[Sanitization Failed]';
}

// Pre-create serializer function
const safeSerialize = (data: unknown) => sanitizeData(data, 3);

function flushQueue() {
  return withRecursionGuard(() => {
    // Emergency check before flushing
    if (!emergencyManager.checkEmergencyConditions()) {
      queue.length = 0; // Clear queue in emergency
      return;
    }

    const batch = queue.splice(0, 50); // Limit batch size
    if (!batch.length) return;

    try {
      // Use sendBeacon for reliability, fallback to fetch
      const payload = JSON.stringify(batch);

      // Size check to prevent huge payloads
      if (payload.length > 100000) { // 100KB limit
        emergencyManager.recordError(new Error('Payload too large'), 'flush-queue');
        return;
      }

      const blob = new Blob([payload], { type: "application/json" });

      if ("sendBeacon" in navigator) {
        const success = navigator.sendBeacon("/telemetry", blob);
        if (!success) {
          // If sendBeacon fails, don't try fetch - likely network issue
          return;
        }
      } else if ("fetch" in window) {
        // Non-blocking fetch with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

        fetch("/telemetry", {
          method: "POST",
          body: blob,
          keepalive: true,
          signal: controller.signal
        }).catch(() => {
          // Silent fail - network errors shouldn't crash logging
        }).finally(() => {
          clearTimeout(timeoutId);
        });
      }
    } catch (error) {
      emergencyManager.recordError(error as Error, 'flush-queue');
    } finally {
      flushTimer = null;

      // If queue still has items, schedule another flush (with emergency check)
      if (queue.length > 0 && emergencyManager.checkEmergencyConditions()) {
        flushTimer = setTimeout(flushQueue, 1000);
      }
    }
  }, 'flush-queue');
}

export function __autoLog<T>(fnId: string, argsLike: IArguments, run: () => T): T {
  // CRITICAL: Multiple safety checks before any logging
  if (!emergencyManager.checkEmergencyConditions()) {
    return run(); // Execute function but skip logging entirely
  }

  // Early bailout for sampling (before any expensive operations)
  if (Math.random() > 0.05) return run(); // 5% sampling

  // Prevent queue overflow with emergency handling
  if (queue.length >= MAX_QUEUE_SIZE) {
    if (queue.length >= MAX_QUEUE_SIZE * 1.5) {
      // Critical overflow - trigger emergency
      emergencyManager.recordError(new Error('Queue overflow'), 'auto-log');
      return run();
    }
    queue.length = MAX_QUEUE_SIZE / 2; // Drop oldest half
  }

  // Use recursion guard for all logging operations
  return withRecursionGuard(() => {
    const start = performance.now();
    let logEntry: Partial<Log> | null = null;

    try {
      // Safe argument serialization
      const serializedArgs = withRecursionGuard(() => {
        return Array.from(argsLike).map(arg => safeSerialize(arg));
      }, 'serialize-args') || [];

      logEntry = {
        fn: fnId,
        args: serializedArgs,
        ts: Date.now()
      };

      const result = run();

      // Handle promise-based results with enhanced safety
      if (result && typeof (result as any).then === "function") {
        return (result as Promise<any>)
          .then((val) => {
            return withRecursionGuard(() => {
              if (logEntry && emergencyManager.checkEmergencyConditions()) {
                logEntry.phase = "ok";
                logEntry.dur = performance.now() - start;
                logEntry.ret = safeSerialize(val);

                // Safe queue operation
                if (queue.length < MAX_QUEUE_SIZE) {
                  queue.push(logEntry as Log);
                }

                // Safe timer scheduling
                if (flushTimer === null && emergencyManager.checkEmergencyConditions()) {
                  try {
                    flushTimer = setTimeout(flushQueue, 1000);
                  } catch (error) {
                    emergencyManager.recordError(error as Error, 'timer-schedule');
                  }
                }
              }
              return val;
            }, 'promise-success') || val;
          })
          .catch((e) => {
            return withRecursionGuard(() => {
              if (logEntry && emergencyManager.checkEmergencyConditions()) {
                emergencyManager.recordError(e, fnId);
                logEntry.phase = "err";
                logEntry.dur = performance.now() - start;
                logEntry.err = String(e?.message || e?.toString() || 'Unknown error');

                // Safe queue operation
                if (queue.length < MAX_QUEUE_SIZE) {
                  queue.push(logEntry as Log);
                }

                // Safe timer scheduling
                if (flushTimer === null && emergencyManager.checkEmergencyConditions()) {
                  try {
                    flushTimer = setTimeout(flushQueue, 1000);
                  } catch (error) {
                    emergencyManager.recordError(error as Error, 'timer-schedule');
                  }
                }
              }
              throw e; // Re-throw the original error
            }, 'promise-error');
          }) as T;
      }

      // Handle synchronous results with enhanced safety
      if (logEntry && emergencyManager.checkEmergencyConditions()) {
        logEntry.phase = "ok";
        logEntry.dur = performance.now() - start;
        logEntry.ret = safeSerialize(result);

        // Safe queue operation
        if (queue.length < MAX_QUEUE_SIZE) {
          queue.push(logEntry as Log);
        }

        // Safe timer scheduling
        if (flushTimer === null && emergencyManager.checkEmergencyConditions()) {
          try {
            flushTimer = setTimeout(flushQueue, 1000);
          } catch (error) {
            emergencyManager.recordError(error as Error, 'timer-schedule');
          }
        }
      }

      return result;

    } catch (e: any) {
      // Enhanced error handling with emergency management
      emergencyManager.recordError(e, fnId);

      if (logEntry && emergencyManager.checkEmergencyConditions()) {
        try {
          logEntry.phase = "err";
          logEntry.dur = performance.now() - start;
          logEntry.err = String(e?.message || e?.toString() || 'Unknown error');

          // Safe queue operation
          if (queue.length < MAX_QUEUE_SIZE) {
            queue.push(logEntry as Log);
          }

          // Safe timer scheduling
          if (flushTimer === null) {
            try {
              flushTimer = setTimeout(flushQueue, 1000);
            } catch (timerError) {
              emergencyManager.recordError(timerError as Error, 'timer-schedule');
            }
          }
        } catch (loggingError) {
          // If logging the error fails, record that too but don't propagate
          emergencyManager.recordError(loggingError as Error, 'error-logging');
        }
      }

      throw e; // Always re-throw the original error
    }
  }, `auto-log-${fnId}`) || run(); // Fallback: execute function if recursion guard fails
}

// Enhanced cleanup and monitoring on page lifecycle events
if (typeof window !== "undefined") {
  // Global error monitoring (critical for emergency management)
  window.addEventListener("error", (event) => {
    emergencyManager.recordError(event.error || new Error(event.message), 'window-error');
  });

  window.addEventListener("unhandledrejection", (event) => {
    emergencyManager.recordError(
      new Error(event.reason?.message || String(event.reason)),
      'unhandled-promise'
    );
  });

  // Performance monitoring
  let performanceWarned = false;
  const checkPerformance = () => {
    if (!performanceWarned && window.performance?.memory) {
      const memory = (window.performance as any).memory;
      const usedMemory = memory.usedJSHeapSize / memory.totalJSHeapSize;

      if (usedMemory > 0.9) { // 90% memory usage
        emergencyManager.recordError(new Error(`High memory usage: ${(usedMemory * 100).toFixed(1)}%`), 'memory-warning');
        performanceWarned = true;
      }
    }
  };

  // Check performance periodically (only if emergency manager allows)
  const performanceCheckInterval = setInterval(() => {
    if (emergencyManager.checkEmergencyConditions()) {
      checkPerformance();
    } else {
      clearInterval(performanceCheckInterval);
    }
  }, 30000); // Every 30 seconds

  // Enhanced page cleanup
  const cleanupTelemetry = () => {
    if (queue.length > 0 && emergencyManager.checkEmergencyConditions()) {
      // Immediate flush on page unload
      const batch = queue.splice(0);
      if (batch.length > 0) {
        try {
          const payload = JSON.stringify(batch);
          if (payload.length < 64000) { // sendBeacon has size limits
            navigator.sendBeacon("/telemetry", new Blob([payload], { type: "application/json" }));
          }
        } catch {
          // Silent fail - don't delay page unload
        }
      }
    }

    // Clear timers
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    // Clear intervals
    clearInterval(performanceCheckInterval);
  };

  window.addEventListener("beforeunload", cleanupTelemetry);
  window.addEventListener("pagehide", cleanupTelemetry);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      cleanupTelemetry();
    }
  });
}
```

## Transform Example

**Before:**
```typescript
export function calculateTotal(price: number, tax: number) {
  return price + (price * tax);
}

const saveUser = async (userData: User) => {
  return api.post("/users", userData);
};
```

**After (generated):**
```typescript
import { __autoLog } from "@/telemetry/logger";

export function calculateTotal(price: number, tax: number) {
  return __autoLog("src/utils/math#calculateTotal", arguments, function () {
    return price + (price * tax);
  });
}

const saveUser = async (userData: User) => {
  return __autoLog("src/services/user#saveUser", arguments, async function () {
    return api.post("/users", userData);
  });
};
```

## Enhanced Transform Rules with Safety-First Approach

### Critical Safety Rules (MANDATORY)

**🚨 NEVER INSTRUMENT (Prevents Infinite Recursion):**

1. **Telemetry System Files (Absolute Exclusion)**
   - `**/telemetry/**` - All telemetry-related files
   - `**/logger/**` - All logging-related files
   - `**/monitoring/**` - All monitoring files
   - Any file importing from these directories
   - Files containing emergency management code

2. **Browser APIs Used by Telemetry (Critical)**
   ```typescript
   // Transform must detect and skip functions using these APIs:
   const FORBIDDEN_APIS = [
     'fetch', 'XMLHttpRequest', 'setTimeout', 'setInterval',
     'requestIdleCallback', 'addEventListener', 'indexedDB',
     'localStorage', 'sessionStorage', 'console.*',
     'JSON.stringify', 'JSON.parse', 'performance.*',
     'Date.now', 'Math.random', 'crypto.*',
     'WeakMap', 'WeakSet', 'Map', 'Set',
     'navigator.sendBeacon', 'Blob', 'Promise.*',
     'Error.captureStackTrace', 'Error.prepareStackTrace'
   ];

   // Build-time API usage detection:
   function functionUsesTelemtryAPIs(functionCode: string): boolean {
     return FORBIDDEN_APIS.some(api =>
       functionCode.includes(api) ||
       functionCode.includes(`window.${api}`) ||
       functionCode.includes(`globalThis.${api}`)
     );
   }
   ```

3. **System Code Patterns (Enhanced Detection)**
   ```typescript
   // File path exclusions (strict)
   const SYSTEM_FILE_PATTERNS = [
     /node_modules/,
     /\.next/,
     /webpack:/,
     /react-dom/,
     /scheduler/,
     /_app\./,
     /_document\./,
     /hot-dev-client/,
     /websocket/,
     /__webpack/,
     /chunk-/,
     /runtime-/,
     /framework-/,
     /polyfill/,
     /vendor/,
     /\.test\./,
     /\.spec\./,
     /\.stories\./,
   ];

   // Function name patterns (strict)
   const SYSTEM_FUNCTION_PATTERNS = [
     /^use[A-Z]/, // React hooks
     /^__webpack/, /^__next/, /^React\./, /scheduler/,
     /^_interop/, /^eval/, /logger\./, /console\./,
     /JSON\.(parse|stringify)/, /performance\./,
     /fetch$/, /setTimeout/, /setInterval/,
     /addEventListener/, /removeEventListener/,
     /^on[A-Z]/, // Event handlers (unless explicitly included)
   ];
   ```

### Enhanced Function Detection

**🔍 Multi-Layer Function Analysis:**

```typescript
function shouldInstrumentFunction(
  functionNode: any,
  filePath: string,
  functionCode: string
): boolean {
  // Layer 1: Emergency conditions check
  if (isSystemInCriticalState) return false;

  // Layer 2: File path exclusions (absolute)
  if (SYSTEM_FILE_PATTERNS.some(pattern => pattern.test(filePath))) {
    return false;
  }

  // Layer 3: Telemetry API usage detection (critical)
  if (functionUsesTelemtryAPIs(functionCode)) {
    return false;
  }

  // Layer 4: System function patterns
  const functionName = functionNode.id?.name || 'anonymous';
  if (SYSTEM_FUNCTION_PATTERNS.some(pattern => pattern.test(functionName))) {
    return false;
  }

  // Layer 5: User code validation (whitelist approach)
  const USER_CODE_DIRECTORIES = [
    '/src/', '/app/', '/components/', '/pages/',
    '/lib/', '/utils/', '/hooks/', '/stores/',
    '/services/', '/context/', '/providers/'
  ];

  const isUserDirectory = USER_CODE_DIRECTORIES.some(dir =>
    filePath.includes(dir)
  );

  if (!isUserDirectory) return false;

  // Layer 6: Function complexity (avoid trivial functions)
  if (functionCode.length < 30) return false;

  // Layer 7: React component detection (enhanced)
  if (isReactComponent(functionNode, functionCode)) return false;

  // Layer 8: Native code detection
  if (functionCode.includes('[native code]')) return false;

  // Layer 9: Already instrumented detection
  if (functionCode.includes('__autoLog')) return false;

  return true;
}

function isReactComponent(functionNode: any, functionCode: string): boolean {
  const functionName = functionNode.id?.name || '';

  // Must be PascalCase
  if (!/^[A-Z]/.test(functionName)) return false;

  // Must return JSX or contain JSX
  const hasJSXReturn = /return\s*\(?</.test(functionCode);
  const hasJSXElements = /<[A-Z][\w\s]*\/?>/.test(functionCode);

  return hasJSXReturn || hasJSXElements;
}
```

### Safe Transform Implementation

**🛠️ Build-Time Safety Checks:**

```typescript
// SWC/Babel transform with safety guards
function transformFunction(functionNode: any, filePath: string): any {
  try {
    const functionCode = functionNode.toString();

    // Safety check: Should we instrument this function?
    if (!shouldInstrumentFunction(functionNode, filePath, functionCode)) {
      return functionNode; // Return unchanged
    }

    // Generate safe function ID
    const functionId = generateSafeFunctionId(functionNode, filePath);

    // Create wrapper with safety checks
    return createSafeWrapper(functionNode, functionId);

  } catch (error) {
    // NEVER fail the build due to logging transform errors
    console.warn(`Telemetry transform skipped for ${filePath}:`, error.message);
    return functionNode; // Return unchanged
  }
}

function generateSafeFunctionId(functionNode: any, filePath: string): string {
  const relativePath = filePath.replace(process.cwd(), '');
  const functionName = functionNode.id?.name || 'anonymous';
  const lineNumber = functionNode.loc?.start?.line || 0;

  // Sanitize function ID to prevent injection
  const safePath = relativePath.replace(/[^a-zA-Z0-9\/\-_\.]/g, '');
  const safeName = functionName.replace(/[^a-zA-Z0-9_$]/g, '');

  return `${safePath}#${safeName}:${lineNumber}`;
}
```

### Enhanced Configuration

**⚙️ Production-Safe Configuration:**

```typescript
interface EnhancedAutoLogConfig {
  // Core safety settings
  emergencyShutdownEnabled: boolean;     // true - MANDATORY
  maxRecursionDepth: number;             // 3 - MANDATORY
  maxErrorsPerMinute: number;            // 10 - MANDATORY

  // File inclusion/exclusion
  include: string[];                     // ["src/**"] - User code only
  exclude: string[];                     // ["**/*.test.*", "**/telemetry/**"]
  telemetryExclude: string[];            // ["**/telemetry/**"] - CRITICAL
  userCodeDirectories: string[];         // User-written code paths

  // Function filtering (enhanced)
  skipReactComponents: boolean;          // true
  skipHooks: boolean;                    // true
  skipNativeFunctions: boolean;          // true - MANDATORY
  skipSystemAPIs: boolean;               // true - MANDATORY
  minFunctionSize: number;               // 30 chars
  maxFunctionSize: number;               // 10000 chars - prevent huge functions

  // API safety (new)
  forbiddenAPIs: string[];               // TELEMETRY_SYSTEM_APIS
  strictAPIDetection: boolean;           // true - MANDATORY
  validateFunctionSafety: boolean;       // true - MANDATORY

  // Performance & safety limits
  samplingRate: number;                  // 0.05 (5%)
  maxQueueSize: number;                  // 1000
  maxBatchSize: number;                  // 50
  maxPayloadSize: number;                // 100KB
  flushIntervalMs: number;               // 1000
  memoryThresholdPercent: number;        // 90%

  // Enhanced data protection
  sensitiveKeyPatterns: RegExp[];        // Enhanced PII detection
  maxObjectDepth: number;                // 3
  maxArrayItems: number;                 // 10
  maxStringLength: number;               // 500
  maxObjectProperties: number;           // 20

  // Production safety (critical)
  enableInProduction: boolean;           // false - MANDATORY
  environmentChecks: string[];           // ["NODE_ENV", "VERCEL_ENV"]
  buildTimeValidation: boolean;          // true - MANDATORY
  runtimeValidation: boolean;            // true - MANDATORY
}
```

### Build-Time Validation (Mandatory)

**✅ Pre-Deployment Safety Checklist:**

```typescript
// Mandatory build-time validation
function validateTelemetryConfig(config: EnhancedAutoLogConfig): void {
  const errors: string[] = [];

  // Critical safety checks
  if (!config.emergencyShutdownEnabled) {
    errors.push("Emergency shutdown must be enabled");
  }

  if (config.enableInProduction) {
    errors.push("Telemetry must not be enabled in production");
  }

  if (!config.strictAPIDetection) {
    errors.push("Strict API detection must be enabled");
  }

  if (config.maxRecursionDepth > 5) {
    errors.push("Max recursion depth too high (security risk)");
  }

  if (config.samplingRate > 0.1) {
    errors.push("Sampling rate too high (performance risk)");
  }

  // Validate exclusion patterns
  const requiredExclusions = [
    "**/telemetry/**",
    "**/logger/**",
    "**/*.test.*",
    "**/node_modules/**"
  ];

  for (const required of requiredExclusions) {
    if (!config.exclude.includes(required)) {
      errors.push(`Missing required exclusion: ${required}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Telemetry configuration validation failed:\n${errors.join('\n')}`);
  }
}
```

## Production-Ready Configuration

The configuration has been moved above as `EnhancedAutoLogConfig` with comprehensive safety measures. Key additions include:

- **Emergency Management**: Automatic shutdown triggers and error thresholds
- **API Safety Detection**: Build-time analysis of telemetry API usage
- **Multi-Layer Validation**: Runtime and build-time safety checks
- **Enhanced Security**: Comprehensive PII detection and data sanitization
- **Memory Monitoring**: Performance tracking with automatic cutoffs

## Usage Example

```typescript
// business/cart.ts
export async function addToCart(productId: string, quantity: number) {
  const response = await fetch("/api/cart", {
    method: "POST",
    body: JSON.stringify({ productId, quantity })
  });
  return response.json();
}

// components/BuyButton.tsx
"use client";
export default function BuyButton({ productId }: { productId: string }) {
  return (
    <button onClick={() => addToCart(productId, 1)}>
      Add to Cart
    </button>
  );
}
```

With the transform, every call to `addToCart` automatically logs args + result/error + timing, with zero manual code changes.

## Key Benefits

1. **No Runtime Monkey-Patching** - Function identity preserved
2. **Async-Safe** - Logs on promise resolution/rejection
3. **React-Safe** - Avoids breaking hook dependencies or spamming render logs
4. **Configurable** - Include/exclude patterns, sampling rates, redaction rules
5. **Zero Manual Work** - Completely automatic via build process
6. **Production-Safe** - Can be completely disabled via build flags

## Critical Safety Measures Implemented

### 1. **Multi-Layered Infinite Recursion Prevention (SOLVED)**
**Original Problem:** Logging functions call other functions that might be instrumented
**Comprehensive Solutions Implemented:**
- ✅ **Operation-Specific Recursion Guards**: `LOGGING_IN_PROGRESS` Set tracks specific operations
- ✅ **Depth Tracking**: `currentRecursionDepth` with `MAX_RECURSION_DEPTH = 3` limit
- ✅ **Circuit Breaker**: `isSystemInCriticalState` emergency shutdown trigger
- ✅ **Build-Time API Detection**: Comprehensive `TELEMETRY_SYSTEM_APIS` exclusion list
- ✅ **Multi-Layer Function Analysis**: 9-layer validation before instrumentation
- ✅ **Emergency Manager**: Automatic system shutdown on recursion detection

### 2. **Emergency Management System (NEW)**
**Problem:** No systematic approach to handling logging system failures
**Solutions Implemented:**
- ✅ **Error Count Monitoring**: Tracks errors with time windows
- ✅ **Critical Error Detection**: Immediate shutdown on stack overflow/memory errors
- ✅ **Automatic Recovery**: System reset after error window expires
- ✅ **Global Error Monitoring**: Catches unhandled errors and promise rejections
- ✅ **Performance Monitoring**: Memory usage tracking with automatic shutdown
- ✅ **Queue Overflow Protection**: Emergency queue clearing on critical conditions

### 3. **Enhanced Data Protection (UPGRADED)**
**Problem:** Comprehensive PII exposure and data leakage risks
**Advanced Solutions:**
- ✅ **Enhanced Sensitive Pattern Detection**: 15+ PII patterns including SSN, credit cards
- ✅ **Dangerous Property Skipping**: Excludes `__proto__`, `constructor`, etc.
- ✅ **Special Object Handling**: Date, Error, RegExp, Function type safety
- ✅ **Strict Size Limits**: 500 char strings, 10 array items, 20 object properties
- ✅ **Circular Reference Protection**: WeakSet-based tracking with depth limits
- ✅ **Serialization Failure Handling**: Graceful degradation on sanitization errors

### 4. **Production-Grade Error Resilience (ENHANCED)**
**Problem:** Logging errors could break application functionality
**Bulletproof Solutions:**
- ✅ **Nested Recursion Guards**: Every operation wrapped with `withRecursionGuard`
- ✅ **Emergency Condition Checks**: Pre-flight safety validation for all operations
- ✅ **Multiple Fallback Layers**: Function execution continues even if logging fails
- ✅ **Timer Safety**: Protected timeout scheduling with error handling
- ✅ **Network Request Safety**: AbortController, timeouts, silent failures
- ✅ **Memory Safety**: Payload size limits, queue overflow protection

### 5. **Advanced Build-Time Safety (NEW)**
**Problem:** Transform could introduce vulnerabilities or break builds
**Comprehensive Build Safety:**
- ✅ **Multi-Layer Function Analysis**: 9 validation layers before instrumentation
- ✅ **API Usage Detection**: Static analysis for telemetry API usage
- ✅ **Build-Time Validation**: Mandatory configuration safety checks
- ✅ **Never-Fail Transforms**: Transform errors never break builds
- ✅ **Conservative Approach**: Whitelist-based user code detection
- ✅ **Safe Function ID Generation**: Injection-proof identifier creation

### 6. **Enhanced Performance & Memory Management (NEW)**
**Problem:** Logging system could consume excessive resources
**Performance Solutions:**
- ✅ **Advanced Sampling**: 5% rate with early bailout before expensive operations
- ✅ **Queue Management**: Size limits, overflow protection, emergency clearing
- ✅ **Memory Monitoring**: Real-time heap usage tracking with 90% threshold
- ✅ **Lazy Evaluation**: Serialization only when actually logging
- ✅ **Network Optimization**: sendBeacon priority, fetch fallback, size limits
- ✅ **Cleanup Management**: Comprehensive page lifecycle event handling

### 7. **Production Safety Guarantees (BULLETPROOF)**
**Problem:** Accidental production deployment could cause outages
**Multiple Safety Layers:**
- ✅ **Build-Time Environment Validation**: Mandatory production disable checks
- ✅ **Runtime Environment Detection**: Multiple environment variable checks
- ✅ **Configuration Validation**: Build fails if unsafe config detected
- ✅ **Zero-Cost Production**: Complete code removal in production builds
- ✅ **Emergency Runtime Switches**: Manual override capabilities

### 8. **Comprehensive Monitoring & Observability (NEW)**
**Problem:** No visibility into telemetry system health
**Monitoring Solutions:**
- ✅ **System Health Tracking**: Error rates, queue sizes, memory usage
- ✅ **Performance Metrics**: Function execution times, serialization costs
- ✅ **Emergency State Logging**: Clear indicators when system shuts down
- ✅ **Build-Time Reporting**: Transform statistics and exclusion reporting
- ✅ **Runtime Diagnostics**: Real-time system state visibility

## Implementation Roadmap (Safety-First Approach)

### Phase 1: Core Safety Infrastructure (CRITICAL)
**Duration: 2-3 weeks | Success Criteria: Zero recursion, bulletproof error handling**

1. **Emergency Management System**
   - ✅ Implement `EmergencyManager` class with error counting and time windows
   - ✅ Add critical error pattern detection (stack overflow, memory errors)
   - ✅ Create automatic shutdown triggers and recovery mechanisms
   - ✅ Test with intentional recursion and error injection

2. **Multi-Layer Recursion Protection**
   - ✅ Build operation-specific `LOGGING_IN_PROGRESS` tracking
   - ✅ Implement depth counting with `MAX_RECURSION_DEPTH` limits
   - ✅ Add circuit breaker with `isSystemInCriticalState` flag
   - ✅ Test recursion guards with nested function calls

3. **Enhanced Data Sanitization**
   - ✅ Implement comprehensive PII detection (15+ patterns)
   - ✅ Add circular reference protection with WeakSet
   - ✅ Create strict size limits and depth restrictions
   - ✅ Test with complex objects, circular refs, and sensitive data

**Validation Requirements:**
- [ ] Recursion testing: 100 nested calls without failure
- [ ] Error injection: System survives 50+ errors per minute
- [ ] Memory testing: Handles 10MB+ object serialization safely
- [ ] PII testing: Redacts all sensitive patterns correctly

### Phase 2: Build-Time Safety (MANDATORY)
**Duration: 2-3 weeks | Success Criteria: Perfect API detection, safe transforms**

4. **Comprehensive API Detection**
   - ✅ Build `TELEMETRY_SYSTEM_APIS` comprehensive list
   - ✅ Implement static analysis for API usage detection
   - ✅ Add multi-layer function analysis (9 validation layers)
   - ✅ Test with real-world functions using browser APIs

5. **Safe Transform Implementation**
   - ✅ Create conservative SWC/Babel transform
   - ✅ Implement never-fail transform strategy
   - ✅ Add safe function ID generation with injection protection
   - ✅ Test transform on large codebases without breaking builds

6. **Build-Time Validation**
   - ✅ Mandatory configuration safety checks
   - ✅ Production deployment prevention
   - ✅ Required exclusion pattern validation
   - ✅ Environment-specific feature flags

**Validation Requirements:**
- [ ] API detection: 100% accuracy on browser API usage
- [ ] Transform safety: Never breaks builds even with malformed code
- [ ] Configuration validation: Rejects all unsafe configurations
- [ ] Production safety: Impossible to deploy with telemetry enabled

### Phase 3: Production-Grade Reliability (BULLETPROOF)
**Duration: 3-4 weeks | Success Criteria: Production-ready reliability**

7. **Advanced Error Resilience**
   - ✅ Nested recursion guards for all operations
   - ✅ Multiple fallback layers for function execution
   - ✅ Protected timer scheduling and network requests
   - ✅ Comprehensive memory and queue overflow protection

8. **Performance & Memory Optimization**
   - ✅ Advanced sampling with early bailout
   - ✅ Real-time memory monitoring with automatic shutdown
   - ✅ Network optimization with AbortController and timeouts
   - ✅ Lazy evaluation and efficient serialization

9. **Global Error Monitoring**
   - ✅ Window error and unhandled promise rejection tracking
   - ✅ Performance monitoring with memory usage alerts
   - ✅ Comprehensive page lifecycle event handling
   - ✅ System health tracking and diagnostics

**Validation Requirements:**
- [ ] Load testing: Handles 10,000+ function calls per second
- [ ] Memory testing: No memory leaks after 24 hours
- [ ] Error resilience: Survives application crashes gracefully
- [ ] Performance impact: <1% overhead in development

### Phase 4: Developer Experience & Monitoring (POLISH)
**Duration: 1-2 weeks | Success Criteria: Easy to use, easy to debug**

10. **Configuration & Validation Tools**
    - ✅ Enhanced configuration with safety defaults
    - ✅ Build-time configuration validation with clear error messages
    - ✅ Runtime diagnostics and system health visibility
    - ✅ Transform statistics and exclusion reporting

11. **Debugging & Observability**
    - ✅ Emergency state logging with clear indicators
    - ✅ System health metrics (error rates, queue sizes)
    - ✅ Performance metrics (execution times, serialization costs)
    - ✅ Build-time transform reporting and analysis

**Validation Requirements:**
- [ ] Developer experience: Setup takes <5 minutes
- [ ] Debugging: Clear error messages for all failure modes
- [ ] Monitoring: Real-time visibility into system health
- [ ] Documentation: Comprehensive safety guides and troubleshooting

## Critical Safety Testing Protocol

### Mandatory Pre-Release Testing (NEVER SKIP)

**1. Recursion Bomb Testing**
```typescript
// Test with intentional infinite recursion
function recursiveBomb() {
  recursiveBomb();
}
// System must shut down safely without crashing browser
```

**2. Memory Exhaustion Testing**
```typescript
// Test with huge objects
const hugeObject = { data: new Array(1000000).fill('test') };
// System must handle gracefully with size limits
```

**3. API Usage Detection Testing**
```typescript
// Test functions using browser APIs
function fetchData() { return fetch('/api/data'); }
// Transform must NOT instrument this function
```

**4. Production Safety Testing**
```typescript
// Attempt to enable in production
process.env.NODE_ENV = 'production';
// System must refuse to initialize
```

**5. Emergency Shutdown Testing**
```typescript
// Trigger 20+ errors rapidly
for (let i = 0; i < 25; i++) {
  throw new Error('Test error');
}
// System must shutdown and recover gracefully
```

## Success Criteria Summary

**Phase 1 Success:** Zero recursion issues, bulletproof error handling
**Phase 2 Success:** Perfect API detection, safe transforms that never break builds
**Phase 3 Success:** Production-ready reliability with <1% performance impact
**Phase 4 Success:** Easy developer experience with comprehensive monitoring

**Overall Success:** A telemetry system that is **impossible to break** and **impossible to deploy unsafely** while providing comprehensive automatic logging for user-written code.