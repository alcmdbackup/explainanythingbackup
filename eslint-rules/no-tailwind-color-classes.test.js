/**
 * Tests for the no-tailwind-color-classes ESLint rule.
 *
 * Run with: node eslint-rules/no-tailwind-color-classes.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-tailwind-color-classes');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-tailwind-color-classes', rule, {
  valid: [
    // Design system tokens - should pass
    `<div className="bg-[var(--status-success)]" />`,
    `<div className="text-[var(--text-primary)]" />`,
    `<div className="border-[var(--border-default)]" />`,

    // Semantic colors - should pass
    `<div className="bg-transparent" />`,
    `<div className="bg-current" />`,
    `<div className="bg-inherit" />`,

    // Non-color utilities - should pass
    `<div className="bg-gradient-to-r" />`,
    `<div className="text-center" />`,
    `<div className="border-2" />`,

    // Design system classes - should pass
    `<div className="bg-[var(--surface-primary)]" />`,
    `<div className="text-[var(--accent-gold)]" />`,
  ],
  invalid: [
    // Green palette
    {
      code: `<div className="bg-green-50" />`,
      errors: [{ messageId: 'noTailwindColor', data: { class: 'bg-green-50' } }],
    },
    {
      code: `<div className="text-green-700" />`,
      errors: [{ messageId: 'noTailwindColor', data: { class: 'text-green-700' } }],
    },
    // Red palette
    {
      code: `<div className="bg-red-100" />`,
      errors: [{ messageId: 'noTailwindColor', data: { class: 'bg-red-100' } }],
    },
    {
      code: `<div className="text-red-600" />`,
      errors: [{ messageId: 'noTailwindColor', data: { class: 'text-red-600' } }],
    },
    // Yellow palette
    {
      code: `<div className="bg-yellow-50" />`,
      errors: [{ messageId: 'noTailwindColor', data: { class: 'bg-yellow-50' } }],
    },
    // Gray palette
    {
      code: `<div className="bg-gray-100" />`,
      errors: [{ messageId: 'noTailwindColor', data: { class: 'bg-gray-100' } }],
    },
    // Multiple violations
    {
      code: `<div className="bg-green-50 border-green-200 text-green-800" />`,
      errors: [
        { messageId: 'noTailwindColor', data: { class: 'bg-green-50' } },
        { messageId: 'noTailwindColor', data: { class: 'border-green-200' } },
        { messageId: 'noTailwindColor', data: { class: 'text-green-800' } },
      ],
    },
    // Mixed with valid classes
    {
      code: `<div className="p-4 bg-blue-500 rounded-lg" />`,
      errors: [{ messageId: 'noTailwindColor', data: { class: 'bg-blue-500' } }],
    },
  ],
});

console.log('✓ no-tailwind-color-classes tests passed');
