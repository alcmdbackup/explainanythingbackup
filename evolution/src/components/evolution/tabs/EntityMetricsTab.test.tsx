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
    uncertainty: null,
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

  it('filters out agentCost:* metrics, keeping generation_cost/ranking_cost', async () => {
    // Run-level per-purpose cost metrics are named generation_cost/ranking_cost (label: "Generation Cost"/"Ranking Cost")
    // agentCost:* are legacy per-phase metrics that should be hidden from the UI
    getEntityMetricsAction.mockResolvedValue({
      success: true,
      data: [
        makeRow({ metric_name: 'agentCost:generation', value: 0.0085 }),
        makeRow({ metric_name: 'agentCost:ranking', value: 0.0413 }),
        makeRow({ metric_name: 'generation_cost', value: 0.1565 }),
        makeRow({ metric_name: 'ranking_cost', value: 0.1565 }),
      ],
      error: null,
    });
    render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument();
    });
    // generation_cost and ranking_cost render as "Generation Cost" / "Ranking Cost"
    // agentCost:* are filtered out so there should be exactly one card per label
    const generationCells = screen.getAllByText('Generation Cost');
    expect(generationCells).toHaveLength(1);
    const rankingCells = screen.getAllByText('Ranking Cost');
    expect(rankingCells).toHaveLength(1);
  });
});
