// src/lib/logging/client/appIntegration.tsx
'use client';

import { useEffect } from 'react';
import { initializeClientAutoLogging } from './initClientAutoLogging';

// Component to initialize client-side automatic logging
export function ClientLoggingInitializer() {
  useEffect(() => {
    // Only run on client side in development
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      initializeClientAutoLogging();
    }
  }, []);

  // This component renders nothing, just handles initialization
  return null;
}

// Export utility functions for manual use
export { exportClientLogs, logUserAction } from './safeUserCodeWrapper';
export { createSafeEventHandler, createSafeAsyncFunction, withComponentLogging } from './safeUserCodeWrapper';