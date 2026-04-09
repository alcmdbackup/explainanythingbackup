// classifyError: maps thrown exceptions to a stable RunErrorCode taxonomy.
// Used by claimAndExecuteRun's outer try/catch and by markRunFailed to populate the
// evolution_runs.error_code column for admin-UI filtering and incident triage.

import { BudgetExceededError, BudgetExceededWithPartialResults } from '../types';

export type RunErrorCode =
  // Setup failures (before any work)
  | 'invalid_config'
  | 'missing_seed_article'
  | 'budget_too_small'

  // Generation failures
  | 'all_generation_failed'
  | 'generation_llm_error'

  // Ranking failures
  | 'swiss_all_pairs_failed'

  // Budget failures
  | 'budget_exceeded_during_generate'
  | 'budget_exceeded_during_swiss'
  | 'budget_exceeded_before_first_variant'

  // Orchestration failures
  | 'merge_agent_crashed'
  | 'invocation_row_write_failed'
  | 'dispatcher_unhandled_error'

  // External / infrastructure
  | 'killed_externally'
  | 'wall_clock_deadline_exceeded'
  | 'unhandled_error';

/**
 * Classify a thrown exception into the RunErrorCode taxonomy.
 * Falls back to 'unhandled_error' for anything we can't categorize.
 *
 * Optional `phase` hint lets the caller distinguish budget errors that happened
 * during a generate iteration vs a swiss iteration vs run setup.
 */
export function classifyError(
  error: unknown,
  phase?: 'setup' | 'generate' | 'swiss' | 'merge' | 'finalize',
): RunErrorCode {
  // BudgetExceededWithPartialResults extends BudgetExceededError — check first.
  if (error instanceof BudgetExceededWithPartialResults || error instanceof BudgetExceededError) {
    if (phase === 'generate') return 'budget_exceeded_during_generate';
    if (phase === 'swiss') return 'budget_exceeded_during_swiss';
    if (phase === 'setup') return 'budget_exceeded_before_first_variant';
    return 'budget_exceeded_during_generate';
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('wall clock') || msg.includes('deadline')) {
      return 'wall_clock_deadline_exceeded';
    }
    if (msg.includes('killed') || msg.includes('cancelled') || msg.includes('aborted')) {
      return 'killed_externally';
    }
    if (msg.includes('budget') && msg.includes('too small')) {
      return 'budget_too_small';
    }
    if (msg.includes('seed article') || msg.includes('missing seed')) {
      return 'missing_seed_article';
    }
    if (msg.includes('invalid') && msg.includes('config')) {
      return 'invalid_config';
    }
    if (phase === 'merge') return 'merge_agent_crashed';
  }

  return 'unhandled_error';
}
