/**
 * Tests for require-serial-with-beforeall ESLint rule.
 */
const { RuleTester } = require('eslint');
const rule = require('./require-serial-with-beforeall');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2020 },
});

ruleTester.run('require-serial-with-beforeall', rule, {
  valid: [
    // describe with beforeAll AND serial mode — correct
    {
      code: `
        test.describe('suite', () => {
          test.describe.configure({ mode: 'serial' });
          test.beforeAll(async () => { /* setup */ });
          test('a', () => {});
        });
      `,
    },
    // adminTest variant
    {
      code: `
        adminTest.describe('suite', () => {
          adminTest.describe.configure({ mode: 'serial' });
          adminTest.beforeAll(async () => { /* setup */ });
          adminTest('a', () => {});
        });
      `,
    },
    // describe WITHOUT beforeAll — no serial needed
    {
      code: `
        test.describe('suite', () => {
          test('a', () => {});
          test('b', () => {});
        });
      `,
    },
    // nested: inner has beforeAll + serial, outer doesn't need it
    {
      code: `
        test.describe('outer', () => {
          test.describe('inner', () => {
            test.describe.configure({ mode: 'serial' });
            test.beforeAll(async () => { /* setup */ });
            test('a', () => {});
          });
        });
      `,
    },
    // serial with additional config (retries) — still valid
    {
      code: `
        test.describe('suite', () => {
          test.describe.configure({ mode: 'serial', retries: 2 });
          test.beforeAll(async () => { /* setup */ });
          test('a', () => {});
        });
      `,
    },
  ],
  invalid: [
    // beforeAll WITHOUT serial mode
    {
      code: `
        test.describe('suite', () => {
          test.beforeAll(async () => { /* setup */ });
          test('a', () => {});
        });
      `,
      errors: [{ messageId: 'missingSerial' }],
    },
    // adminTest variant without serial
    {
      code: `
        adminTest.describe('suite', () => {
          adminTest.beforeAll(async () => { /* setup */ });
          adminTest('a', () => {});
        });
      `,
      errors: [{ messageId: 'missingSerial' }],
    },
    // nested: inner has beforeAll but no serial
    {
      code: `
        test.describe('outer', () => {
          test.describe('inner', () => {
            test.beforeAll(async () => { /* setup */ });
            test('a', () => {});
          });
        });
      `,
      errors: [{ messageId: 'missingSerial' }],
    },
  ],
});

console.log('require-serial-with-beforeall: all tests passed');
