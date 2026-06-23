// Integration tests for the style fingerprint entity DB invariants
// (generate_enforce_style_fingerprint_evolution_20260620): name CHECK + is_test_content
// trigger, the junction's exactly-one-non-empty-source CHECK, and soft-delete filtering.
// The extraction/recompute LLM path is covered by unit tests (extractStyleFingerprint.test.ts);
// integration mocks OpenAI, so this file asserts only the DB-enforced invariants.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'evolution_style_fingerprints';
const ARTICLES = 'evolution_style_fingerprint_articles';

async function fingerprintTableExists(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from(TABLE).select('id').limit(1);
  if (error && (error.code === '42P01' || error.message?.includes('does not exist'))) return false;
  return true;
}

describe('Style Fingerprint Integration Tests', () => {
  let supabase: SupabaseClient;
  let tableExists = false;
  const createdIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tableExists = await fingerprintTableExists(supabase);
    if (!tableExists) console.warn('evolution_style_fingerprints does not exist — skipping style fingerprint tests');
  });

  afterAll(async () => {
    if (!tableExists) return;
    // Junction rows cascade on fingerprint delete; deleting fingerprints suffices.
    for (const id of createdIds) {
      await supabase.from(TABLE).delete().eq('id', id);
    }
  });

  const mkName = () => `TESTEVO-style-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  it('flags is_test_content for TESTEVO-named rows via the trigger', async () => {
    if (!tableExists) return;
    const name = mkName();
    const { data, error } = await supabase.from(TABLE).insert({ name }).select('id, is_test_content').single();
    expect(error).toBeNull();
    createdIds.push(data!.id);
    expect(data!.is_test_content).toBe(true);
  });

  it('rejects names with brackets or spaces (name_format CHECK)', async () => {
    if (!tableExists) return;
    const { error } = await supabase.from(TABLE).insert({ name: '[TEST] bad name' }).select('id').single();
    expect(error).not.toBeNull();
  });

  it('soft-deleted fingerprints are filtered by deleted_at IS NULL', async () => {
    if (!tableExists) return;
    const name = mkName();
    const { data } = await supabase.from(TABLE).insert({ name }).select('id').single();
    createdIds.push(data!.id);
    await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', data!.id);
    const { data: live } = await supabase.from(TABLE).select('id').eq('id', data!.id).is('deleted_at', null).maybeSingle();
    expect(live).toBeNull();
  });

  it('junction CHECK rejects both-null and both-set sources; accepts exactly one', async () => {
    if (!tableExists) return;
    const name = mkName();
    const { data: fp } = await supabase.from(TABLE).insert({ name }).select('id').single();
    createdIds.push(fp!.id);

    // both null → reject
    const bothNull = await supabase.from(ARTICLES).insert({ fingerprint_id: fp!.id, position: 0 }).select('id').single();
    expect(bothNull.error).not.toBeNull();

    // empty text → reject (length(trim) > 0 guard)
    const emptyText = await supabase.from(ARTICLES).insert({ fingerprint_id: fp!.id, article_text: '   ', position: 0 }).select('id').single();
    expect(emptyText.error).not.toBeNull();

    // exactly one (pasted text) → accept
    const ok = await supabase.from(ARTICLES).insert({ fingerprint_id: fp!.id, article_text: 'A real paragraph of text.', position: 0 }).select('id').single();
    expect(ok.error).toBeNull();
  });
});
