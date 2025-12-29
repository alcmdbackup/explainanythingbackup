/**
 * Early Logger Script - Pre-hydration log capture
 *
 * This script is inlined into a <script> tag in layout.tsx for immediate execution.
 * It captures console logs that fire before React hydrates, preventing log loss.
 *
 * How it works:
 * 1. Runs immediately when the page loads (before React)
 * 2. Saves original console methods
 * 3. Patches console to buffer logs to window.__PRE_HYDRATION_LOGS__
 * 4. After ClientInitializer runs, logs are flushed to localStorage
 */

declare global {
  interface Window {
    __PRE_HYDRATION_LOGS__?: Array<{
      timestamp: string;
      level: string;
      args: unknown[];
    }>;
    __LOGGING_INITIALIZED__?: boolean;
    __ORIGINAL_CONSOLE__?: {
      log: typeof console.log;
      info: typeof console.info;
      warn: typeof console.warn;
      error: typeof console.error;
      debug: typeof console.debug;
    };
    exportLogs?: () => string;
    clearLogs?: () => void;
  }
}

/**
 * Script to be inlined in layout.tsx via dangerouslySetInnerHTML.
 * Must be a plain string - no imports, no TypeScript features.
 */
export const EARLY_LOGGER_SCRIPT = `
(function() {
  if (typeof window === 'undefined') return;

  window.__PRE_HYDRATION_LOGS__ = [];
  window.__LOGGING_INITIALIZED__ = false;
  window.__ORIGINAL_CONSOLE__ = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  ['log', 'info', 'warn', 'error', 'debug'].forEach(function(level) {
    var original = console[level];
    console[level] = function() {
      original.apply(console, arguments);
      if (!window.__LOGGING_INITIALIZED__) {
        window.__PRE_HYDRATION_LOGS__.push({
          timestamp: new Date().toISOString(),
          level: level.toUpperCase(),
          args: Array.prototype.slice.call(arguments)
        });
      }
    };
  });
})();
`;

export {};
