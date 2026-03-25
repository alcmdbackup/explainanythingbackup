// Tests for RelatedRunsTab: fetches experiment runs and renders EntityTable.

import { render, screen, waitFor } from '@testing-library/react';
import { RelatedRunsTab } from './RelatedRunsTab';
import { getExperimentAction } from '@evolution/services/experimentActions';

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'exp-001',
      evolution_runs: [
        { id: 'run-002', status: 'running', created_at: '2026-01-02' },
      ],
    },
  }),
}));

const mockedGetExperimentAction = jest.mocked(getExperimentAction);

describe('RelatedRunsTab', () => {
  it('fetches experiment runs and renders table', async () => {
    render(<RelatedRunsTab experimentId="exp-001" />);
    await waitFor(() => {
      expect(screen.getByText(/run-002/)).toBeInTheDocument();
    });
    expect(mockedGetExperimentAction).toHaveBeenCalledWith({ experimentId: 'exp-001' });
  });

  it('shows empty state when no runs', async () => {
    mockedGetExperimentAction.mockResolvedValueOnce({
      success: true,
      data: { id: 'exp-empty', evolution_runs: [] },
      error: null,
    });
    render(<RelatedRunsTab experimentId="exp-empty" />);
    await waitFor(() => {
      expect(screen.getByText('No runs found.')).toBeInTheDocument();
    });
  });

  it('renders run status column', async () => {
    render(<RelatedRunsTab experimentId="exp-001" />);
    await waitFor(() => {
      expect(screen.getByText('Status')).toBeInTheDocument();
    });
  });

  it('renders cost column header', async () => {
    render(<RelatedRunsTab experimentId="exp-001" />);
    await waitFor(() => {
      expect(screen.getByText('Cost')).toBeInTheDocument();
    });
  });

  it('renders created column header', async () => {
    render(<RelatedRunsTab experimentId="exp-001" />);
    await waitFor(() => {
      expect(screen.getByText('Created')).toBeInTheDocument();
    });
  });

  it('shows truncated run ID', async () => {
    render(<RelatedRunsTab experimentId="exp-001" />);
    await waitFor(() => {
      expect(screen.getByText(/run-002/)).toBeInTheDocument();
    });
  });

  it('handles failed experiment fetch gracefully', async () => {
    mockedGetExperimentAction.mockResolvedValueOnce({
      success: false,
      data: null,
      error: { message: 'Not found' },
    });
    render(<RelatedRunsTab experimentId="exp-missing" />);
    // Should show empty table since no runs were loaded
    await waitFor(() => {
      expect(screen.getByText('No runs found.')).toBeInTheDocument();
    });
  });

  it('handles multiple runs', async () => {
    mockedGetExperimentAction.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'exp-multi',
        evolution_runs: [
          { id: 'run-aaa', status: 'completed', created_at: '2026-01-01' },
          { id: 'run-bbb', status: 'running', created_at: '2026-01-02' },
          { id: 'run-ccc', status: 'failed', created_at: '2026-01-03' },
        ],
      },
      error: null,
    });
    render(<RelatedRunsTab experimentId="exp-multi" />);
    await waitFor(() => {
      expect(screen.getByText(/run-aaa/)).toBeInTheDocument();
    });
    expect(screen.getByText(/run-bbb/)).toBeInTheDocument();
    expect(screen.getByText(/run-ccc/)).toBeInTheDocument();
  });

  it('renders empty suggestion text', async () => {
    mockedGetExperimentAction.mockResolvedValueOnce({
      success: true,
      data: { id: 'exp-empty', evolution_runs: [] },
      error: null,
    });
    render(<RelatedRunsTab experimentId="exp-empty" />);
    await waitFor(() => {
      expect(screen.getByText(/will appear here/)).toBeInTheDocument();
    });
  });
});
