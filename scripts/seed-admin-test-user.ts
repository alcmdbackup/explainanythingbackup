/**
 * Seed script for admin E2E test user.
 * Ensures TEST_USER exists in auth and is added to admin_users table.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;

async function seedAdminTestUser() {
  // Validate required env vars — exit gracefully if missing so CI doesn't fail
  // when secrets aren't configured (test user likely already exists in staging)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('⚠ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set - skipping admin user seeding');
    console.log('  Test user likely already exists. E2E auth uses TEST_USER_EMAIL/PASSWORD directly.');
    return;
  }

  if (!TEST_USER_EMAIL || !TEST_USER_PASSWORD) {
    console.log('⚠ TEST_USER_EMAIL or TEST_USER_PASSWORD not set - skipping admin user seeding');
    console.log('  Admin E2E tests will be skipped until these secrets are configured.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Get or create auth user
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  let userId = authUsers?.users.find((u) => u.email === TEST_USER_EMAIL)?.id;

  if (!userId) {
    console.log(`Creating admin test user: ${TEST_USER_EMAIL}`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`Failed to create admin user: ${error.message}`);
    userId = data.user?.id;
  } else {
    console.log(`Admin test user already exists: ${TEST_USER_EMAIL}`);
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

  console.log(`✓ Admin test user seeded: ${TEST_USER_EMAIL} (${userId})`);
}

seedAdminTestUser().catch((err) => {
  // Log but don't fail CI — test user likely already exists
  console.warn('⚠ Seed warning:', err.message);
  console.warn('  Continuing — E2E auth uses TEST_USER_EMAIL/PASSWORD directly, seed is optional.');
});
