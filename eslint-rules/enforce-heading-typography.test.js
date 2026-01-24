/**
 * Tests for the enforce-heading-typography ESLint rule.
 *
 * Run with: node eslint-rules/enforce-heading-typography.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./enforce-heading-typography');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('enforce-heading-typography', rule, {
  valid: [
    // Correct h1 usage
    `<h1 className="font-display text-4xl">Title</h1>`,
    // Correct h2 usage
    `<h2 className="font-display text-2xl">Subtitle</h2>`,
    // Correct h3 usage
    `<h3 className="font-display text-xl">Section</h3>`,
    // Correct h4 usage
    `<h4 className="font-display text-lg">Subsection</h4>`,
    // Legacy atlas-display also valid
    `<h1 className="atlas-display text-4xl">Title</h1>`,
    // Non-heading elements - not checked
    `<div className="text-sm">Not a heading</div>`,
    `<p className="font-display">Paragraph</p>`,
    // Component headings (uppercase) - not checked
    `<Heading className="text-lg">Component</Heading>`,
  ],
  invalid: [
    // h1 with wrong size
    {
      code: `<h1 className="font-display text-2xl">Title</h1>`,
      errors: [{ messageId: 'wrongHeadingSize', data: { element: 'h1', expected: 'text-4xl', actual: 'text-2xl' } }],
    },
    // h2 with wrong size (common violation)
    {
      code: `<h2 className="font-display text-lg">Subtitle</h2>`,
      errors: [{ messageId: 'wrongHeadingSize', data: { element: 'h2', expected: 'text-2xl', actual: 'text-lg' } }],
    },
    // h3 with wrong size
    {
      code: `<h3 className="font-display text-base">Section</h3>`,
      errors: [{ messageId: 'wrongHeadingSize', data: { element: 'h3', expected: 'text-xl', actual: 'text-base' } }],
    },
    // Missing font-display
    {
      code: `<h1 className="text-4xl">Title</h1>`,
      errors: [{ messageId: 'missingHeadingFont', data: { element: 'h1' } }],
    },
    // No className at all
    {
      code: `<h2>Plain heading</h2>`,
      errors: [{ messageId: 'missingHeadingFont', data: { element: 'h2' } }],
    },
    // Inline fontSize
    {
      code: `<h1 className="font-display" style={{ fontSize: '24px' }}>Title</h1>`,
      errors: [{ messageId: 'noInlineFontSize', data: { element: 'h1' } }],
    },
    // Multiple issues
    {
      code: `<h2 className="text-lg">Title</h2>`,
      errors: [
        { messageId: 'wrongHeadingSize', data: { element: 'h2', expected: 'text-2xl', actual: 'text-lg' } },
        { messageId: 'missingHeadingFont', data: { element: 'h2' } },
      ],
    },
  ],
});

console.log('✓ enforce-heading-typography tests passed');
