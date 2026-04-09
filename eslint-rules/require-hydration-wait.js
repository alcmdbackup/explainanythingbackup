/**
 * ESLint rule to require a waitFor/waitForSelector call before click() in POM navigation methods.
 * Prevents clicking elements that are visible in SSR HTML but not yet hydrated by React.
 *
 * Only applies to files in e2e/helpers/pages/ (Page Object Models).
 * Checks methods that contain both a goto/navigation call AND a click() call,
 * and flags click() if there's no waitFor() between the navigation and the click.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require waitFor() between navigation and click() in POM methods to ensure React hydration',
      category: 'Best Practices',
    },
    messages: {
      requireHydrationWait:
        "Add a waitFor() call before click() to ensure the page is hydrated. Visible !== interactive — SSR elements may not have React handlers attached yet. Pattern: await element.waitFor({ state: 'visible' }); await target.click();",
    },
    schema: [],
  },
  create(context) {
    // Only apply to POM files
    const filename = context.getFilename();
    if (!filename.includes('helpers/pages/')) return {};

    return {
      // Check method definitions in classes
      MethodDefinition(node) {
        if (!node.value || node.value.type !== 'FunctionExpression') return;
        const body = node.value.body;
        if (!body || !body.body) return;

        const statements = body.body;
        let hasNavigation = false;
        let hasWaitAfterNav = false;

        for (const stmt of statements) {
          const src = context.getSourceCode().getText(stmt);

          // Detect navigation: goto(), goTo*(), page.goto()
          if (/\.(goto|goTo\w+)\s*\(/.test(src)) {
            hasNavigation = true;
            hasWaitAfterNav = false; // reset — need a new wait after each nav
          }

          // Detect wait: waitFor(), waitForSelector(), waitForURL()
          if (/\.waitFor\s*\(|\.waitForSelector\s*\(|\.waitForURL\s*\(/.test(src)) {
            if (hasNavigation) {
              hasWaitAfterNav = true;
            }
          }

          // Detect click after navigation without intervening wait
          if (/\.click\s*\(/.test(src) && hasNavigation && !hasWaitAfterNav) {
            // Find the click expression node for precise reporting
            context.report({ node: stmt, messageId: 'requireHydrationWait' });
            break; // only report first occurrence per method
          }
        }
      },
    };
  },
};
