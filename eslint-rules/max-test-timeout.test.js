/**
 * Tests for the max-test-timeout ESLint rule.
 *
 * Run with: node eslint-rules/max-test-timeout.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./max-test-timeout');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

ruleTester.run('max-test-timeout', rule, {
  valid: [
    // Timeout under 60s is fine
    `test.setTimeout(30000)`,
    // Exactly 60s is fine (not exceeding)
    `test.setTimeout(60000)`,
    // Small timeout
    `test.setTimeout(5000)`,
    // Non-test setTimeout is not checked
    `setTimeout(() => {}, 120000)`,
  ],
  invalid: [
    // Timeout over 60s
    {
      code: `test.setTimeout(90000)`,
      errors: [{ messageId: 'maxTestTimeout', data: { value: 90000 } }],
    },
    // Very large timeout
    {
      code: `test.setTimeout(120000)`,
      errors: [{ messageId: 'maxTestTimeout', data: { value: 120000 } }],
    },
    // Just over the limit
    {
      code: `test.setTimeout(60001)`,
      errors: [{ messageId: 'maxTestTimeout', data: { value: 60001 } }],
    },
  ],
});

// Also test with custom maxTimeout option
const customRuleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

customRuleTester.run('max-test-timeout (custom limit)', rule, {
  valid: [
    // Under custom 30s limit
    {
      code: `test.setTimeout(25000)`,
      options: [{ maxTimeout: 30000 }],
    },
  ],
  invalid: [
    // Over custom 30s limit
    {
      code: `test.setTimeout(45000)`,
      options: [{ maxTimeout: 30000 }],
      errors: [{ messageId: 'maxTestTimeout', data: { value: 45000 } }],
    },
  ],
});

console.log('✓ max-test-timeout tests passed');
