// Tests for RunMetricsTab: V2 shows empty state (no per-run metrics).

import React from 'react';
import { render, screen } from '@testing-library/react';
import { RunMetricsTab } from './RunMetricsTab';

describe('RunMetricsTab', () => {
  it('renders empty state with V2 message', () => {
    render(<RunMetricsTab runId="test-run-id-full" />);

    expect(screen.getByTestId('run-metrics-tab')).toBeInTheDocument();
    expect(screen.getByText('Per-run metrics are not available in V2.')).toBeInTheDocument();
    expect(
      screen.getByText(/View experiment-level metrics from the experiment detail page/)
    ).toBeInTheDocument();
  });

  it('displays truncated run ID', () => {
    render(<RunMetricsTab runId="abcdef12-3456-7890" />);

    expect(screen.getByText(/Run: abcdef12/)).toBeInTheDocument();
  });
});
