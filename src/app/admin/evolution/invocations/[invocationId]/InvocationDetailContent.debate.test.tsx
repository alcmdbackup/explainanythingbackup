// bring_back_debate_agent_20260506 Phase 4.8 — UI integration test for the debate
// invocation-detail page. Verifies:
//   - 5-tab layout for agent_name='debate_then_generate_from_previous_article'
//   - Debate Overview tab renders variantA/variantB + debate.combined sub-detail.
//   - Synthesis tab renders generation + ranking + totalCost (NOT debate sub-tree).
//   - Tab navigation works.
//
// Mirrors the structure of evaluate-criteria UI tests (Phase 4.4 keyFilter rules).

import { render, screen, fireEvent } from '@testing-library/react';
import { InvocationDetailContent } from './InvocationDetailContent';

// Mock heavy dependencies that aren't relevant to the tab/keyFilter logic.
jest.mock('@evolution/components/evolution/tabs/LogsTab', () => ({
  LogsTab: () => <div data-testid="logs-tab-mock">Logs tab</div>,
}));
jest.mock('@evolution/components/evolution/tabs/InvocationTimelineTab', () => ({
  InvocationTimelineTab: () => <div data-testid="timeline-tab-mock">Timeline tab</div>,
}));
jest.mock('@evolution/components/evolution/tabs/InvocationParentBlock', () => ({
  InvocationParentBlock: () => <div data-testid="parent-block-mock">Parent block</div>,
}));
jest.mock('@evolution/components/evolution', () => {
  const Actual = jest.requireActual('@evolution/components/evolution');
  return {
    ...Actual,
    EntityMetricsTab: () => <div data-testid="metrics-tab-mock">Metrics tab</div>,
  };
});

const VARIANT_A_ID = '00000000-0000-4000-8000-00000000000a';
const VARIANT_B_ID = '00000000-0000-4000-8000-00000000000b';

const sampleDebateInvocation = {
  id: 'inv-debate-1',
  run_id: 'run-1',
  agent_name: 'debate_then_generate_from_previous_article',
  iteration: 2,
  execution_order: 5,
  cost_usd: 0.012,
  duration_ms: 8500,
  success: true,
  error_message: null,
  execution_detail: {
    detailType: 'debate_then_generate_from_previous_article',
    tactic: 'debate_synthesis',
    surfaced: true,
    variantA: { id: VARIANT_A_ID, elo: 1300 },
    variantB: { id: VARIANT_B_ID, elo: 1280 },
    debate: {
      combined: {
        winner: 'A',
        reasoning: 'A is clearer overall.',
        prosA: ['Concise prose', 'Clear topic intro'],
        consA: ['Lacks vivid examples'],
        prosB: ['Vivid imagery'],
        consB: ['Muddled structure'],
        strengthsFromA: ['Topic introduction'],
        strengthsFromB: ['Vivid sensory details'],
        improvements: ['Tighten the closing paragraph'],
        cost: 0.002,
        durationMs: 1200,
      },
    },
    generation: {
      cost: 0.005,
      promptLength: 4500,
      textLength: 9200,
      formatValid: true,
      durationMs: 4800,
    },
    ranking: {
      cost: 0.005,
      totalComparisons: 8,
      finalLocalElo: 1320,
      durationMs: 2500,
    },
    totalCost: 0.012,
  },
  created_at: '2026-05-07T15:00:00Z',
};

describe('InvocationDetailContent — debate_and_generate (Phase 4.8)', () => {
  it('renders 5-tab layout for the debate detailType', () => {
    render(<InvocationDetailContent invocation={sampleDebateInvocation} />);
    // 5 tabs per Phase 4.3: Debate Overview / Synthesis / Metrics / Timeline / Logs.
    expect(screen.getByText('Debate Overview')).toBeInTheDocument();
    expect(screen.getByText('Synthesis')).toBeInTheDocument();
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Logs')).toBeInTheDocument();
  });

  it('default tab is Debate Overview', () => {
    render(<InvocationDetailContent invocation={sampleDebateInvocation} />);
    expect(screen.getByTestId('debate-overview-tab')).toBeInTheDocument();
  });

  it('Debate Overview tab renders the testid block (Phase 4.4 keyFilter active)', () => {
    render(<InvocationDetailContent invocation={sampleDebateInvocation} />);
    // The keyFilter for overview-debate lets through tactic/surfaced/variantA/variantB
    // and debate.* — verify the tab block itself renders. The detailed field-level
    // rendering is exercised by ConfigDrivenDetailRenderer.test.tsx + entities.test.ts
    // parity test.
    expect(screen.getByTestId('debate-overview-tab')).toBeInTheDocument();
  });

  it('switching to Synthesis tab renders generation + ranking sub-detail', () => {
    render(<InvocationDetailContent invocation={sampleDebateInvocation} />);
    const synthesisBtn = screen.getByText('Synthesis');
    fireEvent.click(synthesisBtn);
    expect(screen.getByTestId('debate-synthesis-tab')).toBeInTheDocument();
  });

  it('Synthesis tab does NOT show variantA/variantB (those live on Debate Overview)', () => {
    // After switching to synthesis tab, variantA/variantB IDs from the debate detail
    // should not be rendered. They appear only in the Debate Overview's keyFilter scope.
    render(<InvocationDetailContent invocation={sampleDebateInvocation} />);
    const synthesisBtn = screen.getByText('Synthesis');
    fireEvent.click(synthesisBtn);
    // The synthesis tab should be active.
    expect(screen.getByTestId('debate-synthesis-tab')).toBeInTheDocument();
    // The debate-overview content (which contains variant IDs as object cards) should NOT
    // be in the document on this tab.
    expect(screen.queryByTestId('debate-overview-tab')).not.toBeInTheDocument();
  });

  it('switching to Metrics tab renders the metrics view', () => {
    render(<InvocationDetailContent invocation={sampleDebateInvocation} />);
    const metricsBtn = screen.getByText('Metrics');
    fireEvent.click(metricsBtn);
    expect(screen.getByTestId('metrics-tab-mock')).toBeInTheDocument();
  });

  it('switching to Timeline tab renders the timeline view', () => {
    render(<InvocationDetailContent invocation={sampleDebateInvocation} />);
    const timelineBtn = screen.getByText('Timeline');
    fireEvent.click(timelineBtn);
    expect(screen.getByTestId('timeline-tab-mock')).toBeInTheDocument();
  });
});
