// Integration test for criteriaActions: confirms validateCriteriaIds + getCriteriaForEvaluation
// behave correctly against a chained Supabase mock (round-trip insert→select→validate without
// hitting a real DB). For real-DB CRUD round-trip, see the manual verification gate in the
// project plan.

import { validateCriteriaIds, getCriteriaForEvaluation } from '@evolution/services/criteriaActions';
import { evolutionCriteriaInsertSchema } from '@evolution/lib/schemas';

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';

function makeChainedMock(rows: Array<Record<string, unknown>>, opts: { error?: { message: string } } = {}) {
  const queryStub: Record<string, jest.Mock> = {};
  queryStub.select = jest.fn(() => queryStub);
  queryStub.in = jest.fn(() => queryStub);
  queryStub.eq = jest.fn(() => queryStub);
  queryStub.is = jest.fn(() => Promise.resolve({ data: rows, error: opts.error ?? null }));
  return { from: jest.fn(() => queryStub) };
}

describe('criteriaActions integration', () => {
  describe('validateCriteriaIds', () => {
    it('passes when every UUID resolves to an active row', async () => {
      const db = makeChainedMock([{ id: C1 }, { id: C2 }]) as never;
      await expect(validateCriteriaIds([C1, C2], db)).resolves.toBeUndefined();
    });

    it('rejects missing UUIDs with a clear message naming each', async () => {
      const db = makeChainedMock([]) as never;
      await expect(validateCriteriaIds([C1, C2, C3], db))
        .rejects.toThrow(new RegExp(`${C1}.*${C2}.*${C3}`));
    });

    it('wraps DB errors with a Strategy-friendly message', async () => {
      const db = makeChainedMock([], { error: { message: 'permission denied' } }) as never;
      await expect(validateCriteriaIds([C1], db))
        .rejects.toThrow(/Strategy references|Criteria validation failed/);
    });
  });

  describe('getCriteriaForEvaluation', () => {
    it('returns Map keyed by id with full criterion payload', async () => {
      const rows = [
        { id: C1, name: 'clarity', description: 'how clear', min_rating: 1, max_rating: 5,
          evaluation_guidance: [{ score: 3, description: 'fair' }] },
        { id: C2, name: 'engagement', description: null, min_rating: 1, max_rating: 5, evaluation_guidance: null },
      ];
      const db = makeChainedMock(rows) as never;
      const result = await getCriteriaForEvaluation(db, [C1, C2]);
      expect(result.size).toBe(2);
      expect(result.get(C1)?.evaluation_guidance).toEqual([{ score: 3, description: 'fair' }]);
      expect(result.get(C2)?.evaluation_guidance).toBeNull();
    });

    it('returns empty map on DB error (does not throw, warn-logs)', async () => {
      const db = makeChainedMock([], { error: { message: 'rls denied' } }) as never;
      const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const result = await getCriteriaForEvaluation(db, [C1], logger as never);
      expect(result.size).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('insert schema round-trip', () => {
    it('round-trips a populated rubric without mutation', () => {
      const input = {
        name: 'depth',
        description: 'how deep',
        min_rating: 1,
        max_rating: 10,
        evaluation_guidance: [
          { score: 1, description: 'surface' },
          { score: 5, description: 'fair' },
          { score: 10, description: 'thorough' },
        ],
      };
      const parsed = evolutionCriteriaInsertSchema.parse(input);
      expect(parsed).toEqual(expect.objectContaining(input));
    });

    it('rejects DB-equivalent CHECK violations: name with newline', () => {
      expect(() => evolutionCriteriaInsertSchema.parse({
        name: 'foo\nbar', description: 'd', min_rating: 1, max_rating: 5,
      })).toThrow();
    });

    it('rejects DB-equivalent CHECK violations: name with colon', () => {
      expect(() => evolutionCriteriaInsertSchema.parse({
        name: 'foo:bar', description: 'd', min_rating: 1, max_rating: 5,
      })).toThrow();
    });

    it('rejects rubric anchor outside [min_rating, max_rating]', () => {
      expect(() => evolutionCriteriaInsertSchema.parse({
        name: 'foo', description: 'd', min_rating: 1, max_rating: 5,
        evaluation_guidance: [{ score: 11, description: 'too high' }],
      })).toThrow();
    });
  });
});
