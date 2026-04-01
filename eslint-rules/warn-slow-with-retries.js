/**
 * ESLint rule warning about test.slow() combined with high retry counts.
 *
 * test.slow() triples the timeout. Combined with retries >= 2, a single
 * failing test can block CI for minutes (e.g., 60s * 3 * 3 = 540s).
 * This rule flags the combination as a code smell.
 *
 * See docs/docs_overall/testing_overview.md for timeout guidelines.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Warn when test.slow() is combined with retries >= 2',
      category: 'Best Practices',
    },
    messages: {
      slowWithRetries:
        'test.slow() combined with retries >= {{ retries }} can cause timeouts up to {{ maxSeconds }}s per test. Consider reducing retries or fixing the underlying speed issue.',
    },
    schema: [],
  },
  create(context) {
    const BASE_TIMEOUT_CI = 60; // seconds (from playwright.config.ts CI timeout)
    const describeStack = [];

    function isDescribeCall(node) {
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'describe'
      ) {
        const obj = node.callee.object;
        if (obj.type === 'Identifier' && (obj.name === 'test' || obj.name === 'adminTest')) {
          return true;
        }
      }
      return false;
    }

    function getRetryCount(node) {
      // Match: *.describe.configure({ retries: N })
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'configure'
      ) {
        for (const arg of node.arguments) {
          if (arg.type === 'ObjectExpression') {
            for (const prop of arg.properties) {
              if (
                prop.type === 'Property' &&
                prop.key.type === 'Identifier' &&
                prop.key.name === 'retries' &&
                prop.value.type === 'Literal' &&
                typeof prop.value.value === 'number'
              ) {
                return prop.value.value;
              }
            }
          }
        }
      }
      return null;
    }

    function isTestSlow(node) {
      // Match: test.slow()
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'slow'
      ) {
        const obj = node.callee.object;
        if (obj.type === 'Identifier' && (obj.name === 'test' || obj.name === 'adminTest')) {
          return true;
        }
      }
      return false;
    }

    return {
      CallExpression(node) {
        if (isDescribeCall(node)) {
          describeStack.push({ retries: null, slowNodes: [] });
          return;
        }

        if (describeStack.length === 0) return;

        const retryCount = getRetryCount(node);
        if (retryCount !== null) {
          describeStack[describeStack.length - 1].retries = retryCount;
          return;
        }

        if (isTestSlow(node)) {
          describeStack[describeStack.length - 1].slowNodes.push(node);
        }
      },

      'CallExpression:exit'(node) {
        if (isDescribeCall(node) && describeStack.length > 0) {
          const scope = describeStack.pop();
          // Also check parent scopes for retries
          const effectiveRetries = scope.retries ??
            (describeStack.length > 0 ? describeStack[describeStack.length - 1].retries : null);

          if (effectiveRetries !== null && effectiveRetries >= 2 && scope.slowNodes.length > 0) {
            const maxSeconds = BASE_TIMEOUT_CI * 3 * (effectiveRetries + 1);
            for (const slowNode of scope.slowNodes) {
              context.report({
                node: slowNode,
                messageId: 'slowWithRetries',
                data: {
                  retries: String(effectiveRetries),
                  maxSeconds: String(maxSeconds),
                },
              });
            }
          }
        }
      },
    };
  },
};
