/**
 * Integration tests for per_user_daily_reservations table + 3 RPCs added in
 * Phase 0 of build_website_for_evolutiOn_20260626.
 * Migration: supabase/migrations/20260627000002_per_user_daily_reservations.sql
 *
 * Auto-skips if the migration hasn't reached the staging DB yet (same
 * `does not exist | Could not find` probe pattern used by per-user-cost-rollups).
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { Database } from '@/lib/database.types';

// llmCallTracking.userid is a UUID column — must be a valid UUID, not a prefixed string.
// (The "test-reservation-…" prefix was silently rejected by the INSERT, leaving rollups at
// $0 and the cap-exceeded assertion always returning ok=true. Test never ran in PR-to-main
// CI because per-user-daily-reservations is not in integration-critical, so this slipped
// past the CI gate when it landed in #1302.)
const TEST_USER_ID = crypto.randomUUID();
const TEST_DATE = new Date().toISOString().split('T')[0]!;

describe('per_user_daily_reservations (integration)', () => {
  let serviceClient: SupabaseClient<Database>;
  let migrationApplied = true;

  beforeAll(async () => {
    serviceClient = createTestSupabaseClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const probe = await (serviceClient.rpc as any)('reserve_per_user_daily_cost', {
      p_user_id: TEST_USER_ID,
      p_date: TEST_DATE,
      p_estimated_usd: 0,
      p_cap_usd: 0,
    });
    if (probe.error && /does not exist|Could not find/.test(probe.error.message ?? '')) {
      migrationApplied = false;
      // eslint-disable-next-line no-console
      console.warn('[skip] per_user_daily_reservations migration not applied yet — skipping suite');
    }
  });

  afterEach(async () => {
    if (!migrationApplied) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceClient.from('per_user_daily_reservations' as any) as any)
      .delete()
      .eq('user_id', TEST_USER_ID);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceClient.from('per_user_daily_cost_rollups' as any) as any)
      .delete()
      .eq('user_id', TEST_USER_ID);
  });

  it('reserve_per_user_daily_cost returns ok=true and increments reserved_usd when under cap', async () => {
    if (!migrationApplied) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceClient.rpc as any)('reserve_per_user_daily_cost', {
      p_user_id: TEST_USER_ID,
      p_date: TEST_DATE,
      p_estimated_usd: 1.5,
      p_cap_usd: 10,
    });
    expect(error).toBeNull();
    expect(data.ok).toBe(true);
    expect(Number(data.reservedUsd)).toBeCloseTo(1.5, 6);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (serviceClient.from('per_user_daily_reservations' as any) as any)
      .select('reserved_usd')
      .eq('user_id', TEST_USER_ID)
      .eq('date', TEST_DATE)
      .single();
    expect(Number(row.reserved_usd)).toBeCloseTo(1.5, 6);
  });

  it('reserve_per_user_daily_cost returns ok=false WITHOUT incrementing when cap exceeded', async () => {
    if (!migrationApplied) return;

    // First reservation: pre-fill close to cap
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceClient.rpc as any)('reserve_per_user_daily_cost', {
      p_user_id: TEST_USER_ID,
      p_date: TEST_DATE,
      p_estimated_usd: 9,
      p_cap_usd: 10,
    });

    // Second reservation would push past cap — must reject
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceClient.rpc as any)('reserve_per_user_daily_cost', {
      p_user_id: TEST_USER_ID,
      p_date: TEST_DATE,
      p_estimated_usd: 2,
      p_cap_usd: 10,
    });
    expect(error).toBeNull();
    expect(data.ok).toBe(false);
    expect(Number(data.dailyCap)).toBe(10);

    // reserved_usd must NOT have increased past the first reservation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (serviceClient.from('per_user_daily_reservations' as any) as any)
      .select('reserved_usd')
      .eq('user_id', TEST_USER_ID)
      .eq('date', TEST_DATE)
      .single();
    expect(Number(row.reserved_usd)).toBeCloseTo(9, 6);
  });

  it('reserve sums per_user_daily_cost_rollups across all call_sources', async () => {
    if (!migrationApplied) return;

    // Pre-seed rollups across two different call_sources (simulates earlier real spend).
    await serviceClient.from('llmCallTracking').insert({
      prompt: '[TEST] reservation cross-source 1',
      call_source: 'integration_test_source_a',
      content: '[TEST]',
      raw_api_response: '{}',
      model: 'gpt-4.1-nano',
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      userid: TEST_USER_ID,
      estimated_cost_usd: 4,
    });
    await serviceClient.from('llmCallTracking').insert({
      prompt: '[TEST] reservation cross-source 2',
      call_source: 'integration_test_source_b',
      content: '[TEST]',
      raw_api_response: '{}',
      model: 'gpt-4.1-nano',
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      userid: TEST_USER_ID,
      estimated_cost_usd: 4,
    });

    // Now ask for $3 against a $10 cap — total = $4 + $4 + $3 = $11 → reject
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (serviceClient.rpc as any)('reserve_per_user_daily_cost', {
      p_user_id: TEST_USER_ID,
      p_date: TEST_DATE,
      p_estimated_usd: 3,
      p_cap_usd: 10,
    });
    expect(data.ok).toBe(false);

    // Clean up the llmCallTracking rows we inserted.
    await serviceClient.from('llmCallTracking').delete().eq('userid', TEST_USER_ID);
  });

  it('reconcile_per_user_reservation floors at 0 via GREATEST(0, ...) (race safety)', async () => {
    if (!migrationApplied) return;

    // Reserve $2
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceClient.rpc as any)('reserve_per_user_daily_cost', {
      p_user_id: TEST_USER_ID,
      p_date: TEST_DATE,
      p_estimated_usd: 2,
      p_cap_usd: 10,
    });

    // Try to release $5 — would underflow without the floor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (serviceClient.rpc as any)('reconcile_per_user_reservation', {
      p_user_id: TEST_USER_ID,
      p_date: TEST_DATE,
      p_reserved_usd: 5,
    });
    expect(error).toBeNull();

    // reserved_usd must be 0, not -3.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (serviceClient.from('per_user_daily_reservations' as any) as any)
      .select('reserved_usd')
      .eq('user_id', TEST_USER_ID)
      .eq('date', TEST_DATE)
      .single();
    expect(Number(row.reserved_usd)).toBe(0);
  });

  it('cleanup_orphaned_per_user_reservations zeros rows older than stale window', async () => {
    if (!migrationApplied) return;

    // Reserve $1 and forcibly age the row past the stale window by updating
    // updated_at directly (only service_role can do this; RLS denies all).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceClient.rpc as any)('reserve_per_user_daily_cost', {
      p_user_id: TEST_USER_ID,
      p_date: TEST_DATE,
      p_estimated_usd: 1,
      p_cap_usd: 10,
    });

    const oldTs = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceClient.from('per_user_daily_reservations' as any) as any)
      .update({ updated_at: oldTs })
      .eq('user_id', TEST_USER_ID)
      .eq('date', TEST_DATE);

    // Call cleanup with the default 15-minute window — our row is 30 minutes old.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (serviceClient.rpc as any)('cleanup_orphaned_per_user_reservations', {
      p_stale_minutes: 15,
    });
    expect(error).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (serviceClient.from('per_user_daily_reservations' as any) as any)
      .select('reserved_usd')
      .eq('user_id', TEST_USER_ID)
      .eq('date', TEST_DATE)
      .single();
    expect(Number(row.reserved_usd)).toBe(0);
  });
});
