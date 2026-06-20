// Unit tests for resolveTestSetPairs: dedupe variants, kind filtering, orphan counting.

import { resolveTestSetPairs, type BankPair, type TestSetMember } from './testSetSource';

function pair(label: string, kind: 'article' | 'paragraph', a: string, b: string): BankPair {
  return {
    label, pair_kind: kind, variant_a_id: a, variant_b_id: b,
    text_a: `text ${a}`, text_b: `text ${b}`, mu_a: 25, sigma_a: 8, mu_b: 26, sigma_b: 8,
  };
}
const member = (label: string, kind: 'article' | 'paragraph'): TestSetMember => ({ pair_label: label, pair_kind: kind });

describe('resolveTestSetPairs', () => {
  it('resolves article pairs, dedupes shared variants, and lists one pair per member', () => {
    const bank: BankPair[] = [pair('p1', 'article', 'v1', 'v2'), pair('p2', 'article', 'v2', 'v3')];
    const members = [member('p1', 'article'), member('p2', 'article')];
    const res = resolveTestSetPairs(bank, members, 'article');
    expect(res.pairs).toHaveLength(2);
    expect(res.variants.map((v) => v.variantId).sort()).toEqual(['v1', 'v2', 'v3']); // v2 deduped
    expect(res.orphanCount).toBe(0);
    expect(res.variants.find((v) => v.variantId === 'v1')!.content).toBe('text v1');
  });

  it('filters to the requested kind', () => {
    const bank: BankPair[] = [pair('p1', 'article', 'v1', 'v2'), pair('q1', 'paragraph', 'w1', 'w2')];
    const members = [member('p1', 'article'), member('q1', 'paragraph')];
    const article = resolveTestSetPairs(bank, members, 'article');
    expect(article.pairs).toHaveLength(1);
    expect(article.variants.map((v) => v.variantId).sort()).toEqual(['v1', 'v2']);
    const para = resolveTestSetPairs(bank, members, 'paragraph');
    expect(para.pairs).toHaveLength(1);
    expect(para.variants.map((v) => v.variantId).sort()).toEqual(['w1', 'w2']);
  });

  it('counts orphan members whose label no longer resolves', () => {
    const bank: BankPair[] = [pair('p1', 'article', 'v1', 'v2')];
    const members = [member('p1', 'article'), member('gone', 'article')];
    const res = resolveTestSetPairs(bank, members, 'article');
    expect(res.pairs).toHaveLength(1);
    expect(res.orphanCount).toBe(1);
  });

  it('skips degenerate self-pairs', () => {
    const bank: BankPair[] = [pair('p1', 'article', 'v1', 'v1')];
    const res = resolveTestSetPairs(bank, [member('p1', 'article')], 'article');
    expect(res.pairs).toHaveLength(0);
    expect(res.orphanCount).toBe(1);
  });
});
