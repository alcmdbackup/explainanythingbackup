// Tests for AttributionBadge: z-score color thresholds and gain display.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { AttributionBadge } from './AttributionBadge';
import type { EloAttribution } from '@evolution/lib/types';

function makeAttribution(overrides: Partial<EloAttribution> = {}): EloAttribution {
  return { gain: 50, ci: 30, zScore: 2.5, deltaMu: 3, sigmaDelta: 1.2, ...overrides };
}

describe('AttributionBadge', () => {
  it('displays positive gain with + sign', () => {
    render(<AttributionBadge attribution={makeAttribution({ gain: 45.6 })} />);
    expect(screen.getByText('+46')).toBeInTheDocument();
  });

  it('displays negative gain without + sign', () => {
    render(<AttributionBadge attribution={makeAttribution({ gain: -20.3 })} />);
    expect(screen.getByText('-20')).toBeInTheDocument();
  });

  it('displays CI in full mode', () => {
    render(<AttributionBadge attribution={makeAttribution({ ci: 111.4 })} />);
    expect(screen.getByText('111')).toBeInTheDocument();
    expect(screen.getByText('±')).toBeInTheDocument();
  });

  it('hides CI in compact mode', () => {
    render(<AttributionBadge attribution={makeAttribution({ ci: 111.4 })} compact />);
    expect(screen.queryByText('±')).not.toBeInTheDocument();
  });

  it('uses grey color for |z| < 1.0', () => {
    const { container } = render(<AttributionBadge attribution={makeAttribution({ zScore: 0.9 })} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-[var(--text-secondary)]');
  });

  it('uses amber color for |z| = 1.0', () => {
    const { container } = render(<AttributionBadge attribution={makeAttribution({ zScore: 1.0 })} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-[var(--status-warning)]');
  });

  it('uses amber color for |z| = 1.5', () => {
    const { container } = render(<AttributionBadge attribution={makeAttribution({ zScore: 1.5 })} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-[var(--status-warning)]');
  });

  it('uses green color for z >= 2.0', () => {
    const { container } = render(<AttributionBadge attribution={makeAttribution({ zScore: 2.0 })} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-[var(--status-success)]');
  });

  it('uses red color for z <= -2.0', () => {
    const { container } = render(<AttributionBadge attribution={makeAttribution({ zScore: -2.5, gain: -30 })} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-[var(--status-error)]');
  });

  it('includes z-score in title attribute', () => {
    render(<AttributionBadge attribution={makeAttribution({ zScore: 2.5 })} />);
    const badge = screen.getByTitle('z-score: 2.50');
    expect(badge).toBeInTheDocument();
  });
});
