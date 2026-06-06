// Unit tests for test-set sampling: seed determinism (incl. across fresh calls = process
// boundary), per-kind sizing, stratified strategies, manual selection, and orphan validation.

import { selectTestSetMembers, assertMembersExist } from './testSet';
import type { JudgeEvalPair } from './schemas';

function pair(i: number, kind: 'article' | 'paragraph', conf: number, gap: 'large' | 'close'): JudgeEvalPair {
  return {
    label: `${kind === 'article' ? 'art' : 'para'}#${String(i).padStart(4, '0')}`,
    pair_kind: kind,
    variant_a_id: '00000000-0000-4000-8000-000000000001',
    variant_b_id: '00000000-0000-4000-8000-000000000002',
    text_a: 'a',
    text_b: 'b',
    mu_a: 30,
    mu_b: 20,
    sigma_a: 5,
    sigma_b: 5,
    expected_winner: gap === 'large' ? 'A' : null,
    gap_kind: gap,
    baseline_confidence: conf,
  };
}

function makeBank(): JudgeEvalPair[] {
  const pairs: JudgeEvalPair[] = [];
  for (let i = 0; i < 40; i++) {
    pairs.push(pair(i, 'article', i % 2 === 0 ? 1.0 : 0.5, i % 3 === 0 ? 'large' : 'close'));
  }
  for (let i = 0; i < 30; i++) {
    pairs.push(pair(i, 'paragraph', i % 2 === 0 ? 0.7 : 0.3, i % 4 === 0 ? 'large' : 'close'));
  }
  return pairs;
}

describe('selectTestSetMembers', () => {
  it('honors per-kind sizes', () => {
    const m = selectTestSetMembers(makeBank(), {
      strategy: 'random',
      seed: 1,
      sizeArticle: 10,
      sizeParagraph: 5,
    });
    expect(m.filter((x) => x.pair_kind === 'article')).toHaveLength(10);
    expect(m.filter((x) => x.pair_kind === 'paragraph')).toHaveLength(5);
  });

  it('is deterministic across separate calls (process-boundary stand-in)', () => {
    const opts = { strategy: 'stratified_confidence' as const, seed: 42, sizeArticle: 8, sizeParagraph: 6 };
    const a = selectTestSetMembers(makeBank(), opts);
    const b = selectTestSetMembers(makeBank(), opts);
    expect(a).toEqual(b);
  });

  it('different seeds generally produce different membership', () => {
    const base = { strategy: 'random' as const, sizeArticle: 10, sizeParagraph: 0 };
    const a = selectTestSetMembers(makeBank(), { ...base, seed: 1 });
    const b = selectTestSetMembers(makeBank(), { ...base, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('changing paragraph size does not reshuffle the article selection', () => {
    const a = selectTestSetMembers(makeBank(), { strategy: 'random', seed: 7, sizeArticle: 10, sizeParagraph: 4 });
    const b = selectTestSetMembers(makeBank(), { strategy: 'random', seed: 7, sizeArticle: 10, sizeParagraph: 9 });
    const artA = a.filter((x) => x.pair_kind === 'article');
    const artB = b.filter((x) => x.pair_kind === 'article');
    expect(artA).toEqual(artB);
  });

  it('returns the whole pool when size exceeds availability', () => {
    const m = selectTestSetMembers(makeBank(), { strategy: 'random', seed: 1, sizeArticle: 999, sizeParagraph: 0 });
    expect(m).toHaveLength(40);
  });

  it('stratified_gap draws from both large and close strata', () => {
    const m = selectTestSetMembers(makeBank(), {
      strategy: 'stratified_gap',
      seed: 3,
      sizeArticle: 12,
      sizeParagraph: 0,
    });
    const bank = makeBank();
    const byLabel = new Map(bank.map((p) => [p.label, p]));
    const gaps = m.map((x) => byLabel.get(x.pair_label)!.gap_kind);
    expect(gaps).toContain('large');
    expect(gaps).toContain('close');
  });

  it('manual strategy selects exactly the requested labels', () => {
    const m = selectTestSetMembers(makeBank(), {
      strategy: 'manual',
      seed: 1,
      sizeArticle: 0,
      sizeParagraph: 0,
      manualLabels: ['art#0000', 'para#0001'],
    });
    expect(m.map((x) => x.pair_label).sort()).toEqual(['art#0000', 'para#0001']);
  });
});

describe('assertMembersExist', () => {
  it('throws when a member label is not in the bank', () => {
    expect(() =>
      assertMembersExist([{ pair_label: 'ghost#1', pair_kind: 'article' }], makeBank()),
    ).toThrow(/not in the bank/);
  });

  it('passes when all members exist', () => {
    const bank = makeBank();
    const members = selectTestSetMembers(bank, { strategy: 'random', seed: 1, sizeArticle: 5, sizeParagraph: 5 });
    expect(() => assertMembersExist(members, bank)).not.toThrow();
  });
});
