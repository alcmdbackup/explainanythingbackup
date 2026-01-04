/**
 * ESLint rule to disallow silent catch patterns in E2E tests.
 *
 * Patterns like .catch(() => {}) and .catch(() => false) hide real errors
 * and make debugging flaky tests impossible. Use safe helpers instead:
 * - safeWaitFor() for wait operations
 * - safeIsVisible() for visibility checks
 *
 * See docs/docs_overall/testing_rules.md for acceptable exceptions (Rule 7).
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow silent .catch(() => {}) patterns - use safe helpers from error-utils.ts',
      category: 'Best Practices',
    },
    messages: {
      noSilentCatch:
        'Avoid .catch(() => {{ returnValue }}) - use safeIsVisible/safeWaitFor from error-utils.ts. ' +
        'See docs/docs_overall/testing_rules.md Rule 7 for acceptable exceptions.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // Check for .catch(...) calls
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'catch' &&
          node.arguments.length === 1
        ) {
          const arg = node.arguments[0];

          // Check for arrow function: () => {} or () => false or () => null
          if (arg.type === 'ArrowFunctionExpression') {
            const body = arg.body;

            // Check for empty block: () => {}
            if (body.type === 'BlockStatement' && body.body.length === 0) {
              context.report({
                node,
                messageId: 'noSilentCatch',
                data: { returnValue: '{}' },
              });
              return;
            }

            // Check for literal return: () => false, () => null, () => undefined
            if (body.type === 'Literal') {
              const value = body.value;
              if (value === false || value === null) {
                context.report({
                  node,
                  messageId: 'noSilentCatch',
                  data: { returnValue: String(value) },
                });
                return;
              }
            }

            // Check for undefined identifier: () => undefined
            if (body.type === 'Identifier' && body.name === 'undefined') {
              context.report({
                node,
                messageId: 'noSilentCatch',
                data: { returnValue: 'undefined' },
              });
              return;
            }
          }

          // Check for function expression: function() {}
          if (arg.type === 'FunctionExpression') {
            const body = arg.body;
            if (body.type === 'BlockStatement' && body.body.length === 0) {
              context.report({
                node,
                messageId: 'noSilentCatch',
                data: { returnValue: '{}' },
              });
            }
          }
        }
      },
    };
  },
};
