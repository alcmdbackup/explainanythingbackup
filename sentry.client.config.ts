// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { createBeforeSendLog } from "@/lib/sentrySanitization";

// FAST_DEV mode: Skip all Sentry initialization for faster local development
// Uses NEXT_PUBLIC_ prefix for client-side access
if (process.env.NEXT_PUBLIC_FAST_DEV === 'true') {
  console.log('⚡ FAST_DEV: Skipping Sentry client initialization');
} else {

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Debug logging for Sentry initialization
console.log('[Sentry Client] Initializing...', {
  dsnConfigured: !!dsn,
  dsnPrefix: dsn ? dsn.substring(0, 20) + '...' : 'NOT SET',
  environment: process.env.NODE_ENV,
});

if (!dsn) {
  console.warn('[Sentry Client] NEXT_PUBLIC_SENTRY_DSN not configured - Sentry will not capture errors');
}

Sentry.init({
  dsn,
  environment: process.env.NODE_ENV,

  // Enable Sentry Logs for error correlation (SDK v10+ uses top-level option)
  enableLogs: true,
  beforeSendLog: createBeforeSendLog(),

  // Route through our tunnel endpoint to bypass ad blockers
  tunnel: '/api/monitoring',

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ||
    (process.env.NODE_ENV === 'production' ? '0.2' : '1.0')
  ),

  // Session Replay configuration
  replaysSessionSampleRate: parseFloat(
    process.env.SENTRY_REPLAYS_SESSION_RATE || '0.1'
  ),
  replaysOnErrorSampleRate: parseFloat(
    process.env.SENTRY_REPLAYS_ERROR_RATE || '1.0'
  ),

  // Integrations for enhanced client-side monitoring
  integrations: [
    Sentry.replayIntegration({
      // Capture full DOM for debugging (adjust for privacy requirements)
      maskAllText: false,
      blockAllMedia: false,
    }),
    Sentry.browserTracingIntegration(),
  ],

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Filter out known noise before sending to Sentry
  beforeSend(event) {
    const message = event.exception?.values?.[0]?.value || '';

    // Filter out common non-actionable errors
    if (
      message.includes('ResizeObserver') ||
      message.includes('Non-Error promise rejection') ||
      message.includes('AbortError') ||
      message.includes('Load failed') || // Safari network errors
      message.includes('Script error') // Cross-origin script errors
    ) {
      return null;
    }

    return event;
  },
});

} // End FAST_DEV else block
