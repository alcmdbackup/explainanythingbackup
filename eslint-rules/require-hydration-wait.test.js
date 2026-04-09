/**
 * Tests for require-hydration-wait ESLint rule.
 */
const { RuleTester } = require('eslint');
const rule = require('./require-hydration-wait');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// The rule only activates for files in helpers/pages/
// We simulate this by setting the filename
ruleTester.run('require-hydration-wait', rule, {
  valid: [
    // Has waitFor between goto and click
    {
      code: `class Page {
        async navigate() {
          await this.goto();
          await this.table.waitFor({ state: 'visible' });
          await this.button.click();
        }
      }`,
      filename: '/project/src/__tests__/e2e/helpers/pages/MyPage.ts',
    },
    // No navigation — click alone is fine
    {
      code: `class Page {
        async clickButton() {
          await this.button.click();
        }
      }`,
      filename: '/project/src/__tests__/e2e/helpers/pages/MyPage.ts',
    },
    // Not a POM file — rule doesn't apply
    {
      code: `class Spec {
        async test() {
          await page.goto('/admin');
          await button.click();
        }
      }`,
      filename: '/project/src/__tests__/e2e/specs/my.spec.ts',
    },
  ],
  invalid: [
    // goto then click without waitFor
    {
      code: `class Page {
        async navigate() {
          await this.goto();
          await this.goToContent();
          await this.navLink.click();
        }
      }`,
      filename: '/project/src/__tests__/e2e/helpers/pages/AdminPage.ts',
      errors: [{ messageId: 'requireHydrationWait' }],
    },
  ],
});

console.log('require-hydration-wait: all tests passed');
