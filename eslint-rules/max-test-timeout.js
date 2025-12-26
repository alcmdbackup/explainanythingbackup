/**
 * ESLint rule to warn on test timeouts exceeding 60 seconds.
 *
 * Tests with long timeouts often indicate:
 * - Missing explicit waits that could fail faster
 * - Tests that are too slow and should be optimized
 * - Network-dependent tests that need better mocking
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Warn on test timeouts exceeding 60 seconds',
      category: 'Best Practices',
    },
    messages: {
      maxTestTimeout:
        'Test timeout {{ value }}ms exceeds 60s limit. Consider optimizing the test or documenting why this is necessary.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxTimeout: {
            type: 'number',
            default: 60000,
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    // Rule initialization
    const options = context.options[0] || {};
    const maxTimeout = options.maxTimeout || 60000;

    return {
      CallExpression(node) {
        // Check for test.setTimeout(...) or test.slow() calls
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'test' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'setTimeout'
        ) {
          const timeoutArg = node.arguments[0];
          if (timeoutArg && timeoutArg.type === 'Literal' && typeof timeoutArg.value === 'number') {
            if (timeoutArg.value > maxTimeout) {
              context.report({
                node,
                messageId: 'maxTestTimeout',
                data: { value: timeoutArg.value },
              });
            }
          }
        }
      },
    };
  },
};
