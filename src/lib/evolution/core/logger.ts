// EvolutionLogger factory wrapping existing application logger with structured context.
// Adds runId and agentName to every log entry for filtering in Honeycomb/Sentry.

import { logger } from '@/lib/server_utilities';
import type { EvolutionLogger } from '../types';

export function createEvolutionLogger(runId: string, agentName?: string): EvolutionLogger {
  const baseContext = { subsystem: 'evolution', runId, agentName };
  return {
    info: (msg, ctx) => logger.info(msg, { ...baseContext, ...ctx }),
    warn: (msg, ctx) => logger.warn(msg, { ...baseContext, ...ctx }),
    error: (msg, ctx) => logger.error(msg, { ...baseContext, ...ctx }),
    debug: (msg, ctx) => logger.debug(msg, { ...baseContext, ...ctx }),
  };
}
