/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  // Use node environment for integration tests (not jsdom)
  testEnvironment: 'node',

  // Module paths for manual mocks
  moduleDirectories: ['node_modules', '<rootDir>'],

  // Module name mapper for absolute imports and aliases
  // Mock OpenAI and Pinecone for speed/cost, but use REAL Supabase for integration tests
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    // NOTE: OpenAI and Pinecone NOT mapped here - let test files jest.mock() with custom responses
    // This gives integration tests full control over mock behavior
    '^openai/helpers/zod$': '<rootDir>/src/testing/mocks/openai-helpers-zod.ts',
    // NOTE: Supabase NOT mocked for integration tests - we use real DB
    '^langchain/text_splitter$': '<rootDir>/src/testing/mocks/langchain-text-splitter.ts',
  },

  // Setup files - runs BEFORE module imports (for shims and polyfills)
  setupFiles: ['<rootDir>/jest.shims.js'],

  // Setup files after environment - runs AFTER module imports (for test framework config)
  // Use integration-specific setup
  setupFilesAfterEnv: ['<rootDir>/jest.integration-setup.js'],

  // Test match patterns - integration tests only
  testMatch: [
    '**/__tests__/integration/**/*.integration.test.ts',
    '**/__tests__/integration/**/*.integration.test.tsx',
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{ts,tsx}',
    '!src/testing/**',
  ],

  // Transform configuration
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        moduleResolution: 'node',
      },
    }],
  },

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/out/',
    '/public/',
  ],

  // Verbose output
  verbose: true,

  // Integration test specific settings
  testTimeout: 30000, // 30 seconds for database operations
  maxWorkers: 1, // Run tests sequentially to avoid database conflicts

  // Coverage thresholds (integration tests focus on flow, not coverage)
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
};

module.exports = config;
