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
 * - no-point-in-time-pom-helpers: Disallow expect(await pomHelper()) — use expect.poll() instead
 * - no-hardcoded-base-url: Disallow hardcoded localhost URLs - use Playwright baseURL
 * - no-nth-child-cell-selector: Disallow td:nth-child(N) and tr:nth-child(N) in E2E specs
 * - no-duplicate-describe-name: Disallow same-name nested describe blocks
 * - require-hydration-wait: Require waitFor between navigation and click in POMs
 * - require-reset-filters: Require resetFilters() in admin specs that seed [TEST]-prefixed data
 * - require-serial-with-beforeall: Require serial mode for describe blocks with beforeAll
 * - warn-slow-with-retries: Warn when test.slow() + retries >= 2 causes timeout cascade
 *
 * See docs/docs_overall/testing_overview.md for acceptable exceptions.
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
    'no-nth-child-cell-selector': require('./no-nth-child-cell-selector'),
    'no-duplicate-describe-name': require('./no-duplicate-describe-name'),
    'require-hydration-wait': require('./require-hydration-wait'),
    'require-reset-filters': require('./require-reset-filters'),
    'require-test-cleanup': require('./require-test-cleanup'),
    'no-duplicate-column-labels': require('./no-duplicate-column-labels'),
    'no-point-in-time-checks': require('./no-point-in-time-checks'),
    'no-point-in-time-pom-helpers': require('./no-point-in-time-pom-helpers'),
    'require-serial-with-beforeall': require('./require-serial-with-beforeall'),
    'warn-slow-with-retries': require('./warn-slow-with-retries'),
  },
};
