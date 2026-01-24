/**
 * Tests for the enforce-prose-font ESLint rule.
 *
 * Run with: node eslint-rules/enforce-prose-font.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./enforce-prose-font');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('enforce-prose-font', rule, {
  valid: [
    // Correct font-body usage
    `<p className="font-body">Body text</p>`,
    `<span className="font-body">Inline text</span>`,
    `<li className="font-body">List item</li>`,

    // font-ui also acceptable for prose
    `<p className="font-ui text-sm">UI text</p>`,

    // No font specified is fine (inherits)
    `<p className="text-sm">Text</p>`,

    // Large display text can use font-display (intentional)
    `<p className="font-display text-2xl">Large display text</p>`,
    `<span className="font-display text-3xl">Hero text</span>`,
    `<p className="font-display text-4xl">Extra large</p>`,

    // Non-prose elements - not checked
    `<div className="font-display">Container</div>`,
    `<h1 className="font-display">Heading</h1>`,
  ],
  invalid: [
    // p with font-display (wrong font for prose)
    {
      code: `<p className="font-display">Body text</p>`,
      errors: [{ messageId: 'useBodyFont', data: { element: 'p' } }],
    },
    // span with font-display
    {
      code: `<span className="font-display text-sm">Inline text</span>`,
      errors: [{ messageId: 'useBodyFont', data: { element: 'span' } }],
    },
    // li with font-display
    {
      code: `<li className="font-display">List item</li>`,
      errors: [{ messageId: 'useBodyFont', data: { element: 'li' } }],
    },
    // Inline fontFamily
    {
      code: `<p style={{ fontFamily: 'Arial' }}>Text</p>`,
      errors: [{ messageId: 'noInlineFontFamily', data: { element: 'p' } }],
    },
    // font-display with small text (not intentional display usage)
    {
      code: `<p className="font-display text-lg">Text</p>`,
      errors: [{ messageId: 'useBodyFont', data: { element: 'p' } }],
    },
  ],
});

console.log('✓ enforce-prose-font tests passed');
