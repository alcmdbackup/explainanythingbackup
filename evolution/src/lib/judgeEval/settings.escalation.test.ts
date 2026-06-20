// Tests for the escalation-aware additions to settings.ts: the chain+rule settings key and the
// worst-case (chainCap) cost gate. Single-judge behavior must stay byte-identical.

import {
  buildSettingsKey,
  buildEscalationSettingsKey,
  plannedCalls,
  assertWithinJudgeEvalCap,
  JudgeEvalCapExceededError,
  type EscalationSettingsKeyInput,
} from './settings';

const baseKey: EscalationSettingsKeyInput = {
  chainModels: { article: ['gpt-4o-mini', 'deepseek-chat'], paragraph: ['google/gemini-2.5-flash-lite'] },
  aggregationRule: 'first_decisive',
  aggregationRuleVersion: 1,
  cap: 3,
  temperature: 0,
  reasoningEffort: null,
  promptVariantHash: 'abc',
  kindFilter: 'article',
  testSetId: 'ts1',
};

describe('buildEscalationSettingsKey', () => {
  it('is deterministic', () => {
    expect(buildEscalationSettingsKey(baseKey)).toBe(buildEscalationSettingsKey({ ...baseKey }));
  });

  it('never collides with a single-judge settings key', () => {
    const single = buildSettingsKey({
      judgeModel: 'gpt-4o-mini',
      temperature: 0,
      reasoningEffort: null,
      promptVariantHash: 'abc',
      kindFilter: 'article',
      testSetId: 'ts1',
    });
    expect(buildEscalationSettingsKey(baseKey)).not.toBe(single);
  });

  it('changes with rule, version, cap, and chain composition', () => {
    const k0 = buildEscalationSettingsKey(baseKey);
    expect(buildEscalationSettingsKey({ ...baseKey, aggregationRule: 'unanimous_among_decisive' })).not.toBe(k0);
    expect(buildEscalationSettingsKey({ ...baseKey, aggregationRuleVersion: 2 })).not.toBe(k0);
    expect(buildEscalationSettingsKey({ ...baseKey, cap: 2 })).not.toBe(k0);
    expect(
      buildEscalationSettingsKey({ ...baseKey, chainModels: { article: ['gpt-4o-mini'], paragraph: [] } }),
    ).not.toBe(k0);
  });
});

describe('plannedCalls (escalation-aware)', () => {
  it('chainCap default 1 is byte-identical to single-judge', () => {
    expect(plannedCalls(2, 30, 5)).toBe(2 * 30 * 5 * 2);
    expect(plannedCalls(2, 30, 5, 1)).toBe(plannedCalls(2, 30, 5));
  });

  it('scales by the worst-case chain cap', () => {
    expect(plannedCalls(1, 100, 10, 3)).toBe(1 * 100 * 10 * 2 * 3);
  });
});

describe('assertWithinJudgeEvalCap (worst-case chain)', () => {
  it('rejects an escalation sweep on worst case even when single-judge would pass', () => {
    const single = { cells: 1, matchingPairs: 500, repeats: 10, estimatedCostUsd: 0 };
    // single-judge: 10000 calls < 20000 default -> OK
    expect(() => assertWithinJudgeEvalCap(single)).not.toThrow();
    // escalation worst-case (cap 3): 30000 calls > 20000 default -> rejected
    expect(() => assertWithinJudgeEvalCap({ ...single, chainCap: 3 })).toThrow(JudgeEvalCapExceededError);
  });
});
