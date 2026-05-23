/**
 * Unit tests for the arena-comparison orphan audit script.
 * Exercises the pure functions (findOrphans, deleteOrphans, runAudit) against
 * an in-memory Supabase chain mock; no real DB is hit.
 */

import { findOrphans, deleteOrphans, runAudit, type OrphanRow } from './audit-arena-comparison-orphans';

type Row = { id: string; entry_a?: string; entry_b?: string };

function makeMockDb(
  variants: Row[],
  comparisons: Row[],
): {
  db: any;
  deletedIds: string[];
} {
  const deletedIds: string[] = [];

  // PostgREST chain returns the same builder until terminal; mock both .order() and .range()
  // because the production code now chains .order('id').range(...) to make pagination deterministic.
  function fromImpl(table: string) {
    if (table === 'evolution_variants') {
      const builder = {
        order: (_col: string) => builder,
        range: (from: number, to: number) =>
          Promise.resolve({ data: variants.slice(from, to + 1), error: null }),
      };
      return {
        select: () => builder,
      };
    }
    if (table === 'evolution_arena_comparisons') {
      const builder = {
        order: (_col: string) => builder,
        range: (from: number, to: number) =>
          Promise.resolve({ data: comparisons.slice(from, to + 1), error: null }),
      };
      return {
        select: (cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) {
            return Promise.resolve({ count: comparisons.length, error: null });
          }
          return builder;
        },
        delete: (_opts: any) => ({
          in: (_col: string, ids: string[]) => {
            for (const id of ids) deletedIds.push(id);
            return Promise.resolve({ count: ids.length, error: null });
          },
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }

  return { db: { from: fromImpl }, deletedIds };
}

describe('audit-arena-comparison-orphans', () => {
  describe('findOrphans', () => {
    it('returns empty array when all entry refs are valid', async () => {
      const { db } = makeMockDb(
        [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
        [
          { id: 'c1', entry_a: 'v1', entry_b: 'v2' },
          { id: 'c2', entry_a: 'v2', entry_b: 'v3' },
        ],
      );
      const orphans = await findOrphans(db);
      expect(orphans).toEqual([]);
    });

    it('flags entry_a_missing when entry_a has no matching variant', async () => {
      const { db } = makeMockDb(
        [{ id: 'v1' }, { id: 'v2' }],
        [{ id: 'c1', entry_a: 'ghost', entry_b: 'v2' }],
      );
      const orphans = await findOrphans(db);
      expect(orphans).toHaveLength(1);
      expect(orphans[0]).toEqual({
        id: 'c1', entry_a: 'ghost', entry_b: 'v2', reason: 'entry_a_missing',
      });
    });

    it('flags entry_b_missing when entry_b has no matching variant', async () => {
      const { db } = makeMockDb(
        [{ id: 'v1' }],
        [{ id: 'c1', entry_a: 'v1', entry_b: 'ghost' }],
      );
      const orphans = await findOrphans(db);
      expect(orphans).toHaveLength(1);
      expect(orphans[0]?.reason).toBe('entry_b_missing');
    });

    it('flags both_missing when both entries are ghosts', async () => {
      const { db } = makeMockDb(
        [{ id: 'v1' }],
        [{ id: 'c1', entry_a: 'ghost1', entry_b: 'ghost2' }],
      );
      const orphans = await findOrphans(db);
      expect(orphans).toHaveLength(1);
      expect(orphans[0]?.reason).toBe('both_missing');
    });
  });

  describe('deleteOrphans', () => {
    it('no-ops on empty list', async () => {
      const { db, deletedIds } = makeMockDb([], []);
      const n = await deleteOrphans(db, []);
      expect(n).toBe(0);
      expect(deletedIds).toEqual([]);
    });

    it('deletes the listed orphan ids', async () => {
      const { db, deletedIds } = makeMockDb([], []);
      const orphans: OrphanRow[] = [
        { id: 'c1', entry_a: 'g', entry_b: 'g', reason: 'both_missing' },
        { id: 'c2', entry_a: 'g', entry_b: 'g', reason: 'both_missing' },
      ];
      const n = await deleteOrphans(db, orphans);
      expect(n).toBe(2);
      expect(deletedIds).toEqual(['c1', 'c2']);
    });
  });

  describe('runAudit', () => {
    it('dry-run lists orphans without deleting', async () => {
      const { db, deletedIds } = makeMockDb(
        [{ id: 'v1' }],
        [
          { id: 'c1', entry_a: 'v1', entry_b: 'ghost' },
          { id: 'c2', entry_a: 'v1', entry_b: 'v1' },
        ],
      );
      const result = await runAudit(db, { isDryRun: true, isProd: false });
      expect(result.isDryRun).toBe(true);
      expect(result.orphans).toHaveLength(1);
      expect(result.deleted).toBe(0);
      expect(deletedIds).toEqual([]);
    });

    it('apply path with skipPromptForTest deletes orphans', async () => {
      const { db, deletedIds } = makeMockDb(
        [{ id: 'v1' }],
        [{ id: 'c1', entry_a: 'v1', entry_b: 'ghost' }],
      );
      const result = await runAudit(db, {
        isDryRun: false, isProd: false, skipPromptForTest: true,
      });
      expect(result.isDryRun).toBe(false);
      expect(result.deleted).toBe(1);
      expect(deletedIds).toEqual(['c1']);
    });

    it('apply path with correct confirm string skips prompt and deletes', async () => {
      const { db, deletedIds } = makeMockDb(
        [{ id: 'v1' }],
        [{ id: 'c1', entry_a: 'v1', entry_b: 'ghost' }],
      );
      const result = await runAudit(db, {
        isDryRun: false,
        isProd: false,
        confirmString: 'DELETE ORPHAN ARENA COMPARISONS',
      });
      expect(result.deleted).toBe(1);
      expect(deletedIds).toEqual(['c1']);
    });
  });
});
