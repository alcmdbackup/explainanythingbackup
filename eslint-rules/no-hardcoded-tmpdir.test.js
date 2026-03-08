/**
 * Tests for the no-hardcoded-tmpdir ESLint rule.
 *
 * Run with: node eslint-rules/no-hardcoded-tmpdir.test.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const { RuleTester } = require('eslint');
const rule = require('./no-hardcoded-tmpdir');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
});

ruleTester.run('no-hardcoded-tmpdir', rule, {
  valid: [
    // os.tmpdir() usage
    'const dir = os.tmpdir()',
    // Template literal with workerIndex
    'const dir = `/tmp/test-${workerIndex}`',
    // String containing "worker"
    "const dir = '/tmp/worker-1/output'",
    // Template with process.env.TEST_PARALLEL_INDEX
    'const dir = `/tmp/run-${process.env.TEST_PARALLEL_INDEX}`',
    // String with WORKER
    "const dir = '/tmp/WORKER-0/data'",
    // No /tmp/ at all
    "const dir = '/var/data/output.json'",
  ],
  invalid: [
    {
      code: "const f = '/tmp/test-output.json'",
      errors: [{ messageId: 'noHardcodedTmpdir' }],
    },
    {
      code: 'const f = "/tmp/results"',
      errors: [{ messageId: 'noHardcodedTmpdir' }],
    },
    {
      code: 'const f = `/tmp/data`',
      errors: [{ messageId: 'noHardcodedTmpdir' }],
    },
    {
      code: 'const f = `/tmp/output-${Date.now()}`',
      errors: [{ messageId: 'noHardcodedTmpdir' }],
    },
  ],
});

console.log('✓ no-hardcoded-tmpdir tests passed');
