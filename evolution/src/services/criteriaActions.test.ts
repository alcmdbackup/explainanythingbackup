// Tests for criteriaActions: validateCriteriaIds + getCriteriaForEvaluation
// (the non-`'use server'` helpers used directly from the pipeline).

import { validateCriteriaIds, getCriteriaForEvaluation } from './criteriaActions';

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';

function mockDbWithRows(rows: Array<{ id: string; [k: string]: unknown }>, opts: {
  error?: { message: string } | null;
} = {}) {
  const queryStub: Record<string, jest.Mock> = {};
  queryStub.select = jest.fn(() => queryStub);
  queryStub.in = jest.fn(() => queryStub);
  queryStub.eq = jest.fn(() => queryStub);
  queryStub.is = jest.fn(() => Promise.resolve({ data: rows, error: opts.error ?? null }));
  return {
    from: jest.fn(() => queryStub),
  } as never;
}

describe('validateCriteriaIds', () => {
  it('returns silently when all UUIDs found', async () => {
    const db = mockDbWithRows([{ id: C1 }, { id: C2 }]);
    await expect(validateCriteriaIds([C1, C2], db)).resolves.toBeUndefined();
  });

  it('throws when any UUID is missing (archived/deleted/nonexistent)', async () => {
    const db = mockDbWithRows([{ id: C1 }]); // C2 missing
    await expect(validateCriteriaIds([C1, C2], db))
      .rejects.toThrow(/references 1 criteria.*archived\/deleted/);
  });

  it('lists all missing UUIDs in error message', async () => {
    const db = mockDbWithRows([]);
    await expect(validateCriteriaIds([C1, C2, C3], db))
      .rejects.toThrow(new RegExp(`${C1}.*${C2}.*${C3}`));
  });

  it('no-op on empty array', async () => {
    const db = { from: jest.fn() } as never;
    await expect(validateCriteriaIds([], db)).resolves.toBeUndefined();
    expect((db as { from: jest.Mock }).from).not.toHaveBeenCalled();
  });

  it('wraps DB error', async () => {
    const db = mockDbWithRows([], { error: { message: 'connection refused' } });
    await expect(validateCriteriaIds([C1], db))
      .rejects.toThrow(/Criteria validation failed: connection refused/);
  });
});

describe('getCriteriaForEvaluation', () => {
  it('returns Map keyed by id with full row payload (incl. evaluation_guidance)', async () => {
    const rows = [
      { id: C1, name: 'clarity', description: 'd1', min_rating: 1, max_rating: 5,
        evaluation_guidance: [{ score: 3, description: 'fair' }] },
      { id: C2, name: 'engagement', description: null, min_rating: 1, max_rating: 5, evaluation_guidance: null },
    ];
    const db = mockDbWithRows(rows);
    const result = await getCriteriaForEvaluation(db, [C1, C2]);
    expect(result.size).toBe(2);
    expect(result.get(C1)?.name).toBe('clarity');
    expect(result.get(C1)?.evaluation_guidance).toEqual([{ score: 3, description: 'fair' }]);
    expect(result.get(C2)?.evaluation_guidance).toBeNull();
  });

  it('returns empty map on empty input', async () => {
    const db = { from: jest.fn() } as never;
    const result = await getCriteriaForEvaluation(db, []);
    expect(result.size).toBe(0);
    expect((db as { from: jest.Mock }).from).not.toHaveBeenCalled();
  });

  it('returns empty map and warns on DB error', async () => {
    const db = mockDbWithRows([], { error: { message: 'rls denied' } });
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const result = await getCriteriaForEvaluation(db, [C1], logger as never);
    expect(result.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      expect.objectContaining({ phaseName: 'criteria_prep' }),
    );
  });

  it('returns subset when DB returns fewer rows than requested', async () => {
    // Caller is responsible for surfacing a clear error when actively-missing criteria are
    // expected — the helper returns whatever the DB has.
    const db = mockDbWithRows([{ id: C1, name: 'clarity', description: '', min_rating: 1, max_rating: 5, evaluation_guidance: null }]);
    const result = await getCriteriaForEvaluation(db, [C1, C2, C3]);
    expect(result.size).toBe(1);
    expect(result.get(C1)).toBeDefined();
    expect(result.get(C2)).toBeUndefined();
  });
});
