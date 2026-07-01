/**
 * /edit Page Lifecycle State Machine Reducer
 *
 * Phase 2 of build_website_for_evolutiOn_20260626. Separate reducer (not an
 * extension of pageLifecycleReducer) because /edit has distinct phases
 * (queue-and-poll model: queued/running instead of streaming/editing/saving).
 *
 * Phase Flow:
 *   idle → submitting → queued → running → viewing → (link to /edit)
 *                                            ↓
 *                                          error
 */

// ─── State ─────────────────────────────────────────────────────────

export type EditPageState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'queued'; runId: string; elapsedMs: number }
  | { phase: 'running'; runId: string; elapsedMs: number }
  | {
      phase: 'viewing';
      runId: string;
      originalContent: string;
      winnerVariantContent: string;
      strategyLabel: string;
      /** Actual dollars spent (from evolution_metrics.cost). null when not yet available. */
      costSpent: number | null;
      durationMs: number;
    }
  | {
      phase: 'error';
      runId: string | null;
      message: string;
    };

export const initialEditPageState: EditPageState = { phase: 'idle' };

// ─── Actions ───────────────────────────────────────────────────────

export type EditPageAction =
  | { type: 'START_SUBMITTING' }
  | { type: 'SUBMIT_SUCCESS'; runId: string }
  | { type: 'POLL_TICK'; status: 'pending' | 'claimed' | 'running'; runId: string; elapsedMs: number }
  | {
      type: 'POLL_COMPLETED';
      runId: string;
      originalContent: string;
      winnerVariantContent: string;
      strategyLabel: string;
      costSpent: number | null;
      durationMs: number;
    }
  | { type: 'POLL_FAILED'; runId: string | null; message: string }
  | { type: 'RESET' };

// ─── Reducer ───────────────────────────────────────────────────────

export function editPageLifecycleReducer(state: EditPageState, action: EditPageAction): EditPageState {
  switch (action.type) {
    case 'START_SUBMITTING':
      return { phase: 'submitting' };

    case 'SUBMIT_SUCCESS':
      return { phase: 'queued', runId: action.runId, elapsedMs: 0 };

    case 'POLL_TICK': {
      // Only valid while we're queued or running on the same runId
      if (state.phase !== 'queued' && state.phase !== 'running') return state;
      if (state.runId !== action.runId) return state;
      // Map pending → queued, claimed/running → running
      const next: 'queued' | 'running' = action.status === 'pending' ? 'queued' : 'running';
      return { phase: next, runId: action.runId, elapsedMs: action.elapsedMs };
    }

    case 'POLL_COMPLETED':
      return {
        phase: 'viewing',
        runId: action.runId,
        originalContent: action.originalContent,
        winnerVariantContent: action.winnerVariantContent,
        strategyLabel: action.strategyLabel,
        costSpent: action.costSpent,
        durationMs: action.durationMs,
      };

    case 'POLL_FAILED':
      return { phase: 'error', runId: action.runId, message: action.message };

    case 'RESET':
      return initialEditPageState;
  }
}

// ─── Selectors ─────────────────────────────────────────────────────

export function isSubmitting(state: EditPageState): boolean {
  return state.phase === 'submitting';
}

export function isQueued(state: EditPageState): boolean {
  return state.phase === 'queued';
}

export function isRunning(state: EditPageState): boolean {
  return state.phase === 'running';
}

export function isViewing(state: EditPageState): boolean {
  return state.phase === 'viewing';
}

export function isInFlight(state: EditPageState): boolean {
  return state.phase === 'submitting' || state.phase === 'queued' || state.phase === 'running';
}

export function getRunId(state: EditPageState): string | null {
  if (state.phase === 'queued' || state.phase === 'running' || state.phase === 'viewing') {
    return state.runId;
  }
  if (state.phase === 'error') return state.runId;
  return null;
}

export function getError(state: EditPageState): string | null {
  return state.phase === 'error' ? state.message : null;
}
