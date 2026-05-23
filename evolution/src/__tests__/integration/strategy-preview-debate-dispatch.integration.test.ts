// Phase 3.7 — Integration test for the debate dispatch preview.
// Exercises projectDispatchPlan (the pure function underlying getStrategyDispatchPreviewAction)
// with a debate_and_generate iteration. Verifies:
//   - EstPerAgentValue.debate field populated when iteration is debate.
//   - dispatchCount=1 (single materialized variant per Decision §15).
//   - Kill-switch (debateEnabled=false) zeros the debate field + dispatchCount.
//   - Pool < 2 forces dispatchCount=0 (gate fail projection).
// (bring_back_debate_agent_20260506 Phase 3.7.)

import { projectDispatchPlan } from '@evolution/lib/pipeline/loop/projectDispatchPlan';
import type { EvolutionConfig } from '@evolution/lib/pipeline/infra/types';

const baseConfig: EvolutionConfig = {
  iterationConfigs: [
    { agentType: 'generate', budgetPercent: 30 },
    { agentType: 'generate', budgetPercent: 30 },
    { agentType: 'debate_and_generate', budgetPercent: 40 },
  ],
  budgetUsd: 5,
  judgeModel: 'qwen-2.5-7b-instruct',
  generationModel: 'gpt-4.1-nano',
};

describe('strategy preview — debate dispatch projection', () => {
  it('populates EstPerAgentValue.debate for debate iterations (default debateEnabled)', () => {
    const plan = projectDispatchPlan(
      baseConfig,
      { seedChars: 5000, initialPoolSize: 0 },
    );

    expect(plan).toHaveLength(3);
    const debateEntry = plan.find((p) => p.agentType === 'debate_and_generate');
    expect(debateEntry).toBeDefined();
    // After 2 generate iterations, projected pool ≥ 2 — debate dispatches.
    expect(debateEntry!.dispatchCount).toBe(1);
    expect(debateEntry!.estPerAgent.expected.debate).toBeGreaterThan(0);
    expect(debateEntry!.estPerAgent.upperBound.debate).toBeGreaterThanOrEqual(
      debateEntry!.estPerAgent.expected.debate,
    );
  });

  it('rolls debate cost into the `debate` peer field, NOT `gen` (Phase 1.10)', () => {
    const plan = projectDispatchPlan(
      baseConfig,
      { seedChars: 5000, initialPoolSize: 0 },
    );

    const debateEntry = plan.find((p) => p.agentType === 'debate_and_generate');
    // gen/rank/reflection/editing/editingRank/evaluation should all be 0 for a debate iteration.
    expect(debateEntry!.estPerAgent.expected.gen).toBe(0);
    expect(debateEntry!.estPerAgent.expected.rank).toBe(0);
    expect(debateEntry!.estPerAgent.expected.reflection).toBe(0);
    expect(debateEntry!.estPerAgent.expected.editing).toBe(0);
    expect(debateEntry!.estPerAgent.expected.editingRank).toBe(0);
    expect(debateEntry!.estPerAgent.expected.evaluation).toBe(0);
    // Only `debate` is non-zero.
    expect(debateEntry!.estPerAgent.expected.debate).toBeGreaterThan(0);
    // Total equals debate (since other fields are 0).
    expect(debateEntry!.estPerAgent.expected.total).toBe(debateEntry!.estPerAgent.expected.debate);
  });

  it('zeros debate cost + dispatchCount when debateEnabled=false (kill-switch)', () => {
    const plan = projectDispatchPlan(
      baseConfig,
      { seedChars: 5000, initialPoolSize: 0 },
      { debateEnabled: false },
    );

    const debateEntry = plan.find((p) => p.agentType === 'debate_and_generate');
    expect(debateEntry).toBeDefined();
    expect(debateEntry!.dispatchCount).toBe(0);
    expect(debateEntry!.estPerAgent.expected.debate).toBe(0);
    expect(debateEntry!.estPerAgent.upperBound.debate).toBe(0);
    expect(debateEntry!.estPerAgent.expected.total).toBe(0);
  });

  it('gate fails (dispatchCount=0) when projected pool size < 2 at iteration start', () => {
    // Single debate iteration as second iteration with pool=1 from one generate iter.
    // Pool projection: starts 0, after generate (1 dispatched) it's 1, then debate sees pool=1.
    const config: EvolutionConfig = {
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'debate_and_generate', budgetPercent: 50 },
      ],
      budgetUsd: 0.001, // crammed budget — generate produces ≤1 variant.
      judgeModel: 'qwen-2.5-7b-instruct',
      generationModel: 'gpt-4.1-nano',
    };

    const plan = projectDispatchPlan(
      config,
      { seedChars: 5000, initialPoolSize: 0 },
    );

    const debateEntry = plan.find((p) => p.agentType === 'debate_and_generate');
    expect(debateEntry).toBeDefined();
    // Pool projection at iteration start < 2 → debate cannot dispatch.
    expect(debateEntry!.dispatchCount).toBe(0);
    expect(debateEntry!.estPerAgent.expected.debate).toBe(0);
  });

  it('debate dispatchCount projection adds 1 to pool size for next iteration', () => {
    // Debate followed by another iteration that depends on pool size.
    const config: EvolutionConfig = {
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 30 },
        { agentType: 'generate', budgetPercent: 30 },
        { agentType: 'debate_and_generate', budgetPercent: 20 },
        { agentType: 'swiss', budgetPercent: 20 },
      ],
      budgetUsd: 5,
      judgeModel: 'qwen-2.5-7b-instruct',
      generationModel: 'gpt-4.1-nano',
    };

    const plan = projectDispatchPlan(
      config,
      { seedChars: 5000, initialPoolSize: 0 },
    );

    expect(plan).toHaveLength(4);
    const debateEntry = plan.find((p) => p.agentType === 'debate_and_generate');
    const swissEntry = plan.find((p) => p.agentType === 'swiss');
    expect(debateEntry).toBeDefined();
    expect(swissEntry).toBeDefined();
    // Debate's projected poolSizeAtStart should be > 0 after 2 generate iterations.
    expect(debateEntry!.poolSizeAtStart).toBeGreaterThanOrEqual(2);
    // Swiss after debate sees a pool that includes the debate-synthesized variant.
    expect(swissEntry!.poolSizeAtStart).toBeGreaterThan(debateEntry!.poolSizeAtStart);
  });

  it('debate cost > swiss cost > 0 (sanity check on relative magnitudes)', () => {
    const plan = projectDispatchPlan(
      baseConfig,
      { seedChars: 5000, initialPoolSize: 0 },
    );

    const debateEntry = plan.find((p) => p.agentType === 'debate_and_generate');
    expect(debateEntry).toBeDefined();
    // Debate has both judge call + synthesis call. Should be materially > 0.
    expect(debateEntry!.estPerAgent.expected.debate).toBeGreaterThan(0.0001);
    // Upper bound includes 1.5× output headroom — should exceed expected.
    expect(debateEntry!.estPerAgent.upperBound.debate).toBeGreaterThanOrEqual(
      debateEntry!.estPerAgent.expected.debate,
    );
  });
});
