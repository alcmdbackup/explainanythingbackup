// src/lib/logging/moduleInterceptor.ts
import { withLogging, shouldSkipAutoLogging } from './automaticServerLoggingBase';

export function setupServerModuleInterception() {
  const Module = require('module');
  const originalLoad = Module._load;
  const wrappedFunctions = new WeakSet();

  function wrapModuleFunction(fn: Function, name: string): Function {
    if (wrappedFunctions.has(fn) || shouldSkipAutoLogging(fn, name, 'module')) return fn;

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
    // Use shared filtering - treat request as function name for module context
    return !shouldSkipAutoLogging(() => {}, request, 'module');
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