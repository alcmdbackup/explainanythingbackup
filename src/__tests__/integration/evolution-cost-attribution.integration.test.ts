// Integration test for accurate per-purpose cost attribution.
//
// This is the headline test for the "fix cost reporting evolution generation" project.
// It proves that LLM costs labeled 'generation' end up in the generation_cost row and
// LLM costs labeled 'ranking' end up in the ranking_cost row — NOT a 50/50 split of
// the run total. The bug being fixed: persistRunResults.finalizeRun() previously
// applied a hardcoded `cost / 2` split to generate_from_seed_article invocation rows.
// The fix: createLLMClient writes per-purpose cost metrics live via writeMetricMax,
// keyed by the typed AgentName label passed at the call site.
//
// COST INJECTION: We mock `@/config/llmPricing` so per-token pricing is deterministic
// (jest, NOT vitest — `jest.mock(...)` syntax). Then we engineer prompt/response
// character counts so each call's actual cost is known exactly. After running a
// known mix of generation/ranking calls, we assert the persisted metric rows match
// the expected per-purpose sums (NOT a 50/50 split, which would produce different
// numbers given asymmetric per-call costs).
//
// LOCAL SETUP: Run `supabase db reset` (or `supabase migration up --local`) before
//              `npm run test:integration` to ensure the upsert_metric_max RPC exists.

// Mock pricing module BEFORE importing anything that uses it.
// jest.mock is hoisted, so this runs before the createEvolutionLLMClient import below.
jest.mock('@/config/llmPricing', () => {
  // Each call to getModelPricing returns the same fixed rate.
  // Using $1/1M tokens for both input and output makes per-call cost easy to compute:
  //   cost = (inputTokens + outputTokens) / 1_000_000 dollars
  // chars-to-tokens: ceil(chars/4) per createLLMClient.calculateCost
  return {
    getModelPricing: jest.fn(() => ({ inputPer1M: 1.0, outputPer1M: 1.0 })),
    // Phase 2: calculateLLMCost is now called by the token-based recordSpend path.
    // Mock it with the same $1/1M logic so costs are deterministic.
    calculateLLMCost: jest.fn((_model: string, promptToks: number, completionToks: number, _reasoning: number) =>
      Math.round(((promptToks + completionToks) / 1_000_000) * 1_000_000) / 1_000_000,
    ),
  };
});

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import { createEvolutionLLMClient } from '@evolution/lib/pipeline/infra/createEvolutionLLMClient';
import { createCostTracker } from '@evolution/lib/pipeline/infra/trackBudget';
import type { AgentName } from '@evolution/lib/core/agentNames';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Cost engineering ─────────────────────────────────────────────
// With $1/1M pricing, cost(chars) = ceil(chars/4) / 1_000_000.

const GEN_PROMPT = 'g'.repeat(4000); // 1000 input tokens
const GEN_RESPONSE = 'G'.repeat(4000); // 1000 output tokens → cost $0.002 per call
const RANK_PROMPT = 'r'.repeat(4000); // 1000 input tokens
const RANK_RESPONSE = 'R'.repeat(400); // 100 output tokens → cost $0.0011 per call

const COST_PER_GEN_CALL = (1000 + 1000) / 1_000_000; // = 0.002
const COST_PER_RANK_CALL = (1000 + 100) / 1_000_000; // = 0.0011

async function rpcExists(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.rpc('upsert_metric_max', {
    p_entity_type: 'run',
    p_entity_id: '00000000-0000-0000-0000-000000000000',
    p_metric_name: '__probe__',
    p_value: 0,
    p_source: 'probe',
  });
  if (error && (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.message?.includes('does not exist') ||
    error.message?.includes('schema cache')
  )) return false;
  return true;
}

describe('Per-purpose cost attribution integration tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;
  let migrationApplied: boolean;

  const strategyId = crypto.randomUUID();
  const runId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping cost attribution tests');
      return;
    }
    migrationApplied = await rpcExists(supabase);
    if (!migrationApplied) {
      console.warn('upsert_metric_max RPC does not exist — run `supabase db reset` locally');
      return;
    }
    await supabase
      .from('evolution_metrics')
      .delete()
      .eq('entity_type', 'run')
      .eq('metric_name', '__probe__');

    const { error: stratErr } = await supabase
      .from('evolution_strategies')
      .insert({
        id: strategyId,
        name: '[TEST_EVO] cost-attribution-strategy',
        label: '[TEST_EVO] Cost Attribution',
        config: { test: true },
        config_hash: `test-cost-attribution-hash-${strategyId}`,
      });
    if (stratErr) throw new Error(`Failed to create strategy: ${stratErr.message}`);

    const { error: runErr } = await supabase
      .from('evolution_runs')
      .insert({ id: runId, strategy_id: strategyId, status: 'running' });
    if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
  });

  afterAll(async () => {
    if (!tablesExist || !migrationApplied) return;
    await cleanupEvolutionData(supabase, {
      runIds: [runId],
      strategyIds: [strategyId],
    });
  });

  beforeEach(async () => {
    if (!tablesExist || !migrationApplied) return;
    // Reset metric rows for this run so each test starts from zero
    await supabase
      .from('evolution_metrics')
      .delete()
      .eq('entity_type', 'run')
      .eq('entity_id', runId);
  });

  it('routes "generation" and "ranking" labels to the correct cost metric rows (NOT 50/50)', async () => {
    if (!tablesExist || !migrationApplied) return;

    // Build a mock raw LLM provider that returns deterministic responses based on label
    const rawProvider = {
      complete: jest.fn(async (_prompt: string, label: AgentName) => {
        if (label === 'generation') return GEN_RESPONSE;
        if (label === 'ranking') return RANK_RESPONSE;
        throw new Error(`Unexpected label: ${label}`);
      }),
    };

    const costTracker = createCostTracker(1.0); // $1 budget — way more than we need
    const llm = createEvolutionLLMClient(
      rawProvider,
      costTracker,
      'gpt-4.1-nano', // model name doesn't matter — pricing is mocked
      undefined,
      supabase,
      runId,
    );

    // 2 generation calls + 3 ranking calls
    await llm.complete(GEN_PROMPT, 'generation');
    await llm.complete(GEN_PROMPT, 'generation');
    await llm.complete(RANK_PROMPT, 'ranking');
    await llm.complete(RANK_PROMPT, 'ranking');
    await llm.complete(RANK_PROMPT, 'ranking');

    // Expected values:
    const expectedGenCost = 2 * COST_PER_GEN_CALL; // 0.004
    const expectedRankCost = 3 * COST_PER_RANK_CALL; // 0.0033
    const expectedTotal = expectedGenCost + expectedRankCost; // 0.0073

    // Read the persisted metric rows
    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('metric_name, value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .in('metric_name', ['cost', 'generation_cost', 'ranking_cost']);

    expect(error).toBeNull();
    const byName = new Map(data!.map(r => [r.metric_name, Number(r.value)]));

    // Cost split is accurate per-purpose
    expect(byName.get('generation_cost')).toBeCloseTo(expectedGenCost, 6);
    expect(byName.get('ranking_cost')).toBeCloseTo(expectedRankCost, 6);
    expect(byName.get('cost')).toBeCloseTo(expectedTotal, 6);

    // Sanity: gen + rank = total (the per-purpose split sums correctly)
    expect(
      (byName.get('generation_cost') ?? 0) + (byName.get('ranking_cost') ?? 0),
    ).toBeCloseTo(byName.get('cost') ?? 0, 6);

    // The bug being fixed: 50/50 split would have produced equal halves of total,
    // which is NOT the actual per-purpose sums. Assert we are NOT seeing the buggy split.
    const fiftyFifty = expectedTotal / 2;
    expect(byName.get('generation_cost')).not.toBeCloseTo(fiftyFifty, 4);
    expect(byName.get('ranking_cost')).not.toBeCloseTo(fiftyFifty, 4);
  });

  it('a generation-only run produces ranking_cost=0 and generation_cost=full', async () => {
    if (!tablesExist || !migrationApplied) return;

    const rawProvider = {
      complete: jest.fn(async () => GEN_RESPONSE),
    };
    const costTracker = createCostTracker(1.0);
    const llm = createEvolutionLLMClient(rawProvider, costTracker, 'gpt-4.1-nano', undefined, supabase, runId);

    // Zero-init (like executePipeline does)
    const { writeMetricMax } = await import('@evolution/lib/metrics/writeMetrics');
    for (const metricName of ['cost', 'generation_cost', 'ranking_cost'] as const) {
      await writeMetricMax(supabase, 'run', runId, metricName, 0, 'during_execution');
    }

    // 3 generation calls, 0 ranking calls
    await llm.complete(GEN_PROMPT, 'generation');
    await llm.complete(GEN_PROMPT, 'generation');
    await llm.complete(GEN_PROMPT, 'generation');

    const { data } = await supabase
      .from('evolution_metrics')
      .select('metric_name, value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .in('metric_name', ['cost', 'generation_cost', 'ranking_cost']);

    const byName = new Map(data!.map(r => [r.metric_name, Number(r.value)]));
    expect(byName.get('generation_cost')).toBeCloseTo(3 * COST_PER_GEN_CALL, 6);
    expect(byName.get('ranking_cost')).toBe(0); // zero-initialized, no ranking calls
    expect(byName.get('cost')).toBeCloseTo(3 * COST_PER_GEN_CALL, 6);
  });

  it('a ranking-only run produces generation_cost=0 and ranking_cost=full', async () => {
    if (!tablesExist || !migrationApplied) return;

    const rawProvider = {
      complete: jest.fn(async () => RANK_RESPONSE),
    };
    const costTracker = createCostTracker(1.0);
    const llm = createEvolutionLLMClient(rawProvider, costTracker, 'gpt-4.1-nano', undefined, supabase, runId);

    // Zero-init
    const { writeMetricMax } = await import('@evolution/lib/metrics/writeMetrics');
    for (const metricName of ['cost', 'generation_cost', 'ranking_cost'] as const) {
      await writeMetricMax(supabase, 'run', runId, metricName, 0, 'during_execution');
    }

    // 4 ranking calls, 0 generation
    await llm.complete(RANK_PROMPT, 'ranking');
    await llm.complete(RANK_PROMPT, 'ranking');
    await llm.complete(RANK_PROMPT, 'ranking');
    await llm.complete(RANK_PROMPT, 'ranking');

    const { data } = await supabase
      .from('evolution_metrics')
      .select('metric_name, value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .in('metric_name', ['cost', 'generation_cost', 'ranking_cost']);

    const byName = new Map(data!.map(r => [r.metric_name, Number(r.value)]));
    expect(byName.get('generation_cost')).toBe(0);
    expect(byName.get('ranking_cost')).toBeCloseTo(4 * COST_PER_RANK_CALL, 6);
    expect(byName.get('cost')).toBeCloseTo(4 * COST_PER_RANK_CALL, 6);
  });

  it('seed-phase agent labels do not write per-purpose cost metrics (only the aggregate cost)', async () => {
    if (!tablesExist || !migrationApplied) return;

    const rawProvider = {
      complete: jest.fn(async () => GEN_RESPONSE),
    };
    const costTracker = createCostTracker(1.0);
    const llm = createEvolutionLLMClient(rawProvider, costTracker, 'gpt-4.1-nano', undefined, supabase, runId);

    // Call with seed_title and seed_article — these are valid AgentName values but
    // do NOT have entries in COST_METRIC_BY_AGENT, so per-purpose write should be skipped.
    // Only the aggregate `cost` row gets written.
    await llm.complete(GEN_PROMPT, 'seed_title');
    await llm.complete(GEN_PROMPT, 'seed_article');

    const { data } = await supabase
      .from('evolution_metrics')
      .select('metric_name, value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .in('metric_name', ['cost', 'generation_cost', 'ranking_cost']);

    const byName = new Map(data!.map(r => [r.metric_name, Number(r.value)]));
    // cost has both calls
    expect(byName.get('cost')).toBeCloseTo(2 * COST_PER_GEN_CALL, 6);
    // generation_cost / ranking_cost rows should NOT exist (no entry in COST_METRIC_BY_AGENT)
    expect(byName.has('generation_cost')).toBe(false);
    expect(byName.has('ranking_cost')).toBe(false);
  });

  // ─── Bug A regression: token-based recordSpend ──────────────────
  // When rawProvider returns {text, usage}, recordSpend should use calculateLLMCost
  // (token-based) instead of calculateCost (chars/4). A 50KB response string with
  // only 100 completion tokens should NOT inflate the cost.
  it('Bug A: token-based cost from {text, usage} provider (not response.length inflation)', async () => {
    if (!tablesExist || !migrationApplied) return;

    const rawProvider = {
      complete: jest.fn(async (_prompt: string, label: AgentName) => ({
        text: 'x'.repeat(50_000), // huge string — chars/4 heuristic would compute ~$0.0125
        usage: { promptTokens: 100, completionTokens: 100 }, // token-based: 200 tokens total
      })),
    };

    const costTracker = createCostTracker(1.0);
    const llm = createEvolutionLLMClient(rawProvider, costTracker, 'gpt-4.1-nano', undefined, supabase, runId);

    await llm.complete('p'.repeat(400), 'generation');

    // Token-based cost: (100 + 100) / 1_000_000 = 0.0002 (from mocked calculateLLMCost)
    // String-length bug would compute ~0.0125 (12500 output tokens × $1/1M)
    const spent = costTracker.getTotalSpent();
    expect(spent).toBeCloseTo(0.0002, 6);
    expect(spent).toBeLessThan(0.001); // sanity: far below the inflated value
  });

  // ─── Bug B regression: parallel scope isolation ──────────────────
  // When multiple agents run in parallel on the same shared tracker,
  // each agent's cost_usd should reflect only its own LLM calls.
  it('Bug B: parallel agents via scope — each agent sees only its own cost', async () => {
    if (!tablesExist || !migrationApplied) return;

    const { Agent } = await import('@evolution/lib/core/Agent');
    const { z } = await import('zod');

    class TestCostAgent extends Agent<{ tokens: number }, string, { detailType: 'test'; totalCost: number }> {
      readonly name = 'test_cost_agent';
      readonly executionDetailSchema = z.object({ detailType: z.literal('test'), totalCost: z.number() });
      readonly detailViewConfig = [];
      async execute(input: { tokens: number; llm: { complete: (p: string, l: string) => Promise<string> } }, ctx: any) {
        // Each agent does one LLM call with its configured token count
        await input.llm.complete('p', 'generation');
        return { result: 'ok', detail: { detailType: 'test' as const, totalCost: 0 } };
      }
    }

    const sharedTracker = createCostTracker(1.0);

    // 3 agents each with distinct token counts (100, 200, 300).
    let callIdx = 0;
    const tokenCounts = [100, 200, 300];
    const rawProvider = {
      async complete(_prompt: string, _label: string) {
        const tokens = tokenCounts[callIdx++]!;
        await new Promise(r => setTimeout(r, 5 * (3 - callIdx))); // stagger
        return { text: 'ok', usage: { promptTokens: tokens, completionTokens: tokens } };
      },
    };

    const makeCtx = (execOrder: number) => ({
      db: supabase,
      runId,
      iteration: 1,
      executionOrder: execOrder,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      costTracker: sharedTracker,
      config: { iterationConfigs: [{ agentType: 'generate' as const, budgetPercent: 100 }], budgetUsd: 1, judgeModel: 'test', generationModel: 'test' },
      invocationId: '',
      randomSeed: BigInt(0),
      rawProvider,
      defaultModel: 'gpt-4.1-nano',
    });

    const results = await Promise.all([
      new TestCostAgent().run({ tokens: 100 }, makeCtx(1)),
      new TestCostAgent().run({ tokens: 200 }, makeCtx(2)),
      new TestCostAgent().run({ tokens: 300 }, makeCtx(3)),
    ]);

    // Each agent's cost should equal only its own tokens: (p + c) / 1M
    const costs = results.map(r => r.cost!).sort((a, b) => a - b);
    const expected = tokenCounts.map(t => (t + t) / 1_000_000).sort((a, b) => a - b);

    expect(costs[0]).toBeCloseTo(expected[0]!, 8);
    expect(costs[1]).toBeCloseTo(expected[1]!, 8);
    expect(costs[2]).toBeCloseTo(expected[2]!, 8);

    // Shared tracker total = sum of all three
    expect(sharedTracker.getTotalSpent()).toBeCloseTo(
      expected.reduce((a, b) => a + b, 0), 8,
    );
  });
});
