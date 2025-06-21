import { logger } from '@/lib/server_utilities';

// Configuration for function logging
interface LogConfig {
  enabled: boolean;
  logInputs: boolean;
  logOutputs: boolean;
  logErrors: boolean;
  maxInputLength?: number;
  maxOutputLength?: number;
  sensitiveFields?: string[];
}

// Default configuration
const defaultConfig: LogConfig = {
  enabled: true,
  logInputs: true,
  logOutputs: true,
  logErrors: true,
  maxInputLength: 1000,
  maxOutputLength: 1000,
  sensitiveFields: ['password', 'apiKey', 'token', 'secret']
};

/**
 * Sanitizes data by removing sensitive fields and truncating long values
 */
function sanitizeData(data: any, config: LogConfig): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  if (Array.isArray(sanitized)) {
    return sanitized.map(item => sanitizeData(item, config));
  }

  for (const [key, value] of Object.entries(sanitized)) {
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
  const finalConfig = { ...defaultConfig, ...config };

  if (!finalConfig.enabled) {
    return fn;
  }

  return ((...args: Parameters<T>): ReturnType<T> => {
    const startTime = Date.now();
    const sanitizedArgs = finalConfig.logInputs ? sanitizeData(args, finalConfig) : undefined;

    // Log function entry
    logger.debug(`Function ${functionName} called`, {
      inputs: sanitizedArgs,
      timestamp: new Date().toISOString()
    }, true);

    try {
      // Execute the function
      const result = fn(...args);
      
      // Handle both synchronous and asynchronous functions
      if (result instanceof Promise) {
        return result
          .then((resolvedResult) => {
            const duration = Date.now() - startTime;
            const sanitizedResult = finalConfig.logOutputs ? sanitizeData(resolvedResult, finalConfig) : undefined;
            
            logger.debug(`Function ${functionName} completed successfully`, {
              outputs: sanitizedResult,
              duration: `${duration}ms`,
              timestamp: new Date().toISOString()
            }, true);
            
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
        
        logger.debug(`Function ${functionName} completed successfully`, {
          outputs: sanitizedResult,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        }, true);
        
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