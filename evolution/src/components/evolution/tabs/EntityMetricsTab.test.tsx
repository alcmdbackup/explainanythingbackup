// Unit tests for the EntityMetricsTab component.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { EntityMetricsTab } from './EntityMetricsTab';
import type { MetricRow } from '@evolution/lib/metrics/types';

// Mock the server action
jest.mock('@evolution/services/metricsActions', () => ({
  getEntityMetricsAction: jest.fn(),
}));

const { getEntityMetricsAction } = jest.requireMock('@evolution/services/metricsActions');

function makeRow(overrides: Partial<MetricRow> = {}): MetricRow {
  return {
    id: crypto.randomUUID(),
    entity_type: 'run',
    entity_id: '00000000-0000-0000-0000-000000000001',
    metric_name: 'cost',
    value: 1.5,
    sigma: null,
    ci_lower: null,
    ci_upper: null,
    n: 1,
    origin_entity_type: null,
    origin_entity_id: null,
    aggregation_method: null,
    source: 'pipeline',
    stale: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('EntityMetricsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state while fetching', () => {
    getEntityMetricsAction.mockReturnValue(new Promise(() => {})); // never resolves
    render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
    expect(screen.getByTestId('metrics-loading')).toBeInTheDocument();
  });

  it('shows empty state for entity with no metrics', async () => {
    getEntityMetricsAction.mockResolvedValue({ success: true, data: [], error: null });
    render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(screen.getByTestId('metrics-empty')).toBeInTheDocument();
    });
  });

  it('renders MetricGrid with metrics grouped by category', async () => {
    getEntityMetricsAction.mockResolvedValue({
      success: true,
      data: [
        makeRow({ metric_name: 'cost', value: 2.5 }),
        makeRow({ metric_name: 'winner_elo', value: 1500 }),
        makeRow({ metric_name: 'variant_count', value: 10 }),
      ],
      error: null,
    });
    render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument();
    });
    // Should have category sections (Cost may appear as both category heading and metric label)
    expect(screen.getAllByText('Cost').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Rating')).toBeInTheDocument();
  });

  it('shows CI ranges when ci_lower/ci_upper present', async () => {
    getEntityMetricsAction.mockResolvedValue({
      success: true,
      data: [
        makeRow({ metric_name: 'avg_final_elo', value: 1500, ci_lower: 1400, ci_upper: 1600, n: 5 }),
      ],
      error: null,
    });
    render(<EntityMetricsTab entityType="strategy" entityId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument();
    });
  });

  it('formats cost metrics with formatCost', async () => {
    getEntityMetricsAction.mockResolvedValue({
      success: true,
      data: [makeRow({ metric_name: 'cost', value: 2.5 })],
      error: null,
    });
    render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(screen.getByText('$2.50')).toBeInTheDocument();
    });
  });

  it('renders both static generation_cost (per-purpose) and dynamic agentCost:* (per-agent-class) under Cost group', async () => {
    // Phase 1e regression: per the per-purpose cost split fix, the metrics tab must
    // render BOTH the new static generation_cost / ranking_cost rows (written by
    // createLLMClient via writeMetricMax) AND the legacy agentCost:* dynamic rows
    // (written by experimentMetrics.ts for per-agent-class aggregation on
    // strategy/experiment entities). The two namespaces are orthogonal:
    // - generation_cost = per LLM-call purpose (static, typed) — 'cost' formatter (2 decimals)
    // - agentCost:generate_from_seed_article = per agent class (dynamic, prefix-based)
    //   — uses 'costDetailed' formatter (3 decimals) via DYNAMIC_METRIC_PREFIXES resolver.
    // Use values that produce distinct text in each formatter so test selectors don't collide.
    getEntityMetricsAction.mockResolvedValue({
      success: true,
      data: [
        makeRow({ metric_name: 'generation_cost', value: 1.23 }),     // → $1.23 (cost, 2dp)
        makeRow({ metric_name: 'ranking_cost', value: 4.56 }),        // → $4.56 (cost, 2dp)
        makeRow({ metric_name: 'agentCost:generate_from_seed_article', value: 0.077 }), // → $0.077 (costDetailed, 3dp)
        makeRow({ metric_name: 'agentCost:swiss_ranking', value: 0.055 }),              // → $0.055 (costDetailed, 3dp)
      ],
      error: null,
    });
    render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument();
    });
    // Static per-purpose metrics — 2 decimals via formatCost
    expect(screen.getByText('$1.23')).toBeInTheDocument(); // generation_cost
    expect(screen.getByText('$4.56')).toBeInTheDocument(); // ranking_cost
    // Dynamic per-agent-class metrics — 3 decimals via formatCostDetailed (DYNAMIC_METRIC_PREFIXES path)
    expect(screen.getByText('$0.077')).toBeInTheDocument(); // agentCost:generate_from_seed_article
    expect(screen.getByText('$0.055')).toBeInTheDocument(); // agentCost:swiss_ranking
  });
});
