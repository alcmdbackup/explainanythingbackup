// Pure helper: resolve a Judge Lab test set's frozen members + its pair-bank pairs into the
// distinct variants (to snapshot as articles) and the pair list (to materialize as
// comparisons) for a weight-inference session. Orphan members (no longer in the re-seeded
// bank) and wrong-kind pairs are dropped. Kept pure (no DB) so it is unit-testable.

export interface BankPair {
  label: string;
  pair_kind: 'article' | 'paragraph';
  variant_a_id: string;
  variant_b_id: string;
  text_a: string;
  text_b: string;
  mu_a: number | null;
  sigma_a: number | null;
  mu_b: number | null;
  sigma_b: number | null;
}

export interface TestSetMember {
  pair_label: string;
  pair_kind: 'article' | 'paragraph';
}

export interface TestSetVariant {
  variantId: string;
  content: string;
  mu: number | null;
  sigma: number | null;
}

export interface TestSetPairRef {
  aVariantId: string;
  bVariantId: string;
}

export interface ResolvedTestSet {
  variants: TestSetVariant[];
  pairs: TestSetPairRef[];
  orphanCount: number;
}

/**
 * Resolve frozen members against the bank's pairs for a single `kind`. Returns the deduped
 * variants (id + content + mu/sigma) and one pair ref per resolvable member. Members whose
 * label no longer resolves in the bank (or whose kind differs) are counted as orphans.
 */
export function resolveTestSetPairs(
  bankPairs: ReadonlyArray<BankPair>,
  members: ReadonlyArray<TestSetMember>,
  kind: 'article' | 'paragraph',
): ResolvedTestSet {
  const byLabel = new Map<string, BankPair>();
  for (const p of bankPairs) {
    if (p.pair_kind === kind) byLabel.set(p.label, p);
  }

  const variants = new Map<string, TestSetVariant>();
  const pairs: TestSetPairRef[] = [];
  let orphanCount = 0;

  for (const m of members) {
    if (m.pair_kind !== kind) continue;
    const pair = byLabel.get(m.pair_label);
    if (!pair || pair.variant_a_id === pair.variant_b_id) {
      orphanCount++;
      continue;
    }
    if (!variants.has(pair.variant_a_id)) {
      variants.set(pair.variant_a_id, { variantId: pair.variant_a_id, content: pair.text_a, mu: pair.mu_a, sigma: pair.sigma_a });
    }
    if (!variants.has(pair.variant_b_id)) {
      variants.set(pair.variant_b_id, { variantId: pair.variant_b_id, content: pair.text_b, mu: pair.mu_b, sigma: pair.sigma_b });
    }
    pairs.push({ aVariantId: pair.variant_a_id, bVariantId: pair.variant_b_id });
  }

  return { variants: [...variants.values()], pairs, orphanCount };
}
