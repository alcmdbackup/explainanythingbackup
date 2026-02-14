// Tests for StrategyConfigDisplay: full agent names, enabled/disabled indicators, effective budget.
import { render, screen } from '@testing-library/react';
import { StrategyConfigDisplay } from './StrategyConfigDisplay';
import type { StrategyConfig } from '@/lib/evolution/core/strategyConfig';

const baseConfig: StrategyConfig = {
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  iterations: 3,
  budgetCaps: {
    generation: 0.20,
    calibration: 0.15,
    tournament: 0.20,
    evolution: 0.10,
    reflection: 0.05,
  },
  enabledAgents: ['evolution', 'reflection'],
};

describe('StrategyConfigDisplay', () => {
  it('renders full agent names instead of truncated labels', () => {
    render(<StrategyConfigDisplay config={baseConfig} />);
    // Check budget section has full names via data-testid rows
    expect(screen.getByTestId('budget-row-generation')).toBeInTheDocument();
    expect(screen.getByTestId('budget-row-calibration')).toBeInTheDocument();
    expect(screen.getByTestId('budget-row-evolution')).toBeInTheDocument();
    expect(screen.getByTestId('budget-row-reflection')).toBeInTheDocument();
    // Verify full names in text (not 4-char truncations)
    expect(screen.getByTestId('budget-row-calibration').textContent).toContain('Calibration');
    expect(screen.getByTestId('budget-row-evolution').textContent).toContain('Evolution');
  });

  it('shows enabled/disabled indicators', () => {
    render(<StrategyConfigDisplay config={baseConfig} />);
    // Evolution is enabled — its row should not have opacity-40
    const evoRow = screen.getByTestId('budget-row-evolution');
    expect(evoRow.className).not.toContain('opacity-40');
  });

  it('shows effective budget with redistribution arrow', () => {
    // With only evolution + reflection enabled (from optional agents),
    // disabled agents' budgets get redistributed → effective % > base %
    render(<StrategyConfigDisplay config={baseConfig} />);
    // The "→" indicates redistribution
    const generationRow = screen.getByTestId('budget-row-generation');
    expect(generationRow.textContent).toContain('→');
  });

  it('renders raw JSON when showRaw is true', () => {
    render(<StrategyConfigDisplay config={baseConfig} showRaw />);
    expect(screen.getByText(/deepseek-chat/)).toBeInTheDocument();
  });

  it('shows single article mode when enabled', () => {
    render(<StrategyConfigDisplay config={{ ...baseConfig, singleArticle: true }} />);
    expect(screen.getByText('Single Article')).toBeInTheDocument();
  });
});
