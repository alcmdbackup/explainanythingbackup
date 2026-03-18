// Tests for PhaseIndicator component - verifies phase rendering, styling, and iteration display.

import { render, screen } from '@testing-library/react';
import { PhaseIndicator } from './PhaseIndicator';

describe('PhaseIndicator', () => {
  it('renders EXPANSION phase with iteration count', () => {
    render(<PhaseIndicator phase="EXPANSION" iteration={2} maxIterations={5} />);
    expect(screen.getByText('EXPANSION')).toBeInTheDocument();
    expect(screen.getByText('2/5')).toBeInTheDocument();
  });

  it('renders COMPETITION phase with iteration count', () => {
    render(<PhaseIndicator phase="COMPETITION" iteration={3} maxIterations={10} />);
    expect(screen.getByText('COMPETITION')).toBeInTheDocument();
    expect(screen.getByText('3/10')).toBeInTheDocument();
  });

  it('applies EXPANSION phase styles', () => {
    render(<PhaseIndicator phase="EXPANSION" iteration={1} maxIterations={5} />);
    const el = screen.getByTestId('phase-indicator');
    expect(el.className).toContain('accent-gold');
  });

  it('applies COMPETITION phase styles', () => {
    render(<PhaseIndicator phase="COMPETITION" iteration={1} maxIterations={5} />);
    const el = screen.getByTestId('phase-indicator');
    expect(el.className).toContain('status-success');
  });

  it('forwards custom className', () => {
    render(<PhaseIndicator phase="EXPANSION" iteration={1} maxIterations={5} className="my-custom" />);
    const el = screen.getByTestId('phase-indicator');
    expect(el.className).toContain('my-custom');
  });
});
