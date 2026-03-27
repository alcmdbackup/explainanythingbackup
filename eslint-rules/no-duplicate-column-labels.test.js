/**
 * Tests for the no-duplicate-column-labels ESLint rule.
 *
 * Run with: node eslint-rules/no-duplicate-column-labels.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-duplicate-column-labels');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

ruleTester.run('no-duplicate-column-labels', rule, {
  valid: [
    // Unique column headers
    `const columns = [
      { header: "Name", accessor: "name" },
      { header: "Cost", accessor: "cost" },
      { header: "Status", accessor: "status" },
    ]`,
    // Unique labels
    `const cols = [
      { label: "Name" },
      { label: "Cost" },
    ]`,
    // Dynamic headers (not flagged)
    `const columns = [
      { header: getHeader("a") },
      { header: getHeader("a") },
    ]`,
    // Template literals (not static string literals, not flagged)
    'const columns = [\n  { header: `Cost ${a}` },\n  { header: `Cost ${b}` },\n]',
    // Single element array
    `const columns = [{ header: "Name" }]`,
    // Empty array
    `const columns = []`,
    // Mixed: no duplicates across header/label independently
    `const columns = [
      { header: "Name", label: "Col A" },
      { header: "Cost", label: "Col B" },
    ]`,
  ],
  invalid: [
    // Duplicate "Cost" headers
    {
      code: `const columns = [
        { header: "Name", accessor: "name" },
        { header: "Cost", accessor: "cost1" },
        { header: "Cost", accessor: "cost2" },
      ]`,
      errors: [
        {
          messageId: 'duplicateColumnLabel',
          data: { property: 'header', value: 'Cost' },
        },
      ],
    },
    // Duplicate labels
    {
      code: `const cols = [
        { label: "Status" },
        { label: "Status" },
      ]`,
      errors: [
        {
          messageId: 'duplicateColumnLabel',
          data: { property: 'label', value: 'Status' },
        },
      ],
    },
    // Triple duplicate reports two errors
    {
      code: `const columns = [
        { header: "X" },
        { header: "X" },
        { header: "X" },
      ]`,
      errors: [
        {
          messageId: 'duplicateColumnLabel',
          data: { property: 'header', value: 'X' },
        },
        {
          messageId: 'duplicateColumnLabel',
          data: { property: 'header', value: 'X' },
        },
      ],
    },
  ],
});

console.log('✓ no-duplicate-column-labels tests passed');
