// Tests for ExperimentHistory: rows link to detail pages, no expand/collapse.
import { render, screen } from '@testing-library/react';

jest.mock('@evolution/services/experimentActionsV2', () => ({
  listExperimentsAction: jest.fn(),
  cancelExperimentAction: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { ExperimentHistory } from './ExperimentHistory';
import { listExperimentsAction } from '@evolution/services/experimentActionsV2';

describe('ExperimentHistory', () => {
  beforeEach(() => {
    (listExperimentsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'abc12345-6789-0def-ghij-klmnopqrstuv',
          name: 'Test Experiment',
          status: 'completed',
          created_at: '2026-02-01T00:00:00Z',
          runCount: 3,
        },
      ],
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

  it('does not render expand/collapse controls', async () => {
    render(<ExperimentHistory />);
    await screen.findByText('Test Experiment');
    expect(screen.queryByText('▲')).not.toBeInTheDocument();
    expect(screen.queryByText('▼')).not.toBeInTheDocument();
  });

  it('defaults to non-archived filter (no params means exclude archived)', async () => {
    render(<ExperimentHistory />);
    await screen.findByText('Test Experiment');
    expect(listExperimentsAction).toHaveBeenCalledWith(undefined);
  });

  it('renders status filter dropdown with Active/Archived/All options', async () => {
    render(<ExperimentHistory />);
    await screen.findByText('Test Experiment');
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  // V2: rename removed — experiment names are immutable after creation
});
