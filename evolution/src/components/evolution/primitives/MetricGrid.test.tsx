// Tests for MetricGrid: label/value pairs, variants, CI intervals, prefix, and columns.

import { render, screen } from '@testing-library/react';
import { MetricGrid } from './MetricGrid';

describe('MetricGrid', () => {
  const basicMetrics = [
    { label: 'Runs', value: 42 },
    { label: 'Cost', value: '$1.50' },
  ];

  it('renders label/value pairs in default variant', () => {
    render(<MetricGrid metrics={basicMetrics} columns={2} />);
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('$1.50')).toBeInTheDocument();
  });

  it('renders card variant with elevated background', () => {
    render(<MetricGrid metrics={basicMetrics} variant="card" columns={2} />);
    const cell = screen.getByTestId('metric-runs');
    expect(cell.className).toContain('bg-[var(--surface-elevated)]');
  });

  it('renders CI intervals when provided', () => {
    render(
      <MetricGrid
        metrics={[{ label: 'Elo', value: 1200, ci: [1150.5, 1249.5] }]}
        columns={2}
      />
    );
    expect(screen.getByText(/1150\.50/)).toBeInTheDocument();
    expect(screen.getByText(/1249\.50/)).toBeInTheDocument();
  });

  it('shows warning asterisk when n=2', () => {
    render(
      <MetricGrid
        metrics={[{ label: 'Score', value: 85, ci: [80, 90], n: 2 }]}
        columns={2}
      />
    );
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByText('*')).toHaveAttribute('title', 'Low sample size (n=2)');
  });

  it('renders prefix before numeric value', () => {
    render(
      <MetricGrid
        metrics={[{ label: 'Price', value: 99.99, prefix: '$' }]}
        columns={2}
      />
    );
    expect(screen.getByText('$99.99')).toBeInTheDocument();
  });

  it('handles ReactNode values', () => {
    render(
      <MetricGrid
        metrics={[{ label: 'Status', value: <span data-testid="custom">Active</span> }]}
        columns={2}
      />
    );
    expect(screen.getByTestId('custom')).toHaveTextContent('Active');
  });

  it('applies correct grid column class', () => {
    const { container } = render(<MetricGrid metrics={basicMetrics} columns={5} />);
    const grid = container.querySelector('[data-testid="metric-grid"]');
    expect(grid?.className).toContain('sm:grid-cols-5');
  });

  it('defaults to 4 columns', () => {
    const { container } = render(<MetricGrid metrics={basicMetrics} />);
    const grid = container.querySelector('[data-testid="metric-grid"]');
    expect(grid?.className).toContain('sm:grid-cols-4');
  });
});
