// Unit tests for settings-key/prompt hashing and the hard cost-ceiling guard.

import {
  buildPromptVariantHash,
  buildSettingsKey,
  assertWithinJudgeEvalCap,
  plannedCalls,
  JudgeEvalCapExceededError,
  JudgeEvalDisabledError,
  type SettingsKeyInput,
} from './settings';

describe('buildPromptVariantHash', () => {
  it('is deterministic and distinguishes mode + custom prompt', () => {
    expect(buildPromptVariantHash('article')).toBe(buildPromptVariantHash('article'));
    expect(buildPromptVariantHash('article')).not.toBe(buildPromptVariantHash('paragraph'));
    expect(buildPromptVariantHash('article')).not.toBe(
      buildPromptVariantHash('article', 'custom rubric'),
    );
  });
});

describe('buildSettingsKey', () => {
  const base: SettingsKeyInput = {
    judgeModel: 'qwen-2.5-7b-instruct',
    temperature: 0,
    reasoningEffort: null,
    promptVariantHash: 'abc',
    kindFilter: 'both',
    testSetId: '00000000-0000-4000-8000-000000000001',
  };

  it('collapses identical settings on the same test set', () => {
    expect(buildSettingsKey(base)).toBe(buildSettingsKey({ ...base }));
  });

  it('differs when the test set differs', () => {
    expect(buildSettingsKey(base)).not.toBe(
      buildSettingsKey({ ...base, testSetId: '00000000-0000-4000-8000-000000000002' }),
    );
  });

  it('differs when temperature differs', () => {
    expect(buildSettingsKey(base)).not.toBe(buildSettingsKey({ ...base, temperature: 1 }));
  });
});

describe('plannedCalls', () => {
  it('is cells × pairs × repeats × 2 (forward + reverse)', () => {
    expect(plannedCalls(8, 100, 10)).toBe(16000);
  });
});

describe('assertWithinJudgeEvalCap', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('passes for a small sweep under the defaults', () => {
    const r = assertWithinJudgeEvalCap({ cells: 2, matchingPairs: 20, repeats: 5, estimatedCostUsd: 0.5 });
    expect(r.plannedCalls).toBe(400);
  });

  it('throws when planned calls exceed JUDGE_EVAL_MAX_CALLS', () => {
    expect(() =>
      assertWithinJudgeEvalCap({ cells: 8, matchingPairs: 8861, repeats: 10, estimatedCostUsd: 1 }),
    ).toThrow(JudgeEvalCapExceededError);
  });

  it('throws when estimated cost exceeds JUDGE_EVAL_MAX_USD', () => {
    expect(() =>
      assertWithinJudgeEvalCap({ cells: 1, matchingPairs: 10, repeats: 1, estimatedCostUsd: 999 }),
    ).toThrow(JudgeEvalCapExceededError);
  });

  it('respects a lowered JUDGE_EVAL_MAX_CALLS env override', () => {
    process.env.JUDGE_EVAL_MAX_CALLS = '100';
    expect(() =>
      assertWithinJudgeEvalCap({ cells: 1, matchingPairs: 100, repeats: 1, estimatedCostUsd: 0 }),
    ).toThrow(JudgeEvalCapExceededError);
  });

  it('throws JudgeEvalDisabledError when JUDGE_EVAL_ENABLED=false', () => {
    process.env.JUDGE_EVAL_ENABLED = 'false';
    expect(() =>
      assertWithinJudgeEvalCap({ cells: 1, matchingPairs: 1, repeats: 1, estimatedCostUsd: 0 }),
    ).toThrow(JudgeEvalDisabledError);
  });
});
