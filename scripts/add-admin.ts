/**
 * Script to add a user as admin.
 * Usage: npx ts-node scripts/add-admin.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const USER_ID = '08b3f7d2-196f-4606-83fc-d78b080f3e6f';

async function addAdmin() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data, error } = await supabase
    .from('admin_users')
    .upsert({
      user_id: USER_ID,
      role: 'admin',
      added_by: USER_ID
    }, { onConflict: 'user_id' })
    .select();

  if (error) {
    console.error('Error adding admin:', error.message);
    process.exit(1);
  }

  console.log('Admin user added successfully:', data);
}

addAdmin();
