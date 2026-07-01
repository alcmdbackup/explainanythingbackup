// Tests for EditRunViewer's polling loop.
// Locks in the 2026-06-30 regression: useEffect([runId, state]) re-created
// the interval on every dispatch, producing ~3 polls/second instead of every
// 3s + making a single fetch failure terminal. Fix: deps=[runId] + ref-mirror
// of isInFlight + N-failures-tolerance.

import { render, screen, act } from '@testing-library/react';
import type React from 'react';
import EditRunViewer from './EditRunViewer';

const mockGetEditRunStatusAction = jest.fn();

jest.mock('../../publicEditActions', () => ({
  getEditRunStatusAction: (...args: unknown[]) => mockGetEditRunStatusAction(...args),
}));

jest.mock('@evolution/components/evolution/visualizations/SideBySideWordDiff', () => ({
  SideBySideWordDiff: () => <div data-testid="diff-viewer-mock" />,
}));

// Mock EntityDetailTabs as a passthrough that renders both tab bodies so we
// can assert on tab-panel content without driving tab state in unit tests.
jest.mock('@evolution/components/evolution/sections/EntityDetailTabs', () => ({
  EntityDetailTabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useTabState: () => ['variant', jest.fn()],
}));

// Mock react-markdown as a passthrough — we're not testing markdown rendering here.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div data-testid="react-markdown">{children}</div>,
}));

const RUN_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

function makeStatusResponse(status: 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled', overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      status,
      originalContent: 'original text',
      winnerVariantContent: status === 'completed' ? 'evolved text' : null,
      errorMessage: null,
      costSpent: status === 'completed' ? 0.04 : null,
      etaSeconds: null,
      strategyLabel: status === 'completed' ? 'Quick polish' : null,
      ...overrides,
    },
    error: null,
  };
}

describe('EditRunViewer polling loop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetEditRunStatusAction.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Regression for the 2026-06-30 over-polling bug. Before the fix, every
  // dispatch (POLL_TICK, etc.) re-created the interval and fired an immediate
  // tick — producing ~3 polls/second. After the fix, polling stays on the
  // 3s cadence even as state mutates.
  it('polls exactly once per 3s interval (does not re-create timer on every dispatch)', async () => {
    mockGetEditRunStatusAction.mockResolvedValue(makeStatusResponse('running'));
    render(<EditRunViewer runId={RUN_ID} />);
    // Initial tick fires immediately (await microtasks for the mocked promise).
    await act(async () => { await Promise.resolve(); });
    expect(mockGetEditRunStatusAction).toHaveBeenCalledTimes(1);

    // Advance 3 intervals (9000ms). Should produce exactly 3 more polls.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
    }
    expect(mockGetEditRunStatusAction).toHaveBeenCalledTimes(4);
  });

  // Regression for the "single fetch error aborts the loop" bug. A transient
  // network blip used to dispatch POLL_FAILED and stop polling immediately.
  // Now we tolerate up to 5 consecutive failures before giving up.
  it('tolerates a single fetch failure and recovers on the next poll', async () => {
    mockGetEditRunStatusAction
      .mockResolvedValueOnce(makeStatusResponse('running'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(makeStatusResponse('running'));

    render(<EditRunViewer runId={RUN_ID} />);
    await act(async () => { await Promise.resolve(); });
    // First poll: running. Pending UI visible, no error.
    expect(screen.queryByTestId('edit-run-error')).toBeNull();

    // Tick 2: throws. Should NOT show the error UI (1 failure < 5 tolerated).
    await act(async () => {
      jest.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('edit-run-error')).toBeNull();

    // Tick 3: succeeds again. Counter resets, polling continues.
    await act(async () => {
      jest.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('edit-run-error')).toBeNull();
    expect(mockGetEditRunStatusAction).toHaveBeenCalledTimes(3);
  });

  it('terminates with error UI after 5 consecutive failures', async () => {
    // 6 calls: first running, then 5 throws. Error UI surfaces on the 5th throw.
    mockGetEditRunStatusAction
      .mockResolvedValueOnce(makeStatusResponse('running'))
      .mockRejectedValue(new Error('Failed to fetch'));

    render(<EditRunViewer runId={RUN_ID} />);
    await act(async () => { await Promise.resolve(); });

    // Drive 5 more ticks. After tick 6, error UI shows.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
    }
    expect(screen.queryByTestId('edit-run-error')).not.toBeNull();
  });

  it('flips to the viewing branch when status=completed', async () => {
    mockGetEditRunStatusAction.mockResolvedValueOnce(makeStatusResponse('completed'));
    render(<EditRunViewer runId={RUN_ID} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('edit-run-viewing')).not.toBeNull();
  });

  // Regression for the 2026-06-30 timeout-before-status-check bug. If the
  // user backgrounds the tab → browser throttles setInterval to 1/min → the
  // polling client misses the completion window. When the user returns
  // 10+ min later, we MUST still check status (and surface the diff if the
  // run completed) before showing the "taking longer than expected" timeout.
  it('still surfaces a completed run even when polling resumes past MAX_POLL_DURATION_MS', async () => {
    // First tick: still running (run is in progress). Page-load time → t=0.
    // Subsequent ticks: completed (run finished server-side while tab was
    // backgrounded). Set mockResolvedValue (not Once) so any tick during the
    // long advance sees the same completed response.
    mockGetEditRunStatusAction
      .mockResolvedValueOnce(makeStatusResponse('running'))
      .mockResolvedValue(makeStatusResponse('completed'));
    render(<EditRunViewer runId={RUN_ID} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('edit-run-pending')).not.toBeNull();

    // Simulate tab being backgrounded for 11 minutes (past MAX_POLL_DURATION_MS).
    // During this time the run completes server-side. The NEXT tick after
    // the backgrounded interval fires fetches status='completed' and MUST
    // dispatch POLL_COMPLETED — NOT POLL_FAILED with "taking longer than
    // expected". Advance just enough to fire one more tick + flush.
    await act(async () => {
      jest.advanceTimersByTime(11 * 60 * 1_000);
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('edit-run-viewing')).not.toBeNull();
    expect(screen.queryByTestId('edit-run-error')).toBeNull();
  });

  it('still surfaces timeout error when run is genuinely stuck past 10 min', async () => {
    // All polls return status='running' — run never completes.
    mockGetEditRunStatusAction.mockResolvedValue(makeStatusResponse('running'));
    render(<EditRunViewer runId={RUN_ID} />);
    await act(async () => { await Promise.resolve(); });

    // Advance past the 10-min deadline.
    await act(async () => {
      jest.advanceTimersByTime(11 * 60 * 1_000);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('edit-run-error')).not.toBeNull();
  });

  it('stops polling after reaching terminal phase (no further dispatches)', async () => {
    mockGetEditRunStatusAction.mockResolvedValueOnce(makeStatusResponse('completed'));
    render(<EditRunViewer runId={RUN_ID} />);
    await act(async () => { await Promise.resolve(); });
    expect(mockGetEditRunStatusAction).toHaveBeenCalledTimes(1);

    // Advance many intervals. Polling should NOT fire any more action calls
    // because isInFlightRef.current is now false.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
    }
    expect(mockGetEditRunStatusAction).toHaveBeenCalledTimes(1);
  });
});
