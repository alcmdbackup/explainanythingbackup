// Utility functions for pipeline agent invocation persistence and execution detail truncation.
// Handles JSONB size limits via 2-phase truncation and per-agent invocation records.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import type { AgentResult, EvolutionLogger, AgentExecutionDetail } from '../types';

export const MAX_DETAIL_BYTES = 100_000;

/** Slice known large arrays per detail type to fit within JSONB byte cap. */
export function sliceLargeArrays(detail: AgentExecutionDetail): AgentExecutionDetail {
  switch (detail.detailType) {
    case 'tournament':
      return { ...detail, rounds: detail.rounds.slice(0, 30) };
    case 'calibration':
      return {
        ...detail,
        entrants: detail.entrants.slice(0, 50).map(e => ({
          ...e, matches: e.matches.slice(0, 20),
        })),
      };
    case 'iterativeEditing':
      return { ...detail, cycles: detail.cycles.slice(0, 10) };
    default:
      return detail;
  }
}

/** Cap execution detail JSONB to 100KB via 2-phase truncation. */
export function truncateDetail(detail: AgentExecutionDetail): AgentExecutionDetail {
  const encoded = new TextEncoder().encode(JSON.stringify(detail));
  if (encoded.length <= MAX_DETAIL_BYTES) return detail;

  // Phase 1: Slice known large arrays
  const sliced = sliceLargeArrays(detail);
  const recheck = new TextEncoder().encode(JSON.stringify(sliced));
  if (recheck.length <= MAX_DETAIL_BYTES) {
    return { ...sliced, _truncated: true } as AgentExecutionDetail;
  }

  // Phase 2: Strip to base fields only
  return {
    detailType: detail.detailType,
    totalCost: detail.totalCost,
    _truncated: true,
  } as AgentExecutionDetail;
}

/** Persist a per-agent-per-iteration invocation record. Non-blocking — logs warning on failure. */
export async function persistAgentInvocation(
  runId: string,
  iteration: number,
  agentName: string,
  executionOrder: number,
  result: AgentResult,
  logger: EvolutionLogger,
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();
    await supabase.from('evolution_agent_invocations').upsert({
      run_id: runId,
      iteration,
      agent_name: agentName,
      execution_order: executionOrder,
      success: result.success,
      cost_usd: result.costUsd,
      skipped: result.skipped ?? false,
      error_message: result.error ?? null,
      execution_detail: result.executionDetail ? truncateDetail(result.executionDetail) : {},
    }, { onConflict: 'run_id,iteration,agent_name' });
  } catch (err) {
    logger.warn('Failed to persist agent invocation', {
      agent: agentName, iteration, error: String(err),
    });
  }
}
