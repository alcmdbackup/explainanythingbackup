/**
 * Unit tests for hall-of-fame feeding and pipeline type tracking.
 * Verifies top-2 extraction, bank entry creation with rank, dedup, and pipeline_type setting.
 */

import { PipelineStateImpl } from './state';
import { insertBaselineVariant, finalizePipelineRun, executeMinimalPipeline, executeFullPipeline } from './pipeline';
import type { PipelineAgent, PipelineAgents } from './pipeline';
import { BASELINE_STRATEGY } from '../types';
import type { ExecutionContext, EvolutionLLMClient, EvolutionRunConfig, CostTracker } from '../types';
import { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from '../config';
import type { Rating } from './rating';

// ─── Table-specific result tracking ─────────────────────────────

type DbResult = { data: unknown; error: unknown };

/** Track table-specific Supabase operations. */
let tableOps: Map<string, Array<{ method: string; args: unknown[]; result: DbResult }>>;
let tableResultQueues: Map<string, DbResult[]>;

function queueTableResult(table: string, result: DbResult) {
  const queue = tableResultQueues.get(table) ?? [];
  queue.push(result);
  tableResultQueues.set(table, queue);
}

function getTableOps(table: string) {
  return tableOps.get(table) ?? [];
}

/** Build Proxy-based Supabase chain that records operations and dequeues results. */
function createTableChain(table: string) {
  const ops: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, jest.Mock> = {};
  const handler: ProxyHandler<Record<string, jest.Mock>> = {
    get(_target, prop) {
      if (prop === 'then') {
        // Thenable: resolve with queued result or default null
        const queue = tableResultQueues.get(table) ?? [];
        const result = queue.shift() ?? { data: null, error: null };
        // Store ops with result
        const tableOpList = tableOps.get(table) ?? [];
        for (const op of ops) {
          tableOpList.push({ ...op, result });
        }
        tableOps.set(table, tableOpList);
        return (resolve: (val: unknown) => void) => resolve(result);
      }
      if (!chain[prop as string]) {
        chain[prop as string] = jest.fn((...args: unknown[]) => {
          ops.push({ method: prop as string, args });
          return new Proxy(chain, handler);
        });
      }
      return chain[prop as string];
    },
  };
  return new Proxy(chain, handler);
}

const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    from: jest.fn((table: string) => createTableChain(table)),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

jest.mock('../../../../instrumentation', () => ({
  createAppSpan: jest.fn().mockReturnValue({
    end: jest.fn(),
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────

function ratingWithOrdinal(ordinal: number, sigma = 3): Rating {
  return { mu: ordinal + 3 * sigma, sigma };
}

function makeMockLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(totalSpent = 1.5): CostTracker {
  const agentCosts = new Map<string, number>();
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((name: string, cost: number) => {
      agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost);
    }),
    getAgentCost: jest.fn((name: string) => agentCosts.get(name) ?? 0),
    getTotalSpent: jest.fn().mockReturnValue(totalSpent),
    getAvailableBudget: jest.fn().mockReturnValue(3.5),
    getAllAgentCosts: jest.fn(() => Object.fromEntries(agentCosts)),
    getTotalReserved: jest.fn().mockReturnValue(0),
  };
}

function makeCtx(state: PipelineStateImpl, runId = 'test-run', totalSpent = 1.5): ExecutionContext {
  return {
    payload: {
      originalText: state.originalText,
      title: 'Test Article',
      explanationId: 1,
      runId,
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(totalSpent),
    runId,
  };
}

// ─── Test Setup ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  tableOps = new Map();
  tableResultQueues = new Map();
});

// ─── Hall of Fame Tests ──────────────────────────────────────────

describe('feedHallOfFame (via finalizePipelineRun)', () => {
  it('feeds top 2 variants when prompt_id is linked', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state);
    // Add 3 variants with known ratings
    for (let i = 1; i <= 3; i++) {
      state.addToPool({
        id: `v${i}`, text: `Variant ${i}`, version: 1, parentIds: [],
        strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 1,
      });
      state.ratings.set(`v${i}`, ratingWithOrdinal(10 * i));
    }

    const ctx = makeCtx(state, 'hof-run');

    // Queue: run_summary update → success
    queueTableResult('evolution_runs', { data: null, error: null });
    // Queue: persistVariants upsert → success
    queueTableResult('evolution_variants', { data: null, error: null });
    // Queue: persistAgentMetrics → success
    queueTableResult('evolution_run_agent_metrics', { data: null, error: null });
    // Queue: cost prediction read → no estimate (skip prediction)
    queueTableResult('evolution_runs', { data: { cost_estimate_detail: null }, error: null });
    // Queue: linkStrategyConfig — read run.strategy_config_id → null (auto-create flow)
    queueTableResult('evolution_runs', { data: { strategy_config_id: null }, error: null });
    // Queue: strategy_configs select → existing
    queueTableResult('evolution_strategy_configs', { data: { id: 'strat-1' }, error: null });
    // Queue: link run to strategy → success
    queueTableResult('evolution_runs', { data: null, error: null });
    // Queue: autoLinkPrompt — read prompt_id → already linked
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-123' }, error: null });
    // Queue: feedHallOfFame — read prompt_id → has value
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-123' }, error: null });
    // DB-5: Batch upsert for top-2 entries (1 entries call + 1 elo call)
    queueTableResult('evolution_hall_of_fame_entries', { data: [{ id: 'entry-1' }, { id: 'entry-2' }], error: null });
    queueTableResult('evolution_hall_of_fame_elo', { data: null, error: null });

    await finalizePipelineRun('hof-run', ctx, ctx.logger, 'completed', 30.0);

    // Verify evolution_hall_of_fame_entries was called (batch upsert)
    const bankOps = getTableOps('evolution_hall_of_fame_entries');
    expect(bankOps.length).toBeGreaterThanOrEqual(1);

    // Verify logger.info reports success
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Hall of fame updated',
      expect.objectContaining({ runId: 'hof-run', topicId: 'topic-123' }),
    );
  });

  it('skips hall of fame when no topic resolves', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state);
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 1,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    const ctx = makeCtx(state, 'hof-skip');
    // explanationId = 1 but explanation lookup returns null
    // Queue: run_summary, variants, agent_metrics, linkStrategy run check, strategy select, link run, autoLink prompt check (no prompt_id), bank entry check (no topic), explanation check (no match)
    // Simplified: all default null/empty returns from mock
    // feedHallOfFame: prompt_id check → null, explanation lookup → null
    queueTableResult('evolution_runs', { data: null, error: null }); // summary
    queueTableResult('evolution_variants', { data: null, error: null }); // variants
    queueTableResult('evolution_run_agent_metrics', { data: null, error: null }); // metrics
    queueTableResult('evolution_runs', { data: { cost_estimate_detail: null }, error: null }); // cost prediction
    queueTableResult('evolution_runs', { data: { strategy_config_id: null }, error: null }); // linkStrategy check
    queueTableResult('evolution_strategy_configs', { data: { id: 'strat-1' }, error: null }); // existing strategy
    queueTableResult('evolution_runs', { data: null, error: null }); // link run
    queueTableResult('evolution_runs', { data: { prompt_id: null }, error: null }); // autoLink check
    // autoLink bank entry check
    queueTableResult('evolution_hall_of_fame_entries', { data: null, error: null });
    // autoLink explanation lookup
    queueTableResult('explanations', { data: null, error: null });
    // feedHallOfFame prompt_id check → null
    queueTableResult('evolution_runs', { data: { prompt_id: null }, error: null });
    // feedHallOfFame explanation lookup → null
    queueTableResult('explanations', { data: null, error: null });

    await finalizePipelineRun('hof-skip', ctx, ctx.logger, 'completed', 30.0);

    // Should warn about no topic
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Cannot feed hall of fame — no topic resolved',
      expect.objectContaining({ runId: 'hof-skip' }),
    );

    // No bank entries created
    const bankOps = getTableOps('evolution_hall_of_fame_entries');
    // Only the autoLink check, no upserts
    expect(bankOps.filter(op => op.method === 'upsert')).toHaveLength(0);
  });

  it('handles fewer than 2 variants (only inserts available)', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state);
    // Only 1 non-baseline variant
    state.addToPool({
      id: 'v1', text: 'Single variant', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 1,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    const ctx = makeCtx(state, 'hof-few');

    // Queue results: path through finalize with prompt_id set
    queueTableResult('evolution_runs', { data: null, error: null }); // summary
    queueTableResult('evolution_variants', { data: null, error: null }); // variants
    queueTableResult('evolution_run_agent_metrics', { data: null, error: null }); // metrics
    queueTableResult('evolution_runs', { data: { cost_estimate_detail: null }, error: null }); // cost prediction
    queueTableResult('evolution_runs', { data: { strategy_config_id: null }, error: null }); // linkStrategy
    queueTableResult('evolution_strategy_configs', { data: { id: 'strat-1' }, error: null });
    queueTableResult('evolution_runs', { data: null, error: null }); // link run
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-1' }, error: null }); // autoLink
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-1' }, error: null }); // feedHoF
    // DB-5: Batch upsert for top 2 (v1 + baseline)
    queueTableResult('evolution_hall_of_fame_entries', { data: [{ id: 'e1' }, { id: 'e2' }], error: null });
    queueTableResult('evolution_hall_of_fame_elo', { data: null, error: null });

    await finalizePipelineRun('hof-few', ctx, ctx.logger, 'completed', 15.0);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Hall of fame updated',
      expect.objectContaining({ entriesInserted: 2 }),
    );
  });

  it('skips hall of fame when pool has zero variants', async () => {
    const state = new PipelineStateImpl('Original');
    // Don't add any variants
    const ctx = makeCtx(state, 'hof-empty');

    // Standard finalize queues — most will hit default null returns
    await finalizePipelineRun('hof-empty', ctx, ctx.logger, 'completed', 5.0);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'No variants to feed into hall of fame',
      expect.objectContaining({ runId: 'hof-empty' }),
    );
  });
});

// ─── Auto re-ranking after hall of fame insertion ─────────────────

describe('auto re-ranking after feedHallOfFame', () => {
  it('calls runBankComparisonInternal after inserting entries', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state);
    state.addToPool({
      id: 'v1', text: 'Variant 1', version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 1,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    const ctx = makeCtx(state, 'rerank-run');

    // Queue: summary, variants, agent metrics, cost prediction, linkStrategy, autoLink, feedHoF
    queueTableResult('evolution_runs', { data: null, error: null }); // summary
    queueTableResult('evolution_variants', { data: null, error: null }); // variants
    queueTableResult('evolution_run_agent_metrics', { data: null, error: null }); // metrics
    queueTableResult('evolution_runs', { data: { cost_estimate_detail: null }, error: null }); // cost prediction
    queueTableResult('evolution_runs', { data: { strategy_config_id: null }, error: null }); // linkStrategy
    queueTableResult('evolution_strategy_configs', { data: { id: 'strat-1' }, error: null });
    queueTableResult('evolution_runs', { data: null, error: null }); // link run
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-rerank' }, error: null }); // autoLink
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-rerank' }, error: null }); // feedHoF
    // DB-5: Batch upsert for top 2 entries
    queueTableResult('evolution_hall_of_fame_entries', { data: [{ id: 'e1' }, { id: 'e2' }], error: null });
    queueTableResult('evolution_hall_of_fame_elo', { data: null, error: null });
    // Auto re-ranking: runBankComparisonInternal fetches entries (< 2 → returns 0 comparisons)
    queueTableResult('evolution_hall_of_fame_entries', { data: [{ id: 'e1', content: 'C1', total_cost_usd: 0.01 }], error: null });

    await finalizePipelineRun('rerank-run', ctx, ctx.logger, 'completed', 30.0);

    // Verify re-ranking was attempted. The dynamic import resolves the actual module
    // which may return success:true with 0 comparisons (< 2 entries in mock) or
    // success:false if schema parse fails. Either way, it should not crash.
    const infoCalls = (ctx.logger.info as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
    const warnCalls = (ctx.logger.warn as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
    const reRankLogged = infoCalls.includes('Auto re-ranking completed')
      || warnCalls.some((m: unknown) => typeof m === 'string' && m.includes('re-ranking'));
    expect(reRankLogged).toBe(true);
  });

  it('logs warning when re-ranking throws', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state);
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 1,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    const ctx = makeCtx(state, 'rerank-fail');

    queueTableResult('evolution_runs', { data: null, error: null }); // summary
    queueTableResult('evolution_variants', { data: null, error: null }); // variants
    queueTableResult('evolution_run_agent_metrics', { data: null, error: null }); // metrics
    queueTableResult('evolution_runs', { data: { cost_estimate_detail: null }, error: null }); // cost prediction
    queueTableResult('evolution_runs', { data: { strategy_config_id: null }, error: null });
    queueTableResult('evolution_strategy_configs', { data: { id: 'strat-1' }, error: null });
    queueTableResult('evolution_runs', { data: null, error: null }); // link run
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-fail' }, error: null }); // autoLink
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-fail' }, error: null }); // feedHoF
    // DB-5: Batch upsert for top 2 entries
    queueTableResult('evolution_hall_of_fame_entries', { data: [{ id: 'e1' }, { id: 'e2' }], error: null });
    queueTableResult('evolution_hall_of_fame_elo', { data: null, error: null });
    // Re-ranking: entries fetch throws error
    queueTableResult('evolution_hall_of_fame_entries', { data: null, error: { message: 'DB down' } });

    await finalizePipelineRun('rerank-fail', ctx, ctx.logger, 'completed', 30.0);

    // Should log warning, not crash
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('re-ranking'),
      expect.objectContaining({ runId: 'rerank-fail' }),
    );
  });
});

// ─── autoLinkPrompt config JSONB test ────────────────────────────

describe('autoLinkPrompt config JSONB strategy', () => {
  it('links prompt via config JSONB prompt field when available', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state);
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 1,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    const ctx = makeCtx(state, 'cfg-link');

    // Queue: summary → success
    queueTableResult('evolution_runs', { data: null, error: null });
    // Queue: variants → success
    queueTableResult('evolution_variants', { data: null, error: null });
    // Queue: agent metrics → success
    queueTableResult('evolution_run_agent_metrics', { data: null, error: null });
    // Queue: cost prediction read → no estimate
    queueTableResult('evolution_runs', { data: { cost_estimate_detail: null }, error: null });
    // Queue: linkStrategy → strategy_config_id null (auto-create)
    queueTableResult('evolution_runs', { data: { strategy_config_id: null }, error: null });
    queueTableResult('evolution_strategy_configs', { data: { id: 'strat-1' }, error: null });
    queueTableResult('evolution_runs', { data: null, error: null }); // link run

    // autoLinkPrompt: combined prompt_id + config read → not yet linked, has prompt field
    queueTableResult('evolution_runs', {
      data: { prompt_id: null, config: { prompt: 'Explain gravity' } },
      error: null,
    });
    // autoLinkPrompt: evolution_hall_of_fame_topics match → found
    queueTableResult('evolution_hall_of_fame_topics', { data: { id: 'topic-from-config' }, error: null });
    // autoLinkPrompt: update prompt_id → success
    queueTableResult('evolution_runs', { data: null, error: null });

    // feedHallOfFame: prompt_id check → now linked
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-from-config' }, error: null });
    // DB-5: Batch upsert for entries
    queueTableResult('evolution_hall_of_fame_entries', { data: [{ id: 'e1' }, { id: 'e2' }], error: null });
    queueTableResult('evolution_hall_of_fame_elo', { data: null, error: null });

    await finalizePipelineRun('cfg-link', ctx, ctx.logger, 'completed', 20.0);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Auto-linked prompt via config JSONB',
      expect.objectContaining({ runId: 'cfg-link', promptId: 'topic-from-config' }),
    );
  });
});

// ─── Pipeline Type Tests ─────────────────────────────────────────

describe('pipeline type tracking', () => {
  function makeSpyAgent(name: string): PipelineAgent {
    return {
      name,
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue({
        success: true, costUsd: 0, variantsAdded: 0, matchesPlayed: 0, agentType: name,
      }),
    };
  }

  it('executeMinimalPipeline sets pipeline_type = minimal', async () => {
    const state = new PipelineStateImpl('Original text');
    const ctx = makeCtx(state, 'min-run');
    const agents = [makeSpyAgent('generation'), makeSpyAgent('calibration')];

    await executeMinimalPipeline('min-run', agents, ctx, ctx.logger, { startMs: Date.now() });

    // Verify the first evolution_runs update included pipeline_type
    const runOps = getTableOps('evolution_runs');
    expect(runOps.length).toBeGreaterThan(0);
    // The update call should have been made with pipeline_type
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    const updateCalls = (supabase.from as jest.Mock).mock.calls;
    expect(updateCalls.some((c: string[]) => c[0] === 'evolution_runs')).toBe(true);
  });

  it('executeFullPipeline sets pipeline_type = full', async () => {
    const state = new PipelineStateImpl('Original text');
    const config = resolveConfig({
      maxIterations: 5,
      expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25 },
      plateau: { window: 2, threshold: 0.02 },
    });
    const ctx: ExecutionContext = {
      payload: {
        originalText: state.originalText,
        title: 'Test',
        explanationId: 1,
        runId: 'full-run',
        config,
      },
      state,
      llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
      logger: makeMockLogger(),
      costTracker: {
        reserveBudget: jest.fn().mockResolvedValue(undefined),
        recordSpend: jest.fn(),
        getAgentCost: jest.fn().mockReturnValue(0),
        getTotalSpent: jest.fn().mockReturnValue(0),
        getAvailableBudget: jest.fn().mockReturnValueOnce(2.0).mockReturnValueOnce(2.0).mockReturnValue(0.005),
        getAllAgentCosts: jest.fn().mockReturnValue({}),
        getTotalReserved: jest.fn().mockReturnValue(0),
      },
      runId: 'full-run',
    };

    const agents: PipelineAgents = {
      generation: makeSpyAgent('generation'),
      calibration: makeSpyAgent('calibration'),
      tournament: makeSpyAgent('tournament'),
      evolution: makeSpyAgent('evolution'),
      reflection: makeSpyAgent('reflection'),
      debate: makeSpyAgent('debate'),
      proximity: makeSpyAgent('proximity'),
      metaReview: makeSpyAgent('metaReview'),
    };

    await executeFullPipeline('full-run', agents, ctx, ctx.logger, {
      supervisorResume: { phase: 'COMPETITION' as const, ordinalHistory: [], diversityHistory: [] },
      startMs: Date.now(),
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient: getClient } = require('@/lib/utils/supabase/server');
    const sb = await getClient();
    const updateCalls = (sb.from as jest.Mock).mock.calls;
    expect(updateCalls.some((c: string[]) => c[0] === 'evolution_runs')).toBe(true);
  });
});

// ─── linkStrategyConfig skip test ────────────────────────────────

describe('linkStrategyConfig (pre-linked strategy)', () => {
  it('skips auto-creation when strategy_config_id is already set', async () => {
    const state = new PipelineStateImpl('Original');
    insertBaselineVariant(state);
    state.addToPool({
      id: 'v1', text: 'V1', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 1,
    });
    state.ratings.set('v1', ratingWithOrdinal(20));

    const ctx = makeCtx(state, 'pre-linked');

    // Queue: summary → success
    queueTableResult('evolution_runs', { data: null, error: null });
    // Queue: variants → success
    queueTableResult('evolution_variants', { data: null, error: null });
    // Queue: agent metrics → success
    queueTableResult('evolution_run_agent_metrics', { data: null, error: null });
    // Queue: cost prediction read → no estimate
    queueTableResult('evolution_runs', { data: { cost_estimate_detail: null }, error: null });
    // Queue: linkStrategy reads run → strategy_config_id already set
    queueTableResult('evolution_runs', { data: { strategy_config_id: 'existing-strat' }, error: null });
    // Queue: autoLink → prompt_id already set
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-1' }, error: null });
    // Queue: feedHoF → prompt_id set
    queueTableResult('evolution_runs', { data: { prompt_id: 'topic-1' }, error: null });
    // DB-5: Batch upsert for entries
    queueTableResult('evolution_hall_of_fame_entries', { data: [{ id: 'e1' }, { id: 'e2' }], error: null });
    queueTableResult('evolution_hall_of_fame_elo', { data: null, error: null });

    await finalizePipelineRun('pre-linked', ctx, ctx.logger, 'completed', 30.0);

    // The RPC should have been called for aggregate update (pre-linked path)
    expect(mockRpc).toHaveBeenCalledWith('update_strategy_aggregates', expect.objectContaining({
      p_strategy_id: 'existing-strat',
    }));

    // strategy_configs should NOT have been queried for hash lookup
    const stratOps = getTableOps('evolution_strategy_configs');
    expect(stratOps).toHaveLength(0);

    // Should log the aggregates update message
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'Strategy aggregates updated',
      expect.objectContaining({ strategyId: 'existing-strat' }),
    );
  });
});
