// Sentry-specific sanitization for logs. Self-contained to work on both client and server.
// Redacts sensitive fields from log attributes before sending to Sentry.

import type { Log } from '@sentry/core';
import { defaultLogConfig } from './schemas/schemas';

/**
 * Extended sensitive fields for Sentry Logs.
 * Includes all defaults plus common auth/session fields.
 */
export const SENTRY_SENSITIVE_FIELDS: readonly string[] = [
  ...defaultLogConfig.sensitiveFields,
  'email',
  'authorization',
  'cookie',
  'session',
  'jwt',
  'bearer',
  'refresh_token',
  'access_token',
  'apiKey',
  'pass',
];

/**
 * Sanitizes data by redacting sensitive fields.
 * Self-contained implementation for use on both client and server.
 */
function sanitizeDataForSentry(
  data: unknown,
  sensitiveFields: readonly string[]
): unknown {
  if (!data || typeof data !== 'object') {
    // Handle BigInt serialization
    if (typeof data === 'bigint') {
      return data.toString();
    }
    return data;
  }

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  if (Array.isArray(sanitized)) {
    return sanitized.map((item) => sanitizeDataForSentry(item, sensitiveFields));
  }

  for (const [key, value] of Object.entries(sanitized)) {
    // Handle BigInt values
    if (typeof value === 'bigint') {
      (sanitized as Record<string, unknown>)[key] = value.toString();
      continue;
    }

    // Redact sensitive fields (case-insensitive partial match)
    if (
      sensitiveFields.some((field) =>
        key.toLowerCase().includes(field.toLowerCase())
      )
    ) {
      (sanitized as Record<string, unknown>)[key] = '[REDACTED]';
      continue;
    }

    // Recursively sanitize nested objects
    if (value && typeof value === 'object') {
      (sanitized as Record<string, unknown>)[key] = sanitizeDataForSentry(
        value,
        sensitiveFields
      );
    }
  }

  return sanitized;
}

/**
 * Sanitizes data for Sentry Logs, redacting sensitive fields.
 * Returns undefined if data is null/undefined (Sentry handles this gracefully).
 */
export function sanitizeForSentry(
  data: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return sanitizeDataForSentry(data, SENTRY_SENSITIVE_FIELDS) as Record<
    string,
    unknown
  >;
}

/**
 * Creates a beforeSendLog callback for Sentry.init().
 * Sanitizes attributes to redact PII. All log levels are sent.
 */
export function createBeforeSendLog(): (log: Log) => Log | null {
  return (log: Log): Log | null => {
    // Filter out trace level only (too verbose for Sentry)
    if (log.level === 'trace') {
      return null;
    }

    // Sanitize attributes to redact PII
    if (log.attributes) {
      log.attributes = sanitizeForSentry(log.attributes) ?? {};
    }

    return log;
  };
}
