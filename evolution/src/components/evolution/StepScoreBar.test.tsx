// Tests for StepScoreBar: rendering, color thresholds, weakest step highlighting, and empty data.
import { render, screen } from '@testing-library/react';
import { StepScoreBar, type StepScoreData } from './StepScoreBar';

const FULL_STEPS: StepScoreData[] = [
  { name: 'outline', score: 0.9, costUsd: 0.01 },
  { name: 'expand', score: 0.6, costUsd: 0.02 },
  { name: 'polish', score: 0.3, costUsd: 0.01 },
  { name: 'verify', score: 1.0, costUsd: 0.0 },
];

describe('StepScoreBar', () => {
  it('renders nothing for empty steps', () => {
    const { container } = render(<StepScoreBar steps={[]} weakestStep={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a bar for each step', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep="polish" />);
    expect(screen.getByTestId('step-score-bar')).toBeInTheDocument();
    expect(screen.getByTestId('step-bar-outline')).toBeInTheDocument();
    expect(screen.getByTestId('step-bar-expand')).toBeInTheDocument();
    expect(screen.getByTestId('step-bar-polish')).toBeInTheDocument();
    expect(screen.getByTestId('step-bar-verify')).toBeInTheDocument();
  });

  it('applies green color for high scores (≥0.8)', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep={null} />);
    const bar = screen.getByTestId('step-bar-outline');
    expect(bar.style.backgroundColor).toBe('var(--status-success)');
  });

  it('applies yellow color for mid scores (0.5–0.8)', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep={null} />);
    const bar = screen.getByTestId('step-bar-expand');
    expect(bar.style.backgroundColor).toBe('var(--accent-gold)');
  });

  it('applies red color for low scores (<0.5)', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep={null} />);
    const bar = screen.getByTestId('step-bar-polish');
    expect(bar.style.backgroundColor).toBe('var(--status-error)');
  });

  it('sets bar width from score percentage', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep={null} />);
    const bar = screen.getByTestId('step-bar-outline');
    expect(bar.style.width).toBe('90%');
  });

  it('highlights weakest step label with error color', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep="polish" />);
    // The "Polish" label should have the error text class
    const label = screen.getByText('Polish');
    expect(label.className).toContain('text-[var(--status-error)]');
    expect(label.className).toContain('font-semibold');
  });

  it('does not highlight labels when weakestStep is null', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep={null} />);
    const label = screen.getByText('Polish');
    expect(label.className).toContain('text-[var(--text-muted)]');
    expect(label.className).not.toContain('font-semibold');
  });

  it('renders score text for each step', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep={null} />);
    expect(screen.getByText('0.90')).toBeInTheDocument();
    expect(screen.getByText('0.60')).toBeInTheDocument();
    expect(screen.getByText('0.30')).toBeInTheDocument();
    expect(screen.getByText('1.00')).toBeInTheDocument();
  });

  it('renders human-readable step labels', () => {
    render(<StepScoreBar steps={FULL_STEPS} weakestStep={null} />);
    expect(screen.getByText('Outline')).toBeInTheDocument();
    expect(screen.getByText('Expand')).toBeInTheDocument();
    expect(screen.getByText('Polish')).toBeInTheDocument();
    expect(screen.getByText('Verify')).toBeInTheDocument();
  });
});
