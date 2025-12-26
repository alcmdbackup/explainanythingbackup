/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from '@/lib/client_utilities';
import { LogConfig, defaultLogConfig } from '@/lib/schemas/schemas';

/**
 * Data sanitization limits for client-side logging
 */
const SANITIZE_LIMITS = {
  maxStringLength: 500,
  maxArrayItems: 10,
  maxObjectProperties: 20,
};

/**
 * Sanitizes data by removing sensitive fields, truncating long values,
 * and handling circular references
 */
function sanitizeData(data: any, config: LogConfig, seen = new WeakSet()): any {
  // Handle primitives
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return data.toString();
  }

  if (typeof data !== 'object') {
    // Truncate long strings
    if (typeof data === 'string' && data.length > SANITIZE_LIMITS.maxStringLength) {
      return data.substring(0, SANITIZE_LIMITS.maxStringLength) + '...';
    }
    return data;
  }

  // Circular reference detection
  if (seen.has(data)) {
    return '[Circular Reference]';
  }
  seen.add(data);

  // Handle arrays
  if (Array.isArray(data)) {
    const truncated = data.slice(0, SANITIZE_LIMITS.maxArrayItems);
    const result = truncated.map(item => sanitizeData(item, config, seen));
    if (data.length > SANITIZE_LIMITS.maxArrayItems) {
      result.push(`... and ${data.length - SANITIZE_LIMITS.maxArrayItems} more items`);
    }
    return result;
  }

  // Handle objects
  const sanitized: Record<string, any> = {};
  const keys = Object.keys(data);
  const truncatedKeys = keys.slice(0, SANITIZE_LIMITS.maxObjectProperties);

  for (const key of truncatedKeys) {
    const value = data[key];

    // Handle BigInt values
    if (typeof value === 'bigint') {
      sanitized[key] = value.toString();
      continue;
    }

    // Redact sensitive fields
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
        continue;
      }
    }

    // Recursively sanitize nested objects
    if (value && typeof value === 'object') {
      sanitized[key] = sanitizeData(value, config, seen);
    } else {
      sanitized[key] = value;
    }
  }

  if (keys.length > SANITIZE_LIMITS.maxObjectProperties) {
    sanitized['__truncated__'] = `${keys.length - SANITIZE_LIMITS.maxObjectProperties} more properties`;
  }

  return sanitized;
}

/**
 * Creates a function wrapper that automatically logs inputs and outputs
 * for client-side functions. Mirrors the server-side withLogging pattern.
 */
export function withClientLogging<T extends (...args: any[]) => any>(
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
