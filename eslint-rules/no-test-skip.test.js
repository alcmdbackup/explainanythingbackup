/**
 * Tests for the no-test-skip ESLint rule.
 *
 * Run with: node eslint-rules/no-test-skip.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-test-skip');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

ruleTester.run('no-test-skip', rule, {
  valid: [
    // Normal test call is fine
    `test('should work', () => {})`,
    // test.describe is fine
    `test.describe('suite', () => {})`,
    // test.only is not caught by this rule (separate concern)
    `test.only('focused test', () => {})`,
    // skip on a non-test object is fine
    `myObj.skip()`,
    // adminTest.describe is fine
    `adminTest.describe('admin suite', () => {})`,
  ],
  invalid: [
    // Basic test.skip
    {
      code: `test.skip('skipped test', () => {})`,
      errors: [{ messageId: 'noTestSkip' }],
    },
    // test.skip with async
    {
      code: `test.skip('skipped async', async () => {})`,
      errors: [{ messageId: 'noTestSkip' }],
    },
    // test.skip used as condition check
    {
      code: `test.skip(someCondition, 'reason')`,
      errors: [{ messageId: 'noTestSkip' }],
    },
    // adminTest.skip should also be caught
    {
      code: `adminTest.skip('admin skipped test', () => {})`,
      errors: [{ messageId: 'noTestSkip' }],
    },
  ],
});

console.log('✓ no-test-skip tests passed');
