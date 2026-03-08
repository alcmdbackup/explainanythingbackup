// Tests for EntityDetailHeader: title, entity ID, status badge, cross-links, and actions.

import { render, screen } from '@testing-library/react';
import { EntityDetailHeader } from './EntityDetailHeader';

describe('EntityDetailHeader', () => {
  it('renders title', () => {
    render(<EntityDetailHeader title="Test Strategy" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test Strategy');
  });

  it('renders entity ID truncated with title attr', () => {
    const longId = 'abcdef1234567890abcdef';
    render(<EntityDetailHeader title="Run" entityId={longId} />);
    const el = screen.getByTestId('entity-id');
    expect(el).toHaveAttribute('title', longId);
    expect(el.textContent).toContain('abcdef123456');
    expect(el.textContent).toContain('…');
  });

  it('renders short entity ID without truncation', () => {
    render(<EntityDetailHeader title="Run" entityId="abc123" />);
    const el = screen.getByTestId('entity-id');
    expect(el.textContent).toBe('abc123');
  });

  it('renders status badge when provided', () => {
    render(<EntityDetailHeader title="Run" statusBadge={<span data-testid="badge">Active</span>} />);
    expect(screen.getByTestId('badge')).toHaveTextContent('Active');
  });

  it('renders cross-link badges with correct hrefs', () => {
    render(
      <EntityDetailHeader
        title="Run"
        links={[
          { prefix: 'Experiment', label: 'Test Exp', href: '/experiments/1' },
          { prefix: 'Strategy', label: 'Test Strat', href: '/strategies/2' },
        ]}
      />
    );
    const crossLinks = screen.getByTestId('cross-links');
    const links = crossLinks.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Experiment: Test Exp');
    expect(links[0]).toHaveAttribute('href', '/experiments/1');
    expect(links[1]).toHaveTextContent('Strategy: Test Strat');
  });

  it('renders actions slot', () => {
    render(<EntityDetailHeader title="Run" actions={<button>Compare</button>} />);
    expect(screen.getByTestId('header-actions')).toBeInTheDocument();
    expect(screen.getByText('Compare')).toBeInTheDocument();
  });

  it('omits optional sections when not provided', () => {
    render(<EntityDetailHeader title="Minimal" />);
    expect(screen.queryByTestId('entity-id')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cross-links')).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-actions')).not.toBeInTheDocument();
  });
});
