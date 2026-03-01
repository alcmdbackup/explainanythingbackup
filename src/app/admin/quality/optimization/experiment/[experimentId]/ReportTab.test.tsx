// Tests for ReportTab: cached report, no-report states, regenerate.
import { render, screen } from '@testing-library/react';

jest.mock('@evolution/services/experimentActions', () => ({
  regenerateExperimentReportAction: jest.fn().mockResolvedValue({ success: true, data: null }),
}));

import { ReportTab } from './ReportTab';

describe('ReportTab', () => {
  it('renders cached report text', () => {
    render(
      <ReportTab
        experimentId="exp-1"
        status="converged"
        resultsSummary={{
          report: {
            text: '## Executive Summary\nThe experiment converged successfully.',
            generatedAt: '2026-02-01T00:00:00Z',
            model: 'gpt-4.1-nano',
          },
        }}
      />,
    );
    expect(screen.getByTestId('report-content')).toBeInTheDocument();
    expect(screen.getByText('Executive Summary')).toBeInTheDocument();
    expect(screen.getByText('The experiment converged successfully.')).toBeInTheDocument();
  });

  it('shows "will be generated" for in-progress experiments', () => {
    render(
      <ReportTab experimentId="exp-1" status="round_running" resultsSummary={null} />,
    );
    expect(screen.getByText('Report will be generated when the experiment completes.')).toBeInTheDocument();
  });

  it('shows generate button for terminal experiments without report', () => {
    render(
      <ReportTab experimentId="exp-1" status="converged" resultsSummary={null} />,
    );
    expect(screen.getByTestId('generate-report-button')).toHaveTextContent('Generate Report');
  });

  it('displays report metadata', () => {
    render(
      <ReportTab
        experimentId="exp-1"
        status="converged"
        resultsSummary={{
          report: {
            text: '## Summary\nTest',
            generatedAt: '2026-02-01T12:00:00Z',
            model: 'gpt-4.1-nano',
          },
        }}
      />,
    );
    const meta = screen.getByTestId('report-metadata');
    expect(meta.textContent).toContain('gpt-4.1-nano');
  });
});
