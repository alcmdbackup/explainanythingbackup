// src/lib/logging/client/safeUserCodeWrapper.ts

import { withClientLogging } from './safeClientLoggingBase';

// SAFE: User explicitly chooses what to log
export function createSafeEventHandler<T extends Function>(
  fn: T,
  name: string
): T {
  // Only wrap in development, with full safety guards
  if (process.env.NODE_ENV !== 'development') return fn;

  return withClientLogging(fn, name, {
    functionType: 'userEventHandler',
    enabled: true,
    logInputs: true,
    logOutputs: false
  });
}

// SAFE: User explicitly wraps their async functions
export function createSafeAsyncFunction<T extends Function>(
  fn: T,
  name: string
): T {
  if (process.env.NODE_ENV !== 'development') return fn;

  return withClientLogging(fn, name, {
    functionType: 'userAsync',
    enabled: true,
    logInputs: true,
    logOutputs: false
  });
}

// SAFE: Optional component-level logging
export function withComponentLogging<T extends Function>(
  component: T,
  componentName?: string
): T {
  if (process.env.NODE_ENV !== 'development') return component;

  // Only log the top-level component render, not internals
  return withClientLogging(component, componentName || 'Component', {
    functionType: 'userFunction',
    enabled: true,
    logInputs: false, // Avoid logging props (performance)
    logOutputs: false // Avoid logging JSX (noise)
  });
}

// SAFE: User explicitly calls these when needed
export function logUserAction(name: string, data: any) {
  if (process.env.NODE_ENV !== 'development') return;

  try {
    const { logger } = require('@/lib/client_utilities');
    logger.info(`User action: ${name}`, {
      data,
      timestamp: new Date().toISOString(),
      source: 'manual-user-action'
    });
  } catch {
    // Silent fail - manual logging should never break user code
  }
}

// SAFE: Manual export function
export async function exportClientLogs() {
  try {
    const { clientLogPersistence } = await import('./logPersistence');
    await clientLogPersistence.exportLogs();
  } catch (error) {
    console.warn('Failed to export client logs:', error);
  }
}