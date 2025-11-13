/**
 * Integration Test Setup
 *
 * This file runs AFTER the test environment is set up but BEFORE tests run.
 * Use it for:
 * - Loading test environment variables
 * - Setting up global test utilities
 * - Configuring test database connections
 * - Adding global before/after hooks
 */

// Load environment variables from .env.stage
require('dotenv').config({ path: '.env.stage' });

// Add custom Jest matchers (optional for integration tests, but helpful)
// Note: @testing-library/jest-dom is mainly for DOM testing, may not be needed
// require('@testing-library/jest-dom');

// Polyfills for Node environment (required by langchain/langsmith and OpenAI)
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Global test configuration
const INTEGRATION_TEST_TIMEOUT = parseInt(process.env.INTEGRATION_TEST_TIMEOUT || '60000', 10);
const CLEANUP_AFTER_TESTS = process.env.CLEANUP_AFTER_TESTS === 'true';
const USE_REAL_API_CALLS = process.env.USE_REAL_API_CALLS !== 'false'; // Default to true

// Validate required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'PINECONE_API_KEY',
  'PINECONE_INDEX',
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('\n❌ Missing required environment variables for integration tests:');
  console.error(`   ${missingEnvVars.join(', ')}`);
  console.error('\n📝 Please update your .env.stage file with the required variables.');
  console.error('   Integration tests use the same credentials as staging environment.\n');
  process.exit(1);
}

// Log test configuration (without sensitive values)
console.log('\n🧪 Integration Test Configuration:');
console.log(`   Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`   Pinecone Index: ${process.env.PINECONE_INDEX}`);
console.log(`   Test Timeout: ${INTEGRATION_TEST_TIMEOUT}ms`);
console.log(`   Cleanup After Tests: ${CLEANUP_AFTER_TESTS}`);
console.log(`   Use Real API Calls: ${USE_REAL_API_CALLS}`);
console.log('');

// Global setup for all integration tests
beforeAll(async () => {
  // Optional: Setup test database, seed data, etc.
  // const { setupTestDatabase } = require('./src/testing/utils/integration-helpers');
  // await setupTestDatabase();
});

// Global teardown for all integration tests
afterAll(async () => {
  // Optional: Cleanup test database
  // const { teardownTestDatabase } = require('./src/testing/utils/integration-helpers');
  // await teardownTestDatabase();

  // Give time for connections to close
  await new Promise(resolve => setTimeout(resolve, 500));
});

// Suppress specific console warnings/errors in tests (optional)
const originalWarn = console.warn;
const originalError = console.error;

beforeAll(() => {
  // Suppress specific warnings that are expected in tests
  console.warn = (...args) => {
    const message = args[0]?.toString() || '';

    // Suppress known warnings
    if (
      message.includes('Warning: ReactDOM.render') ||
      message.includes('Not implemented: HTMLFormElement.prototype.submit')
    ) {
      return;
    }

    originalWarn.call(console, ...args);
  };

  console.error = (...args) => {
    const message = args[0]?.toString() || '';

    // Suppress known errors (add as needed)
    if (message.includes('Some expected error pattern')) {
      return;
    }

    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.warn = originalWarn;
  console.error = originalError;
});

// Export configuration for use in tests
global.__INTEGRATION_TEST_CONFIG__ = {
  timeout: INTEGRATION_TEST_TIMEOUT,
  cleanupAfterTests: CLEANUP_AFTER_TESTS,
  useRealApiCalls: USE_REAL_API_CALLS,
};
