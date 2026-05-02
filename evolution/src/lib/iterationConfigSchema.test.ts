// Phase 2: Zod refine coverage for iterationConfigSchema and the strategy-level
// first-iteration-sourcemode rule.

import { iterationConfigSchema, strategyConfigSchema } from './schemas';

describe('iterationConfigSchema', () => {
  it('accepts a minimal generate iteration', () => {
    expect(() => iterationConfigSchema.parse({
      agentType: 'generate', budgetPercent: 60,
    })).not.toThrow();
  });

  it('accepts sourceMode=seed on generate', () => {
    expect(() => iterationConfigSchema.parse({
      agentType: 'generate', budgetPercent: 60, sourceMode: 'seed',
    })).not.toThrow();
  });

  it('accepts sourceMode=pool with qualityCutoff', () => {
    expect(() => iterationConfigSchema.parse({
      agentType: 'generate', budgetPercent: 60, sourceMode: 'pool',
      qualityCutoff: { mode: 'topN', value: 5 },
    })).not.toThrow();
  });

  it('rejects sourceMode=pool without qualityCutoff', () => {
    expect(() => iterationConfigSchema.parse({
      agentType: 'generate', budgetPercent: 60, sourceMode: 'pool',
    })).toThrow(/qualityCutoff required/);
  });

  it('rejects sourceMode on swiss iterations', () => {
    expect(() => iterationConfigSchema.parse({
      agentType: 'swiss', budgetPercent: 40, sourceMode: 'seed',
    })).toThrow(/sourceMode only valid for variant-producing iterations/);
  });

  it('rejects qualityCutoff on swiss iterations', () => {
    expect(() => iterationConfigSchema.parse({
      agentType: 'swiss', budgetPercent: 40,
      qualityCutoff: { mode: 'topN', value: 5 },
    })).toThrow(/qualityCutoff only valid for variant-producing iterations/);
  });

  it('silently strips maxAgents (Phase 4 removed the field; swiss or generate both OK)', () => {
    // Phase 4 deleted IterationConfig.maxAgents. Schemas use default .strip() so
    // legacy configs with maxAgents still parse cleanly (field is dropped).
    expect(() => iterationConfigSchema.parse({
      agentType: 'swiss', budgetPercent: 40, maxAgents: 5,
    })).not.toThrow();
  });

  it('accepts qualityCutoff with topPercent mode', () => {
    expect(() => iterationConfigSchema.parse({
      agentType: 'generate', budgetPercent: 60, sourceMode: 'pool',
      qualityCutoff: { mode: 'topPercent', value: 25 },
    })).not.toThrow();
  });
});

describe('strategyConfigSchema — first-iteration rule', () => {
  const base = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterationConfigs: [] as Array<Record<string, unknown>>,
  };

  it('rejects first iteration with sourceMode=pool', () => {
    expect(() => strategyConfigSchema.parse({
      ...base,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'pool',
          qualityCutoff: { mode: 'topN', value: 3 } },
        { agentType: 'generate', budgetPercent: 50 },
      ],
    })).toThrow(/First iteration cannot use sourceMode=pool/);
  });

  it('accepts first iteration with sourceMode=seed (or omitted)', () => {
    expect(() => strategyConfigSchema.parse({
      ...base,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 }, // sourceMode omitted → default seed
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'pool',
          qualityCutoff: { mode: 'topN', value: 3 } },
      ],
    })).not.toThrow();

    expect(() => strategyConfigSchema.parse({
      ...base,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'seed' },
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'pool',
          qualityCutoff: { mode: 'topPercent', value: 25 } },
      ],
    })).not.toThrow();
  });
});
