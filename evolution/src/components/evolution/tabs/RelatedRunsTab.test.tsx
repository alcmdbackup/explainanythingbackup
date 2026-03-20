// Tests for RelatedRunsTab: fetches experiment runs and renders EntityTable.

import { render, screen, waitFor } from '@testing-library/react';
import { RelatedRunsTab } from './RelatedRunsTab';

jest.mock('@evolution/services/experimentActionsV2', () => ({
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

describe('RelatedRunsTab', () => {
  it('fetches experiment runs and renders table', async () => {
    render(<RelatedRunsTab experimentId="exp-001" />);
    await waitFor(() => {
      expect(screen.getByText(/run-002/)).toBeInTheDocument();
    });
    const { getExperimentAction } = require('@evolution/services/experimentActionsV2');
    expect(getExperimentAction).toHaveBeenCalledWith({ experimentId: 'exp-001' });
  });

  it('shows empty state when no runs', async () => {
    const { getExperimentAction } = require('@evolution/services/experimentActionsV2');
    getExperimentAction.mockResolvedValueOnce({
      success: true,
      data: { id: 'exp-empty', evolution_runs: [] },
    });
    render(<RelatedRunsTab experimentId="exp-empty" />);
    await waitFor(() => {
      expect(screen.getByText('No runs found.')).toBeInTheDocument();
    });
  });
});
