/**
 * Tests for the no-point-in-time-pom-helpers ESLint rule.
 *
 * Run with: node eslint-rules/no-point-in-time-pom-helpers.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-point-in-time-pom-helpers');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

ruleTester.run('no-point-in-time-pom-helpers', rule, {
  valid: [
    // Playwright bare `page` fixture — must NOT match (no uppercase before Page)
    `async function t() { expect(await page.title()).toBe('foo') }`,
    `async function t() { expect(await page.url()).toContain('/results') }`,
    `async function t() { expect(await page.content()).toContain('hello') }`,
    // Correct patterns
    `async function t() { await expect.poll(() => resultsPage.getContent()).toEqual(x) }`,
    `async function t() { await expect(locator).toHaveText(x) }`,
    `async function t() { await expect(locator).toBeVisible() }`,
    // Non-POM identifier (doesn't end in Page) — not flagged
    `async function t() { expect(await otherObj.getValue()).toBe(x) }`,
    `async function t() { expect(await response.json()).toEqual({}) }`,
    // Non-await — not flagged (rule only catches `expect(await ...)`)
    `expect(resultsPage).toBeTruthy()`,
    // Member access on non-POM
    `async function t() { expect(await config.get()).toBe('foo') }`,
  ],
  invalid: [
    // The exact pattern from action-buttons.spec.ts:250
    {
      code: `async function t() { expect(await resultsPage.getContent()).toEqual(initialContent) }`,
      errors: [{ messageId: 'pointInTimePom' }],
    },
    // adminContentPage variant
    {
      code: `async function t() { expect(await adminContentPage.getRowCount()).toBe(5) }`,
      errors: [{ messageId: 'pointInTimePom' }],
    },
    // searchPage variant
    {
      code: `async function t() { expect(await searchPage.getResultCount()).toBeGreaterThan(0) }`,
      errors: [{ messageId: 'pointInTimePom' }],
    },
    // loginPage variant
    {
      code: `async function t() { expect(await loginPage.getErrorMessage()).toContain('invalid') }`,
      errors: [{ messageId: 'pointInTimePom' }],
    },
    // Method other than get* still flagged (POM convention is the discriminator)
    {
      code: `async function t() { expect(await resultsPage.fetchTitle()).toEqual('Test') }`,
      errors: [{ messageId: 'pointInTimePom' }],
    },
  ],
});

console.log('no-point-in-time-pom-helpers: all tests passed');
