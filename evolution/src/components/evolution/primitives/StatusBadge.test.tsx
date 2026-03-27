// Tests for unified StatusBadge component covering all 7 variants.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  // -- run-status variant --
  it('renders run-status completed with icon', () => {
    render(<StatusBadge variant="run-status" status="completed" />);
    const badge = screen.getByTestId('status-badge-completed');
    expect(badge).toHaveTextContent('Completed');
    expect(screen.getByTestId('status-icon')).toHaveTextContent('\u2713');
  });

  it('renders run-status "claimed" as "Starting"', () => {
    render(<StatusBadge variant="run-status" status="claimed" />);
    expect(screen.getByTestId('status-badge-claimed')).toHaveTextContent('Starting');
  });

  it.each(['pending', 'running', 'failed', 'cancelled'] as const)(
    'renders run-status %s with icon',
    (status) => {
      render(<StatusBadge variant="run-status" status={status} />);
      expect(screen.getByTestId(`status-badge-${status}`)).toBeInTheDocument();
      expect(screen.getByTestId('status-icon')).toBeInTheDocument();
    },
  );

  // -- entity-status variant --
  it('renders entity-status active', () => {
    render(<StatusBadge variant="entity-status" status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  // -- pipeline-type variant --
  it('renders pipeline-type v2', () => {
    render(<StatusBadge variant="pipeline-type" status="v2" />);
    expect(screen.getByText('V2')).toBeInTheDocument();
  });

  // -- generation-method variant --
  it('renders generation-method article', () => {
    render(<StatusBadge variant="generation-method" status="article" />);
    expect(screen.getByText('Article')).toBeInTheDocument();
  });

  // -- invocation-status variant --
  it('renders invocation-status true as Success', () => {
    render(<StatusBadge variant="invocation-status" status="true" />);
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('renders invocation-status false as Failed', () => {
    render(<StatusBadge variant="invocation-status" status="false" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  // -- experiment-status variant --
  it('renders experiment-status running', () => {
    render(<StatusBadge variant="experiment-status" status="running" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  // -- winner variant --
  it('renders winner true as Winner', () => {
    render(<StatusBadge variant="winner" status="true" />);
    expect(screen.getByText('Winner')).toBeInTheDocument();
  });

  it('renders nothing for winner false', () => {
    const { container } = render(<StatusBadge variant="winner" status="false" />);
    expect(container.innerHTML).toBe('');
  });

  // -- unknown status fallback --
  it('renders unknown status with fallback', () => {
    render(<StatusBadge variant="run-status" status="unknown_status" />);
    expect(screen.getByText('Unknown_status')).toBeInTheDocument();
  });

  // -- outlined style --
  it('renders outlined style with border and text color', () => {
    render(<StatusBadge variant="experiment-status" status="running" badgeStyle="outlined" />);
    const badge = screen.getByTestId('status-badge');
    expect(badge.className).toContain('border');
  });

  // -- pulse dot --
  it('renders pulse dot when pulse is true', () => {
    render(<StatusBadge variant="experiment-status" status="running" badgeStyle="outlined" pulse />);
    const badge = screen.getByTestId('status-badge');
    const pulseDot = badge.querySelector('.animate-pulse');
    expect(pulseDot).toBeInTheDocument();
  });

  // -- hasError dot --
  it('shows error dot when hasError is true', () => {
    render(<StatusBadge variant="run-status" status="failed" hasError />);
    expect(screen.getByTestId('error-dot')).toBeInTheDocument();
  });

  it('does not show error dot when hasError is false', () => {
    render(<StatusBadge variant="run-status" status="failed" />);
    expect(screen.queryByTestId('error-dot')).not.toBeInTheDocument();
  });

  it('shows error dot alongside non-failed status', () => {
    render(<StatusBadge variant="run-status" status="running" hasError />);
    expect(screen.getByTestId('error-dot')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-running')).toHaveTextContent('Running');
  });

  // -- className --
  it('applies custom className', () => {
    render(<StatusBadge variant="run-status" status="running" className="extra" />);
    expect(screen.getByTestId('status-badge-running').className).toContain('extra');
  });

  // -- status icons for all run statuses --
  it('renders correct status icons', () => {
    const EXPECTED: Record<string, string> = {
      pending: '\u23F3',
      claimed: '\u25B6',
      running: '\u25B6',
      completed: '\u2713',
      failed: '\u2717',
      cancelled: '\u23F9',
    };
    for (const [status, icon] of Object.entries(EXPECTED)) {
      const { unmount } = render(<StatusBadge variant="run-status" status={status} />);
      expect(screen.getByTestId('status-icon')).toHaveTextContent(icon);
      unmount();
    }
  });
});
