/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ESLint plugin for test flakiness prevention rules.
 *
 * Rules:
 * - no-wait-for-timeout: Disallow waitForTimeout in tests
 * - max-test-timeout: Warn on test timeouts exceeding 60 seconds
 * - no-test-skip: Disallow test.skip - use test-data-factory instead
 * - no-silent-catch: Disallow .catch(() => {}) - use safe helpers instead
 * - no-networkidle: Disallow waitForLoadState('networkidle') - use specific waits
 * - no-hardcoded-tmpdir: Disallow hardcoded /tmp/ paths - use os.tmpdir() with worker subdirs
 * - no-point-in-time-checks: Prefer auto-waiting assertions over point-in-time DOM checks
 * - no-hardcoded-base-url: Disallow hardcoded localhost URLs - use Playwright baseURL
 * - require-hydration-wait: Require waitFor between navigation and click in POMs
 *
 * See docs/docs_overall/testing_rules.md for acceptable exceptions.
 */
module.exports = {
  rules: {
    'no-wait-for-timeout': require('./no-wait-for-timeout'),
    'max-test-timeout': require('./max-test-timeout'),
    'no-test-skip': require('./no-test-skip'),
    'no-silent-catch': require('./no-silent-catch'),
    'no-networkidle': require('./no-networkidle'),
    'no-hardcoded-tmpdir': require('./no-hardcoded-tmpdir'),
    'no-hardcoded-base-url': require('./no-hardcoded-base-url'),
    'require-hydration-wait': require('./require-hydration-wait'),
    'require-test-cleanup': require('./require-test-cleanup'),
    'no-duplicate-column-labels': require('./no-duplicate-column-labels'),
    'no-point-in-time-checks': require('./no-point-in-time-checks'),
  },
};
