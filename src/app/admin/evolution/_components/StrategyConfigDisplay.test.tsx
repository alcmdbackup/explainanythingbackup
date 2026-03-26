// Tests for StrategyConfigDisplay: agent names, enabled/disabled indicators.
import { render, screen } from '@testing-library/react';
import { StrategyConfigDisplay } from './StrategyConfigDisplay';

const baseConfig = {
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  iterations: 3,
  enabledAgents: ['evolution', 'reflection'],
};

describe('StrategyConfigDisplay', () => {
  it('renders full agent names', () => {
    render(<StrategyConfigDisplay config={baseConfig} />);
    expect(screen.getByTestId('agent-row-generation')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-ranking')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-evolution')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-reflection')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-ranking').textContent).toContain('Ranking');
    expect(screen.getByTestId('agent-row-evolution').textContent).toContain('Evolution');
  });

  it('shows enabled/disabled indicators', () => {
    render(<StrategyConfigDisplay config={baseConfig} />);
    const evoRow = screen.getByTestId('agent-row-evolution');
    expect(evoRow.className).not.toContain('opacity-40');
    // debate is not enabled — should have opacity-40
    const debateRow = screen.getByTestId('agent-row-debate');
    expect(debateRow.className).toContain('opacity-40');
  });

  it('renders raw JSON when showRaw is true', () => {
    render(<StrategyConfigDisplay config={baseConfig} showRaw />);
    expect(screen.getByText(/deepseek-chat/)).toBeInTheDocument();
  });

  it('renders budget row when budgetUsd is present', () => {
    render(<StrategyConfigDisplay config={{ ...baseConfig, budgetUsd: 2.0 }} />);
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
  });

  it('does not render budget row when budgetUsd is absent', () => {
    render(<StrategyConfigDisplay config={baseConfig} />);
    expect(screen.queryByText('Budget')).not.toBeInTheDocument();
  });

  it('shows single article mode when enabled', () => {
    render(<StrategyConfigDisplay config={{ ...baseConfig, singleArticle: true }} />);
    expect(screen.getByText('Single Article')).toBeInTheDocument();
  });
});
