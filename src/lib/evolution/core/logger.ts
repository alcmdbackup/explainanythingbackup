// EvolutionLogger factory wrapping application logger with structured context.
// Adds runId and agentName to every log entry for filtering. Optionally buffers entries to evolution_run_logs table.

import { randomUUID } from 'crypto';
import { logger } from '@/lib/server_utilities';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import type { EvolutionLogger } from '../types';

interface LogEntry {
  run_id: string;
  level: string;
  agent_name: string | null;
  iteration: number | null;
  variant_id: string | null;
  request_id: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  message: string;
  context: Record<string, unknown> | null;
}

const BUFFER_FLUSH_SIZE = 20;

export class LogBuffer {
  private buffer: LogEntry[] = [];
  private flushPromise: Promise<void> | null = null;

  constructor(private readonly runId: string) {}

  append(level: string, message: string, ctx?: Record<string, unknown>): void {
    this.buffer.push({
      run_id: this.runId,
      level,
      agent_name: extractString(ctx, 'agent', 'agentName') ?? null,
      iteration: extractNumber(ctx, 'iteration') ?? null,
      variant_id: extractString(ctx, 'variationId', 'variantId', 'variant_id') ?? null,
      request_id: extractString(ctx, 'requestId', 'request_id') ?? null,
      cost_usd: extractNumber(ctx, 'costUsd', 'cost_usd', 'cost', 'totalCost', 'total_cost') ?? null,
      duration_ms: extractNumber(ctx, 'durationMs', 'duration_ms', 'duration') ?? null,
      message,
      context: ctx ?? null,
    });

    if (this.buffer.length >= BUFFER_FLUSH_SIZE) {
      this.flushPromise = this.flushInternal();
    }
  }

  async flush(): Promise<void> {
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

function extractString(ctx: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!ctx) return undefined;
  for (const key of keys) {
    if (typeof ctx[key] === 'string') return ctx[key] as string;
  }
  return undefined;
}

function extractNumber(ctx: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!ctx) return undefined;
  for (const key of keys) {
    if (typeof ctx[key] === 'number') return ctx[key] as number;
  }
  return undefined;
}

export function createEvolutionLogger(runId: string, agentName?: string): EvolutionLogger {
  const baseContext = { subsystem: 'evolution', runId, agentName };
  return {
    info: (msg, ctx) => logger.info(msg, { ...baseContext, ...ctx }),
    warn: (msg, ctx) => logger.warn(msg, { ...baseContext, ...ctx }),
    error: (msg, ctx) => logger.error(msg, { ...baseContext, ...ctx }),
    debug: (msg, ctx) => logger.debug(msg, { ...baseContext, ...ctx }),
  };
}

export function createDbEvolutionLogger(runId: string, agentName?: string): EvolutionLogger {
  const requestId = randomUUID();
  const baseContext = { subsystem: 'evolution', runId, agentName, requestId };
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
