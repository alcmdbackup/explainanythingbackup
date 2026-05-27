/**
 * Seed the demo guest user (Phase 4 of fixes_explainanything_for_public_demo_20260523).
 *
 * Idempotent: if `guest@explainanything.app` already exists in auth, this script
 * looks up its UUID and exits cleanly. If it does NOT exist, the script creates
 * it with a generated random password and prints the password ONCE to stdout
 * so the operator can copy it into Vercel env vars + GitHub Actions secrets.
 *
 * Outputs:
 *   GUEST_EMAIL      = guest@explainanything.app
 *   GUEST_PASSWORD   = <generated, only printed on creation>
 *   GUEST_USER_ID    = <captured UUID>
 *
 * After running, set these in:
 *   - Vercel Production env vars (all 3 + NEXT_PUBLIC_GUEST_EMAIL)
 *   - Vercel Preview env vars (same 4)
 *   - GitHub Actions `staging` environment secrets
 *   - GitHub Actions `Production` environment secrets
 *   - .env.local for local dev
 */

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
import type { Database } from '../src/lib/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GUEST_EMAIL = process.env.GUEST_EMAIL ?? 'guest@explainanything.app';

function generatePassword(): string {
  // 32 bytes of randomness, base64-encoded with URL-safe charset (no padding).
  return randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function seedGuestUser() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('✗ NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }

  const ROTATE = process.argv.includes('--rotate');

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Look up existing user by email.
  const { data: listResult, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error(`✗ listUsers failed: ${listErr.message}`);
    process.exit(1);
  }

  const existing = listResult?.users.find((u) => u.email === GUEST_EMAIL);
  if (existing) {
    if (ROTATE) {
      const newPassword = generatePassword();
      const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, {
        password: newPassword,
      });
      if (updateErr) {
        console.error(`✗ updateUserById failed: ${updateErr.message}`);
        process.exit(1);
      }
      console.log(`✓ Guest user password rotated`);
      console.log('');
      console.log('  COPY THESE VALUES INTO VERCEL + GITHUB SECRETS NOW (only printed once):');
      console.log(`  GUEST_EMAIL=${GUEST_EMAIL}`);
      console.log(`  GUEST_PASSWORD=${newPassword}`);
      console.log(`  GUEST_USER_ID=${existing.id}`);
      console.log(`  NEXT_PUBLIC_GUEST_EMAIL=${GUEST_EMAIL}`);
      console.log('');
      console.log('  Targets: Vercel Production + Preview env vars, GitHub Actions staging + Production env secrets, local .env.local');
      console.log('  REMINDER: trigger a Vercel redeploy after updating env vars so running containers pick up the new password.');
      return;
    }
    console.log(`✓ Guest user already exists`);
    console.log(`  GUEST_EMAIL=${GUEST_EMAIL}`);
    console.log(`  GUEST_USER_ID=${existing.id}`);
    console.log(`  (GUEST_PASSWORD not printed — use the existing value from Vercel env vars.`);
    console.log(`   If lost, run with --rotate to set a new one.)`);
    return;
  }

  const password = generatePassword();
  console.log(`Creating guest user: ${GUEST_EMAIL}`);
  const { data: createResult, error: createErr } = await supabase.auth.admin.createUser({
    email: GUEST_EMAIL,
    password,
    email_confirm: true,
  });

  if (createErr || !createResult?.user) {
    console.error(`✗ createUser failed: ${createErr?.message ?? 'unknown error'}`);
    process.exit(1);
  }

  console.log(`✓ Guest user created`);
  console.log('');
  console.log('  COPY THESE VALUES INTO VERCEL + GITHUB SECRETS NOW (only printed once):');
  console.log(`  GUEST_EMAIL=${GUEST_EMAIL}`);
  console.log(`  GUEST_PASSWORD=${password}`);
  console.log(`  GUEST_USER_ID=${createResult.user.id}`);
  console.log(`  NEXT_PUBLIC_GUEST_EMAIL=${GUEST_EMAIL}`);
  console.log('');
  console.log('  Targets: Vercel Production + Preview env vars, GitHub Actions staging + Production env secrets, local .env.local');
}

seedGuestUser().catch((err) => {
  console.error('✗ seed-guest-user failed:', err);
  process.exit(1);
});
