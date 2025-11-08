/* eslint-disable @typescript-eslint/no-explicit-any */
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

// Helper function to add request ID to data
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    return data ? { requestId, ...data } : { requestId };
};

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
    }
};

export { logger }; 