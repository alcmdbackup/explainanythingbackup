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

  // Fix #29-31 (use_playwright_find_ux_issues_bugs_20260501): eloAttrDelta:* rows
  // are SIGNED Elo deltas, not currency. They MUST render via the elo formatter
  // (no $ prefix, no negative-dollar nonsense), be categorized as 'rating' not
  // 'cost', and be labelled with " Δ Elo" suffix instead of " Cost".
  describe('Fix #29-31 dynamic metric registry routing', () => {
    it('renders eloAttrDelta:* via Elo formatter (not currency)', async () => {
      getEntityMetricsAction.mockResolvedValue({
        success: true,
        data: [makeRow({
          metric_name: 'eloAttrDelta:reflect_and_generate_from_previous_article:lexical_simplify',
          value: -15,
        })],
        error: null,
      });
      render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
      await waitFor(() => expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument());
      // Must render as "-15" via formatElo, never as "$-15.000" via costDetailed.
      expect(screen.getByText('-15')).toBeInTheDocument();
      // Negative assertion: no dollar-sign rendering of the value.
      const tab = screen.getByTestId('entity-metrics-tab');
      expect(tab.textContent).not.toMatch(/\$-15/);
    });

    it('groups eloAttrDelta:* under Rating category (not Cost)', async () => {
      getEntityMetricsAction.mockResolvedValue({
        success: true,
        data: [makeRow({
          metric_name: 'eloAttrDelta:reflect_and_generate_from_previous_article:curiosity_hook',
          value: 25,
        })],
        error: null,
      });
      render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
      await waitFor(() => expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument());
      // Rating heading is present; Cost heading is not (no static cost metrics, no agentCost:*).
      expect(screen.getByText('Rating')).toBeInTheDocument();
      expect(screen.queryByText('Cost')).not.toBeInTheDocument();
    });

    it('labels eloAttrDelta:* with " Δ Elo" suffix (not " Cost")', async () => {
      getEntityMetricsAction.mockResolvedValue({
        success: true,
        data: [makeRow({
          metric_name: 'eloAttrDelta:reflect_and_generate_from_previous_article:lexical_simplify',
          value: -15,
        })],
        error: null,
      });
      render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
      await waitFor(() => expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument());
      // The label is the prettified suffix joined by " / " plus " Δ Elo".
      expect(screen.getByText(/Δ Elo/)).toBeInTheDocument();
      // No mis-suffixed " Cost" label for this row.
      const tab = screen.getByTestId('entity-metrics-tab');
      expect(tab.textContent).not.toMatch(/Reflect.* Cost/);
    });
  });

  // Fix #35 (use_playwright_find_ux_issues_bugs_20260501): reflection_cost is
  // already labeled in the metric catalog and now has listView:true. The
  // EntityMetricsTab must surface it as a Cost-section card alongside the others.
  it('renders Reflection Cost summary card when reflection_cost present', async () => {
    getEntityMetricsAction.mockResolvedValue({
      success: true,
      data: [
        makeRow({ metric_name: 'cost', value: 0.04 }),
        makeRow({ metric_name: 'reflection_cost', value: 0.012 }),
      ],
      error: null,
    });
    render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument());
    expect(screen.getByText('Reflection Cost')).toBeInTheDocument();
    expect(screen.getByText('$0.01')).toBeInTheDocument();
  });

  it('renders subagent:*.cost rows alongside generation_cost/ranking_cost (Phase 6: no agentCost: filter)', async () => {
    // rename_agents_subagents_evolution_20260508 Phase 6 removed the agentCost:* filter
    // because the prefix itself was removed. Per-subagent costs now live under
    // subagent:*.cost via the dynamic-prefix path and render alongside the static
    // *_cost rows; there is no longer a filter to test against.
    getEntityMetricsAction.mockResolvedValue({
      success: true,
      data: [
        makeRow({ metric_name: 'subagent:generation.cost', value: 0.0085 }),
        makeRow({ metric_name: 'subagent:ranking.cost', value: 0.0413 }),
        makeRow({ metric_name: 'generation_cost', value: 0.1565 }),
        makeRow({ metric_name: 'ranking_cost', value: 0.1565 }),
      ],
      error: null,
    });
    render(<EntityMetricsTab entityType="run" entityId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => {
      expect(screen.getByTestId('entity-metrics-tab')).toBeInTheDocument();
    });
    // Static *_cost names still resolve to their label-driven cards.
    expect(screen.getAllByText('Generation Cost').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Ranking Cost').length).toBeGreaterThanOrEqual(1);
  });
});
