/**
 * Tests for the no-subdefault-expect-timeout ESLint rule.
 *
 * Run with: node eslint-rules/no-subdefault-expect-timeout.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-subdefault-expect-timeout');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
  },
});

ruleTester.run('no-subdefault-expect-timeout', rule, {
  valid: [
    // No timeout option — relies on the env-scaled config default (preferred).
    `expect(page.getByTestId('row')).toBeVisible()`,
    `expect(locator).toHaveText('hi')`,
    `locator.waitFor({ state: 'visible' })`,
    // Timeout LARGER than the default — deliberate long-poll, allowed.
    `expect(page.getByTestId('row')).toBeVisible({ timeout: 30000 })`,
    `expect(locator).toHaveCount(2, { timeout: 15000 })`,
    `locator.waitFor({ state: 'visible', timeout: 30000 })`,
    // Non-targeted methods are ignored even with a short timeout.
    `page.waitForResponse('**/api/x', { timeout: 5000 })`,
    `page.waitForSelector('.x', { timeout: 5000 })`,
    `page.waitForURL(/results/, { timeout: 10000 })`,
    // A non-numeric / variable timeout is not flagged (can't statically know it's sub-default).
    `expect(locator).toBeVisible({ timeout: SHORT })`,
  ],
  invalid: [
    // Exactly the local default — zero headroom, shrinks CI/prod budget.
    {
      code: `expect(page.getByText(t)).toBeVisible({ timeout: 10000 })`,
      errors: [{ messageId: 'subdefaultTimeout', data: { value: 10000, method: 'toBeVisible' } }],
    },
    // Below the default.
    {
      code: `expect(locator).toBeVisible({ timeout: 5000 })`,
      errors: [{ messageId: 'subdefaultTimeout' }],
    },
    // waitFor with state + sub-default timeout.
    {
      code: `locator.waitFor({ state: 'hidden', timeout: 10000 })`,
      errors: [{ messageId: 'subdefaultTimeout', data: { value: 10000, method: 'waitFor' } }],
    },
    // Timeout as a later argument (toHaveText('x', { timeout }) form).
    {
      code: `expect(locator).toHaveText('x', { timeout: 3000 })`,
      errors: [{ messageId: 'subdefaultTimeout', data: { value: 3000, method: 'toHaveText' } }],
    },
    // toHaveCount with a value arg then sub-default options.
    {
      code: `expect(locator).toHaveCount(2, { timeout: 8000 })`,
      errors: [{ messageId: 'subdefaultTimeout', data: { value: 8000, method: 'toHaveCount' } }],
    },
  ],
});

console.log('All no-subdefault-expect-timeout tests passed!');
