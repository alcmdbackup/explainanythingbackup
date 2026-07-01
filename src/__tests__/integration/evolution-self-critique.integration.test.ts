// Integration test for SelfCritiqueReviseAgent — verifies the full wrapper flow
// with a real Supabase client (for invocation + variant + metric writes) and a
// mocked LLM.
//
// Assertions:
//   - Invocation row created with agent_name='self_critique_revise'
//   - Execution detail carries populated reflection sub-object
//   - Variant is produced by GFPA and persisted (or discarded per surface/discard policy)
//   - self_critique_cost metric > 0 (reflection LLM call routes to self_critique bucket)
//   - generation_cost metric > 0 (inner GFPA generation)
//
// brainstorm_new_agents_with_reflection_20260630.

// Mock pricing so per-token cost is deterministic ($1/1M for both input and output).
jest.mock('@/config/llmPricing', () => ({
  getModelPricing: jest.fn(() => ({ inputPer1M: 1.0, outputPer1M: 1.0 })),
  calculateLLMCost: jest.fn(
    (_model: string, promptToks: number, completionToks: number, _reasoning: number) =>
      Math.round(((promptToks + completionToks) / 1_000_000) * 1_000_000) / 1_000_000,
  ),
}));

// Mock format validator so the mocked generation output is accepted.
jest.mock('@evolution/lib/shared/enforceVariantFormat', () => {
  const actual = jest.requireActual('@evolution/lib/shared/enforceVariantFormat');
  return {
    ...actual,
    validateFormat: jest.fn(() => ({ valid: true, issues: [] })),
  };
});

// Mock compareWithBiasMitigation so the ranking calls resolve deterministically
// without actually needing pair-matched mock responses.
jest.mock('@evolution/lib/shared/computeRatings', () => {
  const actual = jest.requireActual('@evolution/lib/shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => ({
      winner: 'A' as const,
      confidence: 1.0,
      turns: 2,
    })),
  };
});

import { randomUUID } from 'node:crypto';
import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import { SelfCritiqueReviseAgent } from '@evolution/lib/core/agents/selfCritiqueRevise';
import { createEvolutionLLMClient } from '@evolution/lib/pipeline/infra/createEvolutionLLMClient';
import { createCostTracker } from '@evolution/lib/pipeline/infra/trackBudget';
import { createRating } from '@evolution/lib/shared/computeRatings';
import { createV2MockLlm, VALID_VARIANT_TEXT } from '@evolution/testing/v2MockLlm';
import type { Variant, EvolutionLLMClient } from '@evolution/lib/types';
import type { Rating, ComparisonResult } from '@evolution/lib/shared/computeRatings';
import type { AgentContext } from '@evolution/lib/core/types';
import type { EvolutionConfig } from '@evolution/lib/pipeline/infra/types';
import type { AgentName } from '@evolution/lib/core/agentNames';

const VALID_REFLECTION = `ChangeKind: tighten throughout

Summary: The article uses too many hedge words that dilute the argument.

Plan: 1. Replace "might" with "does" throughout.
2. Delete filler phrases like "in some sense".
3. Sharpen the opening claim.`;

describe('SelfCritiqueReviseAgent — pipeline integration', () => {
  let db: ReturnType<typeof createTestSupabaseClient>;
  let tablesExist = false;
  const trackedRunIds: string[] = [];

  beforeAll(async () => {
    db = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(db);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    for (const runId of trackedRunIds) {
      await cleanupEvolutionData(db, { runIds: [runId] });
    }
  });

  it('produces a variant + writes self_critique_cost + populates reflection detail', async () => {
    if (!tablesExist) {
      // eslint-disable-next-line no-console
      console.log('[self-critique-integration] evolution tables not migrated — skipping');
      return;
    }

    // Seed prompt + run so the invocation row has valid FKs.
    const runId = randomUUID();
    const { error: promptErr, data: promptRow } = await db
      .from('evolution_prompts')
      .insert({
        prompt: `[TEST_EVO] Self-critique integration ${runId}`,
        name: `[TEST_EVO] Self-critique ${runId}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (promptErr) throw new Error(`seed prompt failed: ${promptErr.message}`);

    // Seed strategy row (config_hash needs to be unique).
    const { error: stratErr, data: stratRow } = await db
      .from('evolution_strategies')
      .insert({
        name: `[TEST_EVO] Self-critique strategy ${runId}`,
        config: { generationModel: 'gpt-4.1-nano', judgeModel: 'gpt-4.1-nano' },
        config_hash: `test-self-critique-${runId.slice(0, 12)}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (stratErr) throw new Error(`seed strategy failed: ${stratErr.message}`);

    const { error: runErr } = await db
      .from('evolution_runs')
      .insert({
        id: runId,
        prompt_id: promptRow!.id,
        strategy_id: stratRow!.id,
        status: 'running',
        budget_cap_usd: 1.0,
      });
    if (runErr) throw new Error(`seed run failed: ${runErr.message}`);
    trackedRunIds.push(runId);

    // Build the mocked LLM stack. self_critique label → reflection response,
    // generation label → default valid text, ranking handled by mocked
    // compareWithBiasMitigation above (so ranking LLM calls don't fire).
    const mockLlm = createV2MockLlm({
      labelResponses: {
        self_critique: VALID_REFLECTION,
        generation: VALID_VARIANT_TEXT,
      },
    });

    // Cost-tracking client bound to a fresh tracker.
    const costTracker = createCostTracker(1.0);
    const llmClient = createEvolutionLLMClient(
      {
        complete: async (
          prompt: string,
          label: AgentName,
          opts?: { model?: string; temperature?: number },
        ) => {
          const text = await mockLlm.complete(prompt, label, opts);
          // Return {text, usage} shape so token-based recordSpend fires.
          return {
            text,
            usage: {
              promptTokens: Math.ceil(prompt.length / 4),
              completionTokens: Math.ceil(text.length / 4),
            },
          };
        },
      },
      costTracker,
      'gpt-4.1-nano',
      // logger param (EntityLogger) — pass a minimal stub.
      undefined,
      undefined,
      undefined,
    );

    // Build AgentContext.
    const parentVariant: Variant = {
      id: randomUUID(),
      text: 'This is the parent article. It has some content that could be improved.',
      tactic: 'test',
      version: 0,
      parentIds: [],
      createdAt: Date.now(),
      iterationBorn: 0,
    };
    const initialRatings = new Map<string, Rating>();
    initialRatings.set(parentVariant.id, createRating());
    const initialMatchCounts = new Map<string, number>();
    const cache = new Map<string, ComparisonResult>();
    const config: EvolutionConfig = {
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'self_critique_revise', budgetPercent: 100 }],
      maxComparisonsPerVariant: 3,
      budgetUsd: 1.0,
    };
    const ctx: AgentContext = {
      db,
      runId,
      iteration: 1,
      executionOrder: 1,
      invocationId: '',
      randomSeed: BigInt(12345),
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as unknown as AgentContext['logger'],
      costTracker,
      config,
      promptId: promptRow!.id,
      strategyId: stratRow!.id,
      experimentId: undefined,
      runSource: 'test',
      agentIndex: 0,
      rawProvider: {
        complete: async (
          prompt: string,
          label: AgentName,
          opts?: { model?: string; temperature?: number },
        ) => {
          const text = await mockLlm.complete(prompt, label, opts);
          return {
            text,
            usage: {
              promptTokens: Math.ceil(prompt.length / 4),
              completionTokens: Math.ceil(text.length / 4),
            },
          };
        },
      },
      defaultModel: 'gpt-4.1-nano',
    };

    const agent = new SelfCritiqueReviseAgent();
    const output = await agent.run(
      {
        parentText: parentVariant.text,
        parentVariantId: parentVariant.id,
        initialPool: [parentVariant],
        initialRatings,
        initialMatchCounts,
        cache,
        llm: llmClient,
      },
      ctx,
    );

    // ─── Assertions ───────────────────────────────────────────
    expect(output).toBeDefined();

    // Invocation row was created.
    const { data: invocations } = await db
      .from('evolution_agent_invocations')
      .select('id, agent_name, execution_detail, cost_usd')
      .eq('run_id', runId)
      .eq('agent_name', 'self_critique_revise');
    expect(invocations).not.toBeNull();
    expect(invocations!.length).toBeGreaterThanOrEqual(1);

    const inv = invocations![0]!;
    const detail = inv.execution_detail as {
      detailType?: string;
      tactic?: string;
      reflection?: { changeKind?: string; summary?: string; plan?: string };
      surfaced?: boolean;
      guardrails?: { lengthCapHit?: boolean };
    } | null;
    expect(detail?.detailType).toBe('self_critique_revise');
    expect(detail?.tactic).toBe('self_critique_driven');
    expect(detail?.reflection?.changeKind).toBe('tighten throughout');
    expect(detail?.reflection?.summary).toContain('hedge words');
    expect(detail?.reflection?.plan).toContain('Replace');
    expect(detail?.guardrails?.lengthCapHit).toBeDefined();

    // self_critique_cost metric > 0.
    const { data: costMetric } = await db
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', 'self_critique_cost')
      .maybeSingle();
    expect(costMetric).not.toBeNull();
    expect(Number(costMetric!.value)).toBeGreaterThan(0);

    // generation_cost metric > 0 (inner GFPA generation LLM call landed correctly).
    const { data: genMetric } = await db
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', 'generation_cost')
      .maybeSingle();
    expect(genMetric).not.toBeNull();
    expect(Number(genMetric!.value)).toBeGreaterThan(0);
  }, 60_000);
});
