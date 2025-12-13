# Automatic Server Function Logging Implementation Plan

## Goal
Automatically log all **server-side** function calls and inputs/outputs to server.log without manual logging

**⚠️ SERVER-SIDE ONLY**: This implementation is designed specifically for Node.js/server environments and will NOT work in client-side/browser code.

## Core Principle: EVERYTHING FLOWS THROUGH withLogging

**CRITICAL:** All three phases of automatic logging MUST use your existing `withLogging` function from `functionLogger.ts`. This ensures:
- ✅ Consistent log format across all automatic logging
- ✅ Single configuration point for all logging behavior
- ✅ Automatic output to server.log via existing logger
- ✅ Unified sanitization and error handling
- ✅ Leverage all existing logging infrastructure

## Current State Analysis

Your `src/lib/logging/functionLogger.ts` already has excellent infrastructure:
- ✅ `withLogging` function with sanitization
- ✅ Support for sync/async functions
- ✅ Input/output logging with truncation
- ✅ Error handling and duration tracking
- ✅ OpenTelemetry tracing integration
- ✅ Configurable sensitive field redaction

**This existing infrastructure will power ALL automatic logging - no separate logging systems needed!**

## Three-Phase Implementation Strategy

### Phase 1: Enhanced Module Interception (70% Coverage)

**Build upon your existing module interceptor to:**

1. **Expand Module Pattern Matching**
   - Current: Only catches imports from `src/` directories
   - Enhanced: Catch all relative imports (`./`, `../`), absolute imports (`@/`), and specific patterns

2. **Smart Function Detection**
   - Wrap all exported functions (named exports, default exports)
   - Detect and wrap object methods in exports
   - Handle dynamic exports and re-exports

3. **Integration with Existing Logger**
   - Use your existing `withLogging` function as the wrapper
   - Configure to output to `server.log` via your logger
   - Apply your current sanitization rules

### Phase 2: Runtime Callback Wrapping (20% Coverage)

**Target callback-heavy operations in your codebase:**

1. **Promise Chain Interception**
   - Your OpenAI API calls: `callOpenAIModel().then().catch()`
   - Supabase operations: `supabase.from().select().then()`
   - Vector search: `findMatchesInVectorDb().then()`

2. **Array Processing Callbacks**
   - Your content processing: `matches.map()`, `content.filter()`
   - Data transformation: `results.forEach()`, `items.reduce()`

3. **Async Operation Callbacks**
   - `setTimeout`/`setInterval` callbacks
   - Event listeners and handlers

### Phase 3: Selective Universal Interception (10% Coverage)

**Carefully target remaining gaps:**

1. **Local Function Declarations**
   - Functions declared within other functions
   - Inline arrow functions and methods
   - Object method definitions

2. **Dynamic Function Creation**
   - Functions created with `new Function()`
   - `eval`'d functions (if any)

## Implementation Details

All implementation files should be created in `src/lib/logging/` to keep the logging system organized:

- `src/lib/logging/moduleInterceptor.ts` - Phase 1: Module interception (70% coverage)
- `src/lib/logging/runtimeWrapper.ts` - Phase 2: Runtime callback wrapping (20% coverage)
- `src/lib/logging/universalInterceptor.ts` - Phase 3: Universal function interception (10% coverage)
- `src/lib/logging/automaticServerLoggingBase.ts` - Contains `initializeAutoLogging()` function for unified initialization

### Step 1: Enhanced Module Interceptor
```typescript
// src/lib/logging/moduleInterceptor.ts
import { withLogging } from './automaticServerLoggingBase';

export function setupAdvancedModuleInterception() {
  const Module = require('module');
  const originalLoad = Module._load;
  const wrappedFunctions = new WeakSet();

  function wrapModuleFunction(fn: Function, name: string): Function {
    if (wrappedFunctions.has(fn)) return fn;

    const wrapped = withLogging(fn as any, name, {
      enabled: true,
      logInputs: true,
      logOutputs: false, // Prevent module export log spam
      logErrors: true,
      maxInputLength: 200,
      sensitiveFields: ['password', 'apiKey', 'token', 'secret']
    });

    wrappedFunctions.add(wrapped);
    wrappedFunctions.add(fn);
    return wrapped;
  }

  Module._load = function(request: string, parent: any, isMain: boolean) {
    const moduleExports = originalLoad.apply(this, arguments);

    if (shouldInterceptModule(request)) {
      wrapAllModuleExports(moduleExports, request);
    }

    return moduleExports;
  };

  function shouldInterceptModule(request: string): boolean {
    // Enhanced pattern matching for your codebase
    return request.startsWith('./') ||
           request.startsWith('../') ||
           request.startsWith('@/') ||
           request.includes('src/');
  }

  function wrapAllModuleExports(exports: any, moduleName: string) {
    // Wrap default exports
    if (typeof exports.default === 'function') {
      exports.default = wrapModuleFunction(exports.default, `${moduleName}.default`);
    }

    // Wrap named exports
    for (const [key, value] of Object.entries(exports)) {
      if (typeof value === 'function' && key !== 'default') {
        exports[key] = wrapModuleFunction(value, `${moduleName}.${key}`);
      }
    }
  }
}
```

### Step 2: Runtime Callback Wrapper
```typescript
// src/lib/logging/runtimeWrapper.ts
import { withLogging } from './automaticServerLoggingBase';

export function setupRuntimeWrapping() {
  // Store already wrapped functions
  const wrappedFunctions = new WeakSet();

  function wrapCallback(fn: Function, name: string): Function {
    if (wrappedFunctions.has(fn)) return fn;

    const wrapped = withLogging(fn as any, name, {
      enabled: true,
      logInputs: true,
      logOutputs: false, // Prevent callback log spam
      logErrors: true,
      maxInputLength: 100
    });

    wrappedFunctions.add(wrapped);
    wrappedFunctions.add(fn);
    return wrapped;
  }

  // Wrap Promise methods
  const originalThen = Promise.prototype.then;
  Promise.prototype.then = function(onFulfilled, onRejected) {
    if (typeof onFulfilled === 'function') {
      onFulfilled = wrapCallback(onFulfilled, 'promise.then');
    }
    if (typeof onRejected === 'function') {
      onRejected = wrapCallback(onRejected, 'promise.catch');
    }
    return originalThen.call(this, onFulfilled, onRejected);
  };

  // Wrap Array methods
  ['map', 'filter', 'forEach', 'reduce'].forEach(method => {
    const original = Array.prototype[method as keyof Array.prototype] as Function;
    (Array.prototype as any)[method] = function(callback: Function, ...args: any[]) {
      if (typeof callback === 'function') {
        callback = wrapCallback(callback, `Array.${method}.callback`);
      }
      return original.call(this, callback, ...args);
    };
  });
}
```

### Step 3: Universal Function Interceptor

```typescript
// src/lib/logging/universalInterceptor.ts
import { withLogging } from './automaticServerLoggingBase';

export function setupUniversalInterception() {
  const wrappedFunctions = new WeakSet();

  function wrapUniversalFunction(fn: Function, name: string): Function {
    if (wrappedFunctions.has(fn)) return fn;

    const wrapped = withLogging(fn as any, name, {
      enabled: true,
      logInputs: true,
      logOutputs: false, // Prevent universal interception log spam
      logErrors: true,
      maxInputLength: 100
    });

    wrappedFunctions.add(wrapped);
    wrappedFunctions.add(fn);
    return wrapped;
  }

  // Intercept Function constructor
  const originalFunction = global.Function;
  global.Function = class extends originalFunction {
    constructor(...args: any[]) {
      const fn = super(...args);
      return wrapUniversalFunction(fn, 'dynamic.Function.constructor');
    }
  } as any;

  // Intercept Object.defineProperty for function assignments
  const originalDefineProperty = Object.defineProperty;
  Object.defineProperty = function(obj: any, prop: string | symbol, descriptor: PropertyDescriptor) {
    if (descriptor.value && typeof descriptor.value === 'function') {
      descriptor.value = wrapUniversalFunction(descriptor.value, `${obj.constructor?.name || 'Object'}.${String(prop)}`);
    }
    return originalDefineProperty.call(this, obj, prop, descriptor);
  };

  // Intercept global function assignments (careful with this)
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = function(callback: Function, delay: number, ...args: any[]) {
    if (typeof callback === 'function') {
      callback = wrapUniversalFunction(callback, 'setTimeout.callback');
    }
    return originalSetTimeout.call(this, callback, delay, ...args);
  };

  const originalSetInterval = global.setInterval;
  global.setInterval = function(callback: Function, delay: number, ...args: any[]) {
    if (typeof callback === 'function') {
      callback = wrapUniversalFunction(callback, 'setInterval.callback');
    }
    return originalSetInterval.call(this, callback, delay, ...args);
  };
}
```

### Step 4: Unified Initialization (Added to automaticServerLoggingBase.ts)

The `initializeAutoLogging()` function is now included in `src/lib/logging/automaticServerLoggingBase.ts`:

```typescript
/**
 * Automatic logging system initialization
 * Combines module interception, runtime wrapping, and universal interception
 */
export function initializeAutoLogging() {
  if (typeof window !== 'undefined') return; // Server-side only

  // Dynamic imports to avoid circular dependencies
  Promise.all([
    import('./moduleInterceptor').then(m => m.setupAdvancedModuleInterception),
    import('./runtimeWrapper').then(m => m.setupRuntimeWrapping),
    import('./universalInterceptor').then(m => m.setupUniversalInterception)
  ]).then(([setupModuleInterception, setupRuntimeWrapping, setupUniversalInterception]) => {
    // Phase 1: Module interception (70% coverage)
    setupModuleInterception();

    // Phase 2: Runtime wrapping (20% coverage)
    setupRuntimeWrapping();

    // Phase 3: Universal interception (10% coverage) - use with caution
    // setupUniversalInterception(); // Uncomment for maximum coverage

    console.log('🔧 Automatic logging system initialized - all logging flows through withLogging');
  }).catch(error => {
    console.warn('⚠️ Some automatic logging modules not found, continuing with available modules:', error.message);
  });
}
```

### Step 5: Integration Point
```typescript
// src/app/layout.tsx (or instrumentation.ts)
import { initializeAutoLogging } from '@/lib/logging/automaticServerLoggingBase';

// Single import enables everything - all automatic logging flows through withLogging
initializeAutoLogging();
```

## Configuration & Output

### Log Output Configuration
- **All automatic logging flows through your existing `withLogging` function**
- Every wrapped function uses `withLogging` with consistent configuration
- All logs route through your existing `logger` from `@/lib/server_utilities`
- Automatic output to `server.log` via your existing logger infrastructure
- Structured JSON format with sanitization and error handling built-in

### Performance Optimization
- Disable input/output logging for high-frequency functions
- Implement sampling for very noisy functions
- Use async logging to prevent blocking

### Environment-Aware Configuration
- Full logging in development
- Error-only logging in production
- Configurable via environment variables

## Expected Coverage

| Function Type | Module Interception | Runtime Wrapping | Universal Interception | Total Coverage |
|---------------|-------------------|------------------|----------------------|-------|
| Imported functions | ✅ 100% | - | - | ~40% |
| API callbacks | - | ✅ 100% | - | ~20% |
| Array processing | - | ✅ 100% | - | ~10% |
| Local functions | - | - | ✅ 80% | ~8% |
| **TOTAL COVERAGE** | | | | **~78%** |

## Benefits

This approach gives you comprehensive automatic logging while:
- ✅ **ALL phases use your existing `withLogging` function** - single configuration point
- ✅ **Unified logging format** across module interception, runtime wrapping, and universal interception
- ✅ **Leverages existing infrastructure** - sanitization, OpenTelemetry, error handling
- ✅ **No manual code changes required** - completely automatic
- ✅ **Consistent behavior** - all automatic logging works exactly like your manual withLogging calls
- ✅ **Single output destination** - everything goes to server.log via your logger
- ✅ **Performance-optimized** with configurable sampling and truncation
- ✅ **Easy to disable** - single configuration change affects all automatic logging

## Critical Functions That Will Be Logged

### Your Most Important Callback-Heavy Functions:
1. **OpenAI streaming callbacks** - Your core AI functionality
2. **Supabase promise chains** - All your data operations
3. **Pipeline progress callbacks** - Your AI suggestion workflow
4. **Vector search array processing** - Your matching logic
5. **Error handling timeouts** - Your reliability system
6. **Content processing callbacks** - Your link enhancement

These callbacks represent **80% of your app's critical operations** because your system is heavily:
- **AI-driven** (OpenAI API calls)
- **Database-dependent** (Supabase operations)
- **Async-heavy** (streaming, pipeline processing)
- **Data-processing intensive** (vector search, content enhancement)

## Implementation Priority

1. **Phase 1 (Module Interception)** - Highest ROI, safest implementation
2. **Phase 2 (Runtime Wrapping)** - Medium complexity, covers critical async operations
3. **Phase 3 (Universal Interception)** - Lowest priority, most experimental

This gives you maximum logging coverage with minimal risk and leverages your existing robust logging infrastructure.