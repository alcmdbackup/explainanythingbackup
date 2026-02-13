// EvolutionLogger factory wrapping existing application logger with structured context.
// Adds runId and agentName to every log entry for filtering in Honeycomb/Sentry.
// Optionally buffers log entries to evolution_run_logs table for per-run UI access.

import { logger } from '@/lib/server_utilities';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import type { EvolutionLogger } from '../types';

/** Shape of a buffered log entry before DB insert. */
interface LogEntry {
  run_id: string;
  level: string;
  agent_name: string | null;
  iteration: number | null;
  variant_id: string | null;
  message: string;
  context: Record<string, unknown> | null;
}

/** Maximum entries to buffer before auto-flushing. */
const BUFFER_FLUSH_SIZE = 20;

/**
 * Batched DB writer for evolution run logs.
 * Accumulates entries and flushes in a single INSERT when buffer is full or flush() is called.
 */
export class LogBuffer {
  private buffer: LogEntry[] = [];
  private flushPromise: Promise<void> | null = null;

  constructor(private readonly runId: string) {}

  /** Add a log entry to the buffer. Auto-flushes when buffer reaches BUFFER_FLUSH_SIZE. */
  append(level: string, message: string, ctx?: Record<string, unknown>): void {
    this.buffer.push({
      run_id: this.runId,
      level,
      agent_name: extractString(ctx, 'agent', 'agentName') ?? null,
      iteration: extractNumber(ctx, 'iteration') ?? null,
      variant_id: extractString(ctx, 'variationId', 'variantId', 'variant_id') ?? null,
      message,
      context: ctx ?? null,
    });

    if (this.buffer.length >= BUFFER_FLUSH_SIZE) {
      // Fire-and-forget auto-flush — errors logged but not thrown
      this.flushPromise = this.flushInternal();
    }
  }

  /** Flush all buffered entries to DB. Call at pipeline end to ensure nothing is lost. */
  async flush(): Promise<void> {
    // Wait for any in-flight auto-flush first
    if (this.flushPromise) {
      await this.flushPromise;
      this.flushPromise = null;
    }
    await this.flushInternal();
  }

  private async flushInternal(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    try {
      const supabase = await createSupabaseServiceClient();
      const { error } = await supabase.from('evolution_run_logs').insert(batch);
      if (error) {
        logger.warn('[LogBuffer] DB flush failed', { runId: this.runId, error: error.message, count: batch.length });
      }
    } catch (err) {
      logger.warn('[LogBuffer] DB flush threw', {
        runId: this.runId,
        error: err instanceof Error ? err.message : String(err),
        count: batch.length,
      });
    }
  }
}

/** Extract a string value from context by trying multiple key names. */
function extractString(ctx: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!ctx) return undefined;
  for (const key of keys) {
    if (typeof ctx[key] === 'string') return ctx[key] as string;
  }
  return undefined;
}

/** Extract a number value from context by trying multiple key names. */
function extractNumber(ctx: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!ctx) return undefined;
  for (const key of keys) {
    if (typeof ctx[key] === 'number') return ctx[key] as number;
  }
  return undefined;
}

/** Create an EvolutionLogger that logs to both the app logger and an optional DB buffer. */
export function createEvolutionLogger(runId: string, agentName?: string): EvolutionLogger {
  const baseContext = { subsystem: 'evolution', runId, agentName };
  return {
    info: (msg, ctx) => logger.info(msg, { ...baseContext, ...ctx }),
    warn: (msg, ctx) => logger.warn(msg, { ...baseContext, ...ctx }),
    error: (msg, ctx) => logger.error(msg, { ...baseContext, ...ctx }),
    debug: (msg, ctx) => logger.debug(msg, { ...baseContext, ...ctx }),
  };
}

/** Create an EvolutionLogger with DB persistence via LogBuffer. */
export function createDbEvolutionLogger(runId: string, agentName?: string): EvolutionLogger {
  const baseContext = { subsystem: 'evolution', runId, agentName };
  const logBuffer = new LogBuffer(runId);

  return {
    info: (msg, ctx) => {
      logger.info(msg, { ...baseContext, ...ctx });
      logBuffer.append('info', msg, ctx);
    },
    warn: (msg, ctx) => {
      logger.warn(msg, { ...baseContext, ...ctx });
      logBuffer.append('warn', msg, ctx);
    },
    error: (msg, ctx) => {
      logger.error(msg, { ...baseContext, ...ctx });
      logBuffer.append('error', msg, ctx);
    },
    debug: (msg, ctx) => {
      logger.debug(msg, { ...baseContext, ...ctx });
      logBuffer.append('debug', msg, ctx);
    },
    flush: () => logBuffer.flush(),
  };
}
