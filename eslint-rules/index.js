/**
 * ESLint plugin for test flakiness prevention rules.
 *
 * Rules:
 * - no-wait-for-timeout: Disallow waitForTimeout in tests
 * - max-test-timeout: Warn on test timeouts exceeding 60 seconds
 */
module.exports = {
  rules: {
    'no-wait-for-timeout': require('./no-wait-for-timeout'),
    'max-test-timeout': require('./max-test-timeout'),
  },
};
