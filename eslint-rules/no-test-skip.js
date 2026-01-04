/**
 * ESLint rule to disallow test.skip in E2E tests.
 *
 * Tests should never be skipped due to missing data - use test-data-factory.ts
 * to create required test data in beforeAll instead.
 *
 * See docs/docs_overall/testing_rules.md for acceptable exceptions (Rule 8).
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow test.skip - use test-data-factory.ts to create required data',
      category: 'Best Practices',
    },
    messages: {
      noTestSkip:
        'Avoid test.skip() - use test-data-factory.ts to create required data. ' +
        'See docs/docs_overall/testing_rules.md Rule 8 for acceptable exceptions.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        // Check for test.skip(...) calls
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'test' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'skip'
        ) {
          context.report({
            node,
            messageId: 'noTestSkip',
          });
        }

        // Also check for test.skip used as a function argument (inline skip)
        // e.g., test.skip(condition, 'reason') inside a test body
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'skip'
        ) {
          // Check if the object is 'test' (could be from a variable)
          const obj = node.callee.object;
          if (obj.type === 'Identifier' && obj.name === 'test') {
            context.report({
              node,
              messageId: 'noTestSkip',
            });
          }
        }
      },
    };
  },
};
