// Integration test: in-memory `Variant` with criteriaSetUsed/weakestCriteriaIds →
// camelCase ↔ snake_case naming-convention boundary preserved through INSERT
// schema parser. Asserts the persistence-layer mapping is byte-identical.

import { variantSchema, evolutionVariantInsertSchema, evolutionVariantFullDbSchema } from '@evolution/lib/schemas';
import { createVariant } from '@evolution/lib/types';

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';
const RUN_ID = '00000000-0000-4000-8000-0000000000aa';
const PARENT_ID = '00000000-0000-4000-8000-0000000000bb';

describe('variant↔DB criteria roundtrip (integration)', () => {
  it('createVariant preserves criteriaSetUsed + weakestCriteriaIds (in-memory shape)', () => {
    const variant = createVariant({
      text: 'sample',
      tactic: 'criteria_driven',
      iterationBorn: 1,
      parentIds: [PARENT_ID],
      version: 0,
      criteriaSetUsed: [C1, C2, C3],
      weakestCriteriaIds: [C1, C2],
    });
    expect(variant.criteriaSetUsed).toEqual([C1, C2, C3]);
    expect(variant.weakestCriteriaIds).toEqual([C1, C2]);
    expect(variant.tactic).toBe('criteria_driven');
  });

  it('variantSchema (in-memory camelCase) accepts criteria fields', () => {
    const variant = createVariant({
      text: 'sample',
      tactic: 'criteria_driven',
      iterationBorn: 0,
      parentIds: [],
      version: 0,
      criteriaSetUsed: [C1],
      weakestCriteriaIds: [C1],
    });
    expect(() => variantSchema.parse(variant)).not.toThrow();
  });

  it('evolutionVariantInsertSchema (snake_case DB) accepts criteria_set_used + weakest_criteria_ids', () => {
    const dbInsertRow = {
      id: '00000000-0000-4000-8000-0000000000dd',
      run_id: RUN_ID,
      variant_content: 'sample',
      generation: 1,
      parent_variant_id: PARENT_ID,
      agent_name: 'criteria_driven',
      criteria_set_used: [C1, C2, C3],
      weakest_criteria_ids: [C1, C2],
    };
    const parsed = evolutionVariantInsertSchema.parse(dbInsertRow);
    expect(parsed.criteria_set_used).toEqual([C1, C2, C3]);
    expect(parsed.weakest_criteria_ids).toEqual([C1, C2]);
  });

  it('FullDb schema accepts all criteria field shapes (null, empty, populated)', () => {
    const baseDbRow = {
      id: '00000000-0000-4000-8000-0000000000cc',
      run_id: RUN_ID,
      variant_content: 'x',
      elo_score: 1200,
      generation: 0,
      parent_variant_id: null,
      agent_name: 'criteria_driven',
      mu: 25,
      sigma: 8.333,
      match_count: 0,
      is_winner: false,
      synced_to_arena: false,
      arena_match_count: 0,
      generation_method: 'pipeline',
      created_at: '2026-01-01T00:00:00Z',
    };
    // Populated
    expect(() => evolutionVariantFullDbSchema.parse({
      ...baseDbRow, criteria_set_used: [C1, C2], weakest_criteria_ids: [C1],
    })).not.toThrow();
    // Null
    expect(() => evolutionVariantFullDbSchema.parse({
      ...baseDbRow, criteria_set_used: null, weakest_criteria_ids: null,
    })).not.toThrow();
    // Absent (back-compat for non-criteria-driven variants)
    expect(() => evolutionVariantFullDbSchema.parse(baseDbRow)).not.toThrow();
  });

  it('rejects non-uuid in criteria_set_used at the DB schema boundary', () => {
    expect(() => evolutionVariantInsertSchema.parse({
      run_id: RUN_ID,
      variant_content: 'x',
      criteria_set_used: ['not-a-uuid'],
    })).toThrow();
  });
});
