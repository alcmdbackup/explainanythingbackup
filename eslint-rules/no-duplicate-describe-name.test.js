/**
 * Tests for the no-duplicate-describe-name ESLint rule.
 *
 * Run with: node eslint-rules/no-duplicate-describe-name.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-duplicate-describe-name');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('no-duplicate-describe-name', rule, {
  valid: [
    // Different names — fine
    `test.describe('Outer', () => { test.describe('Inner', () => {}) })`,
    // Sibling same name in different scopes is allowed
    `test.describe('A', () => {}); test.describe('A', () => {});`,
    // No nesting
    `test.describe('Foo', () => { test('bar', () => {}) })`,
    // adminTest variants with different names
    `adminTest.describe('Outer', () => { adminTest.describe('Inner', () => {}) })`,
    // test.describe.serial with different names
    `test.describe.serial('Outer', () => { test.describe('Inner', () => {}) })`,
    // Non-describe member expressions ignored
    `test.skip('Foo', () => {})`,
    // Top-level describe with no nesting
    `test.describe('Just one', () => {})`,
  ],
  invalid: [
    // The bug from PR #930: stacked same-name describes
    {
      code: `test.describe('Error Boundary', () => { test.describe('Error Boundary', () => {}) })`,
      errors: [{ messageId: 'duplicateName' }],
    },
    // Same name three deep
    {
      code: `test.describe('A', () => { test.describe('B', () => { test.describe('A', () => {}) }) })`,
      errors: [{ messageId: 'duplicateName' }],
    },
    // adminTest variant
    {
      code: `adminTest.describe('Foo', () => { adminTest.describe('Foo', () => {}) })`,
      errors: [{ messageId: 'duplicateName' }],
    },
    // test.describe.serial variant — outer serial, inner non-serial, same name
    {
      code: `test.describe.serial('X', () => { test.describe('X', () => {}) })`,
      errors: [{ messageId: 'duplicateName' }],
    },
    // test.describe.parallel variant
    {
      code: `test.describe.parallel('Y', () => { test.describe('Y', () => {}) })`,
      errors: [{ messageId: 'duplicateName' }],
    },
    // Mixed test/adminTest with same name (still flagged — same string)
    {
      code: `test.describe('Z', () => { adminTest.describe('Z', () => {}) })`,
      errors: [{ messageId: 'duplicateName' }],
    },
  ],
});

console.log('no-duplicate-describe-name: all tests passed');
