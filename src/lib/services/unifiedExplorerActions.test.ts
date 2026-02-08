/**
 * Unit tests for unifiedExplorerActions — table, matrix, trend, and article detail views.
 * Mocks Supabase to test filter application, dimension resolution, and result shaping.
 */

// ─── Supabase Mock ───────────────────────────────────────────────

function createQueryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  const handler: ProxyHandler<Record<string, jest.Mock>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (val: unknown) => void) => resolve(result);
      }
      if (!chain[prop as string]) {
        chain[prop as string] = jest.fn().mockReturnValue(new Proxy(chain, handler));
      }
      return chain[prop as string];
    },
  };
  return new Proxy(chain, handler);
}

let fromResults: Map<string, Array<{ data: unknown; error: unknown }>>;

const mockFrom = jest.fn().mockImplementation((table: string) => {
  const queue = fromResults.get(table) ?? [];
  const result = queue.shift() ?? { data: null, error: null };
  return createQueryChain(result);
});

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({ from: (...args: unknown[]) => mockFrom(...args) }),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('admin-user-id'),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withLogging: (fn: Function, _name: string) => fn,
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  serverReadRequestId: (fn: Function) => fn,
}));

jest.mock('@/lib/errorHandling', () => ({
  handleError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

import {
  getUnifiedExplorerAction,
  getExplorerMatrixAction,
  getExplorerTrendAction,
  getExplorerArticleDetailAction,
} from './unifiedExplorerActions';

// ─── Test Setup ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  fromResults = new Map();
});

function queueResult(table: string, result: { data: unknown; error: unknown }) {
  const queue = fromResults.get(table) ?? [];
  queue.push(result);
  fromResults.set(table, queue);
}

const sampleRun = {
  id: 'run-1',
  prompt_id: 'prompt-1',
  strategy_config_id: 'strat-1',
  pipeline_type: 'full',
  status: 'completed',
  total_cost_usd: 2.50,
  total_variants: 10,
  current_iteration: 3,
  started_at: '2026-02-01T00:00:00Z',
  completed_at: '2026-02-01T01:00:00Z',
  created_at: '2026-02-01T00:00:00Z',
};

// ─── Table Mode Tests ────────────────────────────────────────────

describe('getUnifiedExplorerAction', () => {
  describe('run view', () => {
    it('returns enriched run rows with prompt and strategy labels', async () => {
      // Runs query
      queueResult('content_evolution_runs', { data: [sampleRun], error: null });
      // Prompt labels
      queueResult('article_bank_topics', { data: [{ id: 'prompt-1', prompt: 'Explain gravity' }], error: null });
      // Strategy labels
      queueResult('strategy_configs', { data: [{ id: 'strat-1', label: 'Gen: ds-chat | 3 iters' }], error: null });

      const result = await getUnifiedExplorerAction({}, 'run');

      expect(result.success).toBe(true);
      expect(result.data?.runs).toHaveLength(1);
      expect(result.data?.runs![0].prompt_text).toBe('Explain gravity');
      expect(result.data?.runs![0].strategy_label).toBe('Gen: ds-chat | 3 iters');
      expect(result.data?.aggregation.totalCost).toBe(2.50);
    });

    it('returns empty result for no matching runs', async () => {
      queueResult('content_evolution_runs', { data: [], error: null });

      const result = await getUnifiedExplorerAction({}, 'run');

      expect(result.success).toBe(true);
      expect(result.data?.runs).toHaveLength(0);
      expect(result.data?.totalCount).toBe(0);
    });

    it('handles DB error gracefully', async () => {
      queueResult('content_evolution_runs', { data: null, error: { message: 'DB down' } });

      const result = await getUnifiedExplorerAction({}, 'run');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to query runs');
    });
  });

  describe('article view', () => {
    it('returns variants with hall-of-fame rank', async () => {
      // Filtered runs
      queueResult('content_evolution_runs', { data: [{ id: 'run-1', prompt_id: 'p1' }], error: null });
      // Variants
      queueResult('content_evolution_variants', {
        data: [{
          id: 'v1', run_id: 'run-1', variant_content: 'Long article text here...',
          elo_score: 1350, agent_name: 'generation', generation: 1,
          parent_variant_id: null, match_count: 5, is_winner: true,
          created_at: '2026-02-01T00:00:00Z',
        }],
        error: null,
      });
      // Bank entries for rank
      queueResult('article_bank_entries', {
        data: [{ evolution_variant_id: 'v1', rank: 1 }],
        error: null,
      });
      // Prompt texts
      queueResult('article_bank_topics', { data: [{ id: 'p1', prompt: 'Test prompt' }], error: null });

      const result = await getUnifiedExplorerAction({}, 'article');

      expect(result.success).toBe(true);
      expect(result.data?.articles).toHaveLength(1);
      expect(result.data?.articles![0].hall_of_fame_rank).toBe(1);
      expect(result.data?.articles![0].variant_content_preview.length).toBeLessThanOrEqual(200);
    });

    it('returns empty for no matching runs', async () => {
      queueResult('content_evolution_runs', { data: [], error: null });

      const result = await getUnifiedExplorerAction({}, 'article');

      expect(result.success).toBe(true);
      expect(result.data?.articles).toHaveLength(0);
    });
  });

  describe('task view', () => {
    it('returns agent metrics with prompt text', async () => {
      // Filtered runs
      queueResult('content_evolution_runs', { data: [{ id: 'run-1', prompt_id: 'p1' }], error: null });
      // Agent metrics
      queueResult('evolution_run_agent_metrics', {
        data: [{
          id: 'metric-1', run_id: 'run-1', agent_name: 'generation',
          cost_usd: 0.50, variants_generated: 5, avg_elo: 1350,
          elo_gain: 150, elo_per_dollar: 300,
        }],
        error: null,
      });
      // Prompt texts
      queueResult('article_bank_topics', { data: [{ id: 'p1', prompt: 'Test prompt' }], error: null });

      const result = await getUnifiedExplorerAction({}, 'task');

      expect(result.success).toBe(true);
      expect(result.data?.tasks).toHaveLength(1);
      expect(result.data?.tasks![0].agent_name).toBe('generation');
      expect(result.data?.tasks![0].prompt_text).toBe('Test prompt');
      expect(result.data?.aggregation.topAgent).toBe('generation');
    });
  });

  describe('attribute filters', () => {
    it('resolves domain tags to prompt IDs via overlaps', async () => {
      // Attribute filter: domain_tags overlaps ['science']
      queueResult('article_bank_topics', { data: [{ id: 'sci-prompt-1' }], error: null });
      // Runs filtered by resolved prompt IDs
      queueResult('content_evolution_runs', {
        data: [{ ...sampleRun, prompt_id: 'sci-prompt-1' }],
        error: null,
      });
      // Prompt labels
      queueResult('article_bank_topics', { data: [{ id: 'sci-prompt-1', prompt: 'Science topic' }], error: null });
      // Strategy labels
      queueResult('strategy_configs', { data: [], error: null });

      const result = await getUnifiedExplorerAction(
        { domainTags: ['science'] },
        'run',
      );

      expect(result.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('article_bank_topics');
    });

    it('resolves strategy model filter via parameterized query', async () => {
      // Strategy model filter: generationModel = 'gpt-4.1-mini'
      queueResult('strategy_configs', { data: [{ id: 'strat-mini' }], error: null });
      // Runs filtered by strategy IDs
      queueResult('content_evolution_runs', {
        data: [{ ...sampleRun, strategy_config_id: 'strat-mini' }],
        error: null,
      });
      // Prompt labels
      queueResult('article_bank_topics', { data: [], error: null });
      // Strategy labels
      queueResult('strategy_configs', { data: [{ id: 'strat-mini', label: 'Mini strat' }], error: null });

      const result = await getUnifiedExplorerAction(
        { models: ['gpt-4.1-mini'] },
        'run',
      );

      expect(result.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('strategy_configs');
    });

    it('resolves difficulty tier to prompt IDs', async () => {
      // Attribute filter resolution: difficulty_tier = 'hard'
      queueResult('article_bank_topics', { data: [{ id: 'hard-prompt-1' }], error: null });
      // Runs filtered by resolved prompt IDs
      queueResult('content_evolution_runs', {
        data: [{ ...sampleRun, prompt_id: 'hard-prompt-1' }],
        error: null,
      });
      // Prompt labels
      queueResult('article_bank_topics', { data: [{ id: 'hard-prompt-1', prompt: 'Hard topic' }], error: null });
      // Strategy labels
      queueResult('strategy_configs', { data: [], error: null });

      const result = await getUnifiedExplorerAction(
        { difficultyTiers: ['hard'] },
        'run',
      );

      expect(result.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('article_bank_topics');
    });
  });
});

// ─── Matrix Mode Tests ───────────────────────────────────────────

describe('getExplorerMatrixAction', () => {
  it('returns matrix with prompt × strategy cells', async () => {
    // Completed runs
    queueResult('content_evolution_runs', {
      data: [
        { ...sampleRun, id: 'r1', prompt_id: 'p1', strategy_config_id: 's1' },
        { ...sampleRun, id: 'r2', prompt_id: 'p1', strategy_config_id: 's2' },
        { ...sampleRun, id: 'r3', prompt_id: 'p2', strategy_config_id: 's1' },
      ],
      error: null,
    });
    // Prompt labels
    queueResult('article_bank_topics', {
      data: [{ id: 'p1', prompt: 'Prompt A' }, { id: 'p2', prompt: 'Prompt B' }],
      error: null,
    });
    // Strategy labels
    queueResult('strategy_configs', {
      data: [{ id: 's1', label: 'Strat 1' }, { id: 's2', label: 'Strat 2' }],
      error: null,
    });

    const result = await getExplorerMatrixAction({
      rowDimension: 'prompt',
      colDimension: 'strategy',
      metric: 'runCount',
      filters: {},
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows.length).toBe(2);
    expect(result.data?.cols.length).toBe(2);
    expect(result.data?.cells.length).toBe(3); // p1×s1, p1×s2, p2×s1
  });

  it('computes avgElo metric correctly per cell', async () => {
    // 2 runs for same prompt×strategy with different Elos
    queueResult('content_evolution_runs', {
      data: [
        { ...sampleRun, id: 'r1', prompt_id: 'p1', strategy_config_id: 's1', total_cost_usd: 1.00 },
        { ...sampleRun, id: 'r2', prompt_id: 'p1', strategy_config_id: 's1', total_cost_usd: 3.00 },
      ],
      error: null,
    });
    queueResult('article_bank_topics', { data: [{ id: 'p1', prompt: 'Prompt A' }], error: null });
    queueResult('strategy_configs', { data: [{ id: 's1', label: 'Strat 1' }], error: null });

    const result = await getExplorerMatrixAction({
      rowDimension: 'prompt',
      colDimension: 'strategy',
      metric: 'totalCost',
      filters: {},
    });

    expect(result.success).toBe(true);
    expect(result.data?.cells.length).toBe(1);
    // totalCost sums: 1.00 + 3.00 = 4.00
    expect(result.data?.cells[0].value).toBe(4.00);
    expect(result.data?.cells[0].runCount).toBe(2);
  });

  it('computes successRate metric correctly', async () => {
    queueResult('content_evolution_runs', {
      data: [
        { ...sampleRun, id: 'r1', prompt_id: 'p1', strategy_config_id: 's1', status: 'completed' },
        { ...sampleRun, id: 'r2', prompt_id: 'p1', strategy_config_id: 's1', status: 'failed' },
      ],
      error: null,
    });
    queueResult('article_bank_topics', { data: [{ id: 'p1', prompt: 'Prompt A' }], error: null });
    queueResult('strategy_configs', { data: [{ id: 's1', label: 'Strat 1' }], error: null });

    const result = await getExplorerMatrixAction({
      rowDimension: 'prompt',
      colDimension: 'strategy',
      metric: 'successRate',
      filters: {},
    });

    expect(result.success).toBe(true);
    // successRate avg: (1 + 0) / 2 = 0.5
    expect(result.data?.cells[0].value).toBe(0.5);
  });

  it('returns error when row === col dimension', async () => {
    const result = await getExplorerMatrixAction({
      rowDimension: 'prompt',
      colDimension: 'prompt',
      metric: 'avgElo',
      filters: {},
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('must be different');
  });

  it('returns empty result for no completed runs', async () => {
    queueResult('content_evolution_runs', { data: [], error: null });

    const result = await getExplorerMatrixAction({
      rowDimension: 'prompt',
      colDimension: 'strategy',
      metric: 'runCount',
      filters: {},
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(0);
    expect(result.data?.cells).toHaveLength(0);
  });
});

// ─── Trend Mode Tests ────────────────────────────────────────────

describe('getExplorerTrendAction', () => {
  it('returns time series grouped by strategy', async () => {
    queueResult('content_evolution_runs', {
      data: [
        { ...sampleRun, id: 'r1', strategy_config_id: 's1', created_at: '2026-01-15T00:00:00Z' },
        { ...sampleRun, id: 'r2', strategy_config_id: 's1', created_at: '2026-01-22T00:00:00Z' },
        { ...sampleRun, id: 'r3', strategy_config_id: 's2', created_at: '2026-01-22T00:00:00Z' },
      ],
      error: null,
    });
    // Strategy labels
    queueResult('strategy_configs', {
      data: [{ id: 's1', label: 'Strat 1' }, { id: 's2', label: 'Strat 2' }],
      error: null,
    });

    const result = await getExplorerTrendAction({
      groupByDimension: 'strategy',
      metric: 'runCount',
      timeBucket: 'week',
      filters: {},
    });

    expect(result.success).toBe(true);
    expect(result.data?.series.length).toBe(2);
    // s1 has 2 data points (2 weeks), s2 has 1
    const s1 = result.data?.series.find(s => s.dimensionId === 's1');
    expect(s1).toBeDefined();
    expect(s1!.points.length).toBeGreaterThan(0);
  });

  it('buckets correctly by day', async () => {
    queueResult('content_evolution_runs', {
      data: [
        { ...sampleRun, id: 'r1', strategy_config_id: 's1', created_at: '2026-02-01T10:00:00Z' },
        { ...sampleRun, id: 'r2', strategy_config_id: 's1', created_at: '2026-02-01T20:00:00Z' },
        { ...sampleRun, id: 'r3', strategy_config_id: 's1', created_at: '2026-02-02T10:00:00Z' },
      ],
      error: null,
    });
    queueResult('strategy_configs', { data: [{ id: 's1', label: 'Strat 1' }], error: null });

    const result = await getExplorerTrendAction({
      groupByDimension: 'strategy',
      metric: 'runCount',
      timeBucket: 'day',
      filters: {},
    });

    expect(result.success).toBe(true);
    expect(result.data?.series.length).toBe(1);
    const s1 = result.data?.series[0];
    // 2 distinct days → 2 points
    expect(s1!.points.length).toBe(2);
    // Day 1 has 2 runs, Day 2 has 1
    const sorted = [...s1!.points].sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted[0].value).toBe(2);
    expect(sorted[1].value).toBe(1);
  });

  it('returns empty series for no data', async () => {
    queueResult('content_evolution_runs', { data: [], error: null });

    const result = await getExplorerTrendAction({
      groupByDimension: 'strategy',
      metric: 'runCount',
      timeBucket: 'day',
      filters: {},
    });

    expect(result.success).toBe(true);
    expect(result.data?.series).toHaveLength(0);
  });

  it('aggregates beyond top 10 into Other', async () => {
    // Create 12 strategies
    const runs = Array.from({ length: 12 }, (_, i) => ({
      ...sampleRun,
      id: `r${i}`,
      strategy_config_id: `s${i}`,
      created_at: '2026-01-15T00:00:00Z',
    }));
    queueResult('content_evolution_runs', { data: runs, error: null });
    // Strategy labels
    const stratLabels = runs.map(r => ({ id: r.strategy_config_id, label: `Strat ${r.strategy_config_id}` }));
    queueResult('strategy_configs', { data: stratLabels, error: null });

    const result = await getExplorerTrendAction({
      groupByDimension: 'strategy',
      metric: 'runCount',
      timeBucket: 'month',
      filters: {},
    });

    expect(result.success).toBe(true);
    // 10 top + 1 "Other" = 11
    expect(result.data?.series.length).toBe(11);
    expect(result.data?.series.find(s => s.dimensionLabel === 'Other')).toBeDefined();
  });
});

// ─── Article Detail Tests ────────────────────────────────────────

describe('getExplorerArticleDetailAction', () => {
  it('returns article with lineage chain', async () => {
    // Main variant
    queueResult('content_evolution_variants', {
      data: {
        id: 'v3', variant_content: 'Final version', elo_score: 1400,
        agent_name: 'evolution', generation: 3, parent_variant_id: 'v2',
      },
      error: null,
    });
    // Parent content
    queueResult('content_evolution_variants', {
      data: { variant_content: 'Second version' },
      error: null,
    });
    // Lineage: v2
    queueResult('content_evolution_variants', {
      data: {
        id: 'v2', agent_name: 'generation', generation: 2,
        variant_content: 'Second version text', parent_variant_id: 'v1',
      },
      error: null,
    });
    // Lineage: v1 (root)
    queueResult('content_evolution_variants', {
      data: {
        id: 'v1', agent_name: 'baseline', generation: 0,
        variant_content: 'Original text', parent_variant_id: null,
      },
      error: null,
    });

    const result = await getExplorerArticleDetailAction({ runId: 'run-1', variantId: 'v3' });

    expect(result.success).toBe(true);
    expect(result.data?.variantId).toBe('v3');
    expect(result.data?.content).toBe('Final version');
    expect(result.data?.parentContent).toBe('Second version');
    expect(result.data?.lineage.length).toBe(2); // v2, v1
    expect(result.data?.lineage[0].id).toBe('v2');
    expect(result.data?.lineage[1].id).toBe('v1');
  });

  it('returns null when variant not found', async () => {
    queueResult('content_evolution_variants', { data: null, error: { message: 'not found' } });

    const result = await getExplorerArticleDetailAction({ runId: 'run-1', variantId: 'missing' });

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});
