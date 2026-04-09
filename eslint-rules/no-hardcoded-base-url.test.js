/**
 * Tests for no-hardcoded-base-url ESLint rule.
 */
const { RuleTester } = require('eslint');
const rule = require('./no-hardcoded-base-url');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-hardcoded-base-url', rule, {
  valid: [
    // Relative paths are fine
    { code: `await page.goto('/admin');` },
    { code: `await page.goto('/results?q=test');` },
    // process.env.BASE_URL without fallback is fine
    { code: `const url = process.env.BASE_URL;` },
    // Non-localhost URLs are fine
    { code: `const url = 'https://example.com/api';` },
  ],
  invalid: [
    {
      code: `const baseUrl = process.env.BASE_URL || 'http://localhost:3008';`,
      errors: [{ messageId: 'noHardcodedBaseUrl' }],
    },
    {
      code: 'const url = `http://localhost:3008/admin`;',
      errors: [{ messageId: 'noHardcodedBaseUrl' }],
    },
    {
      code: `await page.goto('http://localhost:3142/results');`,
      errors: [{ messageId: 'noHardcodedBaseUrl' }],
    },
  ],
});

console.log('no-hardcoded-base-url: all tests passed');
