// Unit tests for the branded CallSource registry, factories, and caller-name capture.

import {
  CALL_SOURCES,
  CALL_SOURCE_SHAPE,
  evolutionSource,
  testSource,
  captureCallerName,
} from '@/lib/services/llmCallSource';

describe('llmCallSource', () => {
  describe('CALL_SOURCES registry', () => {
    it('every member matches the call_source shape', () => {
      for (const value of Object.values(CALL_SOURCES)) {
        expect(value).toMatch(CALL_SOURCE_SHAPE);
      }
    });

    it('importArticle has no source suffix (normalized cardinality)', () => {
      expect(CALL_SOURCES.importArticle).toBe('importArticle');
    });

    it('evolution_* registry entries keep the evolution_ prefix', () => {
      expect(CALL_SOURCES.evolutionJudgeEval).toBe('evolution_judge_eval');
      expect(CALL_SOURCES.evolutionPromptEditor).toBe('evolution_prompt_editor');
    });
  });

  describe('evolutionSource', () => {
    it('prefixes the agent name', () => {
      expect(evolutionSource('generation')).toBe('evolution_generation');
      expect(evolutionSource('ranking')).toBe('evolution_ranking');
    });
  });

  describe('testSource', () => {
    it('round-trips an arbitrary string as a CallSource', () => {
      expect(testSource('test_source')).toBe('test_source');
    });
  });

  describe('captureCallerName', () => {
    function namedCaller(): string {
      return captureCallerName();
    }

    it('returns a non-empty caller from a real stack', () => {
      const caller = namedCaller();
      expect(typeof caller).toBe('string');
      expect(caller.length).toBeGreaterThan(0);
    });

    it("returns 'anonymous' when the stack is unavailable", () => {
      const spy = jest
        .spyOn(global, 'Error')
        .mockImplementation(() => ({ stack: undefined }) as unknown as Error);
      try {
        expect(captureCallerName()).toBe('anonymous');
      } finally {
        spy.mockRestore();
      }
    });
  });
});
