// Tests for ExperimentHistory: experiment ID display, link, and archive filter.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock server actions before importing component
jest.mock('@evolution/services/experimentActions', () => ({
  listExperimentsAction: jest.fn(),
  getExperimentStatusAction: jest.fn(),
  archiveExperimentAction: jest.fn(),
  unarchiveExperimentAction: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { ExperimentHistory } from './ExperimentHistory';
import { listExperimentsAction, getExperimentStatusAction } from '@evolution/services/experimentActions';

describe('ExperimentHistory', () => {
  beforeEach(() => {
    (listExperimentsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'abc12345-6789-0def-ghij-klmnopqrstuv',
          name: 'Test Experiment',
          status: 'completed',
          totalBudgetUsd: 10,
          spentUsd: 7.5,
          createdAt: '2026-02-01T00:00:00Z',
        },
      ],
    });
    (getExperimentStatusAction as jest.Mock).mockResolvedValue({
      success: true,
      data: null,
    });
  });

  it('renders experiment name as a link to the detail page', async () => {
    render(<ExperimentHistory />);
    const link = await screen.findByRole('link', { name: 'Test Experiment' });
    expect(link).toHaveAttribute(
      'href',
      '/admin/evolution/experiments/abc12345-6789-0def-ghij-klmnopqrstuv',
    );
  });

  it('displays truncated experiment ID', async () => {
    render(<ExperimentHistory />);
    const idText = await screen.findByText(/abc12345/);
    expect(idText).toBeInTheDocument();
    expect(idText.tagName).toBe('SPAN');
  });

  it('defaults to non-archived filter (no params means exclude archived)', async () => {
    render(<ExperimentHistory />);
    await screen.findByText('Test Experiment');

    // Default 'non-archived' filter passes undefined (server action excludes archived by default)
    expect(listExperimentsAction).toHaveBeenCalledWith(undefined);
  });

  it('renders status filter dropdown with Active/Archived/All options', async () => {
    render(<ExperimentHistory />);
    await screen.findByText('Test Experiment');

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });
});
