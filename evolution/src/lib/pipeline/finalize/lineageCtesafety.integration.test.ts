// Integration test for the get_variant_full_chain RPC's cycle + orphan safety.
// Requires a real Postgres — the CYCLE clause + array-path guard live in the RPC,
// not in application code. Gated by SUPABASE_SERVICE_ROLE_KEY presence so it's
// skipped in environments that can't reach the DB (e.g., unit-only runs).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type RPCResponse = { data: unknown[] | null; error: { message: string } | null };

const hasSupabase = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

const describeIf = hasSupabase ? describe : describe.skip;

describeIf('get_variant_full_chain RPC safety', () => {
  let supabase: SupabaseClient;
  const trackIds: string[] = [];

  beforeAll(() => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  });

  afterAll(async () => {
    if (trackIds.length > 0) {
      await supabase.from('evolution_variants').delete().in('id', trackIds);
    }
  });

  it('terminates on a simulated cycle without infinite recursion', async () => {
    // Seed two variants that reference each other (a ↔ b). The CYCLE clause
    // in the RPC should halt the walk before stack overflow.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertA = (await (supabase as any)
      .from('evolution_variants')
      .insert({ variant_content: '[TEST_CYCLE] a', elo_score: 1200, generation: 0 })
      .select('id').single()) as { data: { id: string } | null; error: unknown };
    expect(insertA.error).toBeNull();
    const aId = insertA.data!.id;
    trackIds.push(aId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertB = (await (supabase as any)
      .from('evolution_variants')
      .insert({ variant_content: '[TEST_CYCLE] b', elo_score: 1200, generation: 1, parent_variant_id: aId })
      .select('id').single()) as { data: { id: string } | null; error: unknown };
    expect(insertB.error).toBeNull();
    const bId = insertB.data!.id;
    trackIds.push(bId);

    // Now point a → b, forming a ↔ b cycle.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateA = (await (supabase as any)
      .from('evolution_variants')
      .update({ parent_variant_id: bId })
      .eq('id', aId)) as { error: unknown };
    expect(updateA.error).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcRes = (await (supabase as any).rpc('get_variant_full_chain', {
      target_variant_id: bId,
    })) as RPCResponse;
    expect(rpcRes.error).toBeNull();
    // Should return a bounded result (≤ 20 rows), not infinite recursion.
    const rows = rpcRes.data ?? [];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(rows.length).toBeGreaterThan(0);
  }, 30000);

  it('handles orphan parent (parent_variant_id pointing to nonexistent row)', async () => {
    const ghostId = '00000000-0000-0000-0000-000000000099';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertC = (await (supabase as any)
      .from('evolution_variants')
      .insert({ variant_content: '[TEST_ORPHAN] c', elo_score: 1200, generation: 0,
                parent_variant_id: ghostId })
      .select('id').single()) as { data: { id: string } | null; error: unknown };
    // May succeed (no FK) or fail if FK added later — both acceptable for this test.
    if (insertC.error) {
      // If the FK constraint blocks the insert, the RPC has nothing to test here.
      console.log('[lineageCtesafety] orphan insert blocked by FK — skipping orphan test');
      return;
    }
    const cId = insertC.data!.id;
    trackIds.push(cId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcRes = (await (supabase as any).rpc('get_variant_full_chain', {
      target_variant_id: cId,
    })) as RPCResponse;
    expect(rpcRes.error).toBeNull();
    const rows = rpcRes.data ?? [];
    // At least the target variant itself; orphan parent not resolved.
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  }, 30000);
});
