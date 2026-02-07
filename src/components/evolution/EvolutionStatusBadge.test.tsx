// Tests for EvolutionStatusBadge component rendering all 6 statuses.
import { render, screen } from '@testing-library/react';
import { EvolutionStatusBadge } from './EvolutionStatusBadge';
import type { EvolutionRunStatus } from '@/lib/evolution/types';

const ALL_STATUSES: EvolutionRunStatus[] = ['pending', 'claimed', 'running', 'completed', 'failed', 'paused'];

describe('EvolutionStatusBadge', () => {
  it.each(ALL_STATUSES)('renders badge for %s status', (status) => {
    render(<EvolutionStatusBadge status={status} />);
    const badge = screen.getByTestId(`status-badge-${status}`);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(status);
  });

  it('applies custom className', () => {
    render(<EvolutionStatusBadge status="running" className="extra" />);
    const badge = screen.getByTestId('status-badge-running');
    expect(badge.className).toContain('extra');
  });
});
