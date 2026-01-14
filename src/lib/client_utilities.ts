/* eslint-disable @typescript-eslint/no-explicit-any */
import { RequestIdContext } from './requestIdContext';
import * as Sentry from '@sentry/nextjs';
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

// Helper function to add request ID to data (includes full context)
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();
    const sessionId = RequestIdContext.getSessionId();
    return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};

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
            data: addRequestId(data),
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
        sendToSentry('ERROR', message, data);
        // Send to Sentry Logs for dedicated log view (in addition to breadcrumbs)
        try {
            Sentry.logger.error(message, sanitizeForSentry(addRequestId(data)));
        } catch {
            // Silently fail if Sentry.logger fails
        }
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
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
        sendToSentry('WARN', message, data);
        // Send to Sentry Logs for dedicated log view (in addition to breadcrumbs)
        try {
            Sentry.logger.warn(message, sanitizeForSentry(addRequestId(data)));
        } catch {
            // Silently fail if Sentry.logger fails
        }
    }
};

export { logger }; 