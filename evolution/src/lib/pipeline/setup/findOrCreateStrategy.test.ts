// Tests for V2 forked strategy config utilities.

import { hashStrategyConfig, labelStrategyConfig, upsertStrategy } from './findOrCreateStrategy';
import type { StrategyConfig } from '../infra/types';

describe('V2 hashStrategyConfig', () => {
  const baseConfig: StrategyConfig = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
  };

  it('produces a v2-prefixed 12-char hex string', () => {
    const hash = hashStrategyConfig(baseConfig);
    expect(hash).toMatch(/^v2:[0-9a-f]{12}$/);
  });

  it('is deterministic', () => {
    expect(hashStrategyConfig(baseConfig)).toBe(hashStrategyConfig(baseConfig));
  });

  // v2: the hash now covers the ENTIRE config. budgetUsd (a top-level field that v1
  // dropped) MUST change the hash so two strategies differing only in budget are distinct.
  it('INCLUDES top-level budgetUsd in the hash (v2 full-config)', () => {
    const withBudget: StrategyConfig = {
      ...baseConfig,
      budgetUsd: 5.0,
    };
    expect(hashStrategyConfig(withBudget)).not.toBe(hashStrategyConfig(baseConfig));
  });

  it('changes hash when core fields differ', () => {
    const different: StrategyConfig = { ...baseConfig, iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }] };
    expect(hashStrategyConfig(different)).not.toBe(hashStrategyConfig(baseConfig));
  });

  // Phase 5 / 5a-1: seedSelection field added.
  // (a) absent-field stability: strategy WITHOUT seedSelection produces the same
  //     hash as a pre-Phase-5 strategy with same other fields (canonicalize drops
  //     undefined keys, so back-compat is preserved for every existing strategy).
  // (b) present-field distinctness: strategies with different seedSelection values
  //     produce different hashes (otherwise re-run dedup would silently collide).
  it('seedSelection absent matches a baseConfig without the field (back-compat)', () => {
    const withoutField: StrategyConfig = { ...baseConfig };
    const withUndefined: StrategyConfig = { ...baseConfig, seedSelection: undefined };
    expect(hashStrategyConfig(withoutField)).toBe(hashStrategyConfig(withUndefined));
  });

  it('seedSelection distinct values produce distinct hashes', () => {
    const highestElo: StrategyConfig = { ...baseConfig, seedSelection: 'highest_elo' };
    const random: StrategyConfig = { ...baseConfig, seedSelection: 'random' };
    expect(hashStrategyConfig(highestElo)).not.toBe(hashStrategyConfig(random));
    // Same-value idempotency: two strategies with identical seedSelection share a hash.
    const random2: StrategyConfig = { ...baseConfig, seedSelection: 'random' };
    expect(hashStrategyConfig(random)).toBe(hashStrategyConfig(random2));
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
    // v2 re-baseline: canonicalization deliberately changed (whitelist → full-config),
    // so the format is now `v2:<12 hex>` (length 15). This guard now protects the v2 rule.
    expect(hash).toMatch(/^v2:[0-9a-f]{12}$/);
    expect(hash.length).toBe(15);
    // Recomputing twice must always be byte-identical (deterministic).
    expect(hashStrategyConfig(legacy)).toBe(hash);
  });

  // ─── v2 full-config: newly-activated TOP-LEVEL fields (v1 hashed none of these) ───
  it('INCLUDES every newly-activated top-level field in the hash', () => {
    const base = hashStrategyConfig(baseConfig);
    const variants: StrategyConfig[] = [
      { ...baseConfig, generationTemperature: 1.5 },
      { ...baseConfig, maxComparisonsPerVariant: 7 },
      { ...baseConfig, editingModel: 'gpt-4.1-nano' },
      { ...baseConfig, approverModel: 'gpt-4.1-nano' },
      { ...baseConfig, debateJudgeReasoningEffort: 'high', judgeModel: 'o4-mini' },
      { ...baseConfig, minBudgetAfterParallelFraction: 0.2 },
      { ...baseConfig, minBudgetAfterParallelAgentMultiple: 2 },
      { ...baseConfig, minBudgetAfterSequentialFraction: 0.1 },
      { ...baseConfig, minBudgetAfterSequentialAgentMultiple: 1.5 },
    ];
    for (const v of variants) {
      expect(hashStrategyConfig(v)).not.toBe(base);
    }
  });

  it('INCLUDES top-level generationGuidance but is order-insensitive (unordered set)', () => {
    const guideAB: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
      generationGuidance: [{ tactic: 'alpha', percent: 60 }, { tactic: 'beta', percent: 40 }],
    };
    const guideBA: StrategyConfig = {
      ...guideAB,
      generationGuidance: [{ tactic: 'beta', percent: 40 }, { tactic: 'alpha', percent: 60 }],
    };
    const noGuide: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
    };
    // reorder → same hash (set), but present → different from absent.
    expect(hashStrategyConfig(guideAB)).toBe(hashStrategyConfig(guideBA));
    expect(hashStrategyConfig(guideAB)).not.toBe(hashStrategyConfig(noGuide));
  });

  // ─── v2 full-config: newly-activated PER-ITERATION fields ───
  it('INCLUDES newly-activated per-iteration fields in the hash', () => {
    const pr = (extra: Record<string, unknown>): StrategyConfig => ({
      ...baseConfig,
      iterationConfigs: [{ agentType: 'paragraph_recombine', budgetPercent: 100, ...extra } as StrategyConfig['iterationConfigs'][number]],
    });
    const base = hashStrategyConfig(pr({}));
    expect(hashStrategyConfig(pr({ rewritesPerParagraph: 6 }))).not.toBe(base);
    expect(hashStrategyConfig(pr({ maxComparisonsPerParagraph: 8 }))).not.toBe(base);
    expect(hashStrategyConfig(pr({ maxParagraphsPerInvocation: 20 }))).not.toBe(base);
    expect(hashStrategyConfig(pr({ paragraphRewriteModel: 'gpt-4.1-nano' }))).not.toBe(base);

    const edit = (extra: Record<string, unknown>): StrategyConfig => ({
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'iterative_editing_rewrite', budgetPercent: 50, ...extra } as StrategyConfig['iterationConfigs'][number],
      ],
    });
    const editBase = hashStrategyConfig(edit({}));
    expect(hashStrategyConfig(edit({ editingMaxCycles: 4 }))).not.toBe(editBase);
    expect(hashStrategyConfig(edit({ editingProposerSoftCap: 2 }))).not.toBe(editBase);
  });

  // ─── v2 default-folding: omitted ≡ explicit-default (preserve dedup) ───
  it('folds paragraph_recombine runtime defaults: omitted === explicit default', () => {
    const omitted: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [{ agentType: 'paragraph_recombine', budgetPercent: 100 }],
    };
    const explicitDefaults: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [{ agentType: 'paragraph_recombine', budgetPercent: 100, maxDispatches: 1, perInvocationCapUsd: 0.05 }],
    };
    expect(hashStrategyConfig(omitted)).toBe(hashStrategyConfig(explicitDefaults));
  });

  // ─── v2 D1.4: deprecated budget-floor aliases must not split (parse vs action path) ───
  it('strips deprecated budgetBufferAfter* aliases (parse-path vs action-path equivalence)', () => {
    const withNewOnly: StrategyConfig = { ...baseConfig, minBudgetAfterParallelFraction: 0.2 };
    // Simulate the parse path where preprocessBudgetFloor mirrored the value into the alias.
    const withMirroredAlias = { ...withNewOnly, budgetBufferAfterParallel: 0.2 } as StrategyConfig;
    expect(hashStrategyConfig(withNewOnly)).toBe(hashStrategyConfig(withMirroredAlias));
  });

  // ─── v2 D4: number rounding to 0.001 floor, including nested leaves ───
  it('rounds numbers to a 0.001 floor: 40 === 40.0; 0.05 === 0.0500005; 0.05 !== 0.051', () => {
    const t = (temp: number): StrategyConfig => ({ ...baseConfig, generationTemperature: temp });
    expect(hashStrategyConfig(t(40 as number))).toBe(hashStrategyConfig(t(40.0)));
    expect(hashStrategyConfig(t(0.05))).toBe(hashStrategyConfig(t(0.0500005)));
    expect(hashStrategyConfig(t(0.05))).not.toBe(hashStrategyConfig(t(0.051)));
  });

  it('rounds NESTED numeric leaves (qualityCutoff.value, generationGuidance[].percent)', () => {
    const qc = (value: number): StrategyConfig => ({
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'generate', budgetPercent: 50, sourceMode: 'pool', qualityCutoff: { mode: 'topPercent', value } },
      ],
    });
    expect(hashStrategyConfig(qc(25))).toBe(hashStrategyConfig(qc(25.0000004)));
    expect(hashStrategyConfig(qc(25))).not.toBe(hashStrategyConfig(qc(25.5)));

    const gg = (percent: number): StrategyConfig => ({
      ...baseConfig,
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
      generationGuidance: [{ tactic: 'alpha', percent }, { tactic: 'beta', percent: 100 - percent }],
    });
    expect(hashStrategyConfig(gg(60))).toBe(hashStrategyConfig(gg(60.0000003)));
    expect(hashStrategyConfig(gg(60))).not.toBe(hashStrategyConfig(gg(61)));
  });

  // ─── v2 regression-guard: already-hashed per-iteration fields the rewrite must PRESERVE ───
  it('PRESERVES distinctness for previously-hashed per-iteration fields', () => {
    const pr = (extra: Record<string, unknown>): StrategyConfig => ({
      ...baseConfig,
      iterationConfigs: [{ agentType: 'paragraph_recombine', budgetPercent: 100, ...extra } as StrategyConfig['iterationConfigs'][number]],
    });
    const base = hashStrategyConfig(pr({}));
    expect(hashStrategyConfig(pr({ maxDispatches: 5 }))).not.toBe(base);
    expect(hashStrategyConfig(pr({ parallelFloorFraction: 0.3 }))).not.toBe(base);
    expect(hashStrategyConfig(pr({ parallelFloorAgentMultiple: 2 }))).not.toBe(base);
    expect(hashStrategyConfig(pr({ sequentialFloorFraction: 0.1 }))).not.toBe(base);
    expect(hashStrategyConfig(pr({ sequentialFloorAgentMultiple: 1.5 }))).not.toBe(base);

    const spc = (extra: Record<string, unknown>): StrategyConfig => ({
      ...baseConfig,
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'single_pass_evaluate_criteria_and_generate', budgetPercent: 50, criteriaIds: ['11111111-1111-1111-1111-111111111111'], weakestK: 1, ...extra } as StrategyConfig['iterationConfigs'][number],
      ],
    });
    expect(hashStrategyConfig(spc({ redundancyJaccardThreshold: 0.5 }))).not.toBe(hashStrategyConfig(spc({})));
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

// J1.5 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): two
// strategies differing ONLY in `perInvocationCapUsd` must hash DIFFERENTLY so
// they don't collide on `config_hash` upsert. Pre-J1.5 the field was unhashed
// → silently corrupted the strategy registry.
describe('V2 hashStrategyConfig — paragraph_recombine perInvocationCapUsd (J1.5)', () => {
  const baseConfig: StrategyConfig = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterationConfigs: [
      { agentType: 'paragraph_recombine', budgetPercent: 100 },
    ],
  };

  it('hash differs when perInvocationCapUsd differs', () => {
    const withDefaultCap: StrategyConfig = baseConfig;
    const withSmallerCap: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [{ ...baseConfig.iterationConfigs[0]!, perInvocationCapUsd: 0.02 }],
    };
    const withLargerCap: StrategyConfig = {
      ...baseConfig,
      iterationConfigs: [{ ...baseConfig.iterationConfigs[0]!, perInvocationCapUsd: 0.10 }],
    };
    const h1 = hashStrategyConfig(withDefaultCap);
    const h2 = hashStrategyConfig(withSmallerCap);
    const h3 = hashStrategyConfig(withLargerCap);
    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
    expect(h1).not.toBe(h3);
  });

  it('hash is stable when perInvocationCapUsd is omitted (back-compat)', () => {
    expect(hashStrategyConfig(baseConfig)).toBe(hashStrategyConfig(baseConfig));
  });

  it('perInvocationCapUsd is NOT emitted for non-paragraph_recombine agents (refinement-rejected)', () => {
    // Schema refinement rejects perInvocationCapUsd on non-paragraph_recombine types,
    // so this assertion is mostly defensive — but if a future bug bypasses the refinement
    // we still want canonicalizeIterationConfig to leave the field out.
    const baseGenerate: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
    };
    const withCapOnGenerate = {
      ...baseGenerate,
      iterationConfigs: [
        // Casting around the refinement to test the canonicalize whitelist directly.
        { ...baseGenerate.iterationConfigs[0]!, perInvocationCapUsd: 0.10 } as StrategyConfig['iterationConfigs'][number],
      ],
    };
    expect(hashStrategyConfig(withCapOnGenerate)).toBe(hashStrategyConfig(baseGenerate));
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

  // D2: the v2 hash carries a `v2:` prefix; the derived strategy NAME must strip it
  // before slicing, otherwise names read "Strategy v2:abc (...)".
  it('derives a strategy name from the bare hex, NOT the v2: prefix', async () => {
    let capturedName: string | undefined;
    const fakeDb = {
      from: () => ({
        upsert: (payload: { name: string }) => {
          capturedName = payload.name;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'abc' }, error: null }),
            }),
          };
        },
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await upsertStrategy(fakeDb, baseConfig);
    expect(capturedName).toBeDefined();
    expect(capturedName).not.toContain('v2:');
    expect(capturedName).toMatch(/^Strategy [0-9a-f]{6} \(/);
  });
});
