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

const RANGE_START = '2020-01-01T00:00:00Z';
const RANGE_END = '2999-01-01T00:00:00Z';

describe('LLM cost attribution (is_test + spend buckets RPC)', () => {
  let sb: SupabaseClient<Database>;
  let available = false;
  const unique = Date.now();
  const chokepointSrc = `e2e-int-chokepoint-${unique}`;
  const testSrc = `e2e-int-test-${unique}`;
  const realSrc = `e2e-int-real-${unique}`;
  const insertedIds: number[] = [];

  beforeAll(async () => {
    sb = createTestSupabaseClient();
    // Guard: skip if the RPC / column isn't migrated yet (mirrors evolutionTablesExist pattern).
    const probe = await sb.rpc('get_llm_spend_buckets', {
      p_granularity: 'day',
      p_start: RANGE_START,
      p_end: RANGE_START,
      p_include_test: true,
    });
    available = !probe.error;
    if (!available) {
      console.warn('Skipping: get_llm_spend_buckets RPC not available (apply migrations).');
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

    // include_test = true → both rows present; bucket cost sum matches raw insert
    const incl = await sb.rpc('get_llm_spend_buckets', {
      p_granularity: 'day',
      p_start: RANGE_START,
      p_end: RANGE_END,
      p_include_test: true,
    });
    expect(incl.error).toBeNull();
    const inclRows = (incl.data ?? []).filter(
      (r) => r.call_source === testSrc || r.call_source === realSrc,
    );
    const inclTotal = inclRows.reduce((s, r) => s + Number(r.total_cost), 0);
    expect(inclTotal).toBeCloseTo(0.75, 5);

    // include_test = false → only the real row remains
    const excl = await sb.rpc('get_llm_spend_buckets', {
      p_granularity: 'day',
      p_start: RANGE_START,
      p_end: RANGE_END,
      p_include_test: false,
    });
    expect(excl.error).toBeNull();
    const exclSources = (excl.data ?? []).map((r) => r.call_source);
    expect(exclSources).toContain(realSrc);
    expect(exclSources).not.toContain(testSrc);
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
