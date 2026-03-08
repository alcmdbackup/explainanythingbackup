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
      noFixedSleep:
        'Avoid fixed sleeps with setTimeout in tests. Use explicit waits (waitForSelector, expect.toPass, etc.) instead.',
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

      AwaitExpression(node) {
        // Check for: await new Promise(resolve => setTimeout(resolve, N))
        const arg = node.argument;
        if (arg?.type !== 'NewExpression') return;
        if (arg.callee?.type !== 'Identifier' || arg.callee.name !== 'Promise') return;
        if (arg.arguments.length !== 1) return;

        const callback = arg.arguments[0];
        // Accept arrow functions and regular functions with exactly one parameter
        if (
          callback.type !== 'ArrowFunctionExpression' &&
          callback.type !== 'FunctionExpression'
        ) return;
        if (callback.params.length !== 1) return;

        const paramName =
          callback.params[0].type === 'Identifier' ? callback.params[0].name : null;
        if (!paramName) return;

        // Get the body — either an expression or a block with a single statement
        let bodyExpr = null;
        if (callback.body.type === 'CallExpression') {
          // Arrow with expression body: resolve => setTimeout(resolve, N)
          bodyExpr = callback.body;
        } else if (callback.body.type === 'BlockStatement') {
          const stmts = callback.body.body;
          if (stmts.length === 1 && stmts[0].type === 'ExpressionStatement') {
            bodyExpr = stmts[0].expression;
          }
        }
        if (!bodyExpr || bodyExpr.type !== 'CallExpression') return;

        // Check that the call is setTimeout(paramName, ...)
        const callee = bodyExpr.callee;
        if (callee.type !== 'Identifier' || callee.name !== 'setTimeout') return;
        if (bodyExpr.arguments.length < 2) return;
        const firstArg = bodyExpr.arguments[0];
        if (firstArg.type !== 'Identifier' || firstArg.name !== paramName) return;

        context.report({
          node,
          messageId: 'noFixedSleep',
        });
      },
    };
  },
};
