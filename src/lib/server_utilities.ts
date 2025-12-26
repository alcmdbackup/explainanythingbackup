/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { RequestIdContext } from './requestIdContext';

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

    const logEntry = JSON.stringify({
        timestamp,
        level,
        message,
        requestId: RequestIdContext.getRequestId(),
        userId: RequestIdContext.getUserId(),
        sessionId: RequestIdContext.getSessionId(),
        data: data || {}
    }) + '\n';

    try {
        appendFileSync(logFile, logEntry);
    } catch (error) {
        // Silently fail if file write fails to avoid recursive logging
    }
}

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
        writeToFile('DEBUG', message, data);
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
        writeToFile('ERROR', message, data);
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
        writeToFile('INFO', message, data);
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
        writeToFile('WARN', message, data);
    }
};

export { logger, getRequiredEnvVar }; 