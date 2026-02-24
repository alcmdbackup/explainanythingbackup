/**
 * ESLint rule to disallow waitForLoadState('networkidle') in E2E tests.
 *
 * networkidle waits for "no network requests for 500ms" which is unreliable
 * in CI — background polling, analytics, or SSE connections prevent settling.
 * Use specific waits instead (waitForSelector, locator.waitFor, waitForResponse).
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow waitForLoadState(\'networkidle\') - use specific element/response waits instead',
      category: 'Best Practices',
    },
    messages: {
      noNetworkIdle:
        'Avoid waitForLoadState(\'networkidle\') - use waitForSelector, locator.waitFor(), or waitForResponse instead. See testing_overview.md Rule 9.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // Check for *.waitForLoadState('networkidle') calls
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'waitForLoadState' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal' &&
          node.arguments[0].value === 'networkidle'
        ) {
          context.report({
            node,
            messageId: 'noNetworkIdle',
          });
        }
      },
    };
  },
};
