/**
 * OTLP Logger - Sends logs to Grafana Loki via OpenTelemetry
 *
 * This module provides a function to emit logs to Grafana Cloud using the same
 * OTLP endpoint and authentication as traces. Logs are batched and sent
 * asynchronously for efficiency.
 *
 * Log Level Policy:
 * - Production: Only error/warn levels are sent
 * - Development/Staging: All levels are sent
 */

import { SeverityNumber, Logger } from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace } from '@opentelemetry/api';

// Singleton logger instance
let otelLogger: Logger | null = null;
let isInitialized = false;

// Map string levels to OTel severity numbers
const SEVERITY_MAP: Record<string, SeverityNumber> = {
  DEBUG: SeverityNumber.DEBUG,
  INFO: SeverityNumber.INFO,
  WARN: SeverityNumber.WARN,
  ERROR: SeverityNumber.ERROR,
};

// Levels allowed in production (error and warn only)
const PROD_LEVELS = new Set(['ERROR', 'WARN']);

/**
 * Parse OTEL headers from environment variable format
 * Format: "Authorization=Basic xxx" or "key1=value1,key2=value2"
 */
function parseOTELHeaders(headersStr?: string): Record<string, string> {
  if (!headersStr) return {};

  const headers: Record<string, string> = {};
  headersStr.split(',').forEach((pair) => {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join('=').trim();
    }
  });
  return headers;
}

/**
 * Initialize the OTLP logger. Safe to call multiple times.
 * Returns the logger instance or null if not configured.
 */
function initializeOTLPLogger(): Logger | null {
  if (isInitialized) return otelLogger;
  isInitialized = true;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log('[otelLogger] OTEL_EXPORTER_OTLP_ENDPOINT not configured, OTLP logging disabled');
    return null;
  }

  try {
    const exporter = new OTLPLogExporter({
      url: `${endpoint}/v1/logs`,
      headers: parseOTELHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    });

    // Create resource with service attributes using v2.x API
    const resource = resourceFromAttributes({
      'service.name': 'explainanything',
      'service.namespace': 'my-application-group',
      'deployment.environment': process.env.NODE_ENV || 'development',
    });

    const provider = new LoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor(exporter)],
    });

    otelLogger = provider.getLogger('explainanything');
    console.log('[otelLogger] OTLP logging initialized, sending to:', `${endpoint}/v1/logs`);
    return otelLogger;
  } catch (error) {
    console.error('[otelLogger] Failed to initialize:', error);
    return null;
  }
}

/**
 * Emit a log to Grafana via OTLP.
 *
 * In production, only ERROR and WARN levels are sent.
 * In other environments, all levels are sent.
 *
 * @param level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param message - Log message
 * @param data - Additional structured data
 * @param source - Log source ('server' or 'client')
 */
export function emitLog(
  level: string,
  message: string,
  data: Record<string, unknown> = {},
  source: 'server' | 'client' = 'server'
): void {
  const upperLevel = level.toUpperCase();

  // In production, only send error/warn
  if (process.env.NODE_ENV === 'production' && !PROD_LEVELS.has(upperLevel)) {
    return;
  }

  const logger = initializeOTLPLogger();
  if (!logger) return;

  // Get current trace context for correlation
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  const attributes: Record<string, string | number | boolean> = {
    source,
    ...flattenData(data),
  };

  // Add trace correlation if available
  if (spanContext) {
    attributes['trace_id'] = spanContext.traceId;
    attributes['span_id'] = spanContext.spanId;
  }

  logger.emit({
    severityNumber: SEVERITY_MAP[upperLevel] || SeverityNumber.INFO,
    severityText: upperLevel,
    body: message,
    attributes,
    timestamp: Date.now() * 1_000_000, // Convert to nanoseconds
  });
}

/**
 * Flatten nested data object to dot-notation keys for OTLP attributes.
 * Example: { user: { id: '123' } } -> { 'user.id': '123' }
 */
function flattenData(
  data: Record<string, unknown>,
  prefix = ''
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(data)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[fullKey] = value;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenData(value as Record<string, unknown>, fullKey));
    } else {
      // Arrays and other types: stringify
      try {
        result[fullKey] = JSON.stringify(value);
      } catch {
        result[fullKey] = '[Unserializable]';
      }
    }
  }

  return result;
}

/**
 * Check if OTLP logging is enabled and configured.
 */
export function isOTLPLoggingEnabled(): boolean {
  return !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}
