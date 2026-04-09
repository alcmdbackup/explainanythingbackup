/**
 * Tests for warn-slow-with-retries ESLint rule.
 */
const { RuleTester } = require('eslint');
const rule = require('./warn-slow-with-retries');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2020 },
});

ruleTester.run('warn-slow-with-retries', rule, {
  valid: [
    // test.slow() without retries — OK
    {
      code: `
        test.describe('suite', () => {
          test('a', () => { test.slow(); });
        });
      `,
    },
    // retries: 1 with test.slow() — OK (under threshold)
    {
      code: `
        test.describe('suite', () => {
          test.describe.configure({ retries: 1 });
          test('a', () => { test.slow(); });
        });
      `,
    },
    // retries: 2 without test.slow() — OK
    {
      code: `
        test.describe('suite', () => {
          test.describe.configure({ retries: 2 });
          test('a', () => {});
        });
      `,
    },
  ],
  invalid: [
    // test.slow() with retries: 2 — warn
    {
      code: `
        test.describe('suite', () => {
          test.describe.configure({ retries: 2 });
          test('a', () => { test.slow(); });
        });
      `,
      errors: [{ messageId: 'slowWithRetries' }],
    },
    // test.slow() with retries: 3 — warn
    {
      code: `
        test.describe('suite', () => {
          test.describe.configure({ retries: 3 });
          test('a', () => { test.slow(); });
        });
      `,
      errors: [{ messageId: 'slowWithRetries' }],
    },
  ],
});

console.log('warn-slow-with-retries: all tests passed');
