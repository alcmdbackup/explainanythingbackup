// Integration test for LLM cost attribution: the is_test discriminator (set at the
// saveLlmCallTracking chokepoint) and the get_llm_spend_buckets RPC aggregation + filter.
//
// Named with the `evolution-` prefix so CI's prod-path integration split routes it into the
// evolution bucket (where it can auto-skip when the migration/RPC isn't present), matching the
// sibling evolution-cost-* tests.
//
// LOCAL SETUP: apply migrations 20260620000001/02 to the dev DB (supabase migration up) so the
// is_test column + get_llm_spend_buckets RPC exist; CI applies them automatically.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { saveLlmCallTracking } from '@/lib/services/llms';
import { testSource } from '@/lib/services/llmCallSource';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

describe('LLM cost attribution (is_test + spend buckets RPC)', () => {
  let sb: SupabaseClient<Database>;
  let available = false;
  const unique = Date.now();
  const chokepointSrc = `e2e-int-chokepoint-${unique}`;
  const testSrc = `e2e-int-test-${unique}`;
  const realSrc = `e2e-int-real-${unique}`;

  // Seed rows at a UNIQUE far-future timestamp and query a TIGHT window around it. A wide range
  // over the shared dev DB returns thousands of bucket groups; PostgREST caps returned rows and the
  // RPC has no ORDER BY, so our seeded rows get non-deterministically truncated out (the cause of an
  // intermittent 0.5-vs-0.75 flake). Year ~2155 has no real data, so only this run's rows land in
  // the window — and the call_source filter isolates concurrent runs. The real dashboard always
  // queries narrow ranges, so this mirrors production, not a contrived case.
  const EVENT_MS = Date.UTC(2099, 0, 1, 12) + unique;
  const EVENT_TS = new Date(EVENT_MS).toISOString();
  const RANGE_START = new Date(EVENT_MS - 3600_000).toISOString();
  const RANGE_END = new Date(EVENT_MS + 3600_000).toISOString();
  const insertedIds: number[] = [];

  beforeAll(async () => {
    sb = createTestSupabaseClient();
    // Guard: skip ONLY if the RPC isn't migrated yet (function missing). A STRUCTURAL error
    // (42804 "structure of query does not match function result type") must NOT skip — that is a
    // real bug (e.g. a return column returned as varchar against a declared text column), and the
    // old `available = !probe.error` silently skipped it, hiding the broken dashboard from CI.
    // Probe with a NON-empty range so the RETURN QUERY actually materializes rows (the structural
    // check fires per-row, so an empty range would not surface the mismatch).
    const probe = await sb.rpc('get_llm_spend_buckets', {
      p_granularity: 'day',
      p_start: RANGE_START,
      p_end: RANGE_END,
      p_include_test: true,
    });
    const fnMissing =
      probe.error?.code === 'PGRST202' ||
      /could not find the function|does not exist/i.test(probe.error?.message ?? '');
    available = !fnMissing;
    if (fnMissing) {
      console.warn('Skipping: get_llm_spend_buckets RPC not migrated yet (apply migrations).');
    }
  });

  afterAll(async () => {
    if (sb && insertedIds.length > 0) {
      await sb.from('llmCallTracking').delete().in('id', insertedIds);
    }
    await sb
      .from('llmCallTracking')
      .delete()
      .like('call_source', `e2e-int-%-${unique}`);
  });

  function directRow(callSource: string, isTest: boolean, cost: number) {
    return {
      userid: '11111111-2222-4333-8444-555555555555',
      prompt: 'p',
      content: 'c',
      call_source: callSource,
      raw_api_response: '{}',
      model: 'gpt-4.1-mini',
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
      reasoning_tokens: 0,
      finish_reason: 'stop',
      estimated_cost_usd: cost,
      is_test: isTest,
      created_at: EVENT_TS,
    };
  }

  it('sets is_test at the saveLlmCallTracking chokepoint', async () => {
    if (!available) return;
    // Run under NODE_ENV=test (jest), so isTestLlmCall flags it true at the chokepoint.
    await saveLlmCallTracking(
      {
        userid: '99999999-2222-4333-8444-555555555555',
        prompt: 'p',
        content: 'c',
        call_source: testSource(chokepointSrc),
        raw_api_response: '{}',
        model: 'gpt-4.1-mini',
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
        reasoning_tokens: 0,
        finish_reason: 'stop',
        estimated_cost_usd: 0.01,
      },
      sb,
    );
    const { data } = await sb
      .from('llmCallTracking')
      .select('id, is_test')
      .eq('call_source', chokepointSrc)
      .limit(1)
      .single();
    expect(data?.is_test).toBe(true);
    if (data?.id) insertedIds.push(data.id);
  });

  it('aggregates spend via the RPC and respects p_include_test', async () => {
    if (!available) return;
    const { data: rows, error } = await sb
      .from('llmCallTracking')
      .insert([directRow(testSrc, true, 0.5), directRow(realSrc, false, 0.25)])
      .select('id');
    expect(error).toBeNull();
    for (const r of rows ?? []) insertedIds.push(r.id);

    // Sum the bucket cost for our two seeded sources. The dev DB is shared across concurrent CI
    // jobs; poll (bounded) until both just-inserted rows are reflected so a transient read that
    // sees only one row doesn't flake. A genuinely missing/excluded row still fails after retries.
    async function sumForSources(includeTest: boolean): Promise<{ total: number; sources: string[] }> {
      let last = { total: 0, sources: [] as string[] };
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await sb.rpc('get_llm_spend_buckets', {
          p_granularity: 'day',
          p_start: RANGE_START,
          p_end: RANGE_END,
          p_include_test: includeTest,
        });
        expect(res.error).toBeNull();
        const matched = (res.data ?? []).filter(
          (r) => r.call_source === testSrc || r.call_source === realSrc,
        );
        last = {
          total: matched.reduce((s, r) => s + Number(r.total_cost), 0),
          sources: matched.map((r) => r.call_source),
        };
        // include_test=true expects both rows (0.75); include_test=false expects only the real row.
        const settled = includeTest ? last.sources.length >= 2 : last.sources.includes(realSrc);
        if (settled) break;
      }
      return last;
    }

    // include_test = true → both rows present; bucket cost sum matches raw insert
    const incl = await sumForSources(true);
    expect(incl.total).toBeCloseTo(0.75, 5);

    // include_test = false → only the real (is_test=false) row remains
    const excl = await sumForSources(false);
    expect(excl.sources).toContain(realSrc);
    expect(excl.sources).not.toContain(testSrc);
  });

  it('errors cleanly on an invalid granularity', async () => {
    if (!available) return;
    const res = await sb.rpc('get_llm_spend_buckets', {
      p_granularity: 'minute',
      p_start: RANGE_START,
      p_end: RANGE_END,
      p_include_test: true,
    });
    expect(res.error).not.toBeNull();
  });
});
