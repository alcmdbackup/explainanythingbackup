/**
 * Tests for the no-wait-for-timeout ESLint rule.
 *
 * Run with: node eslint-rules/no-wait-for-timeout.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-wait-for-timeout');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-wait-for-timeout', rule, {
  valid: [
    // waitForSelector is the preferred alternative
    `page.waitForSelector('[data-testid="loaded"]')`,
    // locator.waitFor is fine
    `page.locator('.item').waitFor({ state: 'visible' })`,
    // setTimeout is not the same as waitForTimeout
    `setTimeout(() => {}, 1000)`,
    // unrelated method calls
    `page.waitForResponse('**/api/data')`,
    // new Promise without await is fine
    `new Promise(r => setTimeout(r, 1000))`,
    // new Promise with non-setTimeout body is fine
    `async () => { await new Promise(resolve => resolve(42)) }`,
  ],
  invalid: [
    {
      code: `page.waitForTimeout(1000)`,
      errors: [{ messageId: 'noWaitForTimeout', data: { timeout: 1000 } }],
    },
    {
      code: `await page.waitForTimeout(5000)`,
      errors: [{ messageId: 'noWaitForTimeout', data: { timeout: 5000 } }],
    },
    {
      code: `frame.waitForTimeout(500)`,
      errors: [{ messageId: 'noWaitForTimeout', data: { timeout: 500 } }],
    },
    // noFixedSleep: arrow expression body
    {
      code: `async () => { await new Promise(resolve => setTimeout(resolve, 1000)) }`,
      errors: [{ messageId: 'noFixedSleep' }],
    },
    // noFixedSleep: arrow with parens and block body
    {
      code: `async () => { await new Promise((resolve) => { setTimeout(resolve, 500) }) }`,
      errors: [{ messageId: 'noFixedSleep' }],
    },
    // noFixedSleep: short param name
    {
      code: `async () => { await new Promise(r => setTimeout(r, 2000)) }`,
      errors: [{ messageId: 'noFixedSleep' }],
    },
  ],
});

console.log('✓ no-wait-for-timeout tests passed');
