// src/lib/logging/client/safeClientLoggingBase.ts
import { logger } from '@/lib/client_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';

// Global recursion prevention (MANDATORY)
const LOGGING_IN_PROGRESS = new Set<string>();
const MAX_RECURSION_DEPTH = 3;
let currentRecursionDepth = 0;

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