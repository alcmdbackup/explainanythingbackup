/**
 * Tests for the no-arbitrary-text-sizes ESLint rule.
 *
 * Run with: node eslint-rules/no-arbitrary-text-sizes.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-arbitrary-text-sizes');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-arbitrary-text-sizes', rule, {
  valid: [
    // Standard Tailwind text sizes - should pass
    `<div className="text-xs" />`,
    `<div className="text-sm" />`,
    `<div className="text-base" />`,
    `<div className="text-lg" />`,
    `<div className="text-xl" />`,
    `<div className="text-2xl" />`,
    `<div className="text-3xl" />`,

    // Non-text arbitrary values - should pass
    `<div className="w-[100px]" />`,
    `<div className="h-[50vh]" />`,
    `<div className="p-[10px]" />`,

    // Text color with arbitrary - should pass (not size)
    `<div className="text-[#fff]" />`,
  ],
  invalid: [
    // Arbitrary pixel sizes
    {
      code: `<div className="text-[14px]" />`,
      errors: [{ messageId: 'noArbitraryTextSize' }],
    },
    {
      code: `<div className="text-[16px]" />`,
      errors: [{ messageId: 'noArbitraryTextSize' }],
    },
    // Arbitrary rem sizes
    {
      code: `<div className="text-[0.8rem]" />`,
      errors: [{ messageId: 'noArbitraryTextSize' }],
    },
    {
      code: `<div className="text-[1.5rem]" />`,
      errors: [{ messageId: 'noArbitraryTextSize' }],
    },
    // Arbitrary em sizes
    {
      code: `<div className="text-[1.2em]" />`,
      errors: [{ messageId: 'noArbitraryTextSize' }],
    },
    // Very small sizes (like chart labels)
    {
      code: `<div className="text-[8px]" />`,
      errors: [{ messageId: 'noArbitraryTextSize' }],
    },
    // Multiple arbitrary sizes
    {
      code: `<div className="text-[14px] md:text-[16px]" />`,
      errors: [{ messageId: 'noArbitraryTextSize' }, { messageId: 'noArbitraryTextSize' }],
    },
    // With cn() utility
    {
      code: `<div className={cn("text-[14px]", condition && "text-[16px]")} />`,
      errors: [{ messageId: 'noArbitraryTextSize' }, { messageId: 'noArbitraryTextSize' }],
    },
  ],
});

console.log('✓ no-arbitrary-text-sizes tests passed');
