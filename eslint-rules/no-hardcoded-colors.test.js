/**
 * Tests for the no-hardcoded-colors ESLint rule.
 *
 * Run with: node eslint-rules/no-hardcoded-colors.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-hardcoded-colors');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-hardcoded-colors', rule, {
  valid: [
    // CSS variables - should pass
    `<div style={{ color: 'var(--text-primary)' }} />`,
    `<div style={{ backgroundColor: 'var(--bg-surface)' }} />`,
    `<div style={{ borderColor: 'rgba(var(--accent-gold-rgb), 0.5)' }} />`,

    // CSS keywords - should pass
    `<div style={{ color: 'transparent' }} />`,
    `<div style={{ color: 'inherit' }} />`,
    `<div style={{ color: 'currentColor' }} />`,
    `<div style={{ color: 'initial' }} />`,

    // Non-style props - should pass
    `<div data-color="#fff" />`,
    `<input placeholder="#ffffff" />`,

    // Template literals with CSS vars - should pass
    { code: '<div style={{ color: `var(--text-primary)` }} />' },

    // Object outside JSX style prop - no false positives
    `const config = { theme: '#fff' };`, // non-style context
  ],
  invalid: [
    // Hex colors - 3 digit
    {
      code: `<div style={{ color: '#fff' }} />`,
      errors: [{ messageId: 'noHardcodedHex' }],
    },
    // Hex colors - 6 digit
    {
      code: `<div style={{ color: '#ffffff' }} />`,
      errors: [{ messageId: 'noHardcodedHex' }],
    },
    // Hex colors - 8 digit (with alpha)
    {
      code: `<div style={{ color: '#ffffff80' }} />`,
      errors: [{ messageId: 'noHardcodedHex' }],
    },
    // Hex in background
    {
      code: `<div style={{ backgroundColor: '#0d1628' }} />`,
      errors: [{ messageId: 'noHardcodedHex' }],
    },
    // RGBA with hardcoded values
    {
      code: `<div style={{ backgroundColor: 'rgba(255,255,255,0.5)' }} />`,
      errors: [{ messageId: 'noHardcodedRgba' }],
    },
    // RGBA with spaces
    {
      code: `<div style={{ backgroundColor: 'rgba( 255, 255, 255, 0.5 )' }} />`,
      errors: [{ messageId: 'noHardcodedRgba' }],
    },
    // RGB (no alpha)
    {
      code: `<div style={{ color: 'rgb(255, 255, 255)' }} />`,
      errors: [{ messageId: 'noHardcodedRgba' }],
    },
    // Template literal with hardcoded color
    {
      code: '<div style={{ color: `#ffffff` }} />',
      errors: [{ messageId: 'noHardcodedHex' }],
    },
    // Multiple violations in one style object
    {
      code: `<div style={{ color: '#fff', backgroundColor: '#000' }} />`,
      errors: [{ messageId: 'noHardcodedHex' }, { messageId: 'noHardcodedHex' }],
    },
  ],
});

console.log('✓ no-hardcoded-colors tests passed');
