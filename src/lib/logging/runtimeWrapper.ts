// src/lib/logging/runtimeWrapper.ts
import { withLogging, shouldSkipAutoLogging } from './automaticServerLoggingBase';

export function setupRuntimeWrapping() {
  // Store already wrapped functions and track active wrapping to prevent recursion
  const wrappedFunctions = new WeakSet();
  let isWrapping = false;

  function wrapCallback(fn: Function, name: string): Function {
    if (wrappedFunctions.has(fn) || isWrapping || shouldSkipAutoLogging(fn, name, 'runtime')) return fn;

    // Prevent recursive wrapping during sanitization
    isWrapping = true;

    try {
      const wrapped = withLogging(fn as any, name, {
        enabled: true,
        logInputs: true,
        logOutputs: false, // Prevent callback log spam
        logErrors: true,
        maxInputLength: 100
      });

      wrappedFunctions.add(wrapped);
      wrappedFunctions.add(fn);
      isWrapping = false;
      return wrapped;
    } catch (error) {
      isWrapping = false;
      return fn; // Return original function if wrapping fails
    }
  }

  // Wrap Promise methods (safer than Array methods)
  const originalThen = Promise.prototype.then;
  Promise.prototype.then = function(onFulfilled, onRejected) {
    if (typeof onFulfilled === 'function' && !isWrapping) {
      const fnName = onFulfilled.name || 'anonymous';
      onFulfilled = wrapCallback(onFulfilled, `promise.then(${fnName})`);
    }
    if (typeof onRejected === 'function' && !isWrapping) {
      const fnName = onRejected.name || 'anonymous';
      onRejected = wrapCallback(onRejected, `promise.catch(${fnName})`);
    }
    return originalThen.call(this, onFulfilled, onRejected);
  };

  // Comment out Array methods for now to prevent recursion issues
  // These could be re-enabled with more sophisticated recursion detection
  /*
  ['map', 'filter', 'forEach', 'reduce'].forEach(method => {
    const original = Array.prototype[method as keyof Array.prototype] as Function;
    (Array.prototype as any)[method] = function(callback: Function, ...args: any[]) {
      if (typeof callback === 'function' && !isWrapping) {
        callback = wrapCallback(callback, `Array.${method}.callback`);
      }
      return original.call(this, callback, ...args);
    };
  });
  */
}