/**
 * Tests for the no-silent-catch ESLint rule.
 *
 * Run with: node eslint-rules/no-silent-catch.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-silent-catch');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

ruleTester.run('no-silent-catch', rule, {
  valid: [
    // Catch with logging is fine
    `promise.catch((e) => { console.error(e); })`,
    // Catch with rethrow is fine
    `promise.catch((e) => { throw e; })`,
    // Catch returning a meaningful value is fine
    `promise.catch(() => defaultValue)`,
    // Catch with multiple statements is fine
    `promise.catch((e) => { log(e); return fallback; })`,
  ],
  invalid: [
    // Empty arrow function body
    {
      code: `promise.catch(() => {})`,
      errors: [{ messageId: 'noSilentCatch', data: { returnValue: '{}' } }],
    },
    // Arrow returning false
    {
      code: `promise.catch(() => false)`,
      errors: [{ messageId: 'noSilentCatch', data: { returnValue: 'false' } }],
    },
    // Arrow returning null
    {
      code: `promise.catch(() => null)`,
      errors: [{ messageId: 'noSilentCatch', data: { returnValue: 'null' } }],
    },
    // Arrow returning undefined
    {
      code: `promise.catch(() => undefined)`,
      errors: [{ messageId: 'noSilentCatch', data: { returnValue: 'undefined' } }],
    },
    // Empty function expression
    {
      code: `promise.catch(function() {})`,
      errors: [{ messageId: 'noSilentCatch', data: { returnValue: '{}' } }],
    },
  ],
});

console.log('✓ no-silent-catch tests passed');
