/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { RequestIdContext } from './requestIdContext';
import * as Sentry from '@sentry/nextjs';
import { emitLog } from './logging/server/otelLogger';
import { sanitizeForSentry } from './sentrySanitization';

/**
 * Logger utility for consistent logging across the application
 * @param message - The message to log
 * @param data - Optional data to include in the log
 * @param debug - Whether to show debug logs
 */
interface LoggerData {
    [key: string]: any;
}

const logFile = join(process.cwd(), 'server.log');

/**
 * Gets a required environment variable, throwing an error if it's not set
 * @param {string} name - The name of the environment variable
 * @returns {string} The value of the environment variable
 * @throws {Error} If the environment variable is not set
 */
function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Helper function to add request context to console logs
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();
    const sessionId = RequestIdContext.getSessionId();
    return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};

// File logging with FLAT structure (breaking change from nested)
function writeToFile(level: string, message: string, data: LoggerData | null) {
    const timestamp = new Date().toISOString();
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();
    const sessionId = RequestIdContext.getSessionId();

    const logEntry = JSON.stringify({
        timestamp,
        level,
        message,
        requestId,
        userId,
        sessionId,
        data: data || {}
    }) + '\n';

    try {
        appendFileSync(logFile, logEntry);
    } catch (error) {
        // Silently fail if file write fails to avoid recursive logging
    }

    // Send to Honeycomb via OTLP (respects log level policy per environment)
    try {
        emitLog(level, message, {
            requestId,
            userId,
            sessionId,
            ...(data || {})
        }, 'server');
    } catch {
        // Silently fail OTLP to avoid recursive logging
    }
}

// Map log levels to Sentry severity levels
const sentryLevelMap: Record<string, Sentry.SeverityLevel> = {
    'DEBUG': 'debug',
    'INFO': 'info',
    'WARN': 'warning',
    'ERROR': 'error',
};

/**
 * Send log entry as Sentry breadcrumb for error correlation.
 * Breadcrumbs appear in the timeline when an error is captured.
 * Note: This does NOT send a Sentry event - only adds to breadcrumb trail.
 */
function sendToSentry(level: string, message: string, data: LoggerData | null) {
    try {
        Sentry.addBreadcrumb({
            category: 'log',
            message,
            level: sentryLevelMap[level] || 'info',
            data: {
                ...data,
                requestId: RequestIdContext.getRequestId(),
                userId: RequestIdContext.getUserId(),
                sessionId: RequestIdContext.getSessionId(),
            },
        });
        // NO captureMessage - breadcrumbs only to avoid duplicates!
    } catch {
        // Silently fail if Sentry fails to avoid recursive issues
    }
}

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
        writeToFile('DEBUG', message, data);
        sendToSentry('DEBUG', message, data);
        // Send to Sentry Logs for dedicated log view
        try {
            Sentry.logger.debug(message, sanitizeForSentry(addRequestId(data)));
        } catch {
            // Silently fail if Sentry.logger fails
        }
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
        writeToFile('ERROR', message, data);
        sendToSentry('ERROR', message, data);
        // Send to Sentry Logs for dedicated log view (in addition to breadcrumbs)
        try {
            Sentry.logger.error(message, sanitizeForSentry(addRequestId(data)));
            // Flush to ensure logs are sent in serverless/edge environments
            Sentry.flush(2000).catch(() => {});
        } catch {
            // Silently fail if Sentry.logger fails
        }
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
        writeToFile('INFO', message, data);
        sendToSentry('INFO', message, data);
        // Send to Sentry Logs for dedicated log view
        try {
            Sentry.logger.info(message, sanitizeForSentry(addRequestId(data)));
        } catch {
            // Silently fail if Sentry.logger fails
        }
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
        writeToFile('WARN', message, data);
        sendToSentry('WARN', message, data);
        // Send to Sentry Logs for dedicated log view (in addition to breadcrumbs)
        try {
            Sentry.logger.warn(message, sanitizeForSentry(addRequestId(data)));
            // Flush to ensure logs are sent in serverless/edge environments
            Sentry.flush(2000).catch(() => {});
        } catch {
            // Silently fail if Sentry.logger fails
        }
    }
};

export { logger, getRequiredEnvVar }; 