// Tests for the test-set contents helpers: loadTestSetContents (Elo projection + text stripping +
// orphan counting) and getTestSetPairTexts (lazy per-pair text fetch). A hand-rolled chainable/
// awaitable db mock serves the table-specific queries these run (mirrors criteriaActions.test.ts).

import { loadTestSetContents, getTestSetPairTexts } from './persist';
import type { JudgeEvalPair } from './schemas';

const VA = '00000000-0000-4000-8000-0000000000a1';
const VB = '00000000-0000-4000-8000-0000000000b1';

function pair(label: string, overrides: Partial<JudgeEvalPair> = {}): JudgeEvalPair {
  return {
    label,
    pair_kind: 'article',
    variant_a_id: VA,
    variant_b_id: VB,
    text_a: `TEXT_A for ${label}`,
    text_b: `TEXT_B for ${label}`,
    mu_a: 30,
    mu_b: 25,
    sigma_a: 5,
    sigma_b: 5,
    expected_winner: 'A',
    gap_kind: 'large',
    baseline_confidence: 1.0,
    ...overrides,
  };
}

interface DbConfig {
  testSet: Record<string, unknown>;
  bankPairs: JudgeEvalPair[];
  members: Array<{ pair_label: string; pair_kind: string }>;
}

// Builds a db whose builder is both chainable (.select/.eq) and awaitable (.then), returning
// table-appropriate payloads. Count queries are detected via the {count:'exact', head:true}
// select options; everything else resolves to list/single data.
function makeDb(config: DbConfig): never {
  function makeBuilder(table: string) {
    const state: { table: string; count?: string; head?: boolean; eqs: Record<string, unknown> } = {
      table,
      eqs: {},
    };
    const resolveList = () => {
      if (state.table === 'judge_eval_test_set_members') {
        if (state.head && state.count === 'exact') {
          const kind = state.eqs['pair_kind'] as string | undefined;
          const count = config.members.filter((m) => !kind || m.pair_kind === kind).length;
          return { data: null, count, error: null };
        }
        return { data: config.members, count: null, error: null };
      }
      return { data: [], count: null, error: null };
    };
    const resolveSingle = () => {
      if (state.table === 'judge_eval_test_sets') return { data: config.testSet, error: null };
      if (state.table === 'judge_eval_pair_banks') return { data: { pairs: config.bankPairs }, error: null };
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts) {
          state.count = opts.count;
          state.head = opts.head;
        }
        return b;
      },
      eq: (col: string, val: unknown) => {
        state.eqs[col] = val;
        return b;
      },
      single: () => Promise.resolve(resolveSingle()),
      maybeSingle: () => Promise.resolve(resolveSingle()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolveList()).then(onF, onR),
    };
    return b;
  }
  return { from: (table: string) => makeBuilder(table) } as never;
}

const TS = {
  id: 'ts-1',
  pair_bank_id: 'bank-1',
  name: 'fr2-smoke',
  description: 'smoke set',
  strategy: 'stratified_confidence',
  seed: 1,
  size_article: 2,
  size_paragraph: 0,
};

describe('loadTestSetContents', () => {
  it('projects mu/sigma to display Elo and omits snapshot texts from the list', async () => {
    const db = makeDb({
      testSet: TS,
      bankPairs: [pair('art#1'), pair('art#2', { mu_a: 28, mu_b: 28 })],
      members: [
        { pair_label: 'art#1', pair_kind: 'article' },
        { pair_label: 'art#2', pair_kind: 'article' },
      ],
    });
    const out = await loadTestSetContents(db, 'ts-1', 'both');

    expect(out.pairs).toHaveLength(2);
    const p = out.pairs[0]!;
    // Elo present and numeric; NO raw mu/sigma or texts on the row.
    expect(typeof p.elo_a).toBe('number');
    expect(typeof p.elo_b).toBe('number');
    expect(p.elo_gap).toBe(Math.abs((p.elo_a as number) - (p.elo_b as number)));
    expect(p).not.toHaveProperty('mu_a');
    expect(p).not.toHaveProperty('text_a');
    expect(p).not.toHaveProperty('text_b');
    expect(out.memberCount).toBe(2);
    expect(out.resolvedCount).toBe(2);
    expect(out.orphanCount).toBe(0);
  });

  it('flags orphans when a frozen member is missing from the (re-seeded) bank', async () => {
    const db = makeDb({
      testSet: TS,
      bankPairs: [pair('art#1')], // art#ORPHAN no longer in the bank
      members: [
        { pair_label: 'art#1', pair_kind: 'article' },
        { pair_label: 'art#ORPHAN', pair_kind: 'article' },
      ],
    });
    const out = await loadTestSetContents(db, 'ts-1', 'both');
    expect(out.memberCount).toBe(2);
    expect(out.resolvedCount).toBe(1);
    expect(out.orphanCount).toBe(1);
  });

  it('renders null Elo when a pair has no rating (null mu/sigma)', async () => {
    const db = makeDb({
      testSet: TS,
      bankPairs: [pair('art#1', { mu_a: null, sigma_a: null })],
      members: [{ pair_label: 'art#1', pair_kind: 'article' }],
    });
    const out = await loadTestSetContents(db, 'ts-1', 'both');
    expect(out.pairs[0]!.elo_a).toBeNull();
    expect(out.pairs[0]!.elo_gap).toBeNull();
    expect(out.pairs[0]!.elo_b).toBe(Math.round(out.pairs[0]!.elo_b as number)); // b still computed
  });
});

describe('getTestSetPairTexts', () => {
  it('returns the snapshot texts for a member pair', async () => {
    const db = makeDb({
      testSet: TS,
      bankPairs: [pair('art#1'), pair('art#2')],
      members: [
        { pair_label: 'art#1', pair_kind: 'article' },
        { pair_label: 'art#2', pair_kind: 'article' },
      ],
    });
    const out = await getTestSetPairTexts(db, 'ts-1', 'art#2');
    expect(out.text_a).toBe('TEXT_A for art#2');
    expect(out.text_b).toBe('TEXT_B for art#2');
  });

  it('throws when the pair label is not in the test set', async () => {
    const db = makeDb({
      testSet: TS,
      bankPairs: [pair('art#1')],
      members: [{ pair_label: 'art#1', pair_kind: 'article' }],
    });
    await expect(getTestSetPairTexts(db, 'ts-1', 'missing')).rejects.toThrow(/Pair not found/);
  });
});
