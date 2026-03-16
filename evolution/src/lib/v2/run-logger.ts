// Structured run logging for V2. Writes to evolution_run_logs table (fire-and-forget).

import type { SupabaseClient } from '@supabase/supabase-js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  iteration?: number;
  phaseName?: string;
  variantId?: string;
  [key: string]: unknown;
}

export interface RunLogger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
}

/**
 * Create a structured run logger that writes to evolution_run_logs.
 * All writes are fire-and-forget (errors swallowed).
 */
export function createRunLogger(runId: string, supabase: SupabaseClient): RunLogger {
  function log(level: LogLevel, message: string, context?: LogContext): void {
    const { iteration, phaseName, variantId, ...rest } = context ?? {};

    // Fire-and-forget insert
    Promise.resolve(
      supabase
        .from('evolution_run_logs')
        .insert({
          run_id: runId,
          level,
          message,
          agent_name: phaseName ?? null,
          iteration: iteration ?? null,
          variant_id: variantId ?? null,
          context: Object.keys(rest).length > 0 ? rest : null,
        }),
    )
      .then(({ error }) => {
        if (error) console.warn(`[V2RunLogger] DB error: ${error.message}`);
      })
      .catch(() => {
        // Swallow — fire-and-forget
      });
  }

  return {
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    debug: (msg, ctx) => log('debug', msg, ctx),
  };
}
