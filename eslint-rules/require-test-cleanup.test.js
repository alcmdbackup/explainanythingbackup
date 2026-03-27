/**
 * Tests for the require-test-cleanup ESLint rule.
 *
 * Run with: node eslint-rules/require-test-cleanup.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./require-test-cleanup');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('require-test-cleanup', rule, {
  valid: [
    // Has afterAll with supabase import
    `import { createClient } from '@supabase/supabase-js';
     test.afterAll(async () => { /* cleanup */ });
     test('does stuff', () => {});`,

    // Has afterAll with test-data-factory import
    `import { createTestExplanation } from '../helpers/test-data-factory';
     adminTest.afterAll(async () => { /* cleanup */ });
     adminTest('creates data', () => {});`,

    // Has afterAll with evolution-test-helpers import
    `import { createTestEvolutionRun } from 'evolution-test-helpers';
     test.afterAll(async () => { /* cleanup */ });
     test('creates run', () => {});`,

    // No DB imports — afterAll not required
    `import { expect } from '@playwright/test';
     test('renders page', () => {});`,

    // No imports at all
    `const x = 1;`,
  ],
  invalid: [
    {
      code: `import { createClient } from '@supabase/supabase-js';
             test('creates data', () => {});`,
      errors: [{ messageId: 'missingCleanup', data: { source: '@supabase/supabase-js' } }],
    },
    {
      code: `import { createTestExplanation } from '../helpers/test-data-factory';
             test('creates data', () => {});`,
      errors: [{ messageId: 'missingCleanup', data: { source: 'test-data-factory' } }],
    },
    {
      code: `import { createTestEvolutionRun } from '@evolution/testing/evolution-test-helpers';
             test('creates run', () => {});`,
      errors: [{ messageId: 'missingCleanup', data: { source: 'evolution-test-helpers' } }],
    },
  ],
});

console.log('✅ require-test-cleanup: all tests passed');
