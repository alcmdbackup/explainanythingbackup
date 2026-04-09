/**
 * Tests for the no-point-in-time-checks ESLint rule.
 *
 * Run with: node eslint-rules/no-point-in-time-checks.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-point-in-time-checks');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

ruleTester.run('no-point-in-time-checks', rule, {
  valid: [
    // Auto-waiting assertions (the preferred pattern)
    `expect(page.locator('body')).toContainText('Hello')`,
    `expect(page.locator('.item')).toBeVisible()`,
    `expect(searchInput).toHaveValue('quantum')`,

    // Variable assignment for control flow (legitimate)
    `async function run() { const visible = await page.isVisible('.modal') }`,
    `async function run() { const text = await page.textContent('body') }`,

    // Safe helper wrappers (allowed)
    `safeIsVisible(page.locator('.item'))`,
    `safeTextContent(page.locator('body'))`,

    // Standalone call (logging/side effects)
    `async function run() { await page.textContent('body') }`,
    `page.isVisible('.item')`,

    // Non-matching method names
    `page.click('.button')`,
    `page.fill('.input', 'text')`,
    `page.waitForSelector('.item')`,
  ],
  invalid: [
    // textContent result passed directly to expect
    {
      code: `async function run() { expect(await page.textContent('body')).toContain('Hello') }`,
      errors: [{ messageId: 'noPointInTime' }],
    },
    // isVisible result passed directly to expect
    {
      code: `async function run() { expect(await page.isVisible('.content')).toBe(true) }`,
      errors: [{ messageId: 'noPointInTime' }],
    },
    // innerText in expect
    {
      code: `async function run() { expect(await el.innerText()).toBe('Hello') }`,
      errors: [{ messageId: 'noPointInTime' }],
    },
    // inputValue in expect
    {
      code: `async function run() { expect(await input.inputValue()).toBe('quantum') }`,
      errors: [{ messageId: 'noPointInTime' }],
    },
    // getAttribute in expect
    {
      code: `async function run() { expect(await el.getAttribute('class')).toContain('active') }`,
      errors: [{ messageId: 'noPointInTime' }],
    },
  ],
});

console.log('✓ no-point-in-time-checks tests passed');
