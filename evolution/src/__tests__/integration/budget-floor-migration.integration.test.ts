// Integration test: verifies that legacy `budgetBufferAfter*` field shapes
// (from pre-Phase-3 production strategy configs) migrate cleanly through the
// Zod preprocess into the new `minBudgetAfter*Fraction` fields, and that the
// new dual-unit shapes (both fraction and agent-multiple modes) parse correctly.
//
// Uses a checked-in fixture file rather than live DB access so tests are
// deterministic and don't require staging credentials at test time.

import { strategyConfigSchema } from '../../lib/schemas';
import fixtureData from '../../../../src/__tests__/integration/__fixtures__/staging-strategies-2026-04-13.json';

interface Fixture {
  label: string;
  config: Record<string, unknown>;
}

describe('budget floor migration — legacy → new', () => {
  const fixtures = fixtureData.fixtures as Fixture[];

  it('parses all snapshot fixtures without error', () => {
    for (const fixture of fixtures) {
      const result = strategyConfigSchema.safeParse(fixture.config);
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error(`Fixture "${fixture.label}" failed:`, result.error);
      }
    }
  });

  it('legacy-only config migrates budgetBufferAfterParallel → minBudgetAfterParallelFraction', () => {
    const legacy = fixtures.find((f) => f.label === 'legacy-only config (pre-Phase-3)')!;
    const parsed = strategyConfigSchema.parse(legacy.config);

    expect(parsed.minBudgetAfterParallelFraction).toBe(0.40);
    expect(parsed.minBudgetAfterSequentialFraction).toBe(0.15);
    // Legacy aliases retained in output for one-release rollback safety
    expect(parsed.budgetBufferAfterParallel).toBe(0.40);
    expect(parsed.budgetBufferAfterSequential).toBe(0.15);
  });

  it('legacy-minimal config (no floors) parses with floors undefined', () => {
    const minimal = fixtures.find((f) => f.label === 'legacy minimal (no floors)')!;
    const parsed = strategyConfigSchema.parse(minimal.config);

    expect(parsed.minBudgetAfterParallelFraction).toBeUndefined();
    expect(parsed.minBudgetAfterParallelAgentMultiple).toBeUndefined();
    expect(parsed.minBudgetAfterSequentialFraction).toBeUndefined();
    expect(parsed.minBudgetAfterSequentialAgentMultiple).toBeUndefined();
  });

  it('new fraction-mode config round-trips unchanged', () => {
    const modern = fixtures.find((f) => f.label === 'new dual-unit fraction mode')!;
    const parsed = strategyConfigSchema.parse(modern.config);

    expect(parsed.minBudgetAfterParallelFraction).toBe(0.35);
    expect(parsed.minBudgetAfterSequentialFraction).toBe(0.12);
    expect(parsed.minBudgetAfterParallelAgentMultiple).toBeUndefined();
    expect(parsed.minBudgetAfterSequentialAgentMultiple).toBeUndefined();
  });

  it('new agent-multiple config round-trips unchanged; legacy aliases remain undefined', () => {
    const agentMult = fixtures.find((f) => f.label === 'new dual-unit agent-multiple mode')!;
    const parsed = strategyConfigSchema.parse(agentMult.config);

    expect(parsed.minBudgetAfterParallelAgentMultiple).toBe(3);
    expect(parsed.minBudgetAfterSequentialAgentMultiple).toBe(1);
    expect(parsed.minBudgetAfterParallelFraction).toBeUndefined();
    expect(parsed.minBudgetAfterSequentialFraction).toBeUndefined();
    // Agent-multiple mode has no legacy equivalent — aliases stay undefined
    expect(parsed.budgetBufferAfterParallel).toBeUndefined();
    expect(parsed.budgetBufferAfterSequential).toBeUndefined();
  });

  it('when both legacy and new fraction are present, new wins and legacy is overwritten to match', () => {
    const bothConfig = {
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'gpt-4.1-nano',
      iterations: 1,
      budgetBufferAfterParallel: 0.10,
      minBudgetAfterParallelFraction: 0.50,
    };
    const parsed = strategyConfigSchema.parse(bothConfig);

    expect(parsed.minBudgetAfterParallelFraction).toBe(0.50);
    // Legacy alias synced to new value (for display consistency, pre-removal release)
    expect(parsed.budgetBufferAfterParallel).toBe(0.50);
  });
});
