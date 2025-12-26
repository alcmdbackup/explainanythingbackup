import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

async function globalSetup() {
  console.log('🚀 E2E Global Setup: Starting...');

  // Load environment variables from .env.local
  // This is needed because Playwright tests run in Node.js, not through Next.js
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  // Skip setup if E2E_TEST_MODE is not enabled
  if (process.env.E2E_TEST_MODE !== 'true') {
    console.log('⏭️  E2E_TEST_MODE not enabled, skipping setup');
    return;
  }

  // Verify required environment variables
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];

  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missingVars.join(', ')}`);
    console.warn('   E2E tests may fail without proper configuration');
    return;
  }

  // Optional: Seed shared fixtures if service role key is available
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await seedSharedFixtures();
    } catch (error) {
      console.warn('⚠️  Failed to seed shared fixtures:', error);
    }
  }

  console.log('✅ E2E Global Setup: Complete');
}

/**
 * Seeds shared test fixtures that are used across multiple tests.
 * Uses upsert to be idempotent - safe to run multiple times.
 */
async function seedSharedFixtures() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Seed a test topic if needed (idempotent via upsert)
  const { error: topicError } = await supabase.from('topics').upsert(
    {
      topic_title: 'test-e2e-topic',
      topic_description: 'Topic for E2E tests',
    },
    { onConflict: 'topic_title' }
  );

  if (topicError) {
    console.warn('⚠️  Failed to seed test topic:', topicError.message);
  } else {
    console.log('   ✓ Seeded test topic');
  }
}

export default globalSetup;
