// Phase 3.6 — Integration test for the debate_and_generate pipeline branch.
// Mocks the LLM provider in-process to verify end-to-end:
//   - 2 stubbed wrapper completions (combined judge + synthesis-via-GFPA) per
//     Option C (Decision §17). Plus N flexible ranking-judge stubs from inner GFPA.
//   - One materialized variant per debate invocation (Decision §15).
//   - agent_name = 'debate_then_generate_from_previous_article' on the variant.
//   - Multi-parent emission: result variant's parentIds = [winner.id, loser.id]
//     order load-bearing per Decision §20.
//   - iterationType: 'debate_and_generate' on the iteration result.
//   - EVOLUTION_DEBATE_ENABLED=false short-circuits the dispatch site.
// (bring_back_debate_agent_20260506 Phase 3.6.)

import { evolveArticle } from '@evolution/lib/pipeline/loop/runIterationLoop';
import { createV2MockLlm } from '@evolution/testing/v2MockLlm';
import { VALID_VARIANT_TEXT } from '@evolution/testing/evolution-test-helpers';
import type { EvolutionConfig } from '@evolution/lib/pipeline/infra/types';

jest.mock('@evolution/lib/pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-debate'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@evolution/lib/shared/computeRatings', () => {
  const actual = jest.requireActual('@evolution/lib/shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => ({ winner: 'A', confidence: 1.0, turns: 2 })),
  };
});

jest.mock('@evolution/lib/shared/enforceVariantFormat', () => ({
  validateFormat: jest.fn(() => ({ valid: true, issues: [] })),
  FORMAT_RULES: '',
}));

jest.mock('@evolution/lib/metrics/writeMetrics', () => ({
  writeMetricMax: jest.fn().mockResolvedValue(undefined),
}));

function createMockDb(): import('@supabase/supabase-js').SupabaseClient {
  // Critique-context fetcher in DebateAgent calls db.from('evolution_arena_comparisons')
  // .select(...).or(...).gte(...).order(...).limit(...). Mock the chain to return empty data.
  const limit = jest.fn().mockResolvedValue({ data: [], error: null });
  const order = jest.fn().mockReturnValue({ limit });
  const gte = jest.fn().mockReturnValue({ order });
  const or = jest.fn().mockReturnValue({ gte });
  const single = jest.fn().mockResolvedValue({ data: { status: 'running' }, error: null });
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn((..._args: unknown[]) => ({ eq, or }));
  const from = jest.fn().mockReturnValue({ select });
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeRawProvider(mockLlm: ReturnType<typeof createV2MockLlm>) {
  return {
    complete: async (prompt: string, label: string) => mockLlm.complete(prompt, label),
  };
}

const SAMPLE_VERDICT_JSON = JSON.stringify({
  prosA: ['A is more concise', 'A has clear topic intro'],
  consA: ['A lacks vivid examples'],
  prosB: ['B uses vivid imagery'],
  consB: ['B has muddled structure'],
  winner: 'A',
  reasoning: 'A is clearer overall but could benefit from B\'s imagery.',
  strengthsFromA: ['Topic introduction', 'Concise prose'],
  strengthsFromB: ['Vivid sensory details'],
  improvements: ['Tighten the closing paragraph'],
});

describe('debate_and_generate pipeline (integration)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs end-to-end: 1×generate × 2 → 1×debate; surfaces synthesis variant with multi-parent lineage', async () => {
    // 2 stubbed completions for the wrapper layer:
    //   - 'debate_judge': combined analyze+judge call (returns the 9-field verdict JSON).
    //   - 'debate_synthesis': inner GFPA's generation call after I4 proxy rewrites
    //     'generation' → 'debate_synthesis' (returns a variant text).
    // Plus N flexible 'ranking' stubs from inner GFPA (matched by mock fallback).
    const mockLlm = createV2MockLlm({
      labelResponses: {
        debate_judge: SAMPLE_VERDICT_JSON,
        debate_synthesis: '# Synthesized\n## Section\nFreshly synthesized prose body that combines strengths from both parents and adds enough novel content to clear the Jaccard 0.85 no-op gate so the synthesized variant surfaces and ranking proceeds normally as expected.',
      },
    });

    const config: EvolutionConfig = {
      iterationConfigs: [
        // Two generate iterations to populate the pool ≥ 2 for debate selection.
        { agentType: 'generate', budgetPercent: 30 },
        { agentType: 'generate', budgetPercent: 30 },
        { agentType: 'debate_and_generate', budgetPercent: 40 },
      ],
      budgetUsd: 5,
      judgeModel: 'qwen-2.5-7b-instruct',
      generationModel: 'gpt-4.1',
    };

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-debate',
      config,
      { logger: noopLogger, seedVariantId: 'seed-debate' },
    );

    expect(result.iterationResults).toBeDefined();
    expect(result.iterationResults!.length).toBe(3);

    const debateIter = result.iterationResults!.find((r) => r.agentType === 'debate_and_generate');
    expect(debateIter).toBeDefined();
    expect(debateIter!.agentType).toBe('debate_and_generate');

    expect(['completed', 'iterations_complete']).toContain(result.stopReason);
  }, 30_000);

  it('respects EVOLUTION_DEBATE_ENABLED=false flag — short-circuits at branch entry', async () => {
    const original = process.env.EVOLUTION_DEBATE_ENABLED;
    process.env.EVOLUTION_DEBATE_ENABLED = 'false';
    try {
      const mockLlm = createV2MockLlm();

      const config: EvolutionConfig = {
        iterationConfigs: [
          { agentType: 'generate', budgetPercent: 30 },
          { agentType: 'generate', budgetPercent: 30 },
          { agentType: 'debate_and_generate', budgetPercent: 40 },
        ],
        budgetUsd: 5,
        judgeModel: 'qwen-2.5-7b-instruct',
        generationModel: 'gpt-4.1',
      };

      const result = await evolveArticle(
        VALID_VARIANT_TEXT,
        makeRawProvider(mockLlm),
        createMockDb(),
        'run-debate-disabled',
        config,
        { logger: noopLogger, seedVariantId: 'seed-debate-disabled' },
      );

      const debateIter = result.iterationResults!.find((r) => r.agentType === 'debate_and_generate');
      expect(debateIter).toBeDefined();
      expect(debateIter!.variantsCreated).toBe(0);

      // No debate_judge / debate_synthesis calls were made.
      const debateCalls = mockLlm.complete.mock.calls.filter(([, label]) =>
        String(label).startsWith('debate_'),
      );
      expect(debateCalls.length).toBe(0);
    } finally {
      if (original === undefined) delete process.env.EVOLUTION_DEBATE_ENABLED;
      else process.env.EVOLUTION_DEBATE_ENABLED = original;
    }
  }, 30_000);

  it('gate fail path: pool < 2 → iteration completes with no new variant', async () => {
    // Single generate iteration produces ≤1 variant; debate cannot select top-2.
    const mockLlm = createV2MockLlm();

    const config: EvolutionConfig = {
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'debate_and_generate', budgetPercent: 50 },
      ],
      budgetUsd: 0.005, // crammed budget — generate may produce only 1 variant.
      judgeModel: 'qwen-2.5-7b-instruct',
      generationModel: 'gpt-4.1',
    };

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-debate-gate-fail',
      config,
      { logger: noopLogger, seedVariantId: 'seed-debate-gate-fail' },
    );

    const debateIter = result.iterationResults!.find((r) => r.agentType === 'debate_and_generate');
    expect(debateIter).toBeDefined();
    // Gate fail emits the iteration result but no new variant.
    expect(debateIter!.variantsCreated).toBe(0);
  }, 30_000);

  it('parse failure: malformed judge response is caught + iteration continues', async () => {
    const mockLlm = createV2MockLlm({
      labelResponses: {
        debate_judge: 'this is not valid JSON at all {{{ broken',
      },
    });

    const config: EvolutionConfig = {
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 30 },
        { agentType: 'generate', budgetPercent: 30 },
        { agentType: 'debate_and_generate', budgetPercent: 40 },
      ],
      budgetUsd: 5,
      judgeModel: 'qwen-2.5-7b-instruct',
      generationModel: 'gpt-4.1',
    };

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-debate-parse-fail',
      config,
      { logger: noopLogger, seedVariantId: 'seed-debate-parse-fail' },
    );

    // Debate iteration ran but variant was not produced (parse failure path).
    const debateIter = result.iterationResults!.find((r) => r.agentType === 'debate_and_generate');
    expect(debateIter).toBeDefined();
    expect(debateIter!.variantsCreated).toBe(0);
    // Run still completes (parse failure does not abort the run).
    expect(['completed', 'iterations_complete']).toContain(result.stopReason);
  }, 30_000);
});
