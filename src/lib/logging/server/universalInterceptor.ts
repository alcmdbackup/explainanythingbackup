/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
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
      super(...args);
      // Note: super() in Function constructor creates the function,
      // but we can't easily wrap it here without breaking functionality
      // This interception is kept for monitoring purposes only
    }
  } as any;

  // Intercept Object.defineProperty for function assignments
  const originalDefineProperty = Object.defineProperty;
  (Object.defineProperty as any) = function(this: any, obj: any, prop: string | symbol, descriptor: PropertyDescriptor) {
    if (descriptor.value && typeof descriptor.value === 'function') {
      descriptor.value = wrapUniversalFunction(descriptor.value, `${obj.constructor?.name || 'Object'}.${String(prop)}`);
    }
    return originalDefineProperty.call(this, obj, prop, descriptor);
  };

  // Intercept global function assignments (careful with this)
  const originalSetTimeout = global.setTimeout;
  (global.setTimeout as any) = function(this: any, callback: Function, delay: number, ...args: any[]) {
    if (typeof callback === 'function') {
      callback = wrapUniversalFunction(callback, 'setTimeout.callback');
    }
    return (originalSetTimeout as any).call(this, callback, delay, ...args);
  };

  const originalSetInterval = global.setInterval;
  (global.setInterval as any) = function(this: any, callback: Function, delay: number, ...args: any[]) {
    if (typeof callback === 'function') {
      callback = wrapUniversalFunction(callback, 'setInterval.callback');
    }
    return (originalSetInterval as any).call(this, callback, delay, ...args);
  };
}