/**
 * OTLP Logger - Sends logs to the OTLP backend (Honeycomb) via OpenTelemetry
 *
 * This module provides a function to emit logs to the configured OTLP backend
 * using the same endpoint and authentication as traces. Logs are batched and sent
 * asynchronously for efficiency.
 *
 * Log Level Policy:
 * - Production (default): Only error/warn levels are sent
 * - Production (OTEL_SEND_ALL_LOG_LEVELS=true): All levels are sent
 * - Development/Staging: All levels are sent
 */

import { SeverityNumber, Logger } from '@opentelemetry/api-logs';
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
  BatchLogRecordProcessor,
  LogRecordProcessor,
  ReadableLogRecord,
  SdkLogRecord,
} from '@opentelemetry/sdk-logs';
import { Context } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace } from '@opentelemetry/api';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';

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
 * Debug wrapper for LogRecordProcessor that logs export results.
 * Helps diagnose if Honeycomb is accepting or rejecting our logs.
 */
class DebugLogRecordProcessor implements LogRecordProcessor {
  private inner: LogRecordProcessor;
  private exporter: OTLPLogExporter;

  constructor(exporter: OTLPLogExporter, useSimple: boolean) {
    this.exporter = exporter;
    this.inner = useSimple
      ? new SimpleLogRecordProcessor(exporter)
      : new BatchLogRecordProcessor(exporter, {
          maxQueueSize: 100,
          maxExportBatchSize: 50,
          scheduledDelayMillis: 5000,
        });

    // Wrap the exporter's export method to log results
    const originalExport = exporter.export.bind(exporter);
    exporter.export = (logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void) => {
      console.log(`[otelLogger] Exporting ${logs.length} log(s) to Honeycomb...`);
      return originalExport(logs, (result: ExportResult) => {
        if (result.code === ExportResultCode.SUCCESS) {
          console.log(`[otelLogger] ✅ Export SUCCESS - ${logs.length} log(s) sent to Honeycomb`);
        } else {
          console.error(`[otelLogger] ❌ Export FAILED - code: ${result.code}, error:`, result.error);
        }
        resultCallback(result);
      });
    };
  }

  onEmit(logRecord: SdkLogRecord, context?: Context): void {
    this.inner.onEmit(logRecord, context);
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  async forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }
}

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
    const headers = parseOTELHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
    // Mask header values to prevent API key exposure in logs
    const maskedHeaders = Object.fromEntries(Object.entries(headers).map(([k]) => [k, '[MASKED]']));
    console.log('[otelLogger] Parsed headers:', JSON.stringify(maskedHeaders));
    console.log('[otelLogger] Creating exporter for:', `${endpoint}/v1/logs`);

    const exporter = new OTLPLogExporter({
      url: `${endpoint}/v1/logs`,
      headers,
    });

    // Create resource with service attributes using v2.x API
    const resource = resourceFromAttributes({
      'service.name': 'explainanything',
      'service.namespace': 'my-application-group',
      'deployment.environment': process.env.NODE_ENV || 'development',
    });

    // Use DebugLogRecordProcessor to monitor export success/failure
    // In production: uses BatchLogRecordProcessor internally for efficiency
    // In development: uses SimpleLogRecordProcessor for immediate sends
    const useSimple = process.env.NODE_ENV !== 'production';
    const processor = new DebugLogRecordProcessor(exporter, useSimple);

    const provider = new LoggerProvider({
      resource,
      processors: [processor],
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
 * Emit a log to the OTLP backend (Honeycomb).
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

  // Debug: Log what we're trying to send
  console.log(`[otelLogger] emitLog called: level=${upperLevel}, message="${message}", source=${source}`);

  // In production, only send error/warn unless OTEL_SEND_ALL_LOG_LEVELS is enabled
  const sendAllLevels = process.env.OTEL_SEND_ALL_LOG_LEVELS === 'true';
  if (process.env.NODE_ENV === 'production' && !sendAllLevels && !PROD_LEVELS.has(upperLevel)) {
    console.log(`[otelLogger] Skipping log (production mode, level=${upperLevel})`);
    return;
  }

  const logger = initializeOTLPLogger();
  if (!logger) {
    console.log('[otelLogger] Logger not initialized, skipping');
    return;
  }

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

  console.log(`[otelLogger] Log emitted successfully: ${upperLevel} - "${message}"`);
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
