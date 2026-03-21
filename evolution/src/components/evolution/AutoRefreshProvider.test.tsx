// Tests for shared auto-refresh context: refresh key ticking, manual refresh, and toast on error.
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutoRefreshProvider, RefreshIndicator, useAutoRefresh } from './AutoRefreshProvider';
import { toast } from 'sonner';

jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}));

// Helper component that exposes context values
function TestConsumer() {
  const ctx = useAutoRefresh();
  return (
    <div>
      <span data-testid="refresh-key">{ctx.refreshKey}</span>
      <span data-testid="is-active">{String(ctx.isActive)}</span>
      <span data-testid="last-refreshed">{ctx.lastRefreshed?.toISOString() ?? 'null'}</span>
      <button data-testid="trigger" onClick={ctx.triggerRefresh}>Trigger</button>
      <button data-testid="report" onClick={ctx.reportRefresh}>Report</button>
      <button data-testid="error" onClick={() => ctx.reportError('test error')}>Error</button>
    </div>
  );
}

describe('AutoRefreshProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts with refreshKey=0 and isActive matching prop', () => {
    render(
      <AutoRefreshProvider isActive={true}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    expect(screen.getByTestId('refresh-key').textContent).toBe('0');
    expect(screen.getByTestId('is-active').textContent).toBe('true');
  });

  it('increments refreshKey on interval when active', () => {
    render(
      <AutoRefreshProvider isActive={true} intervalMs={5000}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    expect(screen.getByTestId('refresh-key').textContent).toBe('0');

    act(() => { jest.advanceTimersByTime(5000); });
    expect(screen.getByTestId('refresh-key').textContent).toBe('1');

    act(() => { jest.advanceTimersByTime(5000); });
    expect(screen.getByTestId('refresh-key').textContent).toBe('2');
  });

  it('does not increment when isActive=false', () => {
    render(
      <AutoRefreshProvider isActive={false} intervalMs={5000}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    act(() => { jest.advanceTimersByTime(15000); });
    expect(screen.getByTestId('refresh-key').textContent).toBe('0');
  });

  it('supports manual triggerRefresh', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <AutoRefreshProvider isActive={false}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    expect(screen.getByTestId('refresh-key').textContent).toBe('0');
    await user.click(screen.getByTestId('trigger'));
    expect(screen.getByTestId('refresh-key').textContent).toBe('1');
  });

  it('updates lastRefreshed on reportRefresh', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <AutoRefreshProvider isActive={false}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    expect(screen.getByTestId('last-refreshed').textContent).toBe('null');
    await user.click(screen.getByTestId('report'));
    expect(screen.getByTestId('last-refreshed').textContent).not.toBe('null');
  });

  it('triggers final refresh when isActive transitions from true to false', () => {
    const { rerender } = render(
      <AutoRefreshProvider isActive={true} intervalMs={5000}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    expect(screen.getByTestId('refresh-key').textContent).toBe('0');

    // Transition isActive true→false
    rerender(
      <AutoRefreshProvider isActive={false} intervalMs={5000}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    // Should have incremented refreshKey once for the final refresh
    expect(screen.getByTestId('refresh-key').textContent).toBe('1');
  });

  it('does NOT trigger refresh when isActive starts as false', () => {
    render(
      <AutoRefreshProvider isActive={false} intervalMs={5000}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    // Should remain at 0 — no transition occurred
    expect(screen.getByTestId('refresh-key').textContent).toBe('0');
  });

  it('shows toast on reportError', async () => {
    // toast is auto-mocked via jest.mock at top of file
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <AutoRefreshProvider isActive={false}>
        <TestConsumer />
      </AutoRefreshProvider>,
    );

    await user.click(screen.getByTestId('error'));
    expect(toast.error).toHaveBeenCalledWith('Refresh failed: test error');
  });
});

describe('RefreshIndicator', () => {
  it('renders manual refresh button', () => {
    render(
      <AutoRefreshProvider isActive={false}>
        <RefreshIndicator />
      </AutoRefreshProvider>,
    );

    expect(screen.getByTestId('refresh-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('manual-refresh-btn')).toBeInTheDocument();
  });

  it('shows green dot when active', () => {
    render(
      <AutoRefreshProvider isActive={true}>
        <RefreshIndicator />
      </AutoRefreshProvider>,
    );

    expect(screen.getByTitle('Auto-refreshing')).toBeInTheDocument();
  });

  it('shows "Updated just now" after reportRefresh', async () => {
    function Wrapper() {
      const { reportRefresh } = useAutoRefresh();
      return (
        <>
          <button data-testid="report" onClick={reportRefresh}>Report</button>
          <RefreshIndicator />
        </>
      );
    }

    const user = userEvent.setup();

    render(
      <AutoRefreshProvider isActive={false}>
        <Wrapper />
      </AutoRefreshProvider>,
    );

    await user.click(screen.getByTestId('report'));

    await waitFor(() => {
      expect(screen.getByTestId('refresh-ago')).toHaveTextContent('Updated just now');
    });
  });
});

describe('useAutoRefresh fallback', () => {
  it('returns safe defaults outside provider', () => {
    render(<TestConsumer />);

    expect(screen.getByTestId('refresh-key').textContent).toBe('0');
    expect(screen.getByTestId('is-active').textContent).toBe('false');
    expect(screen.getByTestId('last-refreshed').textContent).toBe('null');
  });
});
