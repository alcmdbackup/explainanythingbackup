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

const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Create a structured entity logger that writes to evolution_logs.
 * All writes are fire-and-forget (errors swallowed).
 * Respects EVOLUTION_LOG_LEVEL env var for level filtering (debug < info < warn < error).
 */
export function createEntityLogger(
  entityCtx: EntityLogContext,
  supabase: SupabaseClient,
): EntityLogger {
  const minLevel = LOG_LEVELS[process.env.EVOLUTION_LOG_LEVEL ?? ''] ?? 0;

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if ((LOG_LEVELS[level] ?? 0) < minLevel) return;

    // Defensive: tests pass partial/mock Supabase clients. Skip the DB insert silently
    // when the client doesn't expose .from(), matching the existing fire-and-forget
    // semantics — production calls always have a real client.
    if (typeof (supabase as { from?: unknown })?.from !== 'function') return;

    const { iteration, phaseName, variantId, ...rest } = context ?? {};

    // Wrap the synchronous call chain too: when a test mocks .from() but doesn't expose
    // .insert(), `from(...).insert(...)` would throw synchronously and escape the .catch
    // below. Production clients have both methods so this only matters for test harnesses.
    try {
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
    } catch {
      // Synchronous throw from a partial supabase mock; matches fire-and-forget.
    }
  }

  return {
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    debug: (msg, ctx) => log('debug', msg, ctx),
  };
}
