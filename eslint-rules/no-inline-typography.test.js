/**
 * Tests for the no-inline-typography ESLint rule.
 *
 * Run with: node eslint-rules/no-inline-typography.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-inline-typography');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-inline-typography', rule, {
  valid: [
    // Tailwind classes - should pass
    `<div className="text-lg font-display">Text</div>`,
    `<p className="text-sm font-body">Paragraph</p>`,

    // Other inline styles - should pass
    `<div style={{ color: 'red' }}>Text</div>`,
    `<div style={{ margin: '10px' }}>Text</div>`,
    `<div style={{ padding: 16 }}>Text</div>`,

    // No style prop - should pass
    `<div className="text-lg">Text</div>`,

    // Empty style object - should pass
    `<div style={{}} />`,
  ],
  invalid: [
    // fontSize with px value
    {
      code: `<div style={{ fontSize: '14px' }}>Text</div>`,
      errors: [{ messageId: 'noInlineFontSize', data: { value: '14px' } }],
    },
    // fontSize with rem value
    {
      code: `<div style={{ fontSize: '1.2rem' }}>Text</div>`,
      errors: [{ messageId: 'noInlineFontSize', data: { value: '1.2rem' } }],
    },
    // fontSize with number value
    {
      code: `<div style={{ fontSize: 16 }}>Text</div>`,
      errors: [{ messageId: 'noInlineFontSize', data: { value: '16' } }],
    },
    // fontFamily with string value
    {
      code: `<div style={{ fontFamily: 'Arial' }}>Text</div>`,
      errors: [{ messageId: 'noInlineFontFamily', data: { value: 'Arial' } }],
    },
    // fontFamily with font stack
    {
      code: `<div style={{ fontFamily: 'Georgia, serif' }}>Text</div>`,
      errors: [{ messageId: 'noInlineFontFamily', data: { value: 'Georgia, serif' } }],
    },
    // Both fontSize and fontFamily
    {
      code: `<div style={{ fontSize: '14px', fontFamily: 'Arial' }}>Text</div>`,
      errors: [
        { messageId: 'noInlineFontSize', data: { value: '14px' } },
        { messageId: 'noInlineFontFamily', data: { value: 'Arial' } },
      ],
    },
    // On different elements
    {
      code: `<span style={{ fontSize: '12px' }}>Small</span>`,
      errors: [{ messageId: 'noInlineFontSize', data: { value: '12px' } }],
    },
    {
      code: `<h1 style={{ fontSize: '32px' }}>Heading</h1>`,
      errors: [{ messageId: 'noInlineFontSize', data: { value: '32px' } }],
    },
  ],
});

console.log('✓ no-inline-typography tests passed');
