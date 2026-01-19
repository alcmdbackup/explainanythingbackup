/**
 * Tests for the prefer-design-system-fonts ESLint rule.
 *
 * Run with: node eslint-rules/prefer-design-system-fonts.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./prefer-design-system-fonts');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('prefer-design-system-fonts', rule, {
  valid: [
    // Design system font classes - should pass
    `<div className="font-body" />`,
    `<div className="font-display" />`,
    `<div className="font-ui" />`,
    `<div className="font-mono" />`,

    // Non-font classes - should pass
    `<div className="bg-white text-lg" />`,

    // Font in non-className props - should pass
    `<div data-font="font-serif" />`,

    // Empty className - should pass
    `<div className="" />`,
  ],
  invalid: [
    // Generic font-serif
    {
      code: `<div className="font-serif text-lg" />`,
      errors: [{ messageId: 'preferFontBody' }],
    },
    // Generic font-sans
    {
      code: `<div className="font-sans text-sm" />`,
      errors: [{ messageId: 'preferFontUi' }],
    },
    // Both generic fonts in one className
    {
      code: `<div className="font-serif font-sans" />`,
      errors: [{ messageId: 'preferFontBody' }, { messageId: 'preferFontUi' }],
    },
    // Font class with other Tailwind utilities
    {
      code: `<div className="bg-white font-serif text-lg p-4" />`,
      errors: [{ messageId: 'preferFontBody' }],
    },
  ],
});

console.log('✓ prefer-design-system-fonts tests passed');
