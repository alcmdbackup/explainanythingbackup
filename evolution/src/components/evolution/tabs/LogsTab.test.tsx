// Tests for LogsTab: pagination, search, time-delta, inline cost, tree view, errors-only preset, export.

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LogsTab } from './LogsTab';
import type { RunLogEntry } from '@evolution/services/evolutionActions';

const mockGetLogs = jest.fn();
jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunLogsAction: (...args: unknown[]) => mockGetLogs(...args),
}));

function makeEntry(overrides: Partial<RunLogEntry> & { id: number }): RunLogEntry {
  return {
    created_at: '2026-02-14T10:00:00Z',
    level: 'info',
    agent_name: null,
    iteration: null,
    variant_id: null,
    request_id: null,
    cost_usd: null,
    duration_ms: null,
    message: 'test message',
    context: null,
    ...overrides,
  };
}

const baseLogs: RunLogEntry[] = [
  makeEntry({ id: 1, created_at: '2026-02-14T10:00:00Z', message: 'Start pipeline', agent_name: 'generation' }),
  makeEntry({ id: 2, created_at: '2026-02-14T10:00:05Z', message: 'Generating variants', agent_name: 'generation', context: { cost: 0.0035 } }),
  makeEntry({ id: 3, created_at: '2026-02-14T10:01:10Z', level: 'error', message: 'API rate limit hit', agent_name: 'tournament' }),
];

describe('LogsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogs.mockResolvedValue({ success: true, data: { items: baseLogs, total: 3 }, error: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders log entries', async () => {
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('log-entries')).toBeInTheDocument();
    });
    expect(screen.getByText('Start pipeline')).toBeInTheDocument();
    expect(screen.getByText('Generating variants')).toBeInTheDocument();
  });

  it('shows search box and filters entries client-side', async () => {
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('log-search')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('log-search'), { target: { value: 'rate limit' } });
    expect(screen.getByText('API rate limit hit')).toBeInTheDocument();
    expect(screen.queryByText('Start pipeline')).not.toBeInTheDocument();
  });

  it('shows time-delta between entries', async () => {
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('time-delta')).toHaveLength(2);
    });
    // Second entry is 5 seconds after first
    expect(screen.getAllByTestId('time-delta')[0]).toHaveTextContent('+5.0s');
    // Third entry is 65 seconds after second
    expect(screen.getAllByTestId('time-delta')[1]).toHaveTextContent('+1m5s');
  });

  it('shows inline cost badge for entries with cost in context', async () => {
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('inline-cost')).toBeInTheDocument();
    });
    expect(screen.getByTestId('inline-cost')).toHaveTextContent('$0.0035');
  });

  it('renders errors-only preset button', async () => {
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('errors-only-preset')).toBeInTheDocument();
    });
  });

  it('shows pagination controls when total exceeds page size', async () => {
    mockGetLogs.mockResolvedValue({
      success: true,
      data: { items: baseLogs, total: 1200 },
      error: null,
    });
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('pagination')).toBeInTheDocument();
    });
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByText(/1–500 of 1200/)).toBeInTheDocument();
  });

  it('navigates pages on pagination button click', async () => {
    mockGetLogs.mockResolvedValue({
      success: true,
      data: { items: baseLogs, total: 1200 },
      error: null,
    });
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('Next')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    // Should call with offset 500
    await waitFor(() => {
      const lastCall = mockGetLogs.mock.calls[mockGetLogs.mock.calls.length - 1];
      expect(lastCall[0].filters.offset).toBe(500);
    });
  });

  it('does not show pagination when total fits in one page', async () => {
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('log-entries')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pagination')).not.toBeInTheDocument();
  });

  it('shows collapsible tree view for context', async () => {
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('log-entry-2')).toBeInTheDocument();
    });
    // Click to expand entry with context
    fireEvent.click(screen.getByTestId('log-entry-2'));
    expect(screen.getByTestId('context-tree')).toBeInTheDocument();
    // Should show key-value tree, not raw JSON
    expect(screen.getByText('cost:')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    mockGetLogs.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'DB error', code: 'UNKNOWN_ERROR' },
    });
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText('DB error')).toBeInTheDocument();
    });
  });

  it('shows empty state with filter hint', async () => {
    mockGetLogs.mockResolvedValue({ success: true, data: { items: [], total: 0 }, error: null });
    render(<LogsTab runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText(/No log entries/)).toBeInTheDocument();
    });
  });

  describe('log export', () => {
    it('shows export button when logs exist', async () => {
      render(<LogsTab runId="run-1" />);
      await waitFor(() => {
        expect(screen.getByTestId('export-btn')).toBeInTheDocument();
      });
    });

    it('does not show export button when no logs', async () => {
      mockGetLogs.mockResolvedValue({ success: true, data: { items: [], total: 0 }, error: null });
      render(<LogsTab runId="run-1" />);
      await waitFor(() => {
        expect(screen.getByText(/No log entries/)).toBeInTheDocument();
      });
      expect(screen.queryByTestId('export-btn')).not.toBeInTheDocument();
    });

    it('shows JSON and CSV options on click', async () => {
      render(<LogsTab runId="run-1" />);
      await waitFor(() => {
        expect(screen.getByTestId('export-btn')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('export-btn'));
      expect(screen.getByTestId('export-json')).toBeInTheDocument();
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    });

    it('triggers JSON download on JSON button click', async () => {
      const mockClick = jest.fn();
      const mockCreateObjectURL = jest.fn().mockReturnValue('blob:test');
      const mockRevokeObjectURL = jest.fn();
      const origCreateElement = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') {
          const a = origCreateElement('a');
          a.click = mockClick;
          return a;
        }
        return origCreateElement(tag);
      });
      Object.defineProperty(globalThis, 'URL', {
        value: { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL },
        writable: true,
      });

      render(<LogsTab runId="run-1" />);
      await waitFor(() => {
        expect(screen.getByTestId('export-btn')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('export-btn'));
      fireEvent.click(screen.getByTestId('export-json'));

      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(mockClick).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });

    it('triggers CSV download on CSV button click', async () => {
      const mockClick = jest.fn();
      const mockCreateObjectURL = jest.fn().mockReturnValue('blob:test');
      const mockRevokeObjectURL = jest.fn();
      const origCreateElement = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') {
          const a = origCreateElement('a');
          a.click = mockClick;
          return a;
        }
        return origCreateElement(tag);
      });
      Object.defineProperty(globalThis, 'URL', {
        value: { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL },
        writable: true,
      });

      render(<LogsTab runId="run-1" />);
      await waitFor(() => {
        expect(screen.getByTestId('export-btn')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('export-btn'));
      fireEvent.click(screen.getByTestId('export-csv'));

      expect(mockCreateObjectURL).toHaveBeenCalled();
      const blobArg = mockCreateObjectURL.mock.calls[0][0] as Blob;
      expect(blobArg.type).toBe('text/csv');
      expect(mockClick).toHaveBeenCalled();
    });
  });
});
