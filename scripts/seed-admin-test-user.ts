/**
 * Seed script for admin E2E test user.
 * Creates auth user and adds to admin_users table if not exists.
 * Also verifies TEST_USER is not in admin_users (for non-admin redirect test).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TEST_EMAIL = process.env.ADMIN_TEST_EMAIL;
const ADMIN_TEST_PASSWORD = process.env.ADMIN_TEST_PASSWORD;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;

async function seedAdminTestUser() {
  // Validate required env vars
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  if (!ADMIN_TEST_EMAIL || !ADMIN_TEST_PASSWORD) {
    console.log('⚠ ADMIN_TEST_EMAIL or ADMIN_TEST_PASSWORD not set - skipping admin user seeding');
    console.log('  Admin E2E tests will be skipped until these secrets are configured.');
    return; // Exit gracefully without error
  }

  // Validate password strength
  if (ADMIN_TEST_PASSWORD.length < 12) {
    throw new Error('ADMIN_TEST_PASSWORD must be at least 12 characters');
  }

  // Verify admin email differs from regular test user
  if (ADMIN_TEST_EMAIL === TEST_USER_EMAIL) {
    throw new Error('ADMIN_TEST_EMAIL must differ from TEST_USER_EMAIL');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Get or create auth user
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  let userId = authUsers?.users.find((u) => u.email === ADMIN_TEST_EMAIL)?.id;

  if (!userId) {
    console.log(`Creating admin test user: ${ADMIN_TEST_EMAIL}`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_TEST_EMAIL,
      password: ADMIN_TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`Failed to create admin user: ${error.message}`);
    userId = data.user?.id;
  } else {
    console.log(`Admin test user already exists: ${ADMIN_TEST_EMAIL}`);
  }

  if (!userId) throw new Error('Failed to get admin user ID');

  // 2. Add to admin_users table
  const { error: upsertError } = await supabase.from('admin_users').upsert(
    {
      user_id: userId,
      role: 'admin',
      added_by: userId,
    },
    { onConflict: 'user_id' }
  );

  if (upsertError) {
    throw new Error(`Failed to upsert admin_users: ${upsertError.message}`);
  }

  console.log(`✓ Admin test user seeded: ${ADMIN_TEST_EMAIL} (${userId})`);

  // 3. Verify TEST_USER is not an admin (for non-admin redirect test)
  if (TEST_USER_EMAIL) {
    const regularUserId = authUsers?.users.find((u) => u.email === TEST_USER_EMAIL)?.id;

    if (regularUserId) {
      const { data: adminCheck } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', regularUserId)
        .single();

      if (adminCheck) {
        throw new Error(
          `TEST_USER (${TEST_USER_EMAIL}) is in admin_users! Remove before running tests.`
        );
      }
      console.log(`✓ Verified TEST_USER (${TEST_USER_EMAIL}) is not an admin`);
    }
  }
}

seedAdminTestUser().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
