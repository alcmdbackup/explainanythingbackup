// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ||
    (process.env.NODE_ENV === 'production' ? '0.2' : '1.0')
  ),

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
      message.includes('Load failed') // Safari network errors
    ) {
      return null;
    }

    return event;
  },
});
