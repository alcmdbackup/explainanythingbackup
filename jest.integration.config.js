/** @type {import('jest').Config} */
const baseConfig = require('./jest.config.js');

/**
 * Integration Test Configuration
 *
 * Key differences from unit tests:
 * - Uses real Supabase, OpenAI, and Pinecone connections
 * - Node environment (not jsdom - no React component testing)
 * - Longer timeouts for API calls
 * - Sequential execution to avoid database conflicts
 * - Different test file pattern (.integration.test.ts)
 */
const config = {
  ...baseConfig,

  // Use node environment for integration tests (no DOM needed)
  testEnvironment: 'node',

  // Only run integration tests
  testMatch: [
    '**/*.integration.test.ts',
    '**/*.integration.test.tsx',
  ],

  // Longer timeout for real API calls (60 seconds)
  testTimeout: 60000,

  // Run tests sequentially to avoid database conflicts
  // Can be increased if tests use isolated data
  maxWorkers: 1,

  // Clear all mocks between tests for isolation
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Integration-specific setup file
  setupFilesAfterEnv: ['<rootDir>/jest.integration-setup.js'],

  // DO NOT mock external services for integration tests
  // Remove the moduleNameMapper entries that mock APIs
  moduleNameMapper: {
    // Keep only the absolute import alias
    '^@/(.*)$': '<rootDir>/src/$1',
    // Keep CSS mocking
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    // REMOVE OpenAI, Pinecone, Supabase mocks - use real clients
  },

  // Global settings for integration tests
  globals: {
    'ts-jest': {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        moduleResolution: 'node',
      },
    },
  },

  // Coverage configuration (optional for integration tests)
  collectCoverage: false, // Usually don't collect coverage for integration tests

  // Coverage collection if enabled
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{ts,tsx}',
    '!src/testing/**',
    '!src/**/*.test.{ts,tsx}', // Exclude unit test files
  ],

  // Verbose output for better debugging
  verbose: true,

  // Force exit after tests complete (helpful for hanging connections)
  forceExit: true,

  // Detect open handles (database connections, timers, etc.)
  detectOpenHandles: true,
};

module.exports = config;
