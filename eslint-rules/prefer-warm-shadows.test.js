/**
 * Tests for the prefer-warm-shadows ESLint rule.
 *
 * Run with: node eslint-rules/prefer-warm-shadows.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./prefer-warm-shadows');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('prefer-warm-shadows', rule, {
  valid: [
    // Warm shadow variants - should pass
    `<div className="shadow-warm-sm" />`,
    `<div className="shadow-warm-md" />`,
    `<div className="shadow-warm-lg" />`,
    `<div className="shadow-warm-xl" />`,
    `<div className="shadow-warm-2xl" />`,

    // Non-sized shadows - should pass (not enforced)
    `<div className="shadow" />`,
    `<div className="shadow-none" />`,

    // Custom shadows - should pass
    `<div className="shadow-gold-glow" />`,
    `<div className="shadow-page" />`,

    // Hover states with warm shadow
    `<div className="hover:shadow-warm-md" />`,
  ],
  invalid: [
    // Generic shadow-sm
    {
      code: `<div className="shadow-sm" />`,
      errors: [{ messageId: 'preferWarmShadow', data: { size: 'sm' } }],
    },
    // Generic shadow-md
    {
      code: `<div className="shadow-md" />`,
      errors: [{ messageId: 'preferWarmShadow', data: { size: 'md' } }],
    },
    // Generic shadow-lg
    {
      code: `<div className="shadow-lg" />`,
      errors: [{ messageId: 'preferWarmShadow', data: { size: 'lg' } }],
    },
    // Generic shadow-xl
    {
      code: `<div className="shadow-xl" />`,
      errors: [{ messageId: 'preferWarmShadow', data: { size: 'xl' } }],
    },
    // Generic shadow-2xl
    {
      code: `<div className="shadow-2xl" />`,
      errors: [{ messageId: 'preferWarmShadow', data: { size: '2xl' } }],
    },
    // Multiple shadows (tests lastIndex bug fix)
    {
      code: `<div className="shadow-sm shadow-lg" />`,
      errors: [
        { messageId: 'preferWarmShadow', data: { size: 'sm' } },
        { messageId: 'preferWarmShadow', data: { size: 'lg' } },
      ],
    },
    // Shadow with other classes
    {
      code: `<div className="bg-white shadow-xl p-4 rounded-lg" />`,
      errors: [{ messageId: 'preferWarmShadow', data: { size: 'xl' } }],
    },
  ],
});

console.log('✓ prefer-warm-shadows tests passed');
