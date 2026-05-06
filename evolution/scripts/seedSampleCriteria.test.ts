// Tests for seedSampleCriteria: data shape validation and dry-run behavior.
// Catches typos in the inline data (anchor scores out of range, etc.) at test time.

import { SAMPLE_CRITERIA, seedSampleCriteria } from './seedSampleCriteria';
import { evolutionCriteriaInsertSchema } from '../src/lib/schemas';

describe('SAMPLE_CRITERIA', () => {
  it('contains exactly 7 entries', () => {
    expect(SAMPLE_CRITERIA).toHaveLength(7);
  });

  it('every entry passes evolutionCriteriaInsertSchema (catches data typos)', () => {
    for (const c of SAMPLE_CRITERIA) {
      const result = evolutionCriteriaInsertSchema.safeParse({
        name: c.name,
        description: c.description,
        min_rating: c.min_rating,
        max_rating: c.max_rating,
        evaluation_guidance: c.evaluation_guidance,
      });
      if (!result.success) {
        // Surface a clear failure pinpointing the offending criterion.
        // eslint-disable-next-line jest/no-conditional-expect
        expect({ name: c.name, errors: result.error.issues }).toEqual({ name: c.name, errors: [] });
      }
    }
  });

  it('every anchor score lies within its parent range [min_rating, max_rating]', () => {
    for (const c of SAMPLE_CRITERIA) {
      for (const a of c.evaluation_guidance) {
        expect(a.score).toBeGreaterThanOrEqual(c.min_rating);
        expect(a.score).toBeLessThanOrEqual(c.max_rating);
      }
    }
  });

  it('all names match the parser-safe regex', () => {
    const re = /^[A-Za-z][a-zA-Z0-9_-]*$/;
    for (const c of SAMPLE_CRITERIA) {
      expect(c.name).toMatch(re);
    }
  });

  it('names are unique', () => {
    const names = SAMPLE_CRITERIA.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('seedSampleCriteria --dry-run', () => {
  it('dry-run does not call createClient (no network/DB write)', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = await seedSampleCriteria('http://fake', 'fake-key', { dryRun: true });
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(SAMPLE_CRITERIA.length);
    expect(result.errors).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('would insert clarity'));
    logSpy.mockRestore();
  });
});
