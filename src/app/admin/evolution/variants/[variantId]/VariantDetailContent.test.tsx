// Tests for VariantDetailContent: tabs, metrics, badges, links.

import { render, screen, fireEvent } from '@testing-library/react';
import { VariantDetailContent } from './VariantDetailContent';

jest.mock('@evolution/components/evolution', () => ({
  EntityDetailHeader: ({ title, links, statusBadge }: { title: string; links: Array<{ prefix: string; label: string }>; statusBadge: React.ReactNode }) => (
    <div data-testid="detail-header">
      <h1 data-testid="title">{title}</h1>
      <div data-testid="status-badges">{statusBadge}</div>
      <div data-testid="entity-links">{links.map((l: { prefix: string; label: string }) => `${l.prefix}:${l.label}`).join(', ')}</div>
    </div>
  ),
  MetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string | number }> }) => (
    <div data-testid="metric-grid">
      {metrics.map((m) => <div key={m.label}><span>{m.label}</span><span>{String(m.value)}</span></div>)}
    </div>
  ),
  EntityDetailTabs: ({ tabs, activeTab, onTabChange, children }: {
    tabs: Array<{ id: string; label: string }>;
    activeTab: string;
    onTabChange: (id: string) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="detail-tabs">
      {tabs.map((t) => (
        <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => onTabChange(t.id)}>{t.label}</button>
      ))}
      <div data-testid="tab-content">{children}</div>
    </div>
  ),
  useTabState: (tabs: Array<{ id: string }>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const [tab, setTab] = require('react').useState(tabs[0].id);
    return [tab, setTab];
  },
}));

jest.mock('@evolution/components/evolution/EvolutionStatusBadge', () => ({
  EvolutionStatusBadge: ({ status }: { status: string }) => <span data-testid="run-status">{status}</span>,
}));

jest.mock('@evolution/components/evolution/AttributionBadge', () => ({
  AttributionBadge: ({ attribution }: { attribution: string }) => <span data-testid="attribution">{attribution}</span>,
}));

jest.mock('@evolution/components/evolution/variant/VariantContentSection', () => ({
  VariantContentSection: () => <div data-testid="content-section">Content</div>,
}));

jest.mock('@evolution/components/evolution/variant/VariantLineageSection', () => ({
  VariantLineageSection: () => <div data-testid="lineage-section">Lineage</div>,
}));

jest.mock('@evolution/components/evolution/variant/VariantMatchHistory', () => ({
  VariantMatchHistory: () => <div data-testid="match-history">Matches</div>,
}));

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (v: number) => String(v),
}));

const VARIANT = {
  runId: 'run-12345678-abcd',
  runStatus: 'completed',
  eloScore: 1450,
  agentName: 'generation',
  generation: 3,
  matchCount: 12,
  variantContent: 'Some variant text content here',
  isWinner: false,
  eloAttribution: null,
  explanationId: 42,
  explanationTitle: 'Test Explanation',
  parentVariantId: null,
};

describe('VariantDetailContent', () => {
  it('renders variant title with short id', () => {
    render(<VariantDetailContent variant={VARIANT as never} variantId="abcdef01-2345-6789-0000-000000000000" />);
    expect(screen.getByTestId('title')).toHaveTextContent('Variant abcdef01');
  });

  it('renders run status badge', () => {
    render(<VariantDetailContent variant={VARIANT as never} variantId="abcdef01-2345-6789-0000-000000000000" />);
    expect(screen.getByTestId('run-status')).toHaveTextContent('completed');
  });

  it('shows winner badge when isWinner', () => {
    render(<VariantDetailContent variant={{ ...VARIANT, isWinner: true } as never} variantId="v1" />);
    expect(screen.getByText('Winner')).toBeInTheDocument();
  });

  it('hides winner badge when not winner', () => {
    render(<VariantDetailContent variant={VARIANT as never} variantId="v1" />);
    expect(screen.queryByText('Winner')).not.toBeInTheDocument();
  });

  it('renders entity links including run and explanation', () => {
    render(<VariantDetailContent variant={VARIANT as never} variantId="v1" />);
    const links = screen.getByTestId('entity-links');
    expect(links).toHaveTextContent('Run:run-1234');
    expect(links).toHaveTextContent('Explanation:Test Explanation');
  });

  it('renders parent link when parentVariantId exists', () => {
    render(<VariantDetailContent variant={{ ...VARIANT, parentVariantId: 'parent-12345678' } as never} variantId="v1" />);
    expect(screen.getByTestId('entity-links')).toHaveTextContent('Parent:parent-1');
  });

  it('renders overview metrics', () => {
    render(<VariantDetailContent variant={VARIANT as never} variantId="v1" />);
    const grid = screen.getByTestId('metric-grid');
    expect(grid).toHaveTextContent('1450');
    expect(grid).toHaveTextContent('generation');
    expect(grid).toHaveTextContent('3');
    expect(grid).toHaveTextContent('12');
  });

  it('renders 4 tabs', () => {
    render(<VariantDetailContent variant={VARIANT as never} variantId="v1" />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Match History')).toBeInTheDocument();
    expect(screen.getByText('Lineage')).toBeInTheDocument();
  });

  it('switches to content tab', () => {
    render(<VariantDetailContent variant={VARIANT as never} variantId="v1" />);
    fireEvent.click(screen.getByText('Content'));
    expect(screen.getByTestId('content-section')).toBeInTheDocument();
  });

  it('switches to match history tab', () => {
    render(<VariantDetailContent variant={VARIANT as never} variantId="v1" />);
    fireEvent.click(screen.getByText('Match History'));
    expect(screen.getByTestId('match-history')).toBeInTheDocument();
  });
});
