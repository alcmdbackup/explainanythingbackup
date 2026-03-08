// Tests for ExperimentDetailTabs: tab switching renders correct content.
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ExperimentStatus } from '@evolution/services/experimentActions';

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentRunsAction: jest.fn(),
  getExperimentMetricsAction: jest.fn(),
  regenerateExperimentReportAction: jest.fn(),
}));

import {
  getExperimentRunsAction,
  getExperimentMetricsAction,
  regenerateExperimentReportAction,
} from '@evolution/services/experimentActions';
import { ExperimentDetailTabs } from './ExperimentDetailTabs';

const mockStatus: ExperimentStatus = {
  id: 'exp-test-id',
  name: 'Test',
  status: 'completed',
  optimizationTarget: 'elo',
  totalBudgetUsd: 10,
  spentUsd: 5,
  convergenceThreshold: 10,
  factorDefinitions: {},
  promptId: 'prompt-uuid-1',
  promptTitle: 'Test prompt',
  resultsSummary: null,
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00Z',
  design: 'manual',
  analysisResults: null,
  runCounts: { total: 8, completed: 8, failed: 0, pending: 0 },
};

describe('ExperimentDetailTabs', () => {
  beforeEach(() => {
    (getExperimentRunsAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (getExperimentMetricsAction as jest.Mock).mockResolvedValue({ success: true, data: null });
    (regenerateExperimentReportAction as jest.Mock).mockResolvedValue({ success: true, data: null });
  });

  it('defaults to Analysis tab', async () => {
    await act(async () => {
      render(<ExperimentDetailTabs status={mockStatus} />);
    });
    await waitFor(() => {
      expect(screen.getByText('No analysis results available.')).toBeInTheDocument();
    });
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
