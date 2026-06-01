// Tests for the single source of truth governing discarded-generate-variant UI/query semantics.
import { isDiscardedGenerateVariant, NON_DISCARDED_OR_FILTER } from './variantStatus';

describe('isDiscardedGenerateVariant', () => {
  it('is true only for article variants with persisted===false', () => {
    expect(isDiscardedGenerateVariant(false, 'article')).toBe(true);
  });
  it('is false for paragraph variants regardless of persisted', () => {
    expect(isDiscardedGenerateVariant(false, 'paragraph')).toBe(false);
    expect(isDiscardedGenerateVariant(true, 'paragraph')).toBe(false);
  });
  it('is false for surfaced article variants', () => {
    expect(isDiscardedGenerateVariant(true, 'article')).toBe(false);
  });
  it('is false when persisted/variantKind are undefined (legacy/defensive)', () => {
    expect(isDiscardedGenerateVariant(undefined, 'article')).toBe(false);
    expect(isDiscardedGenerateVariant(false, undefined)).toBe(false);
    expect(isDiscardedGenerateVariant(undefined, undefined)).toBe(false);
  });
});

describe('NON_DISCARDED_OR_FILTER stays in sync with the predicate', () => {
  // The PostgREST `.or(...)` string and the TS predicate must encode the SAME rule: the default
  // list filter hides a row IFF the predicate marks it a discarded generate variant. Derive the
  // filter's keep-set from a small fixture set and compare to the predicate (not a brittle
  // string-equals that could drift in lockstep with a typo).
  type Row = { persisted: boolean; variant_kind: string };
  const fixtures: Row[] = [
    { persisted: true, variant_kind: 'article' },    // surfaced article — keep
    { persisted: false, variant_kind: 'article' },   // discarded article — hide
    { persisted: false, variant_kind: 'paragraph' }, // paragraph — keep
    { persisted: true, variant_kind: 'paragraph' },  // (hypothetical) paragraph — keep
  ];

  // Parse "persisted.eq.true,variant_kind.neq.article" into a keep-predicate.
  function filterKeeps(row: Row): boolean {
    return NON_DISCARDED_OR_FILTER.split(',').some((clause) => {
      const [col, op, val] = clause.split('.');
      const cell = String((row as Record<string, unknown>)[col!]);
      if (op === 'eq') return cell === val;
      if (op === 'neq') return cell !== val;
      throw new Error(`unhandled PostgREST op: ${op}`);
    });
  }

  it('keeps exactly the rows the predicate does NOT mark discarded', () => {
    for (const row of fixtures) {
      const discarded = isDiscardedGenerateVariant(row.persisted, row.variant_kind);
      expect(filterKeeps(row)).toBe(!discarded);
    }
  });
});
