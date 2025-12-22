/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',

  // Module paths for manual mocks
  moduleDirectories: ['node_modules', '<rootDir>'],

  // Module name mapper for absolute imports and aliases
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^openai/helpers/zod$': '<rootDir>/src/testing/mocks/openai-helpers-zod.ts',
    '^openai$': '<rootDir>/src/testing/mocks/openai.ts',
    '^@pinecone-database/pinecone$': '<rootDir>/src/testing/mocks/@pinecone-database/pinecone.ts',
    '^@supabase/supabase-js$': '<rootDir>/src/testing/mocks/@supabase/supabase-js.ts',
    '^langchain/text_splitter$': '<rootDir>/src/testing/mocks/langchain-text-splitter.ts',
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

  // Coverage thresholds (starting at 0, will increase progressively)
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