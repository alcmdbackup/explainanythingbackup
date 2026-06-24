/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',

  // Mock cleanup — clear call history and restore original implementations between tests
  clearMocks: true,
  restoreMocks: true,

  // Cache directory for transform cache (CI uses --cacheDirectory=/tmp/jest-cache)
  cacheDirectory: '/tmp/jest-cache',

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
    // Custom ESLint rule RuleTester suites (CommonJS .js — transformed via babel-jest
    // below). Running them here puts rule-logic coverage in the CI Unit Tests job and
    // auto-discovers new rule tests, replacing the hand-maintained `test:eslint-rules`
    // &&-chain that only covered 16 of 28 files and ran in no CI job. See
    // docs/docs_overall/testing_overview.md and the look_for_CI_flakiness project plan (F2).
    '<rootDir>/eslint-rules/**/*.test.js',
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
    // Pure-ESM packages (unified, remark-*, mdast-*, micromark-*, etc.) ship
    // as ESM only and trip Jest's CJS parser. Transform them via babel-jest.
    '^.+\\.m?js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },

  // Allow ESM-only packages to be transformed (default ignores all node_modules).
  // Without this, jest.config.transform's `.m?js` pattern would still be skipped
  // for files inside node_modules. List the packages we cross into.
  transformIgnorePatterns: [
    'node_modules/(?!(unified|bail|is-plain-obj|trough|vfile|vfile-message|unist-util-stringify-position|remark-parse|remark-stringify|mdast-util-from-markdown|mdast-util-to-markdown|mdast-util-to-string|micromark|micromark-util-.+|micromark-core-.+|decode-named-character-reference|character-entities|escape-string-regexp|character-reference-invalid|is-decimal|is-hexadecimal|is-alphanumerical|is-alphabetical|parse-entities|stringify-entities|character-entities-html4|character-entities-legacy|space-separated-tokens|comma-separated-tokens|property-information|hast-util-.+|html-void-elements|zwitch|longest-streak|markdown-table|ccount|escape-string-regexp)/)',
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/out/',
    '/public/',
    'src/__tests__/e2e/',
    'src/__tests__/integration/',
    '\\.esm\\.test\\.ts$', // ESM tests run via npm run test:esm
    'evolution/scripts/deferred/', // Deferred V1 scripts (M8)
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