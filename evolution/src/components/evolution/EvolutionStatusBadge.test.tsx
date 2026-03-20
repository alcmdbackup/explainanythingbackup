// Tests for EvolutionStatusBadge component rendering all 6 V2 statuses.
import { render, screen } from '@testing-library/react';
import { EvolutionStatusBadge } from './EvolutionStatusBadge';
import type { EvolutionRunStatus } from '@evolution/lib/types';

const ALL_STATUSES: EvolutionRunStatus[] = ['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'];

describe('EvolutionStatusBadge', () => {
  it.each(ALL_STATUSES)('renders badge for %s status', (status) => {
    render(<EvolutionStatusBadge status={status} />);
    const badge = screen.getByTestId(`status-badge-${status}`);
    expect(badge).toBeInTheDocument();
    // "claimed" displays as "starting" for user clarity
    const expectedText = status === 'claimed' ? 'starting' : status;
    expect(badge).toHaveTextContent(expectedText);
  });

  it('applies custom className', () => {
    render(<EvolutionStatusBadge status="running" className="extra" />);
    const badge = screen.getByTestId('status-badge-running');
    expect(badge.className).toContain('extra');
  });

  it('shows error dot when hasError is true', () => {
    render(<EvolutionStatusBadge status="failed" hasError />);
    expect(screen.getByTestId('error-dot')).toBeInTheDocument();
  });

  it('does not show error dot when hasError is false', () => {
    render(<EvolutionStatusBadge status="failed" />);
    expect(screen.queryByTestId('error-dot')).not.toBeInTheDocument();
  });

  it('shows error dot alongside non-failed status', () => {
    render(<EvolutionStatusBadge status="running" hasError />);
    expect(screen.getByTestId('error-dot')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-running')).toHaveTextContent('running');
  });

  it('renders status icon for each status', () => {
    const EXPECTED_ICONS: Record<string, string> = {
      pending: '\u23F3',
      claimed: '\u25B6',
      running: '\u25B6',
      completed: '\u2713',
      failed: '\u2717',
      cancelled: '\u23F9',
    };
    for (const status of ALL_STATUSES) {
      const { unmount } = render(<EvolutionStatusBadge status={status} />);
      expect(screen.getByTestId('status-icon')).toHaveTextContent(EXPECTED_ICONS[status]);
      unmount();
    }
  });
});
