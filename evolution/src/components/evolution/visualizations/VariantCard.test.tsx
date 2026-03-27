// Tests for VariantCard component - verifies variant data display, strategy colors, and tree search info.

import { render, screen } from '@testing-library/react';
import { VariantCard, STRATEGY_PALETTE } from './VariantCard';

describe('VariantCard', () => {
  const baseProps = {
    shortId: 'abc123',
    elo: 1234.56,
    strategy: 'structural_transform',
    iterationBorn: 3,
  };

  it('renders variant ID, rounded elo, strategy, and iteration', () => {
    render(<VariantCard {...baseProps} />);
    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.getByText('1235')).toBeInTheDocument();
    expect(screen.getByText('structural_transform')).toBeInTheDocument();
    expect(screen.getByText('iter 3')).toBeInTheDocument();
  });

  it('applies strategy color as left border', () => {
    render(<VariantCard {...baseProps} />);
    const card = screen.getByTestId('variant-card-abc123');
    // jsdom converts hex to rgb
    expect(card.style.borderLeftColor).toBe('rgb(59, 130, 246)');
  });

  it('falls back to CSS var for unknown strategy', () => {
    render(<VariantCard {...baseProps} strategy="unknown_strat" />);
    const card = screen.getByTestId('variant-card-abc123');
    expect(card.style.borderLeftColor).toBe('var(--border-default)');
  });

  it('shows winner star when isWinner is true', () => {
    render(<VariantCard {...baseProps} isWinner />);
    // Unicode star character ★
    const star = screen.getByText('★');
    expect(star).toBeInTheDocument();
  });

  it('renders tree search depth and revision action when provided', () => {
    render(<VariantCard {...baseProps} treeDepth={2} revisionAction="Simplify introduction" />);
    expect(screen.getByText('depth 2')).toBeInTheDocument();
    expect(screen.getByText('Simplify introduction')).toBeInTheDocument();
  });
});
