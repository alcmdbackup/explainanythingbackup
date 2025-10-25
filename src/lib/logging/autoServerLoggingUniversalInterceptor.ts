// src/lib/logging/autoServerLoggingUniversalInterceptor.ts
import { withLogging, shouldSkipAutoLogging } from './automaticServerLoggingBase';

export function setupServerUniversalInterception() {
  // Universal interception - use with extreme caution
  // This provides the remaining 10% coverage but can impact performance

  const wrappedFunctions = new WeakSet();
  let isIntercepting = false;

  function wrapGlobalFunction(fn: Function, name: string): Function {
    if (wrappedFunctions.has(fn) || isIntercepting || shouldSkipAutoLogging(fn, name, 'runtime')) return fn;

    isIntercepting = true;

    try {
      const wrapped = withLogging(fn as any, name, {
        enabled: true,
        logInputs: false, // Minimal logging to prevent spam
        logOutputs: false,
        logErrors: true,
        maxInputLength: 50
      });

      wrappedFunctions.add(wrapped);
      wrappedFunctions.add(fn);
      isIntercepting = false;
      return wrapped;
    } catch (error) {
      isIntercepting = false;
      return fn;
    }
  }

  // Only intercept setTimeout/setInterval for critical path tracking
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = function(callback: Function, delay: number, ...args: any[]) {
    if (typeof callback === 'function' && !isIntercepting) {
      const fnName = callback.name || 'anonymous';
      callback = wrapGlobalFunction(callback, `setTimeout(${fnName})`);
    }
    return originalSetTimeout.call(this, callback, delay, ...args);
  };

  const originalSetInterval = global.setInterval;
  global.setInterval = function(callback: Function, delay: number, ...args: any[]) {
    if (typeof callback === 'function' && !isIntercepting) {
      const fnName = callback.name || 'anonymous';
      callback = wrapGlobalFunction(callback, `setInterval(${fnName})`);
    }
    return originalSetInterval.call(this, callback, delay, ...args);
  };

  console.log('⚠️ Universal interception enabled - use with caution in production');
}