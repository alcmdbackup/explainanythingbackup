/**
 * ESLint rule requiring serial mode for E2E describe blocks that use beforeAll.
 *
 * When a test.describe or adminTest.describe block contains a beforeAll hook
 * that creates shared state, tests must run serially to prevent parallel race
 * conditions on that shared state. This rule enforces
 * test.describe.configure({ mode: 'serial' }) in such blocks.
 *
 * See docs/docs_overall/testing_overview.md Rule 13.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'E2E describe blocks with beforeAll must use mode: serial',
      category: 'Best Practices',
    },
    messages: {
      missingSerial:
        "This describe block has a beforeAll hook but no serial mode configuration. Add {{ callerPrefix }}.describe.configure({ mode: 'serial' }) to prevent parallel test race conditions on shared state. See testing_overview.md Rule 13.",
    },
    schema: [],
  },
  create(context) {
    // Track describe blocks as a stack (for nesting)
    const describeStack = [];

    function isDescribeCall(node) {
      // Match: test.describe(...), adminTest.describe(...)
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'describe'
      ) {
        const obj = node.callee.object;
        if (obj.type === 'Identifier' && (obj.name === 'test' || obj.name === 'adminTest')) {
          return obj.name;
        }
      }
      return null;
    }

    function isBeforeAllCall(node) {
      // Match: test.beforeAll(...), adminTest.beforeAll(...), *.beforeAll(...)
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'beforeAll'
      ) {
        return true;
      }
      return false;
    }

    function isSerialConfigure(node) {
      // Match: *.describe.configure({ mode: 'serial' })
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'configure'
      ) {
        // Check arguments for { mode: 'serial' }
        for (const arg of node.arguments) {
          if (arg.type === 'ObjectExpression') {
            for (const prop of arg.properties) {
              if (
                prop.type === 'Property' &&
                prop.key.type === 'Identifier' &&
                prop.key.name === 'mode' &&
                prop.value.type === 'Literal' &&
                prop.value.value === 'serial'
              ) {
                return true;
              }
            }
          }
        }
      }
      return false;
    }

    return {
      CallExpression(node) {
        const callerPrefix = isDescribeCall(node);
        if (callerPrefix) {
          // Push a new describe scope
          describeStack.push({
            node,
            callerPrefix,
            hasBeforeAll: false,
            hasSerial: false,
          });
          return;
        }

        // Check for beforeAll in current describe scope
        if (isBeforeAllCall(node) && describeStack.length > 0) {
          describeStack[describeStack.length - 1].hasBeforeAll = true;
          return;
        }

        // Check for serial configure in current describe scope
        if (isSerialConfigure(node) && describeStack.length > 0) {
          describeStack[describeStack.length - 1].hasSerial = true;
          return;
        }
      },

      'CallExpression:exit'(node) {
        const callerPrefix = isDescribeCall(node);
        if (callerPrefix && describeStack.length > 0) {
          const scope = describeStack.pop();
          if (scope.hasBeforeAll && !scope.hasSerial) {
            context.report({
              node: scope.node,
              messageId: 'missingSerial',
              data: { callerPrefix: scope.callerPrefix },
            });
          }
        }
      },
    };
  },
};
