/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ESLint plugin for test flakiness prevention rules.
 *
 * Rules:
 * - no-wait-for-timeout: Disallow waitForTimeout in tests
 * - max-test-timeout: Warn on test timeouts exceeding 60 seconds
 * - no-test-skip: Disallow test.skip - use test-data-factory instead
 * - no-silent-catch: Disallow .catch(() => {}) - use safe helpers instead
 *
 * See docs/docs_overall/testing_rules.md for acceptable exceptions.
 */
module.exports = {
  rules: {
    'no-wait-for-timeout': require('./no-wait-for-timeout'),
    'max-test-timeout': require('./max-test-timeout'),
    'no-test-skip': require('./no-test-skip'),
    'no-silent-catch': require('./no-silent-catch'),
  },
};
