// Tests for debateDispatch helpers: cascade resolver, top-2 selection,
// kill-switch resolver. (bring_back_debate_agent_20260506 Phase 2.8.)

import {
  resolveDebateJudgeReasoningEffort,
  resolveDebateDispatchRuntime,
  resolveDebateDispatchPlanner,
  resolveDebateEnabled,
} from './debateDispatch';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { createRating } from '../../shared/computeRatings';

function mkVariant(id: string): Variant {
  return { id, text: `text-${id}`, version: 1, parentIds: [], tactic: 'baseline', createdAt: 0, iterationBorn: 0 };
}

function mkRating(elo: number): Rating {
  return { ...createRating(), elo };
}

describe('resolveDebateJudgeReasoningEffort', () => {
  describe('cascade order', () => {
    it('returns iter-level when set (highest priority)', () => {
      const out = resolveDebateJudgeReasoningEffort(
        { debateJudgeReasoningEffort: 'high' },
        { judgeModel: 'qwen/qwen3-8b', debateJudgeReasoningEffort: 'low' },
      );
      expect(out).toBe('high');
    });

    it('falls back to strategy-level when iter is unset', () => {
      const out = resolveDebateJudgeReasoningEffort(
        {},
        { judgeModel: 'qwen/qwen3-8b', debateJudgeReasoningEffort: 'medium' },
      );
      expect(out).toBe('medium');
    });

    it('falls back to registry default when both iter + strategy are unset', () => {
      // gpt-oss-20b has defaultReasoningEffort='low' in MODEL_REGISTRY
      const out = resolveDebateJudgeReasoningEffort(
        {},
        { judgeModel: 'gpt-oss-20b' },
      );
      expect(out).toBe('low');
    });

    it('returns undefined when nothing in cascade is set', () => {
      // qwen-2.5-7b-instruct has supportsReasoning=false + no defaultReasoningEffort
      const out = resolveDebateJudgeReasoningEffort(
        {},
        { judgeModel: 'qwen-2.5-7b-instruct' },
      );
      expect(out).toBeUndefined();
    });
  });

  describe('defensive guard (Phase 2.5)', () => {
    it('drops effort + logs warn when judgeModel does not support reasoning', () => {
      const logger = { warn: jest.fn() };
      const metrics = { increment: jest.fn() };
      const out = resolveDebateJudgeReasoningEffort(
        { debateJudgeReasoningEffort: 'medium' },
        { judgeModel: 'gpt-4.1-nano' },  // supportsReasoning=false
        logger,
        metrics,
      );
      expect(out).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('does not support reasoning'),
        expect.objectContaining({
          judgeModel: 'gpt-4.1-nano',
          requestedEffort: 'medium',
          droppedReason: 'model_does_not_support_reasoning',
        }),
      );
      expect(metrics.increment).toHaveBeenCalledWith('debate_reasoning_effort_dropped');
    });

    it('does NOT drop when judgeModel supports reasoning', () => {
      const logger = { warn: jest.fn() };
      const metrics = { increment: jest.fn() };
      const out = resolveDebateJudgeReasoningEffort(
        { debateJudgeReasoningEffort: 'medium' },
        { judgeModel: 'qwen/qwen3-8b' },
        logger,
        metrics,
      );
      expect(out).toBe('medium');
      expect(logger.warn).not.toHaveBeenCalled();
      expect(metrics.increment).not.toHaveBeenCalled();
    });

    it('skips the guard when cascade resolves to undefined (no false-positive warns)', () => {
      const logger = { warn: jest.fn() };
      const out = resolveDebateJudgeReasoningEffort(
        {},
        { judgeModel: 'gpt-4.1-nano' },  // non-reasoning model AND no effort set → ok
        logger,
      );
      expect(out).toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});

describe('resolveDebateDispatchRuntime', () => {
  it('returns null when fewer than 2 eligible variants in pool', () => {
    const pool = [mkVariant('a')];
    const ratings = new Map([['a', mkRating(1300)]]);
    const out = resolveDebateDispatchRuntime({
      pool, arenaVariantIds: new Set(), iterationStartRatings: ratings,
    });
    expect(out).toBeNull();
  });

  it('selects the top-2 by Elo desc', () => {
    const pool = [mkVariant('a'), mkVariant('b'), mkVariant('c')];
    const ratings = new Map([
      ['a', mkRating(1100)],
      ['b', mkRating(1500)],
      ['c', mkRating(1300)],
    ]);
    const out = resolveDebateDispatchRuntime({
      pool, arenaVariantIds: new Set(), iterationStartRatings: ratings,
    });
    expect(out).not.toBeNull();
    expect(out!.variantA.id).toBe('b');  // highest Elo
    expect(out!.variantB.id).toBe('c');  // second-highest
  });

  it('uses lower id as deterministic tiebreak on Elo tie (Decision §12)', () => {
    const pool = [mkVariant('zzz'), mkVariant('aaa'), mkVariant('mmm')];
    const ratings = new Map([
      ['zzz', mkRating(1300)],
      ['aaa', mkRating(1300)],
      ['mmm', mkRating(1300)],
    ]);
    const out = resolveDebateDispatchRuntime({
      pool, arenaVariantIds: new Set(), iterationStartRatings: ratings,
    });
    expect(out).not.toBeNull();
    // Lower id wins on tie → 'aaa' first, 'mmm' second.
    expect(out!.variantA.id).toBe('aaa');
    expect(out!.variantB.id).toBe('mmm');
  });

  it('excludes arena variants from selection', () => {
    const pool = [mkVariant('a'), mkVariant('b'), mkVariant('c')];
    const ratings = new Map([
      ['a', mkRating(1500)],
      ['b', mkRating(1400)],
      ['c', mkRating(1300)],
    ]);
    const out = resolveDebateDispatchRuntime({
      pool,
      arenaVariantIds: new Set(['a']),  // 'a' is from arena, exclude
      iterationStartRatings: ratings,
    });
    expect(out).not.toBeNull();
    expect(out!.variantA.id).toBe('b');
    expect(out!.variantB.id).toBe('c');
  });

  it('excludes variants without a rating (no Elo basis for selection)', () => {
    const pool = [mkVariant('a'), mkVariant('b'), mkVariant('c')];
    const ratings = new Map([
      ['a', mkRating(1500)],
      ['b', mkRating(1400)],
      // 'c' has no rating
    ]);
    const out = resolveDebateDispatchRuntime({
      pool, arenaVariantIds: new Set(), iterationStartRatings: ratings,
    });
    expect(out).not.toBeNull();
    expect(out!.variantA.id).toBe('a');
    expect(out!.variantB.id).toBe('b');
  });
});

describe('resolveDebateDispatchPlanner', () => {
  it('returns willDispatch=true when projected pool size ≥ 2', () => {
    expect(resolveDebateDispatchPlanner({ projectedPoolSize: 2 }))
      .toEqual({ willDispatch: true, effectiveCap: 'unbounded' });
    expect(resolveDebateDispatchPlanner({ projectedPoolSize: 10 }))
      .toEqual({ willDispatch: true, effectiveCap: 'unbounded' });
  });

  it('returns willDispatch=false when projected pool size < 2', () => {
    expect(resolveDebateDispatchPlanner({ projectedPoolSize: 1 }))
      .toEqual({ willDispatch: false, effectiveCap: 'pool_too_small' });
    expect(resolveDebateDispatchPlanner({ projectedPoolSize: 0 }))
      .toEqual({ willDispatch: false, effectiveCap: 'pool_too_small' });
  });
});

describe('resolveDebateEnabled', () => {
  it('returns true when env var unset (default per Decision §11)', () => {
    expect(resolveDebateEnabled({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('returns true on any value other than literal "false"', () => {
    expect(resolveDebateEnabled({ NODE_ENV: 'test', EVOLUTION_DEBATE_ENABLED: 'true' })).toBe(true);
    expect(resolveDebateEnabled({ NODE_ENV: 'test', EVOLUTION_DEBATE_ENABLED: '0' })).toBe(true);
    expect(resolveDebateEnabled({ NODE_ENV: 'test', EVOLUTION_DEBATE_ENABLED: 'no' })).toBe(true);
    expect(resolveDebateEnabled({ NODE_ENV: 'test', EVOLUTION_DEBATE_ENABLED: '' })).toBe(true);
    expect(resolveDebateEnabled({ NODE_ENV: 'test', EVOLUTION_DEBATE_ENABLED: 'False' })).toBe(true);  // case-sensitive
  });

  it('returns false ONLY on the literal string "false"', () => {
    expect(resolveDebateEnabled({ NODE_ENV: 'test', EVOLUTION_DEBATE_ENABLED: 'false' })).toBe(false);
  });
});
