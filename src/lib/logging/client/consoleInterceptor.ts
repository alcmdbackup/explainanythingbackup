/**
 * Console Interceptor - localStorage buffer for client logs
 *
 * This module intercepts console methods and persists logs to localStorage.
 * It also captures uncaught errors and unhandled promise rejections.
 *
 * Features:
 * - Persists logs to localStorage with configurable level filtering
 * - Flushes pre-hydration logs captured by earlyLogger.ts
 * - Captures uncaught errors and unhandled rejections
 * - HMR-safe cleanup to prevent stacked wrappers in development
 */

import {
  getLogConfig,
  shouldPersist,
  type LogLevel,
  type ClientLogConfig,
} from './logConfig';

const LOG_KEY = 'client_logs';
const ERROR_KEY = 'client_errors';

// Store pristine console at module load (before any patching)
const PRISTINE_CONSOLE =
  typeof window !== 'undefined' ? { ...console } : null;
let isInterceptorActive = false;

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  preHydration?: boolean;
}

interface ErrorEntry {
  timestamp: string;
  level: string;
  type: 'uncaught' | 'unhandledrejection';
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
}

/**
 * Safely serialize a value to string, handling edge cases.
 */
function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    return String(value);
  } catch {
    return '[Unserializable]';
  }
}

/**
 * Initialize the console interceptor.
 * Returns a cleanup function for HMR/unmount.
 */
export function initConsoleInterceptor(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (isInterceptorActive) return () => {}; // HMR protection

  // Test localStorage availability
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
  } catch {
    PRISTINE_CONSOLE?.warn('localStorage unavailable - console interceptor disabled');
    return () => {};
  }

  const config = getLogConfig();

  // Flush pre-hydration logs first
  flushPreHydrationLogs(config);

  // Mark as initialized to stop early logger buffering
  window.__LOGGING_INITIALIZED__ = true;

  // Patch console methods with level filtering
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  consoleMethods.forEach((level) => {
    console[level] = (...args: unknown[]) => {
      // Always call original console method
      PRISTINE_CONSOLE![level](...args);

      // Check if should persist
      if (!shouldPersist(level as LogLevel, config)) return;

      persistLog({
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message: args.map(safeStringify).join(' '),
      }, config);
    };
  });

  isInterceptorActive = true;

  // Expose utility functions on window
  window.exportLogs = () => localStorage.getItem(LOG_KEY) || '[]';
  window.clearLogs = () => {
    localStorage.removeItem(LOG_KEY);
    localStorage.removeItem(ERROR_KEY);
  };

  // Return cleanup for HMR
  return () => {
    if (PRISTINE_CONSOLE) {
      consoleMethods.forEach((level) => {
        console[level] = PRISTINE_CONSOLE[level];
      });
    }
    isInterceptorActive = false;
  };
}

/**
 * Flush logs captured before React hydration.
 */
function flushPreHydrationLogs(config: ClientLogConfig): void {
  const preHydrationLogs = window.__PRE_HYDRATION_LOGS__ || [];
  if (preHydrationLogs.length === 0) return;

  try {
    const existingLogs: LogEntry[] = JSON.parse(
      localStorage.getItem(LOG_KEY) || '[]'
    );
    const bufferedLogs: LogEntry[] = preHydrationLogs.map((entry) => ({
      timestamp: entry.timestamp,
      level: entry.level,
      message: entry.args.map(safeStringify).join(' '),
      preHydration: true,
    }));
    const combined = [...existingLogs, ...bufferedLogs].slice(
      -config.maxLocalLogs
    );
    localStorage.setItem(LOG_KEY, JSON.stringify(combined));
  } catch {
    /* ignore */
  }

  // Clear the pre-hydration buffer
  window.__PRE_HYDRATION_LOGS__ = [];
}

/**
 * Persist a log entry to localStorage.
 */
function persistLog(entry: LogEntry, config: ClientLogConfig): void {
  try {
    const logs: LogEntry[] = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    logs.push(entry);
    if (logs.length > config.maxLocalLogs) logs.shift();
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      // Clear logs if quota exceeded
      localStorage.removeItem(LOG_KEY);
    }
  }
}

/**
 * Persist an error entry to localStorage.
 */
function persistError(entry: ErrorEntry): void {
  try {
    const errors: ErrorEntry[] = JSON.parse(
      localStorage.getItem(ERROR_KEY) || '[]'
    );
    errors.push(entry);
    if (errors.length > 100) errors.shift();
    localStorage.setItem(ERROR_KEY, JSON.stringify(errors));
  } catch {
    /* ignore */
  }
}

/**
 * Initialize error handlers for uncaught errors and unhandled rejections.
 * Returns a cleanup function for HMR/unmount.
 */
export function initErrorHandlers(): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleError = (event: ErrorEvent) => {
    persistError({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      type: 'uncaught',
      message: event.message,
      stack: event.error?.stack,
      filename: event.filename,
      lineno: event.lineno,
    });
  };

  const handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    persistError({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      type: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);

  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
  };
}

// HMR support
if (typeof module !== 'undefined' && (module as NodeModule & { hot?: { dispose: (cb: () => void) => void } }).hot) {
  (module as NodeModule & { hot: { dispose: (cb: () => void) => void } }).hot.dispose(() => {
    if (PRISTINE_CONSOLE) {
      (['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
        console[level] = PRISTINE_CONSOLE[level];
      });
    }
    isInterceptorActive = false;
  });
}
