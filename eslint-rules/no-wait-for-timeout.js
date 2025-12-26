/**
 * ESLint rule to disallow waitForTimeout in E2E tests.
 *
 * waitForTimeout causes test flakiness because it uses arbitrary delays
 * instead of waiting for actual conditions. Use explicit waits instead:
 * - page.waitForSelector('[data-testid="..."]')
 * - locator.waitFor({ state: 'visible' | 'hidden' })
 * - waitForSuggestionsSuccess/Error helpers
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow waitForTimeout in tests - use explicit element waits instead',
      category: 'Best Practices',
    },
    messages: {
      noWaitForTimeout:
        'Avoid waitForTimeout({{ timeout }}) - use explicit waits like waitForSelector or locator.waitFor({ state: "visible" | "hidden" }) instead',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // Check for *.waitForTimeout(...) calls
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'waitForTimeout'
        ) {
          // Get the timeout value for the message
          const timeoutArg = node.arguments[0];
          const timeout = timeoutArg?.value || timeoutArg?.raw || 'unknown';

          context.report({
            node,
            messageId: 'noWaitForTimeout',
            data: { timeout },
          });
        }
      },
    };
  },
};
