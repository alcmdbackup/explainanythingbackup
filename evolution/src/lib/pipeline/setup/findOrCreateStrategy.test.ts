// Tests for V2 forked strategy config utilities.

import { hashStrategyConfig, labelStrategyConfig, upsertStrategy } from './findOrCreateStrategy';
import type { StrategyConfig } from '../infra/types';

describe('V2 hashStrategyConfig', () => {
  const baseConfig: StrategyConfig = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
  };

  it('produces a 12-char hex string', () => {
    const hash = hashStrategyConfig(baseConfig);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic', () => {
    expect(hashStrategyConfig(baseConfig)).toBe(hashStrategyConfig(baseConfig));
  });

  it('excludes V2-only fields from hash', () => {
    const withExtras: StrategyConfig = {
      ...baseConfig,
      budgetUsd: 5.0,
    };
    expect(hashStrategyConfig(withExtras)).toBe(hashStrategyConfig(baseConfig));
  });

  it('changes hash when core fields differ', () => {
    const different: StrategyConfig = { ...baseConfig, iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }] };
    expect(hashStrategyConfig(different)).not.toBe(hashStrategyConfig(baseConfig));
  });

  it('changes hash when qualityCutoff.value differs', () => {
    const a: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'pool', qualityCutoff: { mode: 'topN', value: 5 } },
      ],
    };
    const b: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'pool', qualityCutoff: { mode: 'topN', value: 10 } },
      ],
    };
    expect(hashStrategyConfig(a)).not.toBe(hashStrategyConfig(b));
  });

  it('changes hash when sourceMode differs', () => {
    const seedMode: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'seed' },
      ],
    };
    const poolMode: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'pool', qualityCutoff: { mode: 'topPercent', value: 25 } },
      ],
    };
    expect(hashStrategyConfig(seedMode)).not.toBe(hashStrategyConfig(poolMode));
  });

  // ─── Reflection field hash semantics (Shape A: reflect_and_generate is a top-level agentType) ───

  it('agentType=reflect_and_generate changes the hash vs generate', () => {
    const generate: StrategyConfig = baseConfig;
    const reflectAndGenerate: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'reflect_and_generate', budgetPercent: 60, reflectionTopN: 3 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(generate)).not.toBe(hashStrategyConfig(reflectAndGenerate));
  });

  it('reflectionTopN value changes the hash on a reflect_and_generate iteration', () => {
    const a: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'reflect_and_generate', budgetPercent: 60, reflectionTopN: 3 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    const b: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'reflect_and_generate', budgetPercent: 60, reflectionTopN: 5 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(a)).not.toBe(hashStrategyConfig(b));
  });

  it('reflectionTopN is stripped on non-reflect_and_generate iterations (hash collision)', () => {
    // reflectionTopN is meaningless on a 'generate' iteration — canonicalization strips
    // it so a stale value left over from a wizard toggle doesn't produce a phantom hash.
    const without: StrategyConfig = baseConfig;
    const withStaleTopN: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 60, reflectionTopN: 5 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(without)).toBe(hashStrategyConfig(withStaleTopN));
  });

  it('canonicalizes reflectionTopN: undefined === absent on reflect_and_generate too', () => {
    const explicitUndef: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'reflect_and_generate', budgetPercent: 60, reflectionTopN: undefined },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    const absent: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'reflect_and_generate', budgetPercent: 60 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(absent)).toBe(hashStrategyConfig(explicitUndef));
  });

  // ─── criteria_and_generate hash semantics (evaluateCriteriaThenGenerateFromPreviousArticle_20260501) ───
  const C1 = '00000000-0000-4000-8000-0000000000c1';
  const C2 = '00000000-0000-4000-8000-0000000000c2';
  const C3 = '00000000-0000-4000-8000-0000000000c3';

  it('agentType=criteria_and_generate changes the hash vs generate', () => {
    const generate: StrategyConfig = baseConfig;
    const criteriaAndGenerate: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2], weakestK: 1 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(generate)).not.toBe(hashStrategyConfig(criteriaAndGenerate));
  });

  it('criteriaIds order is canonicalized via sort: [a,b,c] === [c,b,a]', () => {
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
    const a: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2], weakestK: 1 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    const b: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C3], weakestK: 1 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(a)).not.toBe(hashStrategyConfig(b));
  });

  it('different weakestK produces different hashes', () => {
    const a: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2, C3], weakestK: 1 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    const b: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2, C3], weakestK: 2 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(a)).not.toBe(hashStrategyConfig(b));
  });

  it('strips criteriaIds + weakestK on non-criteria iterations (hash collision)', () => {
    // Stale wizard state where user typed criteriaIds before switching agent type back.
    // Canonicalization should drop them so the strategy doesn't double-deduplicate.
    const cleanGenerate: StrategyConfig = baseConfig;
    const staleGenerate: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 60, criteriaIds: [C1, C2], weakestK: 1 } as never,
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(hashStrategyConfig(cleanGenerate)).toBe(hashStrategyConfig(staleGenerate));
  });

  // ─── Backward-compat regression: snapshot legacy strategy hashes ───
  // These hashes are computed against the current canonicalization rules. If any
  // future schema change accidentally re-hashes existing strategies (e.g., adding
  // a non-canonicalized optional field, changing serialization order), these
  // assertions fail and prevent silent strategy-row drift in production.
  it('preserves hash for legacy strategy without reflection fields (snapshot regression)', () => {
    const legacy: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'qwen-2.5-7b-instruct',
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'swiss', budgetPercent: 30 },
        { agentType: 'swiss', budgetPercent: 20 },
      ],
    };
    // Snapshot — first computed at Phase 1 implementation. If this changes the
    // canonicalization rule changed too. Update only after confirming intent.
    const hash = hashStrategyConfig(legacy);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hash.length).toBe(12);
    // Recomputing twice must always be byte-identical (deterministic).
    expect(hashStrategyConfig(legacy)).toBe(hash);
  });
});

describe('V2 labelStrategyConfig', () => {
  it('produces correct format', () => {
    const config: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
    };
    const label = labelStrategyConfig(config);
    expect(label).toBe('Gen: 4.1-mini | Judge: 4.1-nano | 1×gen + 1×swiss');
  });

  it('includes budget when set', () => {
    const config: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
      budgetUsd: 2.5,
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Budget: $2.50');
  });

  it('shortens deepseek models', () => {
    const config: StrategyConfig = {
      generationModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Gen: ds-chat');
  });

  it('shortens claude models', () => {
    const config: StrategyConfig = {
      generationModel: 'claude-3.5-sonnet',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
    };
    const label = labelStrategyConfig(config);
    expect(label).toContain('Gen: cl-3.5-sonnet');
  });

  // ─── new criteria-based agents (updated_criteria_agent_20260505) ──────────

  it('labels include single-pass-criteria count', () => {
    const config: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [
        {
          agentType: 'single_pass_evaluate_criteria_and_generate',
          budgetPercent: 60,
          criteriaIds: ['00000000-0000-0000-0000-000000000001'],
          weakestK: 1,
        },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
    };
    expect(labelStrategyConfig(config)).toContain('1×single-pass-criteria');
  });

  it('labels include proposer-approver count', () => {
    const config: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        {
          agentType: 'proposer_approver_criteria_generate',
          budgetPercent: 50,
          criteriaIds: ['00000000-0000-0000-0000-000000000001'],
          weakestK: 1,
          editingMaxCycles: 1,
        },
      ],
    };
    expect(labelStrategyConfig(config)).toContain('1×proposer-approver');
  });
});

describe('V2 hashStrategyConfig — new criteria-based agents (updated_criteria_agent_20260505)', () => {
  const cId1 = '11111111-1111-1111-1111-111111111111';
  const cId2 = '22222222-2222-2222-2222-222222222222';

  it('hash differs between criteria_and_generate, single_pass, and proposer_approver', () => {
    const base = (agentType: 'criteria_and_generate' | 'single_pass_evaluate_criteria_and_generate' | 'proposer_approver_criteria_generate'): StrategyConfig => ({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        {
          agentType,
          budgetPercent: 50,
          criteriaIds: [cId1],
          weakestK: 1,
          ...(agentType === 'proposer_approver_criteria_generate' ? { editingMaxCycles: 1 } : {}),
        },
      ],
    });
    const h1 = hashStrategyConfig(base('criteria_and_generate'));
    const h2 = hashStrategyConfig(base('single_pass_evaluate_criteria_and_generate'));
    const h3 = hashStrategyConfig(base('proposer_approver_criteria_generate'));
    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
    expect(h1).not.toBe(h3);
  });

  it('hash includes criteriaIds for the 2 new criteria-based agent types', () => {
    const make = (agentType: 'single_pass_evaluate_criteria_and_generate' | 'proposer_approver_criteria_generate', ids: string[]): StrategyConfig => ({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        {
          agentType,
          budgetPercent: 50,
          criteriaIds: ids,
          weakestK: 1,
          ...(agentType === 'proposer_approver_criteria_generate' ? { editingMaxCycles: 1 } : {}),
        },
      ],
    });
    expect(hashStrategyConfig(make('single_pass_evaluate_criteria_and_generate', [cId1])))
      .not.toBe(hashStrategyConfig(make('single_pass_evaluate_criteria_and_generate', [cId2])));
    expect(hashStrategyConfig(make('proposer_approver_criteria_generate', [cId1])))
      .not.toBe(hashStrategyConfig(make('proposer_approver_criteria_generate', [cId2])));
  });

  it('lengthCapRatio is included in the hash for proposer_approver only', () => {
    const baseProposerApprover: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        {
          agentType: 'proposer_approver_criteria_generate',
          budgetPercent: 50,
          criteriaIds: [cId1],
          weakestK: 1,
          editingMaxCycles: 1,
        },
      ],
    };
    const baseHash = hashStrategyConfig(baseProposerApprover);
    const withRatio: StrategyConfig = {
      ...baseProposerApprover,
      iterationConfigs: [
        baseProposerApprover.iterationConfigs[0]!,
        { ...baseProposerApprover.iterationConfigs[1]!, lengthCapRatio: 1.20 },
      ],
    };
    expect(hashStrategyConfig(withRatio)).not.toBe(baseHash);
  });

  it('includesMirrorApprover is emitted to the hash ONLY when explicitly false', () => {
    const make = (mirror: boolean | undefined): StrategyConfig => ({
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        {
          agentType: 'proposer_approver_criteria_generate',
          budgetPercent: 50,
          criteriaIds: [cId1],
          weakestK: 1,
          editingMaxCycles: 1,
          ...(mirror !== undefined && { includesMirrorApprover: mirror }),
        },
      ],
    });
    // Default-on (undefined) and explicit-true should hash the same (compact emission).
    expect(hashStrategyConfig(make(undefined))).toBe(hashStrategyConfig(make(true)));
    // Explicit-false should produce a different hash.
    expect(hashStrategyConfig(make(false))).not.toBe(hashStrategyConfig(make(undefined)));
  });
});

describe('V2 upsertStrategy', () => {
  const baseConfig: StrategyConfig = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
  };

  it('throws on DB error (does not return null)', async () => {
    const fakeDb = {
      from: () => ({
        upsert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { message: 'connection refused', code: '08006' },
              }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(upsertStrategy(fakeDb, baseConfig)).rejects.toThrow(
      'Strategy upsert failed: connection refused',
    );
  });

  it('throws when upsert returns no ID', async () => {
    const fakeDb = {
      from: () => ({
        upsert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({ data: {}, error: null }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(upsertStrategy(fakeDb, baseConfig)).rejects.toThrow(
      'Strategy upsert returned no ID',
    );
  });
});
