/**
 * Client-side log level configuration for the console interceptor.
 *
 * This module controls which log levels are persisted to localStorage
 * and which are sent to the remote endpoint.
 *
 * In production, set NEXT_PUBLIC_LOG_ALL_LEVELS=true to send all log levels
 * to the server for debugging. Note: This is a build-time variable - changing
 * it requires a new deployment.
 */

export type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  log: 1,
  info: 2,
  warn: 3,
  error: 4,
};

export interface ClientLogConfig {
  /** Minimum level to persist to localStorage */
  minPersistLevel: LogLevel;
  /** Minimum level to send to remote endpoint */
  minRemoteLevel: LogLevel;
  /** Whether remote sending is enabled */
  remoteEnabled: boolean;
  /** Maximum number of logs to keep in localStorage */
  maxLocalLogs: number;
}

const DEFAULT_DEV_CONFIG: ClientLogConfig = {
  minPersistLevel: 'debug',
  minRemoteLevel: 'warn',
  remoteEnabled: false,
  maxLocalLogs: 500,
};

// Check if all log levels should be sent to remote (build-time env var)
const sendAllLevels = process.env.NEXT_PUBLIC_LOG_ALL_LEVELS === 'true';

const DEFAULT_PROD_CONFIG: ClientLogConfig = {
  minPersistLevel: 'warn', // Keep localStorage conservative to avoid quota issues
  minRemoteLevel: sendAllLevels ? 'debug' : 'error',
  remoteEnabled: true,
  maxLocalLogs: 200,
};

/**
 * Get the appropriate log configuration based on environment.
 */
export function getLogConfig(): ClientLogConfig {
  const isProd = process.env.NODE_ENV === 'production';
  return isProd ? DEFAULT_PROD_CONFIG : DEFAULT_DEV_CONFIG;
}

/**
 * Check if a log at the given level should be persisted to localStorage.
 */
export function shouldPersist(
  level: LogLevel,
  config: ClientLogConfig
): boolean {
  return (
    LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[config.minPersistLevel]
  );
}

/**
 * Check if a log at the given level should be sent to remote.
 */
export function shouldSendRemote(
  level: LogLevel,
  config: ClientLogConfig
): boolean {
  return (
    config.remoteEnabled &&
    LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[config.minRemoteLevel]
  );
}
