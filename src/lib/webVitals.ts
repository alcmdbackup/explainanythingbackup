/**
 * Web Vitals reporter for Core Web Vitals metrics.
 * Reports CLS, FCP, LCP, TTFB, and INP to Sentry for performance monitoring.
 */
import * as Sentry from '@sentry/nextjs';
import { onCLS, onFCP, onLCP, onTTFB, onINP, type Metric } from 'web-vitals';

/**
 * Rating thresholds for Web Vitals metrics
 * Based on Google's Core Web Vitals guidelines
 */
const VITALS_THRESHOLDS = {
  CLS: { good: 0.1, needsImprovement: 0.25 },
  FCP: { good: 1800, needsImprovement: 3000 },
  LCP: { good: 2500, needsImprovement: 4000 },
  TTFB: { good: 800, needsImprovement: 1800 },
  INP: { good: 200, needsImprovement: 500 },
};

/**
 * Send a Web Vitals metric to Sentry
 */
function sendToSentry(metric: Metric) {
  const { name, value, rating, id } = metric;

  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Web Vitals] ${name}: ${value.toFixed(2)} (${rating})`);
  }

  // Report to Sentry as a custom measurement
  // Sentry automatically tracks Web Vitals when browserTracingIntegration is enabled,
  // but we add custom spans for more detailed tracking
  Sentry.addBreadcrumb({
    category: 'web-vitals',
    message: `${name}: ${value.toFixed(2)}`,
    level: rating === 'good' ? 'info' : rating === 'needs-improvement' ? 'warning' : 'error',
    data: {
      metric: name,
      value,
      rating,
      id,
      threshold_good: VITALS_THRESHOLDS[name as keyof typeof VITALS_THRESHOLDS]?.good,
      threshold_poor: VITALS_THRESHOLDS[name as keyof typeof VITALS_THRESHOLDS]?.needsImprovement,
    },
  });

  // Set custom measurement for the active transaction
  Sentry.setMeasurement(name, value, name === 'CLS' ? '' : 'millisecond');
}

/**
 * Initialize Web Vitals collection and reporting.
 * Call this once in ClientInitializer or layout.
 */
export function initWebVitals() {
  // Skip in FAST_DEV mode
  if (process.env.NEXT_PUBLIC_FAST_DEV === 'true') {
    return;
  }

  // Register handlers for all Core Web Vitals
  onCLS(sendToSentry);
  onFCP(sendToSentry);
  onLCP(sendToSentry);
  onTTFB(sendToSentry);
  onINP(sendToSentry);

  if (process.env.NODE_ENV === 'development') {
    console.log('[Web Vitals] Initialized - collecting CLS, FCP, LCP, TTFB, INP');
  }
}

/**
 * Performance mark helper for custom timing points.
 * Use this to mark key milestones in the user flow.
 *
 * @example
 * markPerformance('streaming_start');
 * markPerformance('content_complete');
 */
export function markPerformance(name: string, detail?: Record<string, unknown>) {
  if (typeof performance === 'undefined') return;

  try {
    performance.mark(name, { detail });

    // Also add a Sentry breadcrumb for correlation
    Sentry.addBreadcrumb({
      category: 'performance',
      message: `Mark: ${name}`,
      level: 'info',
      data: detail,
    });
  } catch {
    // Ignore errors in environments without Performance API
  }
}

/**
 * Measure time between two performance marks.
 *
 * @example
 * measurePerformance('streaming_duration', 'streaming_start', 'streaming_end');
 */
export function measurePerformance(
  measureName: string,
  startMark: string,
  endMark: string
) {
  if (typeof performance === 'undefined') return;

  try {
    const measure = performance.measure(measureName, startMark, endMark);

    // Report the custom measurement to Sentry
    Sentry.setMeasurement(measureName, measure.duration, 'millisecond');

    Sentry.addBreadcrumb({
      category: 'performance',
      message: `Measure: ${measureName} = ${measure.duration.toFixed(2)}ms`,
      level: 'info',
      data: {
        startMark,
        endMark,
        duration: measure.duration,
      },
    });

    return measure.duration;
  } catch {
    // Ignore errors (e.g., if marks don't exist)
    return undefined;
  }
}
