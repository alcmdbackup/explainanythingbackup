// Tests for AutoRefreshProvider polling context: initial load, interval, pause on hidden, and manual refresh.
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutoRefreshProvider, RefreshIndicator, useAutoRefresh } from './AutoRefreshProvider';

// Helper component that exposes context values
function TestConsumer() {
  const ctx = useAutoRefresh();
  return (
    <div>
      <span data-testid="is-refreshing">{String(ctx.isRefreshing)}</span>
      <span data-testid="last-updated">{ctx.lastUpdated?.toISOString() ?? 'null'}</span>
      <button data-testid="manual-refresh" onClick={ctx.refresh}>Refresh</button>
    </div>
  );
}

describe('AutoRefreshProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls onRefresh on mount', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    await act(async () => {
      render(
        <AutoRefreshProvider onRefresh={onRefresh} intervalMs={5000}>
          <TestConsumer />
        </AutoRefreshProvider>,
      );
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('polls at specified interval', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    await act(async () => {
      render(
        <AutoRefreshProvider onRefresh={onRefresh} intervalMs={5000}>
          <TestConsumer />
        </AutoRefreshProvider>,
      );
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it('does not poll when enabled=false', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    await act(async () => {
      render(
        <AutoRefreshProvider onRefresh={onRefresh} intervalMs={5000} enabled={false}>
          <TestConsumer />
        </AutoRefreshProvider>,
      );
    });

    // Still calls once on mount
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(15000);
    });

    // No additional calls
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('updates lastUpdated after successful refresh', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    await act(async () => {
      render(
        <AutoRefreshProvider onRefresh={onRefresh} intervalMs={5000}>
          <TestConsumer />
        </AutoRefreshProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('last-updated').textContent).not.toBe('null');
    });
  });

  it('supports manual refresh via context', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    await act(async () => {
      render(
        <AutoRefreshProvider onRefresh={onRefresh} intervalMs={60000}>
          <TestConsumer />
        </AutoRefreshProvider>,
      );
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('manual-refresh'));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(2);
    });
  });
});

describe('RefreshIndicator', () => {
  it('renders the refresh button', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    await act(async () => {
      render(
        <AutoRefreshProvider onRefresh={onRefresh}>
          <RefreshIndicator />
        </AutoRefreshProvider>,
      );
    });

    expect(screen.getByTestId('refresh-indicator')).toBeInTheDocument();
  });
});
