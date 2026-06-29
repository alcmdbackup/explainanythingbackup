// Unit tests for slot-topic + per-slot-match persistence helpers.
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.

import {
  upsertSlotTopic,
  persistSlotMatches,
  makeMatchKey,
  type BeforeAfterRatingsMap,
} from './slotTopicActions';
import type { V2Match } from '@evolution/lib/pipeline/infra/types';
import type { Rating } from '@evolution/lib/shared/computeRatings';

const PARENT_ID = 'b1234567-89ab-cdef-0123-456789abcdef';
const TOPIC_ID = 't0000000-0000-0000-0000-000000000001';
const RUN_ID = 'r0000000-0000-0000-0000-000000000002';
const INV_ID = 'i0000000-0000-0000-0000-000000000003';
const ORIG_VARIANT_ID = 'o0000000-0000-0000-0000-000000000004';
const ID_A = 'a0000000-0000-0000-0000-000000000005';
const ID_B = 'b0000000-0000-0000-0000-000000000006';
const ID_C = 'c0000000-0000-0000-0000-000000000007';

function makeRating(elo: number, uncertainty = 50): Rating {
  return { elo, uncertainty };
}

/** Thin mock for the chained Supabase query builders we use. */
function makeSupabaseMock() {
  const inserts: Array<{ table: string; rows: unknown }> = [];
  const selects: Array<{ table: string; filters: Record<string, unknown> }> = [];

  type Override = {
    insert?: { error?: { code?: string; message?: string } | null; data?: unknown };
    select?: { data?: unknown; error?: null | { message?: string } };
  };
  const overrides: Record<string, Override> = {};

  function from(table: string) {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};

    chain.insert = (rows: unknown) => {
      inserts.push({ table, rows });
      const override = overrides[table]?.insert ?? {};
      chain.select = () => chain;
      chain.maybeSingle = async () => ({
        data: override.error ? null : (override.data ?? { id: TOPIC_ID }),
        error: override.error ?? null,
      });
      chain.single = async () => ({
        data: override.error ? null : (override.data ?? { id: ORIG_VARIANT_ID }),
        error: override.error ?? null,
      });
      // For .insert(rows) without .select chaining (bulk inserts on comparisons),
      // the call should also be awaitable directly. Return promise wrapper.
      const promise: Promise<{ error: typeof override.error }> = Promise.resolve({ error: override.error ?? null });
      Object.assign(chain, promise);
      Object.defineProperty(chain, 'then', { value: promise.then.bind(promise), enumerable: false });
      return chain;
    };
    chain.select = () => chain;
    chain.eq = (key: string, value: unknown) => {
      filters[key] = value;
      return chain;
    };
    chain.maybeSingle = async () => {
      selects.push({ table, filters });
      const override = overrides[table]?.select;
      return { data: override?.data ?? null, error: override?.error ?? null };
    };
    chain.single = async () => {
      selects.push({ table, filters });
      const override = overrides[table]?.select;
      return { data: override?.data ?? null, error: override?.error ?? null };
    };
    return chain;
  }

  return {
    from,
    inserts,
    selects,
    overrideInsert(table: string, override: Override['insert']) {
      overrides[table] ??= {};
      overrides[table]!.insert = override ?? {};
    },
    overrideSelect(table: string, override: Override['select']) {
      overrides[table] ??= {};
      overrides[table]!.select = override ?? {};
    },
  };
}

describe('makeMatchKey', () => {
  it('produces lexicographically-sorted canonical key (order-invariant)', () => {
    expect(makeMatchKey(ID_A, ID_B)).toBe(`${ID_A}|${ID_B}`);
    expect(makeMatchKey(ID_B, ID_A)).toBe(`${ID_A}|${ID_B}`);
  });
});

describe('upsertSlotTopic', () => {
  it('inserts a new topic when none exists (isNew=true)', async () => {
    const mock = makeSupabaseMock();
    mock.overrideInsert('evolution_prompts', { data: { id: TOPIC_ID } });
    mock.overrideInsert('evolution_variants', { data: { id: ORIG_VARIANT_ID } });
    mock.overrideSelect('evolution_variants', { data: null });

    const result = await upsertSlotTopic(mock as never, 'paragraph', PARENT_ID, 2, 'Original paragraph text.');

    expect(result.isNew).toBe(true);
    expect(result.topicId).toBe(TOPIC_ID);
    expect(result.originalSlotVariantId).toBe(ORIG_VARIANT_ID);
    // First INSERT: evolution_prompts. Second INSERT: evolution_variants.
    expect(mock.inserts.find((i) => i.table === 'evolution_prompts')).toBeDefined();
    expect(mock.inserts.find((i) => i.table === 'evolution_variants')).toBeDefined();
  });

  it('returns existing topic on unique-violation (isNew=false, idempotent)', async () => {
    const mock = makeSupabaseMock();
    mock.overrideInsert('evolution_prompts', { error: { code: '23505', message: 'unique violation' } });
    mock.overrideSelect('evolution_prompts', { data: { id: TOPIC_ID } });
    mock.overrideSelect('evolution_variants', { data: { id: ORIG_VARIANT_ID } });

    const result = await upsertSlotTopic(mock as never, 'paragraph', PARENT_ID, 2, 'Original.');

    expect(result.isNew).toBe(false);
    expect(result.topicId).toBe(TOPIC_ID);
    expect(result.originalSlotVariantId).toBe(ORIG_VARIANT_ID);
  });

  it('does not re-insert the original variant when one already exists for the slot', async () => {
    const mock = makeSupabaseMock();
    mock.overrideInsert('evolution_prompts', { data: { id: TOPIC_ID } });
    mock.overrideSelect('evolution_variants', { data: { id: ORIG_VARIANT_ID } });

    const result = await upsertSlotTopic(mock as never, 'paragraph', PARENT_ID, 2, 'Original.');

    expect(result.originalSlotVariantId).toBe(ORIG_VARIANT_ID);
    // The variants INSERT should NOT have happened (only the prompts INSERT).
    expect(mock.inserts.filter((i) => i.table === 'evolution_variants')).toHaveLength(0);
  });

  it('throws on non-conflict insert error (surfaces real DB failures)', async () => {
    const mock = makeSupabaseMock();
    mock.overrideInsert('evolution_prompts', { error: { code: 'XX000', message: 'unrelated failure' } });

    await expect(
      upsertSlotTopic(mock as never, 'paragraph', PARENT_ID, 2, 'Original.'),
    ).rejects.toThrow(/upsertSlotTopic: insert failed/);
  });

  // build_website_for_evolutiOn_20260626 follow-up — source propagation
  // (migration 20260629000001). Source is denormalized onto evolution_prompts
  // so arena topic-list filters don't need a 3-table JOIN.
  it('passes source=admin by default when omitted', async () => {
    const mock = makeSupabaseMock();
    mock.overrideInsert('evolution_prompts', { data: { id: TOPIC_ID } });
    mock.overrideInsert('evolution_variants', { data: { id: ORIG_VARIANT_ID } });
    mock.overrideSelect('evolution_variants', { data: null });

    await upsertSlotTopic(mock as never, 'paragraph', PARENT_ID, 2, 'Original.');

    const promptsInsert = mock.inserts.find((i) => i.table === 'evolution_prompts');
    expect(promptsInsert).toBeDefined();
    expect((promptsInsert!.rows as { source: string }).source).toBe('admin');
  });

  it('persists source=public_edit when caller passes it (paragraph topic tagging)', async () => {
    const mock = makeSupabaseMock();
    mock.overrideInsert('evolution_prompts', { data: { id: TOPIC_ID } });
    mock.overrideInsert('evolution_variants', { data: { id: ORIG_VARIANT_ID } });
    mock.overrideSelect('evolution_variants', { data: null });

    await upsertSlotTopic(mock as never, 'paragraph', PARENT_ID, 2, 'Original.', 'public_edit');

    const promptsInsert = mock.inserts.find((i) => i.table === 'evolution_prompts');
    expect((promptsInsert!.rows as { source: string }).source).toBe('public_edit');
  });
});

describe('persistSlotMatches', () => {
  function makeMatch(winnerId: string, loserId: string, result: 'a-wins' | 'b-wins' | 'draw' = 'a-wins', confidence = 0.9): V2Match {
    return {
      winnerId,
      loserId,
      result,
      confidence,
      cost: 0,
      durationMs: 0,
    } as unknown as V2Match;
  }

  it('returns inserted=0 with no INSERT call when slotMatches is empty', async () => {
    const mock = makeSupabaseMock();
    const result = await persistSlotMatches(mock as never, TOPIC_ID, RUN_ID, INV_ID, 1, [], new Map());
    expect(result.inserted).toBe(0);
    expect(mock.inserts.filter((i) => i.table === 'evolution_arena_comparisons')).toHaveLength(0);
  });

  it('inserts matches with correct slotTopicId and iteration', async () => {
    const mock = makeSupabaseMock();
    const ratings: BeforeAfterRatingsMap = new Map();
    ratings.set(makeMatchKey(ID_A, ID_B), {
      aBefore: makeRating(1200),
      aAfter: makeRating(1220),
      bBefore: makeRating(1180),
      bAfter: makeRating(1160),
    });
    const matches = [makeMatch(ID_A, ID_B)];

    const result = await persistSlotMatches(mock as never, TOPIC_ID, RUN_ID, INV_ID, 3, matches, ratings);

    expect(result.inserted).toBe(1);
    const insert = mock.inserts.find((i) => i.table === 'evolution_arena_comparisons')!;
    const rows = insert.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prompt_id).toBe(TOPIC_ID);
    expect(rows[0]!.run_id).toBe(RUN_ID);
    expect(rows[0]!.iteration).toBe(3);
    expect(rows[0]!.invocation_id).toBe(INV_ID);
    expect(rows[0]!.entry_a).toBe(ID_A);
    expect(rows[0]!.entry_b).toBe(ID_B);
    expect(rows[0]!.winner).toBe('a');
    expect(rows[0]!.status).toBe('completed');
    // mu/sigma columns populated from ratingToDb conversion.
    expect(rows[0]!.entry_a_mu_before).not.toBeNull();
    expect(rows[0]!.entry_a_mu_after).not.toBeNull();
  });

  it('leaves mu/sigma columns NULL when beforeAfterRatings is missing a match key', async () => {
    const mock = makeSupabaseMock();
    const ratings: BeforeAfterRatingsMap = new Map(); // empty — no entry for the match
    const matches = [makeMatch(ID_A, ID_B)];

    const result = await persistSlotMatches(mock as never, TOPIC_ID, RUN_ID, INV_ID, 1, matches, ratings);

    expect(result.inserted).toBe(1);
    const rows = (mock.inserts.find((i) => i.table === 'evolution_arena_comparisons')!.rows) as Record<string, unknown>[];
    expect(rows[0]!.entry_a_mu_before).toBeNull();
    expect(rows[0]!.entry_a_sigma_before).toBeNull();
    expect(rows[0]!.entry_b_mu_after).toBeNull();
  });

  it('normalizes entry_a/entry_b in sorted order for draws (matches MergeRatingsAgent precedent)', async () => {
    const mock = makeSupabaseMock();
    const matches = [makeMatch(ID_B, ID_A, 'draw')];

    await persistSlotMatches(mock as never, TOPIC_ID, RUN_ID, INV_ID, 1, matches, new Map());

    const rows = (mock.inserts.find((i) => i.table === 'evolution_arena_comparisons')!.rows) as Record<string, unknown>[];
    // ID_A < ID_B lexicographically, so entry_a should be ID_A.
    expect(rows[0]!.entry_a).toBe(ID_A);
    expect(rows[0]!.entry_b).toBe(ID_B);
    expect(rows[0]!.winner).toBe('draw');
  });

  it('returns error on bulk INSERT failure without throwing (best-effort contract)', async () => {
    const mock = makeSupabaseMock();
    mock.overrideInsert('evolution_arena_comparisons', { error: { message: 'PostgreSQL gone away' } });
    const matches = [makeMatch(ID_A, ID_B)];

    const result = await persistSlotMatches(mock as never, TOPIC_ID, RUN_ID, INV_ID, 1, matches, new Map());

    expect(result.inserted).toBe(0);
    expect(result.error).toMatch(/PostgreSQL gone away/);
  });

  it('filters out failed comparisons (confidence === 0)', async () => {
    const mock = makeSupabaseMock();
    const matches = [
      makeMatch(ID_A, ID_B, 'a-wins', 0.9),
      makeMatch(ID_B, ID_C, 'a-wins', 0), // failed comparison
    ];

    const result = await persistSlotMatches(mock as never, TOPIC_ID, RUN_ID, INV_ID, 1, matches, new Map());

    expect(result.inserted).toBe(1);
    const rows = (mock.inserts.find((i) => i.table === 'evolution_arena_comparisons')!.rows) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
  });

  it('iteration value flows to all rows in the batch', async () => {
    const mock = makeSupabaseMock();
    const matches = [
      makeMatch(ID_A, ID_B),
      makeMatch(ID_B, ID_C),
    ];

    await persistSlotMatches(mock as never, TOPIC_ID, RUN_ID, INV_ID, 5, matches, new Map());

    const rows = (mock.inserts.find((i) => i.table === 'evolution_arena_comparisons')!.rows) as Record<string, unknown>[];
    expect(rows.every((r) => r.iteration === 5)).toBe(true);
  });
});
