/**
 * Tests for the no-nth-child-cell-selector ESLint rule.
 *
 * Run with: node eslint-rules/no-nth-child-cell-selector.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-nth-child-cell-selector');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('no-nth-child-cell-selector', rule, {
  valid: [
    // Stable selectors are fine
    `page.getByRole('cell', { name: 'Status' })`,
    `page.locator('[data-testid="status-cell"]')`,
    `page.getByRole('columnheader', { name: 'Status' })`,
    // nth-child on non-table elements not flagged
    `page.locator('li:nth-child(3)')`,
    `page.locator('div:nth-child(2)')`,
    // Bare strings without selector context are not flagged unless they contain td/tr nth-child
    `const x = 'normal string'`,
    `const y = \`template \${x}\``,
    // nth-of-type is allowed (semantically different — counts only siblings of same type)
    `page.locator('td:nth-of-type(3)')`,
  ],
  invalid: [
    // Direct td:nth-child
    {
      code: `page.locator('td:nth-child(5)')`,
      errors: [{ messageId: 'noNthChildCell' }],
    },
    // tr:nth-child
    {
      code: `page.locator('tbody tr:nth-child(2)')`,
      errors: [{ messageId: 'noNthChildCell' }],
    },
    // Both in the same selector (rule fires once per literal — first match)
    {
      code: `table.locator('tbody tr:nth-child(2) td:nth-child(4)')`,
      errors: [{ messageId: 'noNthChildCell' }],
    },
    // Inside a template literal chunk
    {
      code: `table.locator(\`tbody td:nth-child(4) span\`)`,
      errors: [{ messageId: 'noNthChildCell' }],
    },
    // Inside getByText / similar (the rule scans all string literals, not just locator())
    {
      code: `page.locator('table td:nth-child(5) span')`,
      errors: [{ messageId: 'noNthChildCell' }],
    },
  ],
});

console.log('no-nth-child-cell-selector: all tests passed');
