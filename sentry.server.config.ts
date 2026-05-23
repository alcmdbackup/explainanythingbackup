// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { createBeforeSendLog } from "@/lib/sentrySanitization";
import { classifyHost } from "@/config/hostnames";

// Production safeguard: FAST_DEV must NEVER run in production
if (process.env.NODE_ENV === 'production' && process.env.FAST_DEV === 'true' && !process.env.CI) {
  console.error('FATAL: FAST_DEV cannot be enabled in production');
}

// Runtime guard: Only initialize in Node.js runtime (not Edge)
// This prevents duplicate OpenTelemetry registration if Turbopack loads this in wrong context
if (process.env.NEXT_RUNTIME === 'edge') {
  console.warn('⚠️ sentry.server.config loaded in Edge runtime - skipping (use sentry.edge.config instead)');
}

// FAST_DEV mode: Skip all Sentry initialization for faster local development
else if (process.env.FAST_DEV === 'true') {
  console.log('⚡ FAST_DEV: Skipping Sentry server initialization');
} else {

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Enable Sentry Logs for error correlation (SDK v10+ uses top-level option)
  enableLogs: true,
  beforeSendLog: createBeforeSendLog(),

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ||
    (process.env.NODE_ENV === 'production' ? '0.2' : '1.0')
  ),

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: process.env.NODE_ENV !== 'production',

  // Filter out known noise before sending to Sentry, and tag each event with
  // the routing tier of the request hostname (split_evolution_explainanythig_into_separate_websites_20260522).
  beforeSend(event) {
    const message = event.exception?.values?.[0]?.value || '';

    // Filter out common non-actionable errors
    if (
      message.includes('ResizeObserver') ||
      message.includes('Non-Error promise rejection') ||
      message.includes('AbortError') ||
      message.includes('Load failed') // Safari network errors
    ) {
      return null;
    }

    // Per-event host tag — module-init setTag wouldn't work because the host is per-request.
    // Node IncomingMessage.headers can store a value as string | string[]; coerce defensively
    // so beforeSend never throws on the array shape.
    const rawHost = event.request?.headers?.host;
    const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
    if (typeof host === 'string' && host.length > 0) {
      event.tags = { ...event.tags, site: classifyHost(host) };
    }

    return event;
  },
});

} // End FAST_DEV else block
