/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',

  // Module paths for manual mocks
  moduleDirectories: ['node_modules', '<rootDir>'],

  // Module name mapper for absolute imports and aliases
  moduleNameMapper: {
    '^@evolution/(.*)$': '<rootDir>/evolution/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^openai/helpers/zod$': '<rootDir>/src/testing/mocks/openai-helpers-zod.ts',
    '^openai$': '<rootDir>/src/testing/mocks/openai.ts',
    '^@pinecone-database/pinecone$': '<rootDir>/src/testing/mocks/@pinecone-database/pinecone.ts',
    '^@supabase/supabase-js$': '<rootDir>/src/testing/mocks/@supabase/supabase-js.ts',
    '^@anthropic-ai/sdk$': '<rootDir>/src/testing/mocks/@anthropic-ai/sdk.ts',
    '^langchain/text_splitter$': '<rootDir>/src/testing/mocks/langchain-text-splitter.ts',
    '^d3$': '<rootDir>/src/testing/mocks/d3.ts',
    '^d3-dag$': '<rootDir>/src/testing/mocks/d3-dag.ts',
    '^openskill$': '<rootDir>/src/testing/mocks/openskill.ts',
  },

  // Setup files - runs BEFORE module imports (for shims and polyfills)
  setupFiles: ['<rootDir>/jest.shims.js'],

  // Setup files after environment - runs AFTER module imports (for test framework config)
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Test match patterns - colocated structure
  testMatch: [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'evolution/src/**/*.{ts,tsx}',
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
    'src/__tests__/e2e/',
    'src/__tests__/integration/',
    '\\.esm\\.test\\.ts$', // ESM tests run via npm run test:esm
  ],

  // Verbose output
  verbose: true,

  // Coverage thresholds — floor set ~5% below current baseline (Feb 2026)
  // Only enforced on full runs; --changedSince subset runs have lower coverage by design
  coverageThreshold: process.argv.some(arg => arg.startsWith('--changedSince')) ? undefined : {
    global: {
      branches: 41,
      functions: 35,
      lines: 42,
      statements: 42,
    },
  },
};

module.exports = config;