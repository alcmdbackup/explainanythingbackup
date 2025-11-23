async function globalSetup() {
  console.log('🚀 E2E Global Setup: Starting...');

  // Verify environment variables are set
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];

  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missingVars.join(', ')}`);
    console.warn('   E2E tests may fail without proper configuration');
  }

  // Additional setup tasks can be added here:
  // - Seed test database
  // - Clear old test data
  // - Verify external services are available

  console.log('✅ E2E Global Setup: Complete');
}

export default globalSetup;
