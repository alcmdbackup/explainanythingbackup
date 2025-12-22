/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-function-type */
import { logger } from '@/lib/server_utilities';
import { createAppSpan } from '../../../../instrumentation';
import { 
  LogConfig, 
  TracingConfig, 
  defaultLogConfig, 
  defaultTracingConfig 
} from '@/lib/schemas/schemas';

/**
 * Shared filtering utility to exclude framework internals and system functions
 */
export function shouldSkipAutoLogging(fn: Function, name: string, context: 'module' | 'runtime' = 'runtime'): boolean {
  if (!fn || typeof fn !== 'function') return true;

  const fnString = fn.toString();
  const stackTrace = new Error().stack || '';

  // Framework and system patterns to exclude
  const frameworkPatterns = [
    // React/Next.js core
    'react/', 'react\\', 'react-dom/', 'react-dom\\',
    './cjs/react', './dist/', 'react-jsx-runtime',
    'react-dom-server', 'renderToReadableStream',

    // Next.js internals
    'next/dist/', 'next\\dist\\', '@next/', 'compiled/next-server',
    '.next-internal/', 'app-page.runtime', 'app-route.runtime',
    'turbopack', '[turbopack]', 'chunks/', 'runtime.js', 'runtime.dev.js',

    // Build tools
    'webpack/', 'node_modules/',

    // Node.js internals
    'internal/modules', 'internal/process', 'vm.js', 'loader.js',

    // Problematic functions
    'runInCleanSnapshot', 'runInThisContext', 'compileFunction',
    'Module._compile', 'Module._load', 'require', 'createRequire'
  ];

  // Check stack trace and function string for framework code
  if (frameworkPatterns.some(pattern =>
    stackTrace.includes(pattern) ||
    fnString.includes(pattern) ||
    name.includes(pattern)
  )) {
    return true;
  }

  // Skip very short functions (likely system internals)
  if (fnString.length < 20) return true;

  // Skip native functions
  if (fnString.includes('[native code]')) return true;

  // For module context, only allow your own application code
  if (context === 'module') {
    return !(name.startsWith('./src/') ||
             name.startsWith('../src/') ||
             name.startsWith('@/')) ||
           name.includes('node_modules');
  }

  return false;
}

/**
 * Sanitizes data by removing sensitive fields and truncating long values
 */
function sanitizeData(data: any, config: LogConfig): any {
  if (!data || typeof data !== 'object') {
    // Handle BigInt serialization
    if (typeof data === 'bigint') {
      return data.toString();
    }
    return data;
  }

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizeData(item, config));
  }

  for (const [key, value] of Object.entries(sanitized)) {
    // Handle BigInt values
    if (typeof value === 'bigint') {
      sanitized[key] = value.toString();
      continue;
    }

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
      sanitized[key] = sanitizeData(value, config);
    }
  }

  return sanitized;
}

/**
 * Creates a function wrapper that automatically logs inputs and outputs
 */
export function withLogging<T extends (...args: any[]) => any>(
  fn: T,
  functionName: string,
  config: Partial<LogConfig> = {}
): T {
  const finalConfig = { ...defaultLogConfig, ...config };

  if (!finalConfig.enabled) {
    return fn;
  }

  return ((...args: Parameters<T>): ReturnType<T> => {
    const startTime = Date.now();
    const sanitizedArgs = finalConfig.logInputs ? sanitizeData(args, finalConfig) : undefined;

    // Log function entry
    logger.info(`Function ${functionName} called`, {
      inputs: sanitizedArgs,
      timestamp: new Date().toISOString()
    });

    try {
      // Execute the function
      const result = fn(...args);
      
      // Handle both synchronous and asynchronous functions
      if (result instanceof Promise) {
        return result
          .then((resolvedResult) => {
            const duration = Date.now() - startTime;
            const sanitizedResult = finalConfig.logOutputs ? sanitizeData(resolvedResult, finalConfig) : undefined;
            
            logger.info(`Function ${functionName} completed successfully`, {
              outputs: sanitizedResult,
              duration: `${duration}ms`,
              timestamp: new Date().toISOString()
            });
            
            return resolvedResult;
          })
          .catch((error) => {
            const duration = Date.now() - startTime;
            
            if (finalConfig.logErrors) {
              logger.error(`Function ${functionName} failed`, {
                error: error instanceof Error ? error.message : String(error),
                duration: `${duration}ms`,
                timestamp: new Date().toISOString()
              });
            }
            
            throw error;
          }) as ReturnType<T>;
      } else {
        // Synchronous function
        const duration = Date.now() - startTime;
        const sanitizedResult = finalConfig.logOutputs ? sanitizeData(result, finalConfig) : undefined;
        
        logger.info(`Function ${functionName} completed successfully`, {
          outputs: sanitizedResult,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
        
        return result;
      }
    } catch (error) {
      // Synchronous error
      const duration = Date.now() - startTime;
      
      if (finalConfig.logErrors) {
        logger.error(`Function ${functionName} failed`, {
          error: error instanceof Error ? error.message : String(error),
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
      }
      
      throw error;
    }
  }) as T;
}

/**
 * Creates a function wrapper that automatically adds OpenTelemetry tracing
 */
export function withTracing<T extends (...args: any[]) => any>(
  fn: T,
  operationName: string,
  config: Partial<TracingConfig> = {}
): T {
  const finalConfig = { ...defaultTracingConfig, ...config };

  if (!finalConfig.enabled) {
    return fn;
  }

  return ((...args: Parameters<T>): ReturnType<T> => {
    const attributes: Record<string, string | number> = {
      'operation.name': operationName,
      'function.args.count': args.length,
      ...finalConfig.customAttributes
    };

    // Add input information if enabled
    if (finalConfig.includeInputs && args.length > 0) {
      attributes['function.input.length'] = JSON.stringify(args).length;
    }

    const span = createAppSpan(operationName, attributes);

    try {
      const result = fn(...args);
      
      // Handle both synchronous and asynchronous functions
      if (result instanceof Promise) {
        return result
          .then((resolvedResult) => {
            // Add output information if enabled
            if (finalConfig.includeOutputs) {
              span.setAttributes({
                'function.success': 'true',
                'function.output.type': typeof resolvedResult,
                'function.output.length': JSON.stringify(resolvedResult).length
              });
            } else {
              span.setAttributes({
                'function.success': 'true'
              });
            }
            
            span.end();
            return resolvedResult;
          })
          .catch((error) => {
            span.recordException(error as Error);
            span.setStatus({ code: 2, message: (error as Error).message });
            span.setAttributes({
              'function.success': 'false',
              'function.error.type': (error as Error).constructor.name,
              'function.error.message': (error as Error).message
            });
            span.end();
            throw error;
          }) as ReturnType<T>;
      } else {
        // Synchronous function
        if (finalConfig.includeOutputs) {
          span.setAttributes({
            'function.success': 'true',
            'function.output.type': typeof result,
            'function.output.length': JSON.stringify(result).length
          });
        } else {
          span.setAttributes({
            'function.success': 'true'
          });
        }
        
        span.end();
        return result;
      }
    } catch (error) {
      // Synchronous error
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      span.setAttributes({
        'function.success': 'false',
        'function.error.type': (error as Error).constructor.name,
        'function.error.message': (error as Error).message
      });
      span.end();
      throw error;
    }
  }) as T;
}

/**
 * Creates a function wrapper that combines both logging and tracing
 */
export function withLoggingAndTracing<T extends (...args: any[]) => any>(
  fn: T,
  functionName: string,
  logConfig: Partial<LogConfig> = {},
  tracingConfig: Partial<TracingConfig> = {}
): T {
  const tracedFn = withTracing(fn, functionName, tracingConfig);
  return withLogging(tracedFn, functionName, logConfig);
}

/**
 * Decorator for class methods (if using TypeScript decorators)
 */
export function logMethod(config: Partial<LogConfig> = {}) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const functionName = `${target.constructor.name}.${propertyName}`;
    
    descriptor.value = withLogging(method, functionName, config);
  };
}

/**
 * Utility to create a logged version of a function with custom name
 */
export function createLoggedFunction<T extends (...args: any[]) => any>(
  fn: T,
  name: string,
  config: Partial<LogConfig> = {}
): T {
  return withLogging(fn, name, config);
}

/**
 * Batch logging for multiple functions
 */
export function withBatchLogging<T extends Record<string, (...args: any[]) => any>>(
  functions: T,
  config: Partial<LogConfig> = {}
): T {
  const loggedFunctions: any = {};
  
  for (const [name, fn] of Object.entries(functions)) {
    loggedFunctions[name] = withLogging(fn, name, config);
  }
  
  return loggedFunctions as T;
}

/**
 * Automatic logging system initialization (deprecated)
 * The auto-interception modules have been removed. This is now a no-op.
 */
export function initializeAutoLogging() {
  // No-op: auto-interception modules removed
  // withLogging wrapper still works for manually wrapped functions
}