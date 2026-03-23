// Generalized entity logger for the evolution pipeline.
// Writes structured logs to evolution_logs table with entity context and denormalized ancestor FKs.

import type { SupabaseClient } from '@supabase/supabase-js';

export type EntityType = 'run' | 'invocation' | 'experiment' | 'strategy';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface EntityLogContext {
  entityType: EntityType;
  entityId: string;
  runId?: string;
  experimentId?: string;
  strategyId?: string;
}

/**
 * Logger interface compatible with EvolutionLogger from types.ts.
 * Callers pass Record<string, unknown> context; known fields (iteration, phaseName,
 * variantId) are extracted internally by the log() implementation.
 */
export interface EntityLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/**
 * Create a structured entity logger that writes to evolution_logs.
 * All writes are fire-and-forget (errors swallowed).
 */
export function createEntityLogger(
  entityCtx: EntityLogContext,
  supabase: SupabaseClient,
): EntityLogger {
  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const { iteration, phaseName, variantId, ...rest } = context ?? {};

    Promise.resolve(
      supabase
        .from('evolution_logs')
        .insert({
          entity_type: entityCtx.entityType,
          entity_id: entityCtx.entityId,
          run_id: entityCtx.runId ?? null,
          experiment_id: entityCtx.experimentId ?? null,
          strategy_id: entityCtx.strategyId ?? null,
          level,
          message,
          agent_name: (phaseName as string) ?? null,
          iteration: (iteration as number) ?? null,
          variant_id: (variantId as string) ?? null,
          context: Object.keys(rest).length > 0 ? rest : null,
        }),
    )
      .then(({ error }) => {
        if (error) console.warn(`[EntityLogger] DB error: ${error.message}`);
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
