// Tests for ExperimentDetailTabs: tab switching renders correct content.
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExperimentStatus } from '@evolution/services/experimentActions';

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentRunsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
  regenerateExperimentReportAction: jest.fn().mockResolvedValue({ success: true, data: null }),
}));

import { ExperimentDetailTabs } from './ExperimentDetailTabs';

const mockStatus: ExperimentStatus = {
  id: 'exp-test-id',
  name: 'Test',
  status: 'converged',
  optimizationTarget: 'elo',
  totalBudgetUsd: 10,
  spentUsd: 5,
  maxRounds: 3,
  currentRound: 2,
  convergenceThreshold: 10,
  factorDefinitions: {},
  prompts: [],
  resultsSummary: null,
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00Z',
  rounds: [
    {
      roundNumber: 1,
      type: 'screening',
      design: 'L8',
      status: 'completed',
      batchRunId: 'batch-1',
      analysisResults: null,
      completedAt: '2026-01-02T00:00:00Z',
      runCounts: { total: 8, completed: 8, failed: 0, pending: 0 },
    },
  ],
};

describe('ExperimentDetailTabs', () => {
  it('defaults to Rounds tab', () => {
    render(<ExperimentDetailTabs status={mockStatus} />);
    expect(screen.getByText('Round 1')).toBeInTheDocument();
  });

  it('switches to Runs tab', () => {
    render(<ExperimentDetailTabs status={mockStatus} />);
    fireEvent.click(screen.getByText('Runs'));
    expect(screen.getByText('Loading runs...')).toBeInTheDocument();
  });

  it('switches to Report tab', () => {
    render(<ExperimentDetailTabs status={mockStatus} />);
    fireEvent.click(screen.getByText('Report'));
    expect(screen.getByText('No report available. Click below to generate one.')).toBeInTheDocument();
  });
});
