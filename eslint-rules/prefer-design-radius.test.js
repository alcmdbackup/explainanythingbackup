/**
 * Tests for the prefer-design-radius ESLint rule.
 *
 * Run with: node eslint-rules/prefer-design-radius.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./prefer-design-radius');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('prefer-design-radius', rule, {
  valid: [
    // Design system radius - should pass
    `<div className="rounded-page" />`,
    `<div className="rounded-book" />`,

    // Other radius values - should pass
    `<div className="rounded" />`,
    `<div className="rounded-full" />`,
    `<div className="rounded-sm" />`,
    `<div className="rounded-xl" />`,
    `<div className="rounded-none" />`,

    // Responsive variants with design tokens
    `<div className="sm:rounded-book md:rounded-book" />`,
  ],
  invalid: [
    // rounded-md should be rounded-page
    {
      code: `<div className="rounded-md" />`,
      errors: [{ messageId: 'preferPageRadius' }],
    },
    // rounded-lg should be rounded-book
    {
      code: `<div className="rounded-lg" />`,
      errors: [{ messageId: 'preferBookRadius' }],
    },
    // Multiple radius issues
    {
      code: `<div className="rounded-md rounded-lg" />`,
      errors: [{ messageId: 'preferPageRadius' }, { messageId: 'preferBookRadius' }],
    },
    // Mixed with other classes
    {
      code: `<div className="p-4 rounded-lg border" />`,
      errors: [{ messageId: 'preferBookRadius' }],
    },
    // Responsive variant
    {
      code: `<div className="sm:rounded-lg" />`,
      errors: [{ messageId: 'preferBookRadius' }],
    },
  ],
});

console.log('✓ prefer-design-radius tests passed');
