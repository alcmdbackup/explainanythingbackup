/**
 * Tests for the no-networkidle ESLint rule.
 *
 * Run with: node eslint-rules/no-networkidle.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-networkidle');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

ruleTester.run('no-networkidle', rule, {
  valid: [
    // waitForLoadState with 'load' is fine
    `page.waitForLoadState('load')`,
    // waitForLoadState with 'domcontentloaded' is fine
    `page.waitForLoadState('domcontentloaded')`,
    // waitForSelector is the preferred alternative
    `page.waitForSelector('[data-testid="ready"]')`,
    // locator.waitFor is fine
    `page.locator('.item').waitFor({ state: 'visible' })`,
    // waitForLoadState with no args
    `page.waitForLoadState()`,
  ],
  invalid: [
    {
      code: `page.waitForLoadState('networkidle')`,
      errors: [{ messageId: 'noNetworkIdle' }],
    },
    {
      code: `async function run() { await page.waitForLoadState('networkidle') }`,
      errors: [{ messageId: 'noNetworkIdle' }],
    },
    {
      code: `frame.waitForLoadState('networkidle')`,
      errors: [{ messageId: 'noNetworkIdle' }],
    },
  ],
});

console.log('✓ no-networkidle tests passed');
