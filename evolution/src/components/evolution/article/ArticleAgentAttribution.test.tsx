// Tests for ArticleAgentAttribution: agent attribution table rendering and empty state.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ArticleAgentAttribution } from './ArticleAgentAttribution';
import * as articleDetailActions from '@evolution/services/articleDetailActions';
import type { ArticleAgentAttribution as AgentAttr } from '@evolution/services/articleDetailActions';

jest.mock('@evolution/services/articleDetailActions', () => ({
  getArticleAgentAttributionAction: jest.fn(),
}));

jest.mock('@evolution/components/evolution', () => ({
  EmptyState: ({ message }: any) => <div data-testid="empty-state">{message}</div>,
}));

jest.mock('@evolution/components/evolution/AttributionBadge', () => ({
  AgentAttributionSummary: ({ agentName }: any) => <span data-testid="agent-summary">{agentName}</span>,
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

const mockAgents: AgentAttr[] = [
  {
    agentName: 'evolution',
    runCount: 5,
    totalVariants: 12,
    avgGain: 35.2,
    avgCi: 18.1,
  },
  {
    agentName: 'generation',
    runCount: 3,
    totalVariants: 8,
    avgGain: -10.5,
    avgCi: 22.7,
  },
];

describe('ArticleAgentAttribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    (articleDetailActions.getArticleAgentAttributionAction as jest.Mock).mockImplementation(
      () => new Promise(() => {}),
    );

    const { container } = render(<ArticleAgentAttribution explanationId={42} />);

    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);

    expect(screen.queryByTestId('article-agent-attribution')).not.toBeInTheDocument();
  });

  it('renders agent table after loading', async () => {
    (articleDetailActions.getArticleAgentAttributionAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockAgents,
      error: null,
    });

    render(<ArticleAgentAttribution explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('article-agent-attribution')).toBeInTheDocument();
    });

    // Table headers
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('Variants')).toBeInTheDocument();
    expect(screen.getByText('Avg Gain')).toBeInTheDocument();

    // Agent names in rows (appear twice: once in td, once in AgentAttributionSummary mock)
    expect(screen.getAllByText('evolution')).toHaveLength(2);
    expect(screen.getAllByText('generation')).toHaveLength(2);

    // Run counts
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // Variant counts
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();

    // AgentAttributionSummary mocks rendered
    const summaries = screen.getAllByTestId('agent-summary');
    expect(summaries).toHaveLength(2);
  });

  it('shows empty state when no agents', async () => {
    (articleDetailActions.getArticleAgentAttributionAction as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
      error: null,
    });

    render(<ArticleAgentAttribution explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('No agent attribution data yet.')).toBeInTheDocument();
  });

  it('has data-testid="article-agent-attribution"', async () => {
    (articleDetailActions.getArticleAgentAttributionAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockAgents,
      error: null,
    });

    render(<ArticleAgentAttribution explanationId={42} />);

    await waitFor(() => {
      expect(screen.getByTestId('article-agent-attribution')).toBeInTheDocument();
    });
  });
});
