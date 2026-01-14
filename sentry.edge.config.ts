// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { createBeforeSendLog } from "@/lib/sentrySanitization";

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
  debug: false,
});
