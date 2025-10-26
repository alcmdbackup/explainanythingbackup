// src/lib/logging/client/runtimeInterceptor.ts

import { withClientLogging } from './safeClientLoggingBase';
import { clientLogPersistence } from './logPersistence';

// Global state to track interception
let interceptorsInitialized = false;
const originalAPIs = new Map<string, any>();

// Re-entrance protection
const RUNTIME_LOGGING_IN_PROGRESS = new Set<string>();
let runtimeRecursionDepth = 0;
const MAX_RUNTIME_RECURSION = 2;

/**
 * Aggressive runtime interception of browser APIs for automated logging
 * WARNING: This is the high-risk approach that the user specifically requested
 */
export function setupRuntimeBrowserInterception() {
  if (interceptorsInitialized || typeof window === 'undefined') return;
  if (process.env.NODE_ENV !== 'development') return;

  console.log('🔧 Setting up runtime browser API interception');

  try {
    // Phase 1: Promise interception (HIGH RISK - but user requested)
    interceptPromiseAPIs();

    // Phase 2: Timer API interception
    interceptTimerAPIs();

    // Phase 3: Event API interception
    interceptEventAPIs();

    // Phase 4: Fetch/XHR interception
    interceptNetworkAPIs();

    // Phase 5: DOM manipulation interception
    interceptDOMAPIs();

    interceptorsInitialized = true;
    console.log('✅ Runtime browser API interception active');
  } catch (error) {
    console.warn('⚠️ Failed to setup runtime interception:', error);
  }
}

/**
 * Intercept Promise APIs - DANGEROUS but automated
 */
function interceptPromiseAPIs() {
  if (!window.Promise || originalAPIs.has('Promise.prototype.then')) return;

  // Store original methods
  originalAPIs.set('Promise.prototype.then', Promise.prototype.then);
  originalAPIs.set('Promise.prototype.catch', Promise.prototype.catch);
  originalAPIs.set('Promise.prototype.finally', Promise.prototype.finally);

  // Wrap Promise.then
  Promise.prototype.then = function(onResolve?: any, onReject?: any) {
    const original = originalAPIs.get('Promise.prototype.then');

    // Check if this is user code or system code
    if (!isUserCodePromise()) {
      return original.call(this, onResolve, onReject);
    }

    const wrappedResolve = onResolve ? withRuntimeLogging(
      onResolve, 'Promise.then.resolve', 'userAsync'
    ) : onResolve;

    const wrappedReject = onReject ? withRuntimeLogging(
      onReject, 'Promise.then.reject', 'userAsync'
    ) : onReject;

    return original.call(this, wrappedResolve, wrappedReject);
  };

  // Wrap Promise.catch
  Promise.prototype.catch = function(onReject?: any) {
    const original = originalAPIs.get('Promise.prototype.catch');

    if (!isUserCodePromise()) {
      return original.call(this, onReject);
    }

    const wrappedReject = onReject ? withRuntimeLogging(
      onReject, 'Promise.catch', 'userAsync'
    ) : onReject;

    return original.call(this, wrappedReject);
  };

  // Wrap Promise.finally
  Promise.prototype.finally = function(onFinally?: any) {
    const original = originalAPIs.get('Promise.prototype.finally');

    if (!isUserCodePromise()) {
      return original.call(this, onFinally);
    }

    const wrappedFinally = onFinally ? withRuntimeLogging(
      onFinally, 'Promise.finally', 'userAsync'
    ) : onFinally;

    return original.call(this, wrappedFinally);
  };
}

/**
 * Intercept Timer APIs (setTimeout, setInterval)
 */
function interceptTimerAPIs() {
  if (originalAPIs.has('setTimeout')) return;

  // Store originals
  originalAPIs.set('setTimeout', window.setTimeout);
  originalAPIs.set('setInterval', window.setInterval);

  // Wrap setTimeout
  window.setTimeout = function(callback: any, delay?: number, ...args: any[]) {
    const original = originalAPIs.get('setTimeout');

    if (!isUserCodeTimer() || typeof callback !== 'function') {
      return original.call(window, callback, delay, ...args);
    }

    const wrappedCallback = withRuntimeLogging(
      callback, 'setTimeout.callback', 'userAsync'
    );

    return original.call(window, wrappedCallback, delay, ...args);
  };

  // Wrap setInterval
  window.setInterval = function(callback: any, delay?: number, ...args: any[]) {
    const original = originalAPIs.get('setInterval');

    if (!isUserCodeTimer() || typeof callback !== 'function') {
      return original.call(window, callback, delay, ...args);
    }

    const wrappedCallback = withRuntimeLogging(
      callback, 'setInterval.callback', 'userAsync'
    );

    return original.call(window, wrappedCallback, delay, ...args);
  };
}

/**
 * Intercept Event APIs (addEventListener)
 */
function interceptEventAPIs() {
  if (originalAPIs.has('addEventListener')) return;

  // Store original
  originalAPIs.set('addEventListener', EventTarget.prototype.addEventListener);

  // Wrap addEventListener
  EventTarget.prototype.addEventListener = function(
    type: string,
    listener: any,
    options?: boolean | AddEventListenerOptions
  ) {
    const original = originalAPIs.get('addEventListener');

    if (!isUserCodeEvent() || typeof listener !== 'function') {
      return original.call(this, type, listener, options);
    }

    const wrappedListener = withRuntimeLogging(
      listener, `addEventListener.${type}`, 'userEventHandler'
    );

    return original.call(this, type, wrappedListener, options);
  };
}

/**
 * Intercept Network APIs (fetch, XMLHttpRequest)
 */
function interceptNetworkAPIs() {
  if (originalAPIs.has('fetch')) return;

  // Store originals
  originalAPIs.set('fetch', window.fetch);
  originalAPIs.set('XMLHttpRequest', window.XMLHttpRequest);

  // Wrap fetch
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const original = originalAPIs.get('fetch');

    if (!isUserCodeNetwork()) {
      return original.call(window, input, init);
    }

    logNetworkCall('fetch', input.toString(), init);
    return original.call(window, input, init);
  };

  // Wrap XMLHttpRequest
  const OriginalXHR = originalAPIs.get('XMLHttpRequest');
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();

    if (isUserCodeNetwork()) {
      const originalOpen = xhr.open;
      xhr.open = function(method: string, url: string | URL, ...args: any[]) {
        logNetworkCall('XMLHttpRequest', `${method} ${url}`);
        return originalOpen.apply(this, [method, url, ...args]);
      };
    }

    return xhr;
  };

  // Preserve static properties
  Object.setPrototypeOf(window.XMLHttpRequest, OriginalXHR);
  Object.defineProperty(window.XMLHttpRequest, 'prototype', {
    value: OriginalXHR.prototype,
    writable: false
  });
}

/**
 * Intercept DOM APIs (query selectors, manipulation)
 */
function interceptDOMAPIs() {
  if (originalAPIs.has('querySelector')) return;

  // Store originals
  originalAPIs.set('querySelector', Document.prototype.querySelector);
  originalAPIs.set('querySelectorAll', Document.prototype.querySelectorAll);
  originalAPIs.set('getElementById', Document.prototype.getElementById);

  // Wrap querySelector
  Document.prototype.querySelector = function(selectors: string) {
    const original = originalAPIs.get('querySelector');

    if (isUserCodeDOM()) {
      logDOMOperation('querySelector', selectors);
    }

    return original.call(this, selectors);
  };

  // Wrap querySelectorAll
  Document.prototype.querySelectorAll = function(selectors: string) {
    const original = originalAPIs.get('querySelectorAll');

    if (isUserCodeDOM()) {
      logDOMOperation('querySelectorAll', selectors);
    }

    return original.call(this, selectors);
  };

  // Wrap getElementById
  Document.prototype.getElementById = function(elementId: string) {
    const original = originalAPIs.get('getElementById');

    if (isUserCodeDOM()) {
      logDOMOperation('getElementById', elementId);
    }

    return original.call(this, elementId);
  };
}

/**
 * Generic wrapper for runtime logging with recursion protection
 */
function withRuntimeLogging<T extends Function>(
  fn: T,
  operationName: string,
  functionType: string
): T {
  return ((...args: any[]) => {
    // MANDATORY: Prevent infinite recursion
    const logKey = `runtime-${operationName}-${Date.now()}`;

    if (RUNTIME_LOGGING_IN_PROGRESS.has(logKey) || runtimeRecursionDepth >= MAX_RUNTIME_RECURSION) {
      return fn(...args);
    }

    RUNTIME_LOGGING_IN_PROGRESS.add(logKey);
    runtimeRecursionDepth++;

    try {
      // Log the operation safely
      safeRuntimeLog(operationName, args, functionType);

      const result = fn(...args);

      // Handle async results
      if (result instanceof Promise) {
        return result
          .then((resolved) => {
            safeRuntimeLog(`${operationName}.completed`, { duration: 'async' }, functionType);
            return resolved;
          })
          .catch((error) => {
            safeRuntimeLog(`${operationName}.failed`, { error: error.message }, functionType);
            throw error;
          });
      }

      safeRuntimeLog(`${operationName}.completed`, {}, functionType);
      return result;
    } catch (error) {
      safeRuntimeLog(`${operationName}.failed`, { error: error instanceof Error ? error.message : String(error) }, functionType);
      throw error;
    } finally {
      RUNTIME_LOGGING_IN_PROGRESS.delete(logKey);
      runtimeRecursionDepth--;
    }
  }) as T;
}

/**
 * Safe logging that never throws or causes recursion
 */
function safeRuntimeLog(operation: string, data: any, functionType: string) {
  try {
    // Use the persistence system directly to avoid recursion
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: `Runtime ${functionType}: ${operation}`,
      data: sanitizeRuntimeData(data),
      requestId: getCurrentRequestId(),
      source: 'runtime-interceptor'
    };

    // Persist without recursion
    clientLogPersistence.persistClientLogSafely(logEntry);
  } catch {
    // Silent fail - runtime logging should never break anything
  }
}

/**
 * Utility functions to determine if code is user code vs system code
 */
function isUserCodePromise(): boolean {
  return isUserCodeCall();
}

function isUserCodeTimer(): boolean {
  return isUserCodeCall();
}

function isUserCodeEvent(): boolean {
  return isUserCodeCall();
}

function isUserCodeNetwork(): boolean {
  return isUserCodeCall();
}

function isUserCodeDOM(): boolean {
  return isUserCodeCall();
}

function isUserCodeCall(): boolean {
  try {
    const stack = new Error().stack;
    if (!stack) return true; // Default to true for aggressive logging

    // For aggressive logging per user request - log most things except obvious system calls
    const systemCodePatterns = [
      'node_modules/',
      '_next/static/chunks/node_modules',
      'webpack:',
      'scheduler',
      '/register',
      'instrumentation',
      'hot-reloader'
    ];

    const stackLines = stack.split('\n');

    // Check if this is definitely system code
    for (const line of stackLines) {
      if (systemCodePatterns.some(pattern => line.includes(pattern))) {
        return false; // Definitely system code
      }
    }

    // If we can't find obvious system patterns, assume it's user code
    // This is aggressive logging as requested by the user
    return true;
  } catch {
    return true; // Aggressive approach: log by default if we can't determine
  }
}

/**
 * Log network operations
 */
function logNetworkCall(type: string, url: string, options?: any) {
  safeRuntimeLog(`${type}`, { url, options }, 'userAsync');
}

/**
 * Log DOM operations
 */
function logDOMOperation(operation: string, selector: string) {
  safeRuntimeLog(`DOM.${operation}`, { selector }, 'userFunction');
}

/**
 * Sanitize runtime data safely
 */
function sanitizeRuntimeData(data: any): any {
  try {
    if (!data || typeof data !== 'object') return data;

    // Simple sanitization for runtime data
    if (Array.isArray(data)) {
      return data.slice(0, 5).map(item =>
        typeof item === 'object' ? '[Object]' : item
      );
    }

    const sanitized: any = {};
    const keys = Object.keys(data).slice(0, 5);

    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'function') {
        sanitized[key] = '[Function]';
      } else if (typeof value === 'object') {
        sanitized[key] = '[Object]';
      } else if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = value.substring(0, 100) + '...';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  } catch {
    return '[Sanitization Error]';
  }
}

/**
 * Get current request ID from context
 */
function getCurrentRequestId(): string {
  try {
    // Try to get request ID from React context or generate one
    return `runtime-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  } catch {
    return 'unknown';
  }
}

/**
 * Restore original APIs (for testing or emergency disable)
 */
export function restoreOriginalAPIs() {
  try {
    for (const [key, original] of originalAPIs.entries()) {
      switch (key) {
        case 'Promise.prototype.then':
          Promise.prototype.then = original;
          break;
        case 'Promise.prototype.catch':
          Promise.prototype.catch = original;
          break;
        case 'Promise.prototype.finally':
          Promise.prototype.finally = original;
          break;
        case 'setTimeout':
          window.setTimeout = original;
          break;
        case 'setInterval':
          window.setInterval = original;
          break;
        case 'addEventListener':
          EventTarget.prototype.addEventListener = original;
          break;
        case 'fetch':
          window.fetch = original;
          break;
        case 'querySelector':
          Document.prototype.querySelector = original;
          break;
        case 'querySelectorAll':
          Document.prototype.querySelectorAll = original;
          break;
        case 'getElementById':
          Document.prototype.getElementById = original;
          break;
      }
    }

    interceptorsInitialized = false;
    console.log('✅ Original browser APIs restored');
  } catch (error) {
    console.warn('⚠️ Failed to restore some APIs:', error);
  }
}