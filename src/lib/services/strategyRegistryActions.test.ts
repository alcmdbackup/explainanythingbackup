/**
 * Unit tests for strategyRegistryActions CRUD operations.
 * Mocks Supabase and adminAuth — verifies action logic without hitting DB.
 */

// ─── Supabase Mock ───────────────────────────────────────────────

/** Build a chainable Supabase-like mock that resolves to the given result at the end. */
function createQueryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  const handler: ProxyHandler<Record<string, jest.Mock>> = {
    get(_target, prop) {
      if (prop === 'then') {
        // Make the chain thenable — resolves like a Supabase query
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

// Import after mocks
import {
  getStrategiesAction,
  getStrategyDetailAction,
  createStrategyAction,
  updateStrategyAction,
  cloneStrategyAction,
  archiveStrategyAction,
  deleteStrategyAction,
  getStrategyPresetsAction,
  getStrategyPresets,
} from './strategyRegistryActions';

// ─── Test Setup ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  fromResults = new Map();
});

/** Helper: queue Supabase result for a table. Multiple calls queue multiple results. */
function queueResult(table: string, result: { data: unknown; error: unknown }) {
  const queue = fromResults.get(table) ?? [];
  queue.push(result);
  fromResults.set(table, queue);
}

const sampleRow = {
  id: 's1',
  config_hash: 'abc123def456',
  name: 'Test Strategy',
  description: null,
  label: 'Gen: ds-chat | Judge: 4.1-nano | 3 iters',
  config: {
    generationModel: 'deepseek-chat',
    judgeModel: 'gpt-4.1-nano',
    iterations: 3,
    budgetCaps: { generation: 0.30, calibration: 0.30, tournament: 0.40 },
  },
  is_predefined: true,
  pipeline_type: 'full',
  status: 'active',
  created_by: 'admin',
  run_count: 5,
  total_cost_usd: 2.50,
  avg_final_elo: 1350,
  avg_elo_per_dollar: 60,
  best_final_elo: 1500,
  worst_final_elo: 1200,
  stddev_final_elo: 75,
  first_used_at: '2026-01-01T00:00:00Z',
  last_used_at: '2026-02-07T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
};

// ─── Tests ───────────────────────────────────────────────────────

describe('strategyRegistryActions', () => {
  describe('getStrategiesAction', () => {
    it('returns strategies with normalized fields', async () => {
      queueResult('strategy_configs', {
        data: [{ ...sampleRow, status: null, created_by: null }],
        error: null,
      });

      const result = await getStrategiesAction();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].status).toBe('active');
      expect(result.data![0].created_by).toBe('system');
      expect(mockFrom).toHaveBeenCalledWith('strategy_configs');
    });

    it('applies status filter', async () => {
      queueResult('strategy_configs', { data: [sampleRow], error: null });

      const result = await getStrategiesAction({ status: 'active' });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('returns error on DB failure', async () => {
      queueResult('strategy_configs', { data: null, error: { message: 'DB down' } });

      const result = await getStrategiesAction();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to fetch');
    });
  });

  describe('getStrategyDetailAction', () => {
    it('returns a single strategy with normalized fields', async () => {
      queueResult('strategy_configs', {
        data: { ...sampleRow, status: null, created_by: null },
        error: null,
      });

      const result = await getStrategyDetailAction('s1');

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('active');
      expect(result.data?.created_by).toBe('system');
    });

    it('returns error when not found', async () => {
      queueResult('strategy_configs', { data: null, error: { message: 'not found' } });

      const result = await getStrategyDetailAction('missing');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Strategy not found');
    });
  });

  describe('createStrategyAction', () => {
    it('creates a new strategy when no hash match exists', async () => {
      // Hash check: no match
      queueResult('strategy_configs', { data: null, error: null });
      // Insert returns new row
      queueResult('strategy_configs', { data: sampleRow, error: null });

      const result = await createStrategyAction({
        name: 'Test Strategy',
        config: sampleRow.config,
        pipelineType: 'full',
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Test Strategy');
    });

    it('promotes existing auto-created strategy when hash matches', async () => {
      // Hash check: existing auto-created strategy found
      queueResult('strategy_configs', {
        data: { ...sampleRow, is_predefined: false, created_by: 'system' },
        error: null,
      });
      // Update (promote) returns updated row
      queueResult('strategy_configs', {
        data: { ...sampleRow, is_predefined: true, created_by: 'admin', name: 'Promoted' },
        error: null,
      });

      const result = await createStrategyAction({
        name: 'Promoted',
        config: sampleRow.config,
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Promoted');
    });

    it('returns error on insert failure', async () => {
      queueResult('strategy_configs', { data: null, error: null }); // hash check
      queueResult('strategy_configs', { data: null, error: { message: 'insert failed' } }); // insert

      const result = await createStrategyAction({
        name: 'Fail',
        config: sampleRow.config,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to create');
    });
  });

  describe('updateStrategyAction', () => {
    it('updates metadata in place when no config change', async () => {
      // Fetch current
      queueResult('strategy_configs', { data: { ...sampleRow }, error: null });
      // Update returns updated row
      queueResult('strategy_configs', {
        data: { ...sampleRow, name: 'Renamed', description: 'New desc' },
        error: null,
      });

      const result = await updateStrategyAction({
        id: 's1',
        name: 'Renamed',
        description: 'New desc',
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Renamed');
    });

    it('rejects editing non-predefined strategy', async () => {
      queueResult('strategy_configs', {
        data: { ...sampleRow, is_predefined: false },
        error: null,
      });

      const result = await updateStrategyAction({ id: 's1', name: 'Nope' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Only predefined');
    });

    it('returns error when strategy not found', async () => {
      queueResult('strategy_configs', { data: null, error: { message: 'not found' } });

      const result = await updateStrategyAction({ id: 'missing', name: 'Nope' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Strategy not found');
    });

    it('creates new version when config changed and strategy has runs', async () => {
      const newConfig = { ...sampleRow.config, iterations: 5 };
      // Fetch current (has runs)
      queueResult('strategy_configs', { data: { ...sampleRow, run_count: 3 }, error: null });
      // Hash collision check (no collision)
      queueResult('strategy_configs', { data: null, error: null });
      // Archive old → success
      queueResult('strategy_configs', { data: null, error: null });
      // Create new (hash check in createStrategyAction — no match)
      queueResult('strategy_configs', { data: null, error: null });
      // Insert new row
      queueResult('strategy_configs', {
        data: { ...sampleRow, id: 'new-version', config: newConfig },
        error: null,
      });

      const result = await updateStrategyAction({ id: 's1', config: newConfig });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('new-version');
    });

    it('updates config in place when zero runs', async () => {
      const newConfig = { ...sampleRow.config, iterations: 10 };
      // Fetch current (zero runs)
      queueResult('strategy_configs', {
        data: { ...sampleRow, run_count: 0 },
        error: null,
      });
      // Hash collision check (no collision)
      queueResult('strategy_configs', { data: null, error: null });
      // Update returns updated row
      queueResult('strategy_configs', {
        data: { ...sampleRow, config: newConfig },
        error: null,
      });

      const result = await updateStrategyAction({ id: 's1', config: newConfig });

      expect(result.success).toBe(true);
    });

    it('rejects config change on hash collision with another row', async () => {
      const newConfig = { ...sampleRow.config, iterations: 7 };
      // Fetch current
      queueResult('strategy_configs', { data: { ...sampleRow, run_count: 0 }, error: null });
      // Hash collision check: collides with another row
      queueResult('strategy_configs', { data: { id: 'other-strat' }, error: null });

      const result = await updateStrategyAction({ id: 's1', config: newConfig });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('hash collision');
    });

    it('returns current data unchanged when no fields provided', async () => {
      queueResult('strategy_configs', { data: { ...sampleRow }, error: null });

      const result = await updateStrategyAction({ id: 's1' });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('s1');
    });
  });

  describe('cloneStrategyAction', () => {
    it('clones an existing strategy', async () => {
      // Fetch source
      queueResult('strategy_configs', {
        data: { config: sampleRow.config, pipeline_type: 'full' },
        error: null,
      });
      // Hash check in create (no match)
      queueResult('strategy_configs', { data: null, error: null });
      // Insert returns new row
      queueResult('strategy_configs', {
        data: { ...sampleRow, id: 'clone-1', name: 'Cloned' },
        error: null,
      });

      const result = await cloneStrategyAction({
        sourceId: 's1',
        name: 'Cloned',
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Cloned');
    });

    it('returns error when source not found', async () => {
      queueResult('strategy_configs', { data: null, error: { message: 'not found' } });

      const result = await cloneStrategyAction({
        sourceId: 'missing',
        name: 'Clone',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Source strategy not found');
    });
  });

  describe('archiveStrategyAction', () => {
    it('archives a predefined strategy', async () => {
      // Guard check: is_predefined = true
      queueResult('strategy_configs', { data: { is_predefined: true }, error: null });
      // Update
      queueResult('strategy_configs', { error: null, data: null });

      const result = await archiveStrategyAction('s1');

      expect(result.success).toBe(true);
      expect(result.data?.archived).toBe(true);
    });

    it('rejects archiving non-predefined strategy', async () => {
      queueResult('strategy_configs', { data: { is_predefined: false }, error: null });

      const result = await archiveStrategyAction('s1');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Only predefined');
    });
  });

  describe('deleteStrategyAction', () => {
    it('deletes a predefined strategy with zero runs', async () => {
      // Guard check
      queueResult('strategy_configs', { data: { is_predefined: true, run_count: 0 }, error: null });
      // Delete
      queueResult('strategy_configs', { error: null, data: null });

      const result = await deleteStrategyAction('s1');

      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(true);
    });

    it('rejects deletion of strategy with runs', async () => {
      queueResult('strategy_configs', { data: { is_predefined: true, run_count: 3 }, error: null });

      const result = await deleteStrategyAction('s1');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Cannot delete');
    });

    it('rejects deletion of non-predefined strategy', async () => {
      queueResult('strategy_configs', { data: { is_predefined: false, run_count: 0 }, error: null });

      const result = await deleteStrategyAction('s1');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Only predefined');
    });
  });

  describe('getStrategyPresets', () => {
    it('returns 3 presets', async () => {
      const presets = await getStrategyPresets();

      expect(presets).toHaveLength(3);
      expect(presets.map(p => p.name)).toEqual(['Economy', 'Balanced', 'Quality']);
    });

    it('each preset has required fields', async () => {
      const presets = await getStrategyPresets();

      for (const preset of presets) {
        expect(preset.config.generationModel).toBeDefined();
        expect(preset.config.judgeModel).toBeDefined();
        expect(preset.config.iterations).toBeGreaterThan(0);
        expect(preset.config.budgetCaps).toBeDefined();
        expect(preset.pipelineType).toBeDefined();
      }
    });
  });

  describe('getStrategyPresetsAction', () => {
    it('returns presets via server action', async () => {
      const result = await getStrategyPresetsAction();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
    });
  });
});
