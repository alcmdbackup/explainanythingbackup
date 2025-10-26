// src/lib/logging/client/initClientAutoLogging.ts
import { clientLogPersistence } from './logPersistence';
import { setupRuntimeBrowserInterception } from './runtimeInterceptor';

export async function initializeClientAutoLogging() {
  if (typeof window === 'undefined') return; // Client-side only

  // Only initialize in development
  if (process.env.NODE_ENV !== 'development') return;

  try {
    // Initialize log persistence
    await clientLogPersistence.initialize();

    // Setup aggressive runtime browser API interception
    setupRuntimeBrowserInterception();

    console.log('🔧 Client-side automatic logging initialized with runtime interception');
  } catch (error) {
    console.warn('⚠️ Failed to initialize client-side automatic logging:', error);
  }
}

// Export function to manually export logs
export async function exportClientLogs() {
  await clientLogPersistence.exportLogs();
}

// Emergency disable mechanism
export const CLIENT_LOGGING_ENABLED = process.env.CLIENT_LOGGING !== 'false';