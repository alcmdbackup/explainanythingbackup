// Generalized entity logger for the evolution pipeline.
// Writes structured logs to evolution_logs table with entity context and denormalized ancestor FKs.
//
// rename_agents_subagents_evolution_20260508 Phase 4: introduces `subagentName`
// (`string | string[]`, joined to dotted path on write) as the canonical field for
// log-emitter identification; `phaseName` is accepted for back-compat. The stored
// value lands in the `subagent_name` column on evolution_logs. The legacy
// `agent_name` column was dropped in migration 20260509000002 (Phase 4b).

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
 * Validate + join a subagent path. Returns the canonical dotted-string form,
 * or null when the input is empty / invalid (don't write garbage).
 *
 * Rules:
 *  - empty string / empty array → null
 *  - non-string / null / undefined / non-flat array elements → null + warn
 *  - segments containing `.` → null + warn (would corrupt prefix-LIKE queries)
 *  - whitespace-only segments → null + warn
 *  - total joined length > 200 → truncated + warn
 */
const _warnDedup = new Set<string>();
function _warnOnce(reason: string): void {
  if (_warnDedup.has(reason)) return;
  _warnDedup.add(reason);
  console.warn(`[joinSubagentPath] ${reason}`);
}

export function joinSubagentPath(input: string | string[] | null | undefined): string | null {
  if (input == null) return null;
  let segments: unknown[];
  if (Array.isArray(input)) {
    if (input.length === 0) return null;
    segments = input;
  } else if (typeof input === 'string') {
    if (input.length === 0) return null;
    segments = [input];
  } else {
    _warnOnce('input must be string or string[]');
    return null;
  }
  for (const seg of segments) {
    if (typeof seg !== 'string') {
      _warnOnce(`non-string segment: ${typeof seg}`);
      return null;
    }
    if (seg.trim().length === 0) {
      _warnOnce('whitespace-only segment');
      return null;
    }
    if (seg.includes('.')) {
      _warnOnce(`segment contains '.': "${seg}" (would corrupt prefix queries)`);
      return null;
    }
  }
  const joined = (segments as string[]).join('.');
  if (joined.length > 200) {
    _warnOnce(`subagent path > 200 chars; truncating`);
    return joined.slice(0, 200);
  }
  return joined;
}

/**
 * Logger interface compatible with EvolutionLogger from types.ts.
 * Callers pass Record<string, unknown> context; known fields (iteration,
 * subagentName / phaseName for back-compat, variantId) are extracted internally
 * by the log() implementation.
 */
export interface EntityLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  /**
   * Returns a NEW EntityLogger whose subagent path is extended with the given
   * segment(s). Pure in-memory: does NOT write a DB row at construction. Safe
   * inside hot loops. Each call site that emits logs from a sub-unit of work
   * is encouraged to construct a child logger rather than passing subagentName
   * on every call.
   *
   * Optional in the type so that ad-hoc test fixture loggers (`{info, warn,
   * error, debug}`) without a child() implementation still satisfy the type.
   * The factory always provides one.
   */
  child?(name: string | string[]): EntityLogger;
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
  basePath: string[] = [],
): EntityLogger {
  const minLevel = LOG_LEVELS[process.env.EVOLUTION_LOG_LEVEL ?? ''] ?? 0;

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if ((LOG_LEVELS[level] ?? 0) < minLevel) return;

    // Defensive: tests pass partial/mock Supabase clients. Skip the DB insert silently
    // when the client doesn't expose .from(), matching the existing fire-and-forget
    // semantics — production calls always have a real client.
    if (typeof (supabase as { from?: unknown })?.from !== 'function') return;

    const { iteration, subagentName, phaseName, variantId, ...rest } = context ?? {};

    // subagentName takes precedence; phaseName is accepted for back-compat.
    // basePath segments (set via .child()) are prepended to the per-call subagentName.
    const perCallExtra = (subagentName ?? phaseName) as string | string[] | null | undefined;
    const fullPath = [
      ...basePath,
      ...(Array.isArray(perCallExtra) ? perCallExtra : perCallExtra ? [perCallExtra] : []),
    ];
    const joined = joinSubagentPath(fullPath.length > 0 ? fullPath : null);

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
            // Phase 4b: only subagent_name is written; the agent_name column was dropped
            // in migration 20260509000002.
            subagent_name: joined,
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

  function child(name: string | string[]): EntityLogger {
    const extra = Array.isArray(name) ? name : [name];
    return createEntityLogger(entityCtx, supabase, [...basePath, ...extra]);
  }

  return {
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    debug: (msg, ctx) => log('debug', msg, ctx),
    child,
  };
}
