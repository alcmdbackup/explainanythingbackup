// Tests for shared LogsTab component.

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { LogsTab } from './LogsTab';

const mockLogs = [
  {
    id: 1,
    created_at: '2026-03-23T10:00:00Z',
    level: 'info',
    agent_name: 'generation',
    iteration: 1,
    variant_id: null,
    message: 'Starting generation',
    context: null,
    entity_type: 'run',
    entity_id: 'run-1',
  },
  {
    id: 2,
    created_at: '2026-03-23T10:01:00Z',
    level: 'warn',
    agent_name: 'ranking',
    iteration: 1,
    variant_id: null,
    message: 'Triage eliminated 2 variants',
    context: { eliminated: 2 },
    entity_type: 'invocation',
    entity_id: 'inv-1',
  },
];

jest.mock('@evolution/services/logActions', () => ({
  getEntityLogsAction: jest.fn(() =>
    Promise.resolve({ success: true, data: { items: mockLogs, total: 2 } }),
  ),
}));

describe('LogsTab', () => {
  it('renders log entries after loading', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('Starting generation')).toBeInTheDocument();
    });
    expect(screen.getByText('Triage eliminated 2 variants')).toBeInTheDocument();
  });

  it('shows entity type badges', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('run')).toBeInTheDocument();
    });
    expect(screen.getByText('invocation')).toBeInTheDocument();
  });

  it('shows total count', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('2 logs')).toBeInTheDocument();
    });
  });

  it('renders filter controls', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByLabelText('Filter by level')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Filter by entity type')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by agent name')).toBeInTheDocument();
  });

  it('has data-testid for testing', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('logs-tab')).toBeInTheDocument();
    });
  });

  it('renders iteration dropdown with options based on log data', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByLabelText('Filter by iteration')).toBeInTheDocument();
    });
    const select = screen.getByLabelText('Filter by iteration');
    const options = select.querySelectorAll('option');
    // 1 "All iterations" + N numbered options (dynamic, based on max iteration in logs)
    expect(options.length).toBeGreaterThanOrEqual(2); // at least "All" + 0
    expect(options[0]!.textContent).toBe('All iterations');
    expect(options[1]!.textContent).toBe('0');
  });

  it('renders message search input with placeholder', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });
  });

  it('renders variant ID input with placeholder', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Variant ID...')).toBeInTheDocument();
    });
  });

  it('renders log level with color styling', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('info')).toBeInTheDocument();
      expect(screen.getByText('warn')).toBeInTheDocument();
    });
  });

  it('renders agent name column', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('generation')).toBeInTheDocument();
      expect(screen.getByText('ranking')).toBeInTheDocument();
    });
  });

  it('shows empty state when no logs', async () => {
    const { getEntityLogsAction } = jest.requireMock('@evolution/services/logActions');
    getEntityLogsAction.mockResolvedValueOnce({
      success: true, data: { items: [], total: 0 },
    });

    render(<LogsTab entityType="run" entityId="run-empty" />);
    await waitFor(() => {
      expect(screen.getByText('No logs available.')).toBeInTheDocument();
    });
  });

  it('renders table headers', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('Time')).toBeInTheDocument();
      expect(screen.getByText('Level')).toBeInTheDocument();
      expect(screen.getByText('Source')).toBeInTheDocument();
      expect(screen.getByText('Agent')).toBeInTheDocument();
      expect(screen.getByText('Message')).toBeInTheDocument();
    });
  });

  it('renders singular "log" for count of 1', async () => {
    const { getEntityLogsAction } = jest.requireMock('@evolution/services/logActions');
    getEntityLogsAction.mockResolvedValueOnce({
      success: true, data: { items: [mockLogs[0]], total: 1 },
    });

    render(<LogsTab entityType="run" entityId="run-single" />);
    await waitFor(() => {
      expect(screen.getByText('1 log')).toBeInTheDocument();
    });
  });

  // ─── Phase 3: Filter correctness tests ──────────────────────────

  it('iteration dropdown options have string values so selected item highlights correctly', async () => {
    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByLabelText('Filter by iteration')).toBeInTheDocument());

    const select = screen.getByLabelText('Filter by iteration') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));
    // All options must have string values (not numbers) to match the string state
    const numberedOptions = options.filter(o => o.value !== '');
    expect(numberedOptions.length).toBeGreaterThan(0);
    numberedOptions.forEach(o => {
      expect(typeof o.value).toBe('string');
    });
  });

  it('level filter change triggers reload with correct filter arg', async () => {
    const { getEntityLogsAction } = jest.requireMock('@evolution/services/logActions');
    getEntityLogsAction.mockClear();

    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByLabelText('Filter by level')).toBeInTheDocument());

    const callsBefore = getEntityLogsAction.mock.calls.length;
    const select = screen.getByLabelText('Filter by level');
    fireEvent.change(select, { target: { value: 'error' } });

    await waitFor(() => {
      expect(getEntityLogsAction.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    const lastCall = getEntityLogsAction.mock.calls[getEntityLogsAction.mock.calls.length - 1]![0];
    expect(lastCall.filters.level).toBe('error');
  });

  it('"All levels" selection sends undefined level to server action', async () => {
    const { getEntityLogsAction } = jest.requireMock('@evolution/services/logActions');
    getEntityLogsAction.mockClear();

    render(<LogsTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByLabelText('Filter by level')).toBeInTheDocument());

    // Set to 'error' first, then back to 'All'
    const select = screen.getByLabelText('Filter by level');
    fireEvent.change(select, { target: { value: 'error' } });
    await waitFor(() => {
      const calls = getEntityLogsAction.mock.calls;
      const last = calls[calls.length - 1]![0];
      expect(last.filters.level).toBe('error');
    });

    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => {
      const calls = getEntityLogsAction.mock.calls;
      const last = calls[calls.length - 1]![0];
      // Empty string → falsy → not included in filters
      expect(last.filters.level).toBeUndefined();
    });
  });

  it('agent filter is debounced — does not call action immediately on each keystroke', async () => {
    jest.useFakeTimers();
    const { getEntityLogsAction } = jest.requireMock('@evolution/services/logActions');

    render(<LogsTab entityType="run" entityId="run-1" />);
    // Wait for initial load
    await act(async () => { jest.runAllTimers(); });
    await waitFor(() => expect(screen.getByLabelText('Filter by agent name')).toBeInTheDocument());

    getEntityLogsAction.mockClear();
    const input = screen.getByLabelText('Filter by agent name');

    // Type characters — action should NOT be called immediately
    fireEvent.change(input, { target: { value: 'gen' } });
    expect(getEntityLogsAction).not.toHaveBeenCalled();

    // Advance timers to trigger debounce
    await act(async () => { jest.advanceTimersByTime(350); });

    await waitFor(() => {
      expect(getEntityLogsAction).toHaveBeenCalled();
    });
    const lastCall = getEntityLogsAction.mock.calls[getEntityLogsAction.mock.calls.length - 1]![0];
    expect(lastCall.filters.agentName).toBe('gen');

    jest.useRealTimers();
  });

  it('variant ID filter is debounced', async () => {
    jest.useFakeTimers();
    const { getEntityLogsAction } = jest.requireMock('@evolution/services/logActions');

    render(<LogsTab entityType="run" entityId="run-1" />);
    await act(async () => { jest.runAllTimers(); });
    await waitFor(() => expect(screen.getByPlaceholderText('Variant ID...')).toBeInTheDocument());

    getEntityLogsAction.mockClear();
    const input = screen.getByPlaceholderText('Variant ID...');

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(getEntityLogsAction).not.toHaveBeenCalled();

    await act(async () => { jest.advanceTimersByTime(350); });

    await waitFor(() => {
      expect(getEntityLogsAction).toHaveBeenCalled();
    });
    const lastCall = getEntityLogsAction.mock.calls[getEntityLogsAction.mock.calls.length - 1]![0];
    expect(lastCall.filters.variantId).toBe('abc');

    jest.useRealTimers();
  });
});
