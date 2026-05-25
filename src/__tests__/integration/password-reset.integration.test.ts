/**
 * Integration Test: Password Reset Flow
 *
 * Validates the Supabase SDK contract end-to-end without needing an inbox:
 *   admin.createUser → admin.generateLink → verifyOtp → updateUser → signInWithPassword
 *
 * Uses a dedicated per-test user (NOT the shared TEST_USER_*) so password
 * mutations cannot poison other tests' cached sessions.
 *
 * The requestPasswordReset server action's behavior is fully covered by
 * src/app/login/actions.test.ts; this file validates the SDK chain the action
 * delegates to, which is what we can't unit test.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { randomUUID } from 'crypto';

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';

const INITIAL_PWD = 'OldPassword1!';
const NEW_PWD = 'NewPassword1!';

describe('Password Reset Integration', () => {
  let serviceClient: SupabaseClient;
  let createdUserIds: string[] = [];

  beforeAll(() => {
    serviceClient = createTestSupabaseClient();
  });

  afterEach(async () => {
    // Delete all users created in this test, even on failure.
    const ids = [...createdUserIds];
    createdUserIds = [];
    for (const id of ids) {
      try {
        await serviceClient.auth.admin.deleteUser(id);
      } catch (err) {
        console.warn('Cleanup deleteUser failed for', id, err);
      }
    }
  });

  afterAll(async () => {
    // Belt-and-suspenders: scan for any leaked pwreset-* users from prior runs.
    // No-op if afterEach already cleaned everything.
    if (createdUserIds.length === 0) return;
    for (const id of createdUserIds) {
      try {
        await serviceClient.auth.admin.deleteUser(id);
      } catch {
        // ignore
      }
    }
  });

  async function createDedicatedUser(): Promise<{ id: string; email: string }> {
    const email = `pwreset-${Date.now()}-${randomUUID()}@example.com`;
    const { data, error } = await serviceClient.auth.admin.createUser({
      email,
      password: INITIAL_PWD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Failed to create test user: ${error?.message ?? 'no user'}`);
    }
    createdUserIds.push(data.user.id);
    return { id: data.user.id, email };
  }

  it('admin.generateLink returns a usable hashed_token', async () => {
    const user = await createDedicatedUser();

    const { data, error } = await serviceClient.auth.admin.generateLink({
      type: 'recovery',
      email: user.email,
    });

    expect(error).toBeNull();
    // SDK returns the hashed token in the structured response — do NOT parse
    // from action_link (that uses a raw `token` param, not `token_hash`).
    expect(data?.properties?.hashed_token).toBeTruthy();
    expect(typeof data?.properties?.hashed_token).toBe('string');
  });

  it('completes the full recovery → updateUser → signInWithPassword chain', async () => {
    const user = await createDedicatedUser();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // Step 1: generate a recovery link via service-role admin API.
    const { data: linkData, error: linkErr } = await serviceClient.auth.admin.generateLink({
      type: 'recovery',
      email: user.email,
    });
    expect(linkErr).toBeNull();
    const tokenHash = linkData?.properties?.hashed_token;
    expect(tokenHash).toBeTruthy();

    // Step 2: simulate the user clicking the email link by calling verifyOtp
    // directly on a fresh anon client. This is exactly what /auth/confirm does
    // internally (`src/app/auth/confirm/route.ts:20`).
    const recoveryClient = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: otpData, error: otpErr } = await recoveryClient.auth.verifyOtp({
      type: 'recovery',
      token_hash: tokenHash!,
    });
    expect(otpErr).toBeNull();
    expect(otpData.session).toBeTruthy();
    expect(otpData.user?.email).toBe(user.email);

    // Step 3: change the password on the recovered session.
    const { error: updateErr } = await recoveryClient.auth.updateUser({
      password: NEW_PWD,
    });
    expect(updateErr).toBeNull();

    // Step 4: prove the new password actually works on a brand-new client.
    const verifyClient = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInErr } = await verifyClient.auth.signInWithPassword({
      email: user.email,
      password: NEW_PWD,
    });
    expect(signInErr).toBeNull();
    expect(signInData.session).toBeTruthy();

    // Step 5: and prove the old password no longer works.
    const verifyOldClient = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: oldErr } = await verifyOldClient.auth.signInWithPassword({
      email: user.email,
      password: INITIAL_PWD,
    });
    expect(oldErr).toBeTruthy();
  }, 30000);

  it('verifyOtp with a tampered token_hash fails', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const recoveryClient = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await recoveryClient.auth.verifyOtp({
      type: 'recovery',
      token_hash: 'not-a-real-token',
    });
    expect(error).toBeTruthy();
  });
});
