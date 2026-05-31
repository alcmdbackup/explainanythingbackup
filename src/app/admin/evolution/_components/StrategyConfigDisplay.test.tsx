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

  // Phase 9 — Iterations stat falls back to iterationConfigs.length for V2 strategies.
  // The component has BOTH a stat row (label "Iterations") AND a table heading <h4>Iterations</h4>;
  // these tests target the stat row by querying via the label's parent div (ConfigRow).
  function getIterationsStatValue(container: HTMLElement): string {
    // ConfigRow renders <div><span>Iterations</span><span>VALUE</span></div>
    const allLabels = Array.from(container.querySelectorAll('span.font-ui.text-xs'));
    const labelEl = allLabels.find((el) => el.textContent === 'Iterations');
    expect(labelEl).toBeDefined();
    const valueEl = labelEl!.nextElementSibling as HTMLElement | null;
    return valueEl?.textContent ?? '';
  }

  it('falls back to iterationConfigs.length when legacy iterations field is absent', () => {
    const v2Config = {
      generationModel: 'gemini-2.5-flash-lite',
      judgeModel: 'qwen-2.5-7b-instruct',
      iterationConfigs: [
        { agentType: 'generate', sourceMode: 'seed', budgetPercent: 40 },
        { agentType: 'paragraph_recombine', sourceMode: 'pool', budgetPercent: 60 },
      ],
    };
    const { container } = render(<StrategyConfigDisplay config={v2Config} />);
    expect(getIterationsStatValue(container)).toBe('2');
  });

  it('prefers legacy iterations field when both are present', () => {
    const dualConfig = {
      ...baseConfig,
      iterations: 3,
      iterationConfigs: [
        { agentType: 'generate', sourceMode: 'seed', budgetPercent: 40 },
        { agentType: 'paragraph_recombine', sourceMode: 'pool', budgetPercent: 60 },
      ],
    };
    const { container } = render(<StrategyConfigDisplay config={dualConfig} />);
    expect(getIterationsStatValue(container)).toBe('3');
  });

  it('renders em-dash when neither field is set', () => {
    const emptyConfig = {
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'qwen-2.5-7b-instruct',
    };
    const { container } = render(<StrategyConfigDisplay config={emptyConfig} />);
    expect(getIterationsStatValue(container)).toBe('—');
  });
});
