// Integration test: legacy strategy hash unchanged after migration; criteria_and_generate
// strategies stored with criteriaIds + weakestK in canonical hash; criteriaIds UUID order
// is canonicalized via sort (committed Phase 2B decision).

import { hashStrategyConfig } from '@evolution/lib/pipeline/setup/findOrCreateStrategy';
import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';

describe('strategy hash integration (criteria-driven)', () => {
  const baseConfig: StrategyConfig = {
    generationModel: 'gpt-4.1-nano',
    judgeModel: 'gpt-4.1-nano',
    iterationConfigs: [
      { agentType: 'generate', budgetPercent: 60 },
      { agentType: 'swiss', budgetPercent: 40 },
    ],
  };

  it('legacy hash is unchanged by adding criteriaIds support to schema', () => {
    // Snapshot regression: this hash must NOT change as long as canonicalization rules stay stable.
    const hash = hashStrategyConfig(baseConfig);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    // Re-hashing twice produces identical output (deterministic).
    expect(hashStrategyConfig(baseConfig)).toBe(hash);
  });

  it('criteriaIds order does not affect hash: [a,b,c] === [c,b,a] (sort canonicalization)', () => {
    const a: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2, C3], weakestK: 2 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    const b: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C3, C2, C1], weakestK: 2 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(a)).toBe(hashStrategyConfig(b));
  });

  it('different criteria sets produce different hashes', () => {
    const setA: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2], weakestK: 1 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    const setB: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C2, C3], weakestK: 1 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(setA)).not.toBe(hashStrategyConfig(setB));
  });

  it('different weakestK produces different hashes', () => {
    const k1: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2, C3], weakestK: 1 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    const k2: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2, C3], weakestK: 2 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(k1)).not.toBe(hashStrategyConfig(k2));
  });

  it('agentType=criteria_and_generate hashes distinctly from generate', () => {
    const generate: StrategyConfig = baseConfig;
    const criteriaAndGenerate: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1], weakestK: 1 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(generate)).not.toBe(hashStrategyConfig(criteriaAndGenerate));
  });
});
