/**
 * @jest-environment node
 */
// Unit tests for the editPageLifecycleReducer state machine.

import {
  editPageLifecycleReducer,
  initialEditPageState,
  isInFlight,
  isQueued,
  isRunning,
  isViewing,
  isSubmitting,
  getRunId,
  getError,
} from './editPageLifecycleReducer';

describe('editPageLifecycleReducer', () => {
  it('starts in idle', () => {
    expect(initialEditPageState.phase).toBe('idle');
  });

  it('transitions idle → submitting via START_SUBMITTING', () => {
    const s = editPageLifecycleReducer(initialEditPageState, { type: 'START_SUBMITTING' });
    expect(s.phase).toBe('submitting');
    expect(isSubmitting(s)).toBe(true);
  });

  it('transitions submitting → queued via SUBMIT_SUCCESS', () => {
    const s = editPageLifecycleReducer(
      { phase: 'submitting' },
      { type: 'SUBMIT_SUCCESS', runId: 'r1' },
    );
    expect(s.phase).toBe('queued');
    expect(isQueued(s)).toBe(true);
    expect(getRunId(s)).toBe('r1');
  });

  it('POLL_TICK with status=pending stays queued; status=running flips to running', () => {
    let s = editPageLifecycleReducer({ phase: 'queued', runId: 'r1', elapsedMs: 0 }, {
      type: 'POLL_TICK',
      runId: 'r1',
      status: 'pending',
      elapsedMs: 1000,
    });
    expect(s.phase).toBe('queued');
    expect(isQueued(s)).toBe(true);

    s = editPageLifecycleReducer(s, {
      type: 'POLL_TICK',
      runId: 'r1',
      status: 'running',
      elapsedMs: 2000,
    });
    expect(s.phase).toBe('running');
    expect(isRunning(s)).toBe(true);
  });

  it('POLL_TICK ignored when runId mismatches', () => {
    const before = { phase: 'queued' as const, runId: 'r1', elapsedMs: 0 };
    const after = editPageLifecycleReducer(before, {
      type: 'POLL_TICK',
      runId: 'WRONG',
      status: 'running',
      elapsedMs: 9999,
    });
    expect(after).toBe(before);
  });

  it('POLL_COMPLETED transitions to viewing with diff payload', () => {
    const s = editPageLifecycleReducer(
      { phase: 'running', runId: 'r1', elapsedMs: 5000 },
      {
        type: 'POLL_COMPLETED',
        runId: 'r1',
        originalContent: 'orig',
        winnerVariantContent: 'evolved',
        strategyLabel: 'Quick polish',
        durationMs: 60000,
      },
    );
    expect(s.phase).toBe('viewing');
    expect(isViewing(s)).toBe(true);
    if (s.phase === 'viewing') {
      expect(s.originalContent).toBe('orig');
      expect(s.winnerVariantContent).toBe('evolved');
    }
  });

  it('POLL_FAILED transitions to error', () => {
    const s = editPageLifecycleReducer(
      { phase: 'running', runId: 'r1', elapsedMs: 1000 },
      { type: 'POLL_FAILED', runId: 'r1', message: 'boom' },
    );
    expect(s.phase).toBe('error');
    expect(getError(s)).toBe('boom');
  });

  it('isInFlight covers submitting/queued/running', () => {
    expect(isInFlight({ phase: 'submitting' })).toBe(true);
    expect(isInFlight({ phase: 'queued', runId: 'r', elapsedMs: 0 })).toBe(true);
    expect(isInFlight({ phase: 'running', runId: 'r', elapsedMs: 0 })).toBe(true);
    expect(isInFlight({ phase: 'idle' })).toBe(false);
    expect(isInFlight({ phase: 'error', runId: null, message: 'x' })).toBe(false);
  });

  it('RESET returns to idle', () => {
    const s = editPageLifecycleReducer(
      { phase: 'error', runId: 'r1', message: 'oops' },
      { type: 'RESET' },
    );
    expect(s).toEqual(initialEditPageState);
  });
});
