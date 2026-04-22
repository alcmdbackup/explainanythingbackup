import { render, screen } from '@testing-library/react';
import { VariantParentBadge } from './VariantParentBadge';

describe('VariantParentBadge', () => {
  it('renders "Seed · no parent" when parentId is null', () => {
    render(
      <VariantParentBadge
        parentId={null}
        parentElo={null}
        parentUncertainty={null}
        delta={null}
        deltaCi={null}
      />,
    );
    const badge = screen.getByTestId('variant-parent-badge');
    expect(badge).toHaveAttribute('data-state', 'seed');
    expect(badge).toHaveTextContent('Seed · no parent');
  });

  it('renders parent short ID + elo + delta + CI', () => {
    render(
      <VariantParentBadge
        parentId="a1b2c3d4e5f6"
        parentElo={1250}
        parentUncertainty={40}
        delta={45}
        deltaCi={[10, 80]}
      />,
    );
    const badge = screen.getByTestId('variant-parent-badge');
    expect(badge).toHaveAttribute('data-state', 'parent');
    expect(badge).toHaveTextContent('Parent #a1b2c3d4');
    expect(badge).toHaveTextContent('Δ +45');
    expect(badge).toHaveTextContent('[+10, +80]');
  });

  it('renders negative delta with sign', () => {
    render(
      <VariantParentBadge
        parentId="xxx"
        parentElo={1300}
        parentUncertainty={20}
        delta={-25}
        deltaCi={[-50, 0]}
      />,
    );
    const badge = screen.getByTestId('variant-parent-badge');
    expect(badge).toHaveTextContent('Δ -25');
    expect(badge).toHaveTextContent('[-50, +0]');
  });

  it('annotates cross-run parent with a strengthened pill (20260421)', () => {
    render(
      <VariantParentBadge
        parentId="xxx"
        parentElo={1200}
        parentUncertainty={30}
        delta={10}
        deltaCi={[-5, 25]}
        crossRun={true}
      />,
    );
    const pill = screen.getByTestId('parent-cross-run-pill');
    expect(pill).toHaveTextContent(/other run/i);
    // Accessible label for screen readers.
    expect(pill).toHaveAttribute('aria-label', 'Parent is from a different run');
  });

  it('appends 6-char parent run id to the cross-run pill when supplied', () => {
    render(
      <VariantParentBadge
        parentId="xxx"
        parentElo={1200}
        parentUncertainty={30}
        delta={10}
        deltaCi={[-5, 25]}
        crossRun={true}
        parentRunId="abc123def456"
      />,
    );
    const pill = screen.getByTestId('parent-cross-run-pill');
    expect(pill).toHaveTextContent(/other run abc123$/i);
  });

  it('omits the run-id slice when parentRunId is null', () => {
    render(
      <VariantParentBadge
        parentId="xxx"
        parentElo={1200}
        parentUncertainty={30}
        delta={10}
        deltaCi={[-5, 25]}
        crossRun={true}
        parentRunId={null}
      />,
    );
    const pill = screen.getByTestId('parent-cross-run-pill');
    expect(pill).toHaveTextContent(/^other run$/i);
  });

  it('renders "From" label when role="from"', () => {
    render(
      <VariantParentBadge
        parentId="abc123"
        parentElo={1200}
        parentUncertainty={30}
        delta={50}
        deltaCi={[20, 80]}
        role="from"
      />,
    );
    const badge = screen.getByTestId('variant-parent-badge');
    expect(badge).toHaveAttribute('data-state', 'from');
    expect(badge).toHaveTextContent('From #abc123');
  });
});
