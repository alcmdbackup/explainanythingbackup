/**
 * Tests for the require-reset-filters ESLint rule.
 *
 * Run with: node eslint-rules/require-reset-filters.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./require-reset-filters');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('require-reset-filters', rule, {
  valid: [
    // Has both [TEST] literal AND resetFilters() call — fine
    `adminTest('seeds and resets', async () => {
      await contentPage.resetFilters();
      await contentPage.search('[TEST] foo');
    })`,
    // resetFilters() before [TEST] literal anywhere in body
    `test('seeds and resets reverse', async () => {
      await page.search('[TEST] bar');
      await page.resetFilters();
    })`,
    // resetSearch() also satisfies the rule
    `adminTest('uses reset search', async () => {
      await page.resetSearch();
      await page.search('[TEST] baz');
    })`,
    // Test does NOT use [TEST] literal — not flagged regardless of reset
    `adminTest('non-test data', async () => {
      await page.search('regular search');
    })`,
    // Empty test body
    `test('empty', async () => {})`,
    // Non-test call ignored (e.g., test.describe)
    `test.describe('suite', () => {})`,
    // Test without callback (e.g., test.skip(condition, 'reason'))
    `test.skip(condition, 'reason')`,
  ],
  invalid: [
    // The exact bug from PR #930 — seeds [TEST] data, no reset call
    {
      code: `adminTest('search filters', async () => {
        await contentPage.gotoContent();
        await contentPage.search('[TEST] Admin Test Visible');
      })`,
      errors: [{ messageId: 'requireReset' }],
    },
    // Plain test (not adminTest) also caught
    {
      code: `test('seeds without reset', async () => {
        await page.search('[TEST] foo');
      })`,
      errors: [{ messageId: 'requireReset' }],
    },
    // [TEST] in template literal
    {
      code: 'adminTest(\'templated\', async () => { await page.search(`[TEST] dynamic`) })',
      errors: [{ messageId: 'requireReset' }],
    },
    // adminTest with options object — callback is the last arg
    {
      code: `adminTest('with options', { tag: '@critical' }, async () => {
        await page.search('[TEST] tagged');
      })`,
      errors: [{ messageId: 'requireReset' }],
    },
    // Test with resetSomething() that doesn't match the regex — not satisfied
    {
      code: `test('wrong reset name', async () => {
        await page.resetState();
        await page.search('[TEST] foo');
      })`,
      errors: [{ messageId: 'requireReset' }],
    },
  ],
});

console.log('require-reset-filters: all tests passed');
